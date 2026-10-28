// Carmesí Bags — web pública + panel para cargar categorías y productos.
// Node puro (http) + SQLite local vía @libsql/client. Sin frameworks para que sea liviano.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');

loadEnvFile(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3200);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SEED_DIR = path.join(__dirname, 'seed');
const COMMIT = (process.env.APP_COMMIT_SHA || readText(path.join(__dirname, '.deploy-commit')) || 'dev').trim();

const SESSION_DAYS = 30;
const MAX_BODY = 8 * 1024 * 1024;
const MAX_IMAGE = 3 * 1024 * 1024;
// Roles: super = Pixel Cuyo (todo, único que crea admins y prende el mantenimiento);
// admin = la dueña (catálogo, datos del negocio, crea vendedores);
// vendedor = colaboradores (cargan y editan productos y stock).
const ROLES = ['super', 'admin', 'vendedor'];
const USERS = [
  { username: 'admin', role: 'super', alias: 'Pixel Cuyo', envPass: 'INIT_PASS_ADMIN' },
  { username: 'valentina', role: 'admin', alias: 'Valentina', envPass: 'INIT_PASS_VALENTINA' },
];
const DEFAULT_SETTINGS = { whatsapp: '5492612554003', instagram: 'bags_carmesi' };

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const SECRET = process.env.SESSION_SECRET || getOrCreateSecret();
const db = createClient({ url: 'file:' + path.join(DATA_DIR, 'carmesi.db') });

// ---------- utilidades ----------

function loadEnvFile(file) {
  const text = readText(file);
  if (!text) return;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

function getOrCreateSecret() {
  const file = path.join(DATA_DIR, 'session-secret');
  let s = readText(file).trim();
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, s, { mode: 0o600 });
  }
  return s;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function checkPassword(password, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

function randomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (const b of crypto.randomBytes(8)) out += chars[b % chars.length];
  return out;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
// Cambia cuando cambia la contraseña: así las sesiones viejas quedan invalidadas.
const passVersion = (passHash) => crypto.createHash('sha256').update(passHash).digest('hex').slice(0, 10);

function makeToken(user) {
  const payload = b64url(JSON.stringify({ uid: user.id, pv: passVersion(user.pass_hash), exp: Date.now() + SESSION_DAYS * 864e5 }));
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isHttps(req) {
  return req.headers['x-forwarded-proto'] === 'https' || process.env.COOKIE_SECURE === '1';
}

function sessionCookie(req, value, maxAgeSec) {
  return `cb_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${isHttps(req) ? '; Secure' : ''}`;
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'La foto es demasiado grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Datos inválidos')); }
    });
    req.on('error', reject);
  });
}

// Precio en pesos enteros (acepta "22000", "22.000", "$ 22.000").
function parsePrice(value) {
  const s = String(value ?? '').replace(/[$\s.]/g, '').replace(/,\d*$/, '');
  if (!s) throw new HttpError(400, 'Poné el precio');
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > 100000000) throw new HttpError(400, 'Precio inválido');
  return n;
}

const cleanText = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

function cleanName(value, what) {
  const name = String(value || '').replace(/\s+/g, ' ').trim();
  if (!name) throw new HttpError(400, `Poné el nombre ${what}`);
  if (name.length > 60) throw new HttpError(400, 'El nombre es demasiado largo');
  return name;
}

function cleanUsername(value) {
  const u = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,20}$/.test(u)) throw new HttpError(400, 'El usuario tiene que tener de 3 a 20 letras o números, sin espacios');
  return u;
}

function cleanPassword(value) {
  const p = String(value || '');
  if (p.length < 6) throw new HttpError(400, 'La contraseña tiene que tener al menos 6 caracteres');
  if (p.length > 100) throw new HttpError(400, 'La contraseña es demasiado larga');
  return p;
}

async function checkCategoryId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Elegí una categoría');
  const r = await db.execute({ sql: 'SELECT id FROM categories WHERE id = ?', args: [id] });
  if (!r.rows.length) throw new HttpError(400, 'Esa categoría ya no existe');
  return id;
}

// Guarda una imagen JPEG/WebP que llega como data URL. Devuelve el nombre de archivo.
function saveImage(dataUrl, baseName) {
  const m = String(dataUrl || '').match(/^data:image\/(jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new HttpError(400, 'Foto inválida');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_IMAGE) throw new HttpError(413, 'La foto es demasiado grande');
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isWebp = buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP';
  if (!isJpeg && !isWebp) throw new HttpError(400, 'Foto inválida');
  const file = `${baseName}.${isJpeg ? 'jpg' : 'webp'}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, file), buf);
  return file;
}

function removeUpload(file) {
  if (file && /^[\w-]+\.(jpg|webp)$/.test(file)) fs.rm(path.join(UPLOADS_DIR, file), { force: true }, () => {});
}

const newPhotoName = () => `p${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

// ---------- base de datos ----------

async function initDb() {
  await db.execute('PRAGMA journal_mode = WAL');
  await db.batch([
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      pass_hash TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      position INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '',
      category_id INTEGER NOT NULL REFERENCES categories(id),
      price INTEGER NOT NULL,
      photo TEXT,
      thumb TEXT,
      sold_out INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
    `CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      entity_id INTEGER,
      name TEXT NOT NULL,
      who TEXT NOT NULL,
      action TEXT NOT NULL,
      changes TEXT,
      at INTEGER NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS activity_by_at ON activity (at)',
  ], 'write');

  if (!(await db.execute('PRAGMA table_info(users)')).rows.some((r) => r.name === 'alias')) {
    await db.execute("ALTER TABLE users ADD COLUMN alias TEXT NOT NULL DEFAULT ''");
  }

  // Roles viejos (admin = Pixel Cuyo, duena = Valentina) → super / admin. Una sola vez.
  if (!(await getMeta('roles_v2'))) {
    await db.execute("UPDATE users SET role = CASE role WHEN 'admin' THEN 'super' WHEN 'duena' THEN 'admin' ELSE role END");
    await db.execute("UPDATE users SET alias = 'Pixel Cuyo' WHERE username = 'admin' AND alias = ''");
    await db.execute("UPDATE users SET alias = 'Valentina' WHERE username = 'valentina' AND alias = ''");
    await setMeta('roles_v2', '1');
  }

  // Catálogo de arranque (una sola vez): lo que estaba en la web de muestra.
  if (!(await getMeta('catalog_seeded'))) {
    const seed = JSON.parse(readText(path.join(SEED_DIR, 'catalogo-inicial.json')) || '{"categorias":[],"productos":[]}');
    const now = Date.now();
    const ids = {};
    for (const [i, name] of seed.categorias.entries()) {
      const r = await db.execute({ sql: 'INSERT INTO categories (name, position, updated_at) VALUES (?, ?, ?) RETURNING id', args: [name, i, now] });
      ids[name] = r.rows[0].id;
    }
    for (const [i, p] of seed.productos.entries()) {
      let photo = null;
      const src = path.join(SEED_DIR, 'fotos', p.foto);
      if (fs.existsSync(src)) {
        photo = `${newPhotoName()}.jpg`;
        fs.copyFileSync(src, path.join(UPLOADS_DIR, photo));
      }
      await db.execute({
        sql: `INSERT INTO products (name, color, category_id, price, photo, sold_out, position, updated_by, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'sistema', ?)`,
        args: [p.nombre, p.color, ids[p.categoria], p.precio, photo, p.agotado ? 1 : 0, i, now],
      });
    }
    await setMeta('catalog_seeded', '1');
  }

  // Usuarios iniciales (una sola vez): admin (Pixel Cuyo) y valentina (la dueña).
  if (!(await getMeta('users_seeded'))) {
    const created = [];
    for (const u of USERS) {
      const pass = process.env[u.envPass] || randomPassword();
      await db.execute({ sql: 'INSERT OR IGNORE INTO users (username, role, alias, pass_hash) VALUES (?, ?, ?, ?)', args: [u.username, u.role, u.alias, hashPassword(pass)] });
      created.push(`${u.username}: ${pass}`);
    }
    await setMeta('users_seeded', '1');
    const file = path.join(DATA_DIR, 'contrasenas-iniciales.txt');
    fs.appendFileSync(file, `Usuarios creados ${new Date().toISOString()}\n${created.join('\n')}\n\n`, { mode: 0o600 });
    console.log(`Usuarios creados. Contraseñas iniciales en ${file}`);
  }
}

async function getMeta(key) {
  const r = await db.execute({ sql: 'SELECT value FROM meta WHERE key = ?', args: [key] });
  return r.rows[0] ? r.rows[0].value : null;
}

async function setMeta(key, value) {
  await db.execute({ sql: 'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', args: [key, value] });
}

// Mientras no se lance, la web arranca "en construcción" (solo Pixel Cuyo la abre desde el panel).
const inMaintenance = async () => (await getMeta('maintenance')) !== '0';

async function getSettings() {
  return {
    whatsapp: (await getMeta('whatsapp')) || DEFAULT_SETTINGS.whatsapp,
    instagram: (await getMeta('instagram')) || DEFAULT_SETTINGS.instagram,
  };
}

async function getUser(id) {
  const r = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [id] });
  return r.rows[0] || null;
}

async function currentUser(req) {
  const data = readToken(parseCookies(req).cb_session);
  if (!data) return null;
  const user = await getUser(data.uid);
  return user && passVersion(user.pass_hash) === data.pv ? user : null;
}

const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role, alias: u.alias || '' });
const whoName = (u) => (u.alias ? `${u.alias} (${u.username})` : u.username);

// Quién puede hacer qué.
const can = {
  catalog: (u) => ROLES.includes(u.role),                   // crear y editar productos, stock
  manage: (u) => u.role === 'super' || u.role === 'admin',   // borrar productos, categorías, datos del negocio, historial
  super: (u) => u.role === 'super',
  // super maneja a todos; admin solo a los vendedores.
  manageUser: (u, target) => u.role === 'super' || (u.role === 'admin' && target.role === 'vendedor'),
};

function requireRole(ok, message = 'No tenés permiso para hacer esto') {
  if (!ok) throw new HttpError(403, message);
}

// ---------- historial de cambios ----------

async function logActivity(kind, entityId, name, user, action, changes = []) {
  await db.execute({
    sql: 'INSERT INTO activity (kind, entity_id, name, who, action, changes, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [kind, entityId, name, whoName(user), action, JSON.stringify(changes), Date.now()],
  });
}

async function categoryName(id) {
  const r = await db.execute({ sql: 'SELECT name FROM categories WHERE id = ?', args: [id] });
  return r.rows[0] ? r.rows[0].name : 'sin categoría';
}

// Lista legible de lo que cambió, ej: "precio: $22.000 → $25.000".
async function describeProductChanges(before, after) {
  const out = [];
  const plata = (n) => '$' + Number(n).toLocaleString('es-AR');
  if (before.name !== after.name) out.push(`nombre: "${before.name}" → "${after.name}"`);
  if (before.color !== after.color) out.push(`color: "${before.color}" → "${after.color}"`);
  if (before.price !== after.price) out.push(`precio: ${plata(before.price)} → ${plata(after.price)}`);
  if (before.category_id !== after.category_id) out.push(`categoría: ${await categoryName(before.category_id)} → ${await categoryName(after.category_id)}`);
  if (before.sold_out !== after.sold_out) out.push(after.sold_out ? 'marcado sin stock' : 'marcado con stock');
  if (before.hidden !== after.hidden) out.push(after.hidden ? 'oculto de la web' : 'visible en la web');
  if (before.photo !== after.photo) out.push('foto nueva');
  return out;
}

const productLabel = (p) => (p.color ? `${p.name} (${p.color})` : p.name);
const photoUrl = (file) => (file ? `/uploads/${file}` : null);

function adminProduct(p) {
  return {
    id: p.id, name: p.name, color: p.color, categoryId: p.category_id, price: p.price,
    photo: photoUrl(p.photo), thumb: photoUrl(p.thumb || p.photo),
    soldOut: !!p.sold_out, hidden: !!p.hidden, position: p.position,
    updatedBy: p.updated_by, updatedAt: p.updated_at,
  };
}

const PRODUCT_ORDER = 'ORDER BY c.position, c.id, p.position, p.id';

// Lo que necesita la web pública: categorías en orden y productos visibles.
async function publicCatalog() {
  const cats = (await db.execute('SELECT id, name FROM categories ORDER BY position, id')).rows;
  const prods = (await db.execute(`SELECT p.* FROM products p JOIN categories c ON c.id = p.category_id WHERE p.hidden = 0 ${PRODUCT_ORDER}`)).rows;
  return {
    ...(await getSettings()),
    categorias: cats.map((c) => ({ id: String(c.id), nombre: c.name })),
    productos: prods.map((p) => ({
      id: String(p.id), nombre: p.name, color: p.color, categoria: String(p.category_id), precio: p.price,
      foto: photoUrl(p.photo), miniatura: photoUrl(p.thumb || p.photo), agotado: !!p.sold_out,
    })),
  };
}

async function readProductBody(req) {
  const body = await readJson(req);
  return {
    body,
    name: cleanName(body.name, 'del producto'),
    color: cleanText(body.color, 60),
    categoryId: await checkCategoryId(body.categoryId),
    price: parsePrice(body.price),
    soldOut: body.soldOut ? 1 : 0,
    hidden: body.hidden ? 1 : 0,
  };
}

// Intercambia el lugar de una fila con su vecina (para las flechitas ↑ ↓ del panel).
async function move(table, id, dir, scopeSql = '', scopeArgs = []) {
  const rows = (await db.execute({ sql: `SELECT id, position FROM ${table} ${scopeSql} ORDER BY position, id`, args: scopeArgs })).rows;
  const i = rows.findIndex((r) => r.id === id);
  const j = i + (dir === 'up' ? -1 : 1);
  if (i < 0 || j < 0 || j >= rows.length) return;
  // Renumera todo para que no queden posiciones repetidas.
  [rows[i], rows[j]] = [rows[j], rows[i]];
  await db.batch(rows.map((r, k) => ({ sql: `UPDATE ${table} SET position = ? WHERE id = ?`, args: [k, r.id] })), 'write');
}

// ---------- login: freno simple contra intentos repetidos ----------

const loginFails = new Map();
function tooManyFails(ip) {
  const f = loginFails.get(ip);
  return f && f.count >= 10 && Date.now() - f.first < 15 * 60e3;
}
function registerFail(ip) {
  const f = loginFails.get(ip);
  if (!f || Date.now() - f.first > 15 * 60e3) loginFails.set(ip, { count: 1, first: Date.now() });
  else f.count++;
}

// ---------- rutas ----------

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const ip = req.headers['x-real-ip'] || req.socket.remoteAddress;

  if (route === 'GET /api/health') return send(res, 200, { ok: true, commit: COMMIT });

  if (route === 'GET /api/catalogo') {
    // Quien entró al panel puede ver la tienda igual, para revisar cómo queda.
    // ?vista=1 lo manda la vista previa /inicio, que se ve siempre.
    const preview = url.searchParams.get('vista') === '1';
    if (!preview && (await inMaintenance()) && !(await currentUser(req))) throw new HttpError(503, 'Sitio en construcción');
    return send(res, 200, await publicCatalog(), { 'Cache-Control': 'no-cache' });
  }

  if (route === 'POST /api/login') {
    if (tooManyFails(ip)) throw new HttpError(429, 'Demasiados intentos. Esperá unos minutos.');
    const body = await readJson(req);
    const r = await db.execute({ sql: 'SELECT * FROM users WHERE username = ?', args: [String(body.username || '').trim().toLowerCase()] });
    const user = r.rows[0];
    if (!user || !checkPassword(String(body.password || ''), user.pass_hash)) {
      registerFail(ip);
      throw new HttpError(401, 'Usuario o contraseña incorrectos');
    }
    loginFails.delete(ip);
    return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(req, makeToken(user), SESSION_DAYS * 86400) });
  }

  if (route === 'POST /api/logout') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  const user = await currentUser(req);
  if (!user) throw new HttpError(401, 'Iniciá sesión');

  if (route === 'GET /api/me') return send(res, 200, { user: publicUser(user), maintenance: await inMaintenance() });

  if (route === 'PUT /api/me/password') {
    const body = await readJson(req);
    if (!checkPassword(String(body.current || ''), user.pass_hash)) throw new HttpError(400, 'La contraseña actual no es correcta');
    const passHash = hashPassword(cleanPassword(body.password));
    await db.execute({ sql: 'UPDATE users SET pass_hash = ? WHERE id = ?', args: [passHash, user.id] });
    await logActivity('user', user.id, user.username, user, 'update', ['cambió su contraseña']);
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, makeToken({ ...user, pass_hash: passHash }), SESSION_DAYS * 86400) });
  }

  // ----- modo mantenimiento (solo Pixel Cuyo): la web muestra un cartel, el panel sigue andando -----
  if (route === 'PUT /api/maintenance') {
    requireRole(can.super(user), 'Solo Pixel Cuyo puede poner la web en mantenimiento');
    const on = !!(await readJson(req)).on;
    await setMeta('maintenance', on ? '1' : '0');
    await logActivity('site', null, 'web', user, 'update', [on ? 'puso la web en mantenimiento' : 'volvió a abrir la web']);
    return send(res, 200, { maintenance: on });
  }

  // ----- datos del negocio (WhatsApp e Instagram) -----
  if (route === 'GET /api/settings') {
    requireRole(can.manage(user));
    return send(res, 200, await getSettings());
  }
  if (route === 'PUT /api/settings') {
    requireRole(can.manage(user));
    const body = await readJson(req);
    const whatsapp = String(body.whatsapp || '').replace(/\D/g, '');
    if (whatsapp.length < 10 || whatsapp.length > 15) throw new HttpError(400, 'El WhatsApp tiene que ser el número completo, ej: 5492612554003');
    const instagram = String(body.instagram || '').trim().replace(/^@/, '');
    if (instagram && !/^[\w.]{1,30}$/.test(instagram)) throw new HttpError(400, 'Usuario de Instagram inválido');
    const before = await getSettings();
    await setMeta('whatsapp', whatsapp);
    await setMeta('instagram', instagram);
    const changes = [];
    if (before.whatsapp !== whatsapp) changes.push(`WhatsApp: ${before.whatsapp} → ${whatsapp}`);
    if (before.instagram !== instagram) changes.push(`Instagram: @${before.instagram} → @${instagram}`);
    if (changes.length) await logActivity('site', null, 'datos del negocio', user, 'update', changes);
    return send(res, 200, await getSettings());
  }

  // ----- categorías -----
  if (route === 'GET /api/categories') {
    const r = await db.execute(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS count
                                FROM categories c ORDER BY c.position, c.id`);
    return send(res, 200, { categories: r.rows.map((c) => ({ id: c.id, name: c.name, count: Number(c.count) })) });
  }

  if (route === 'POST /api/categories') {
    requireRole(can.manage(user), 'Solo la dueña puede crear categorías');
    const name = cleanName((await readJson(req)).name, 'de la categoría');
    const pos = Number((await db.execute('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM categories')).rows[0].n);
    try {
      const r = await db.execute({ sql: 'INSERT INTO categories (name, position, updated_at) VALUES (?, ?, ?) RETURNING *', args: [name, pos, Date.now()] });
      await logActivity('category', r.rows[0].id, name, user, 'create');
      return send(res, 201, { category: { id: r.rows[0].id, name, count: 0 } });
    } catch (err) {
      if (/UNIQUE/i.test(String(err.message))) throw new HttpError(409, 'Ya existe una categoría con ese nombre');
      throw err;
    }
  }

  const cmove = url.pathname.match(/^\/api\/categories\/(\d+)\/move$/);
  if (cmove && req.method === 'POST') {
    requireRole(can.manage(user));
    await move('categories', Number(cmove[1]), (await readJson(req)).dir);
    return send(res, 200, { ok: true });
  }

  const cm = url.pathname.match(/^\/api\/categories\/(\d+)$/);
  if (cm) {
    requireRole(can.manage(user), 'Solo la dueña puede cambiar categorías');
    const id = Number(cm[1]);
    const existing = (await db.execute({ sql: 'SELECT * FROM categories WHERE id = ?', args: [id] })).rows[0];
    if (!existing) throw new HttpError(404, 'La categoría no existe');

    if (req.method === 'PUT') {
      const name = cleanName((await readJson(req)).name, 'de la categoría');
      try {
        await db.execute({ sql: 'UPDATE categories SET name = ?, updated_at = ? WHERE id = ?', args: [name, Date.now(), id] });
        if (name !== existing.name) await logActivity('category', id, name, user, 'update', [`nombre: "${existing.name}" → "${name}"`]);
        return send(res, 200, { ok: true });
      } catch (err) {
        if (/UNIQUE/i.test(String(err.message))) throw new HttpError(409, 'Ya existe una categoría con ese nombre');
        throw err;
      }
    }

    if (req.method === 'DELETE') {
      const n = (await db.execute({ sql: 'SELECT COUNT(*) AS n FROM products WHERE category_id = ?', args: [id] })).rows[0].n;
      if (n > 0) throw new HttpError(409, 'Primero pasá sus productos a otra categoría o borralos');
      await db.execute({ sql: 'DELETE FROM categories WHERE id = ?', args: [id] });
      await logActivity('category', id, existing.name, user, 'delete');
      return send(res, 200, { ok: true });
    }
  }

  // ----- productos -----
  if (route === 'GET /api/products') {
    const r = await db.execute(`SELECT p.* FROM products p JOIN categories c ON c.id = p.category_id ${PRODUCT_ORDER}`);
    return send(res, 200, { products: r.rows.map(adminProduct) });
  }

  if (route === 'POST /api/products') {
    requireRole(can.catalog(user));
    const p = await readProductBody(req);
    if (!p.body.photo) throw new HttpError(400, 'Sacale o elegí una foto');
    const base = newPhotoName();
    const photo = saveImage(p.body.photo, base);
    const thumb = p.body.thumb ? saveImage(p.body.thumb, `${base}-t`) : null;
    // Los nuevos aparecen primeros dentro de su categoría.
    const pos = Number((await db.execute({ sql: 'SELECT COALESCE(MIN(position), 1) - 1 AS n FROM products WHERE category_id = ?', args: [p.categoryId] })).rows[0].n);
    const r = await db.execute({
      sql: `INSERT INTO products (name, color, category_id, price, photo, thumb, sold_out, hidden, position, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      args: [p.name, p.color, p.categoryId, p.price, photo, thumb, p.soldOut, p.hidden, pos, user.username, Date.now()],
    });
    await logActivity('product', r.rows[0].id, productLabel(r.rows[0]), user, 'create');
    return send(res, 201, { product: adminProduct(r.rows[0]) });
  }

  const pmove = url.pathname.match(/^\/api\/products\/(\d+)\/move$/);
  if (pmove && req.method === 'POST') {
    requireRole(can.catalog(user));
    const id = Number(pmove[1]);
    const p = (await db.execute({ sql: 'SELECT category_id FROM products WHERE id = ?', args: [id] })).rows[0];
    if (!p) throw new HttpError(404, 'El producto no existe');
    await move('products', id, (await readJson(req)).dir, 'WHERE category_id = ?', [p.category_id]);
    return send(res, 200, { ok: true });
  }

  const m = url.pathname.match(/^\/api\/products\/(\d+)$/);
  if (m) {
    requireRole(can.catalog(user));
    const id = Number(m[1]);
    const existing = (await db.execute({ sql: 'SELECT * FROM products WHERE id = ?', args: [id] })).rows[0];
    if (!existing) throw new HttpError(404, 'El producto no existe');

    // Cambio rápido desde la lista: solo "sin stock" u "oculto".
    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const soldOut = body.soldOut === undefined ? existing.sold_out : body.soldOut ? 1 : 0;
      const hidden = body.hidden === undefined ? existing.hidden : body.hidden ? 1 : 0;
      const r = await db.execute({
        sql: 'UPDATE products SET sold_out = ?, hidden = ?, updated_by = ?, updated_at = ? WHERE id = ? RETURNING *',
        args: [soldOut, hidden, user.username, Date.now(), id],
      });
      const changes = await describeProductChanges(existing, r.rows[0]);
      if (changes.length) await logActivity('product', id, productLabel(r.rows[0]), user, 'update', changes);
      return send(res, 200, { product: adminProduct(r.rows[0]) });
    }

    if (req.method === 'PUT') {
      const p = await readProductBody(req);
      let { photo, thumb } = existing;
      if (p.body.photo) {
        const base = newPhotoName();
        photo = saveImage(p.body.photo, base);
        thumb = p.body.thumb ? saveImage(p.body.thumb, `${base}-t`) : null;
      }
      const r = await db.execute({
        sql: `UPDATE products SET name = ?, color = ?, category_id = ?, price = ?, photo = ?, thumb = ?, sold_out = ?, hidden = ?, updated_by = ?, updated_at = ?
              WHERE id = ? RETURNING *`,
        args: [p.name, p.color, p.categoryId, p.price, photo, thumb, p.soldOut, p.hidden, user.username, Date.now(), id],
      });
      if (photo !== existing.photo) { removeUpload(existing.photo); removeUpload(existing.thumb); }
      const changes = await describeProductChanges(existing, r.rows[0]);
      if (changes.length) await logActivity('product', id, productLabel(r.rows[0]), user, 'update', changes);
      return send(res, 200, { product: adminProduct(r.rows[0]) });
    }

    if (req.method === 'DELETE') {
      requireRole(can.manage(user), 'Solo la dueña puede borrar productos');
      await db.execute({ sql: 'DELETE FROM products WHERE id = ?', args: [id] });
      await logActivity('product', id, productLabel(existing), user, 'delete');
      removeUpload(existing.photo);
      removeUpload(existing.thumb);
      return send(res, 200, { ok: true });
    }
  }

  // ----- historial -----
  if (route === 'GET /api/activity') {
    requireRole(can.manage(user));
    const limit = Math.min(500, Number(url.searchParams.get('limit')) || 200);
    const r = await db.execute({ sql: 'SELECT * FROM activity ORDER BY at DESC, id DESC LIMIT ?', args: [limit] });
    return send(res, 200, {
      items: r.rows.map((a) => ({ id: a.id, kind: a.kind, name: a.name, who: a.who, action: a.action, changes: JSON.parse(a.changes || '[]'), at: a.at })),
    });
  }

  // ----- usuarios: super maneja a todos; la dueña, solo a los vendedores -----
  if (route === 'GET /api/users') {
    requireRole(can.manage(user));
    const r = await db.execute("SELECT * FROM users ORDER BY CASE role WHEN 'super' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, username");
    return send(res, 200, {
      users: r.rows.map((u) => ({ ...publicUser(u), editable: u.id !== user.id && can.manageUser(user, u) })),
    });
  }

  if (route === 'POST /api/users') {
    requireRole(can.manage(user));
    const body = await readJson(req);
    const role = String(body.role || 'vendedor');
    if (!['admin', 'vendedor'].includes(role)) throw new HttpError(400, 'Rol inválido');
    requireRole(can.manageUser(user, { role }), 'Solo Pixel Cuyo puede crear administradores');
    const username = cleanUsername(body.username);
    const alias = cleanText(body.alias, 30);
    const password = cleanPassword(body.password);
    try {
      const r = await db.execute({
        sql: 'INSERT INTO users (username, role, alias, pass_hash) VALUES (?, ?, ?, ?) RETURNING *',
        args: [username, role, alias, hashPassword(password)],
      });
      await logActivity('user', r.rows[0].id, username, user, 'create', [`rol: ${role}`]);
      return send(res, 201, { user: publicUser(r.rows[0]) });
    } catch (err) {
      if (/UNIQUE/i.test(String(err.message))) throw new HttpError(409, 'Ya existe un usuario con ese nombre');
      throw err;
    }
  }

  const um = url.pathname.match(/^\/api\/users\/(\d+)(\/password)?$/);
  if (um) {
    requireRole(can.manage(user));
    const target = await getUser(Number(um[1]));
    if (!target) throw new HttpError(404, 'Usuario no encontrado');
    if (target.id === user.id) throw new HttpError(400, 'Tu propia contraseña cambiala desde "Cambiar mi contraseña"');
    requireRole(can.manageUser(user, target), 'No podés cambiar este usuario');

    if (um[2] && req.method === 'PUT') {
      const password = cleanPassword((await readJson(req)).password);
      await db.execute({ sql: 'UPDATE users SET pass_hash = ? WHERE id = ?', args: [hashPassword(password), target.id] });
      await logActivity('user', target.id, target.username, user, 'update', ['contraseña blanqueada']);
      return send(res, 200, { ok: true });
    }

    if (!um[2] && req.method === 'DELETE') {
      if (target.role === 'super') throw new HttpError(400, 'El usuario de Pixel Cuyo no se puede borrar');
      await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [target.id] });
      await logActivity('user', target.id, target.username, user, 'delete');
      return send(res, 200, { ok: true });
    }
  }

  throw new HttpError(404, 'No encontrado');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

function serveFile(res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'No encontrado');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido');

    // Fotos de productos: públicas (las ve la web). Nombre único → se cachean para siempre.
    if (url.pathname.startsWith('/uploads/')) {
      const name = url.pathname.slice('/uploads/'.length);
      if (!/^[\w-]+\.(jpg|webp)$/.test(name)) return send(res, 404, 'No encontrado');
      return serveFile(res, path.join(UPLOADS_DIR, name), 'public, max-age=31536000, immutable');
    }

    if (url.pathname === '/panel/') return send(res, 301, '', { Location: '/panel' });
    if (url.pathname === '/inicio/') return send(res, 301, '', { Location: '/inicio' });
    // Vista previa de la tienda: se ve aunque la portada esté en construcción (Google no la indexa).
    if (url.pathname === '/inicio') {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      return serveFile(res, path.join(PUBLIC_DIR, 'index.html'), 'no-cache');
    }
    // En construcción: la tienda no se ve (ni por /index.html), el panel y las imágenes sí.
    const tienda = url.pathname === '/' || url.pathname === '/index.html';
    if (tienda && (await inMaintenance()) && !(await currentUser(req))) return serveFile(res, path.join(PUBLIC_DIR, 'construccion.html'), 'no-cache');
    const rel = url.pathname === '/' ? 'index.html'
      : url.pathname === '/panel' ? 'panel.html'
      : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'No encontrado');
    const cache = rel.startsWith('assets/') ? 'public, max-age=604800' : 'no-cache';
    return serveFile(res, file, cache);
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error(err);
    return send(res, 500, { error: 'Error del servidor. Probá de nuevo.' });
  }
}

initDb().then(() => {
  http.createServer(handle).listen(PORT, HOST, () => {
    console.log(`Carmesí escuchando en http://${HOST}:${PORT} (datos en ${DATA_DIR})`);
  });
}).catch((err) => {
  console.error('No se pudo iniciar la base de datos', err);
  process.exit(1);
});
