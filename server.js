// Carmesí Bags — web pública + panel para cargar categorías y productos.
// Node puro (http) + SQLite local vía @libsql/client. Sin frameworks para que sea liviano.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');
const { buildXlsx } = require('./xlsx');

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

// Copia cifrada de cada contraseña para que Pixel Cuyo pueda verlas desde el panel.
// El login sigue usando el hash; esto solo sirve para mostrarlas. Llave propia en DATA_DIR.
const VAULT_KEY = (() => {
  const file = path.join(DATA_DIR, 'vault-key');
  let k = readText(file).trim();
  if (!k) {
    k = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, k, { mode: 0o600 });
  }
  return Buffer.from(k, 'hex');
})();

function sealPassword(password) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', VAULT_KEY, iv);
  const data = Buffer.concat([c.update(String(password), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

function openPassword(sealed) {
  try {
    const [iv, tag, data] = String(sealed || '').split('.').map((s) => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', VAULT_KEY, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch { return null; }
}

async function setPassword(userId, password) {
  const passHash = hashPassword(password);
  await db.execute({ sql: 'UPDATE users SET pass_hash = ?, pass_view = ? WHERE id = ?', args: [passHash, sealPassword(password), userId] });
  return passHash;
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

// Precio anterior (oferta): opcional; si se pone, tiene que ser más alto que el actual.
function parseOldPrice(value, price) {
  if (!String(value ?? '').replace(/[$s.,]/g, '')) return null;
  const n = parsePrice(value);
  if (n <= price) throw new HttpError(400, 'El precio anterior tiene que ser más alto que el precio actual');
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

  const userCols = (await db.execute('PRAGMA table_info(users)')).rows.map((r) => r.name);
  if (!userCols.includes('alias')) await db.execute("ALTER TABLE users ADD COLUMN alias TEXT NOT NULL DEFAULT ''");
  if (!userCols.includes('pass_view')) await db.execute('ALTER TABLE users ADD COLUMN pass_view TEXT');
  // Quién creó cada usuario: una admin maneja solo a los subadmins que creó ella.
  if (!userCols.includes('created_by_id')) await db.execute('ALTER TABLE users ADD COLUMN created_by_id INTEGER');
  // Descripción opcional de cada producto (medidas, material, detalles).
  if (!(await db.execute('PRAGMA table_info(products)')).rows.some((r) => r.name === 'description')) {
    await db.execute("ALTER TABLE products ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  }
  // Precio anterior tachado (oferta): vacío = sin oferta.
  if (!(await db.execute('PRAGMA table_info(products)')).rows.some((r) => r.name === 'old_price')) {
    await db.execute('ALTER TABLE products ADD COLUMN old_price INTEGER');
  }
  // Fotos extra de cada producto (otros ángulos): lista de archivos en JSON, hasta 3.
  if (!(await db.execute('PRAGMA table_info(products)')).rows.some((r) => r.name === 'gallery')) {
    await db.execute("ALTER TABLE products ADD COLUMN gallery TEXT NOT NULL DEFAULT '[]'");
  }

  // Rol de quien hizo cada cambio: así lo de Pixel Cuyo no se le muestra a la dueña.
  const actCols = (await db.execute('PRAGMA table_info(activity)')).rows.map((r) => r.name);
  if (!actCols.includes('actor_role')) {
    await db.execute('ALTER TABLE activity ADD COLUMN actor_id INTEGER');
    await db.execute('ALTER TABLE activity ADD COLUMN actor_role TEXT');
    // Cambios viejos: el rol sale del "(usuario)" del final.
    for (const u of (await db.execute('SELECT id, username, role FROM users')).rows) {
      await db.execute({ sql: "UPDATE activity SET actor_id = ?, actor_role = ? WHERE who = ? OR who LIKE ?", args: [u.id, u.role, u.username, `% (${u.username})`] });
    }
  }

  // Recupera las contraseñas iniciales que siguen vigentes (las que nadie cambió todavía).
  const initial = readText(path.join(DATA_DIR, 'contrasenas-iniciales.txt'));
  if (initial) {
    const sinCopia = (await db.execute('SELECT id, username, pass_hash FROM users WHERE pass_view IS NULL')).rows;
    for (const u of sinCopia) {
      const name = u.username.replace(/[.\-]/g, '\\$&');
      const vigente = [...initial.matchAll(new RegExp(`^${name}: (\\S+)$`, 'gm'))].map((m) => m[1]).find((p) => checkPassword(p, u.pass_hash));
      if (vigente) await db.execute({ sql: 'UPDATE users SET pass_view = ? WHERE id = ?', args: [sealPassword(vigente), u.id] });
    }
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
      await db.execute({ sql: 'INSERT OR IGNORE INTO users (username, role, alias, pass_hash, pass_view) VALUES (?, ?, ?, ?, ?)', args: [u.username, u.role, u.alias, hashPassword(pass), sealPassword(pass)] });
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

// Permisos que Pixel Cuyo prende o apaga por rol desde el panel (super siempre tiene todo).
// Ver contraseñas, cupos, permisos y la web en construcción es solo de super, fijo.
const PERMISSIONS = [
  { key: 'products_edit', label: 'Cargar y editar productos y stock' },
  { key: 'products_delete', label: 'Borrar productos' },
  { key: 'categories', label: 'Crear, ordenar y borrar categorías' },
  { key: 'settings', label: 'Cambiar WhatsApp e Instagram' },
  { key: 'activity', label: 'Ver el historial de cambios' },
  { key: 'users', label: 'Crear vendedores y cambiarles la contraseña' },
  { key: 'admins', label: 'Crear subadministradores y cambiarles la contraseña' },
];
const DEFAULT_PERMS = {
  admin: { products_edit: true, products_delete: true, categories: true, settings: true, activity: true, users: true, admins: true },
  vendedor: { products_edit: true, products_delete: false, categories: false, settings: false, activity: false, users: false, admins: false },
};
let PERMS = DEFAULT_PERMS;

async function loadPerms() {
  let saved = {};
  try { saved = JSON.parse((await getMeta('permissions')) || '{}'); } catch { saved = {}; }
  PERMS = {};
  for (const role of Object.keys(DEFAULT_PERMS)) {
    PERMS[role] = {};
    for (const { key } of PERMISSIONS) PERMS[role][key] = typeof saved[role]?.[key] === 'boolean' ? saved[role][key] : DEFAULT_PERMS[role][key];
  }
}

// Quién puede hacer qué.
const can = {
  super: (u) => u.role === 'super',
  do: (u, key) => u.role === 'super' || !!PERMS[u.role]?.[key],
  // super maneja a todos; los demás (con el permiso) a los vendedores y a los subadmins que crearon ellos.
  manageUser: (u, target) => u.role === 'super'
    || (target.role === 'vendedor' && can.do(u, 'users'))
    || (target.role === 'admin' && can.do(u, 'admins') && target.created_by_id === u.id),
  createRole: (u, role) => u.role === 'super' || (role === 'vendedor' && can.do(u, 'users')) || (role === 'admin' && can.do(u, 'admins')),
  seeUsers: (u) => can.do(u, 'users') || can.do(u, 'admins'),
};
const permsOf = (u) => Object.fromEntries(PERMISSIONS.map(({ key }) => [key, can.do(u, key)]));

function requireRole(ok, message = 'No tenés permiso para hacer esto') {
  if (!ok) throw new HttpError(403, message);
}

// ---------- historial de cambios ----------

async function logActivity(kind, entityId, name, user, action, changes = []) {
  await db.execute({
    sql: 'INSERT INTO activity (kind, entity_id, name, who, action, changes, at, actor_id, actor_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    args: [kind, entityId, name, whoName(user), action, JSON.stringify(changes), Date.now(), user.id, user.role],
  });
}

// La dueña y su equipo no ven lo que hace Pixel Cuyo.
const activityScope = (u) => (u.role === 'super' ? '' : "AND (actor_role IS NULL OR actor_role != 'super')");

// El historial guarda solo los últimos 6 meses (para no llenar el servidor).
const ACTIVITY_DAYS = 183;
const ACTIVITY_WARN_DAYS = 10; // aviso en la campanita antes de que se borre
const ZONA = 'America/Argentina/Mendoza';
const fechaAR = (ms) => new Date(ms).toLocaleDateString('es-AR', { timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric' });
const horaAR = (ms) => new Date(ms).toLocaleTimeString('es-AR', { timeZone: ZONA, hour: '2-digit', minute: '2-digit' });
async function trimActivity() {
  const r = await db.execute({ sql: 'DELETE FROM activity WHERE at < ?', args: [Date.now() - ACTIVITY_DAYS * 864e5] });
  if (r.rowsAffected) console.log(`Historial: ${r.rowsAffected} cambios de hace más de 6 meses borrados`);
}

// Cupos de perfiles: los primeros son gratis; los siguientes, pago único (lo habilita Pixel Cuyo).
const DEFAULT_QUOTAS = {
  admin: { gratis: 2, precio: 25000, extra: 0 },     // la dueña + 1 subadmin
  vendedor: { gratis: 3, precio: 10000, extra: 0 },
};

async function getQuotas() {
  let saved = {};
  try { saved = JSON.parse((await getMeta('quotas')) || '{}'); } catch { saved = {}; }
  const out = {};
  for (const role of Object.keys(DEFAULT_QUOTAS)) {
    out[role] = {};
    for (const k of Object.keys(DEFAULT_QUOTAS[role])) {
      const v = Number(saved[role]?.[k]);
      out[role][k] = Number.isInteger(v) && v >= 0 ? v : DEFAULT_QUOTAS[role][k];
    }
    out[role].usados = Number((await db.execute({ sql: 'SELECT COUNT(*) AS n FROM users WHERE role = ?', args: [role] })).rows[0].n);
    out[role].limite = out[role].gratis + out[role].extra;
  }
  return out;
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
  if ((before.description || '') !== (after.description || '')) out.push(after.description ? 'descripción nueva' : 'descripción borrada');
  if (before.price !== after.price) out.push(`precio: ${plata(before.price)} → ${plata(after.price)}`);
  if ((before.old_price || null) !== (after.old_price || null)) out.push(after.old_price ? `oferta: antes ${plata(after.old_price)}` : 'oferta quitada');
  if (before.category_id !== after.category_id) out.push(`categoría: ${await categoryName(before.category_id)} → ${await categoryName(after.category_id)}`);
  if (before.sold_out !== after.sold_out) out.push(after.sold_out ? 'marcado sin stock' : 'marcado con stock');
  if (before.hidden !== after.hidden) out.push(after.hidden ? 'oculto de la web' : 'visible en la web');
  if (before.photo !== after.photo) out.push('foto principal nueva');
  const antes = galleryOf(before), despues = galleryOf(after);
  if (antes.join() !== despues.join()) out.push(`fotos: ${antes.length + 1} → ${despues.length + 1}`);
  return out;
}

const productLabel = (p) => (p.color ? `${p.name} (${p.color})` : p.name);
const photoUrl = (file) => (file ? `/uploads/${file}` : null);

const MAX_EXTRA_PHOTOS = 3; // + la principal = 4 fotos por producto

function galleryOf(p) {
  try {
    const g = JSON.parse(p.gallery || '[]');
    return Array.isArray(g) ? g.filter((f) => /^[\w-]+\.(jpg|webp)$/.test(f)) : [];
  } catch { return []; }
}

// Las fotos extra llegan en orden: "/uploads/archivo.jpg" (ya estaba) o una foto nueva (data URL).
function saveGallery(list, before) {
  if (!Array.isArray(list)) return before;
  if (list.length > MAX_EXTRA_PHOTOS) throw new HttpError(400, `Son hasta ${MAX_EXTRA_PHOTOS + 1} fotos por producto`);
  return list.map((item, i) => {
    const vieja = String(item).match(/^\/uploads\/([\w-]+\.(?:jpg|webp))$/);
    if (vieja) {
      if (!before.includes(vieja[1])) throw new HttpError(400, 'Foto inválida');
      return vieja[1];
    }
    return saveImage(item, `${newPhotoName()}-${i + 1}`);
  });
}

function adminProduct(p) {
  return {
    id: p.id, name: p.name, color: p.color, description: p.description || '', categoryId: p.category_id, price: p.price, oldPrice: p.old_price || null,
    photo: photoUrl(p.photo), thumb: photoUrl(p.thumb || p.photo),
    gallery: galleryOf(p).map(photoUrl),
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
      id: String(p.id), nombre: p.name, color: p.color, descripcion: p.description || '', categoria: String(p.category_id), precio: p.price, precioAnterior: p.old_price || null,
      foto: photoUrl(p.photo), miniatura: photoUrl(p.thumb || p.photo), agotado: !!p.sold_out,
      fotos: [p.photo, ...galleryOf(p)].filter(Boolean).map(photoUrl),
    })),
  };
}

// Texto libre con renglones: se limpian espacios de más y se corta en 1000 caracteres.
function cleanDescription(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1000);
}

async function readProductBody(req) {
  const body = await readJson(req);
  const price = parsePrice(body.price);
  return {
    body,
    name: cleanName(body.name, 'del producto'),
    color: cleanText(body.color, 60),
    description: cleanDescription(body.description),
    categoryId: await checkCategoryId(body.categoryId),
    price,
    oldPrice: parseOldPrice(body.oldPrice, price),
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
    // Contraseñas puestas antes de existir la copia cifrada: se guardan al entrar.
    if (!user.pass_view) await db.execute({ sql: 'UPDATE users SET pass_view = ? WHERE id = ?', args: [sealPassword(String(body.password)), user.id] });
    return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(req, makeToken(user), SESSION_DAYS * 86400) });
  }

  if (route === 'POST /api/logout') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  const user = await currentUser(req);
  if (!user) throw new HttpError(401, 'Iniciá sesión');

  if (route === 'GET /api/me') return send(res, 200, { user: publicUser(user), perms: permsOf(user), maintenance: await inMaintenance() });

  // ----- niveles y permisos (solo Pixel Cuyo) -----
  if (route === 'GET /api/permissions') {
    requireRole(can.super(user), 'Solo Pixel Cuyo ve los permisos');
    return send(res, 200, { permissions: PERMISSIONS, roles: PERMS });
  }
  if (route === 'PUT /api/permissions') {
    requireRole(can.super(user), 'Solo Pixel Cuyo cambia los permisos');
    const body = await readJson(req);
    const before = PERMS;
    const next = {};
    for (const role of Object.keys(DEFAULT_PERMS)) {
      next[role] = {};
      for (const { key } of PERMISSIONS) next[role][key] = typeof body[role]?.[key] === 'boolean' ? body[role][key] : before[role][key];
    }
    await setMeta('permissions', JSON.stringify(next));
    await loadPerms();
    const changes = [];
    for (const role of Object.keys(next)) {
      for (const p of PERMISSIONS) {
        if (before[role][p.key] !== PERMS[role][p.key]) changes.push(`${role}: ${PERMS[role][p.key] ? 'puede' : 'ya no puede'} ${p.label.toLowerCase()}`);
      }
    }
    if (changes.length) await logActivity('site', null, 'permisos', user, 'update', changes);
    return send(res, 200, { roles: PERMS });
  }

  if (route === 'PUT /api/me/password') {
    const body = await readJson(req);
    if (!checkPassword(String(body.current || ''), user.pass_hash)) throw new HttpError(400, 'La contraseña actual no es correcta');
    const passHash = await setPassword(user.id, cleanPassword(body.password));
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
    requireRole(can.do(user, 'settings'));
    return send(res, 200, await getSettings());
  }
  if (route === 'PUT /api/settings') {
    requireRole(can.do(user, 'settings'));
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
    requireRole(can.do(user, 'categories'), 'No tenés permiso para crear categorías');
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
    requireRole(can.do(user, 'categories'));
    await move('categories', Number(cmove[1]), (await readJson(req)).dir);
    return send(res, 200, { ok: true });
  }

  const cm = url.pathname.match(/^\/api\/categories\/(\d+)$/);
  if (cm) {
    requireRole(can.do(user, 'categories'), 'No tenés permiso para cambiar categorías');
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
    requireRole(can.do(user, 'products_edit'), 'No tenés permiso para cargar o editar productos');
    const p = await readProductBody(req);
    if (!p.body.photo) throw new HttpError(400, 'Sacale o elegí una foto');
    const base = newPhotoName();
    const photo = saveImage(p.body.photo, base);
    const thumb = p.body.thumb ? saveImage(p.body.thumb, `${base}-t`) : null;
    const gallery = saveGallery(p.body.gallery, []);
    // Los nuevos aparecen primeros dentro de su categoría.
    const pos = Number((await db.execute({ sql: 'SELECT COALESCE(MIN(position), 1) - 1 AS n FROM products WHERE category_id = ?', args: [p.categoryId] })).rows[0].n);
    const r = await db.execute({
      sql: `INSERT INTO products (name, color, description, category_id, price, old_price, photo, thumb, gallery, sold_out, hidden, position, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      args: [p.name, p.color, p.description, p.categoryId, p.price, p.oldPrice, photo, thumb, JSON.stringify(gallery), p.soldOut, p.hidden, pos, user.username, Date.now()],
    });
    await logActivity('product', r.rows[0].id, productLabel(r.rows[0]), user, 'create');
    return send(res, 201, { product: adminProduct(r.rows[0]) });
  }

  const pmove = url.pathname.match(/^\/api\/products\/(\d+)\/move$/);
  if (pmove && req.method === 'POST') {
    requireRole(can.do(user, 'products_edit'), 'No tenés permiso para cargar o editar productos');
    const id = Number(pmove[1]);
    const p = (await db.execute({ sql: 'SELECT category_id FROM products WHERE id = ?', args: [id] })).rows[0];
    if (!p) throw new HttpError(404, 'El producto no existe');
    await move('products', id, (await readJson(req)).dir, 'WHERE category_id = ?', [p.category_id]);
    return send(res, 200, { ok: true });
  }

  const m = url.pathname.match(/^\/api\/products\/(\d+)$/);
  if (m) {
    requireRole(can.do(user, 'products_edit'), 'No tenés permiso para cargar o editar productos');
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
      const galleryBefore = galleryOf(existing);
      const gallery = saveGallery(p.body.gallery, galleryBefore);
      const r = await db.execute({
        sql: `UPDATE products SET name = ?, color = ?, description = ?, category_id = ?, price = ?, old_price = ?, photo = ?, thumb = ?, gallery = ?, sold_out = ?, hidden = ?, updated_by = ?, updated_at = ?
              WHERE id = ? RETURNING *`,
        args: [p.name, p.color, p.description, p.categoryId, p.price, p.oldPrice, photo, thumb, JSON.stringify(gallery), p.soldOut, p.hidden, user.username, Date.now(), id],
      });
      if (photo !== existing.photo) { removeUpload(existing.photo); removeUpload(existing.thumb); }
      galleryBefore.filter((f) => !gallery.includes(f)).forEach(removeUpload);
      const changes = await describeProductChanges(existing, r.rows[0]);
      if (changes.length) await logActivity('product', id, productLabel(r.rows[0]), user, 'update', changes);
      return send(res, 200, { product: adminProduct(r.rows[0]) });
    }

    if (req.method === 'DELETE') {
      requireRole(can.do(user, 'products_delete'), 'No tenés permiso para borrar productos');
      await db.execute({ sql: 'DELETE FROM products WHERE id = ?', args: [id] });
      await logActivity('product', id, productLabel(existing), user, 'delete');
      removeUpload(existing.photo);
      removeUpload(existing.thumb);
      galleryOf(existing).forEach(removeUpload);
      return send(res, 200, { ok: true });
    }
  }

  // ----- historial -----
  if (route === 'GET /api/activity') {
    requireRole(can.do(user, 'activity'));
    // Rango opcional (lo arma el celu con su hora local): from/to en milisegundos.
    const from = Number(url.searchParams.get('from')) || 0;
    const to = Number(url.searchParams.get('to')) || Date.now() + 864e5;
    const limit = Math.min(500, Number(url.searchParams.get('limit')) || 200);
    const r = await db.execute({ sql: `SELECT * FROM activity WHERE at >= ? AND at < ? ${activityScope(user)} ORDER BY at DESC, id DESC LIMIT ?`, args: [from, to, limit] });
    return send(res, 200, {
      items: r.rows.map((a) => ({ id: a.id, kind: a.kind, name: a.name, who: a.who, action: a.action, changes: JSON.parse(a.changes || '[]'), at: a.at })),
    });
  }

  // Descargar el historial en Excel (mismo filtro que la pantalla: sin lo de Pixel Cuyo para el resto).
  if (route === 'GET /api/activity/export') {
    requireRole(can.do(user, 'activity'));
    const from = Number(url.searchParams.get('from')) || 0;
    const to = Number(url.searchParams.get('to')) || Date.now() + 864e5;
    const r = await db.execute({ sql: `SELECT * FROM activity WHERE at >= ? AND at < ? ${activityScope(user)} ORDER BY at, id`, args: [from, to] });
    const ACCION = { create: 'Creó', update: 'Cambió', delete: 'Borró', export: 'Descargó' };
    const TIPO = { product: 'Producto', category: 'Categoría', user: 'Usuario', site: 'Web' };
    const rows = [['Fecha', 'Hora', 'Quién', 'Acción', 'Tipo', 'Qué', 'Detalle']];
    for (const a of r.rows) {
      rows.push([fechaAR(a.at), horaAR(a.at), a.who, ACCION[a.action] || a.action, TIPO[a.kind] || a.kind, a.name, JSON.parse(a.changes || '[]').join(' · ')]);
    }
    const xlsx = buildXlsx({ sheetName: 'Historial', rows, widths: [12, 8, 26, 10, 12, 34, 60] });
    const nombre = `historial-carmesi-${fechaAR(from || (r.rows[0] ? r.rows[0].at : Date.now())).replace(/\//g, '-')}-al-${fechaAR(Math.min(to, Date.now())).replace(/\//g, '-')}.xlsx`;
    await logActivity('site', null, 'el historial en Excel', user, 'export', [`${r.rows.length} cambios`]);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'Content-Length': xlsx.length,
      'Cache-Control': 'no-store',
    });
    return res.end(xlsx);
  }

  // 🔔 Avisos de la campanita.
  if (route === 'GET /api/avisos') {
    const avisos = [];
    if (can.do(user, 'activity')) {
      // Cambios que se borran en los próximos 10 días.
      const limite = Date.now() - (ACTIVITY_DAYS - ACTIVITY_WARN_DAYS) * 864e5;
      const r = await db.execute({ sql: `SELECT COUNT(*) AS n, MIN(at) AS viejo FROM activity WHERE at < ? ${activityScope(user)}`, args: [limite] });
      const { n, viejo } = r.rows[0];
      if (Number(n) > 0) {
        const borra = Number(viejo) + ACTIVITY_DAYS * 864e5;
        const dias = Math.max(0, Math.ceil((borra - Date.now()) / 864e5));
        avisos.push({
          id: 'borrado',
          icono: '🗓️',
          titulo: `${n} ${Number(n) === 1 ? 'cambio del historial se borra' : 'cambios del historial se borran'} ${dias <= 1 ? 'mañana' : `en ${dias} días`}`,
          texto: `El historial guarda 6 meses. Lo del ${fechaAR(Number(viejo))} se borra el ${fechaAR(borra)}. Si lo querés guardar, bajalo en Excel antes.`,
          descargar: { from: 0, to: limite },
        });
      }
    }
    return send(res, 200, { avisos });
  }

  // Para marcar en el almanaque qué días tuvieron movimiento.
  if (route === 'GET /api/activity/stamps') {
    requireRole(can.do(user, 'activity'));
    const from = Number(url.searchParams.get('from')) || 0;
    const to = Number(url.searchParams.get('to')) || Date.now() + 864e5;
    const r = await db.execute({ sql: `SELECT at FROM activity WHERE at >= ? AND at < ? ${activityScope(user)} ORDER BY at`, args: [from, to] });
    return send(res, 200, { stamps: r.rows.map((a) => a.at), days: ACTIVITY_DAYS });
  }

  // ----- cupos de perfiles -----
  if (route === 'GET /api/quotas') {
    requireRole(can.seeUsers(user));
    return send(res, 200, { quotas: await getQuotas() });
  }
  if (route === 'PUT /api/quotas') {
    requireRole(can.super(user), 'Solo Pixel Cuyo cambia los cupos');
    const body = await readJson(req);
    const before = await getQuotas();
    const next = {};
    const changes = [];
    for (const role of Object.keys(DEFAULT_QUOTAS)) {
      next[role] = {};
      for (const k of Object.keys(DEFAULT_QUOTAS[role])) {
        const v = Number(body[role]?.[k]);
        next[role][k] = Number.isInteger(v) && v >= 0 && v <= 100000000 ? v : before[role][k];
        if (next[role][k] !== before[role][k]) changes.push(`${role} ${k}: ${before[role][k]} → ${next[role][k]}`);
      }
    }
    await setMeta('quotas', JSON.stringify(next));
    if (changes.length) await logActivity('site', null, 'cupos de perfiles', user, 'update', changes);
    return send(res, 200, { quotas: await getQuotas() });
  }

  // ----- usuarios: super maneja a todos; la dueña, a sus vendedores y subadmins -----
  if (route === 'GET /api/users') {
    requireRole(can.seeUsers(user));
    const r = await db.execute("SELECT * FROM users ORDER BY CASE role WHEN 'super' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, username");
    return send(res, 200, {
      // La dueña y su equipo no ven el usuario de Pixel Cuyo.
      users: r.rows.filter((u) => can.super(user) || u.role !== 'super').map((u) => ({
        ...publicUser(u),
        editable: u.id !== user.id && can.manageUser(user, u),
        // Solo Pixel Cuyo ve las contraseñas (null = todavía no hay copia guardada).
        ...(can.super(user) ? { password: openPassword(u.pass_view) } : {}),
      })),
    });
  }

  if (route === 'POST /api/users') {
    requireRole(can.seeUsers(user));
    const body = await readJson(req);
    const role = String(body.role || 'vendedor');
    if (!['admin', 'vendedor'].includes(role)) throw new HttpError(400, 'Rol inválido');
    requireRole(can.createRole(user, role), role === 'admin' ? 'No tenés permiso para crear subadministradores' : 'No tenés permiso para crear vendedores');
    const username = cleanUsername(body.username);
    const alias = cleanText(body.alias, 30);
    const password = cleanPassword(body.password);
    // Pixel Cuyo no tiene límite; el resto, hasta los cupos gratis más los que se pagaron.
    if (!can.super(user)) {
      const q = (await getQuotas())[role];
      if (q.usados >= q.limite) {
        const err = new HttpError(402, `Llegaste al límite de ${role === 'admin' ? 'administradores' : 'vendedores'}. Cada perfil más cuesta $` + `${q.precio.toLocaleString('es-AR')} (pago único).`);
        err.extra = { cupo: { role, precio: q.precio } };
        throw err;
      }
    }
    try {
      const r = await db.execute({
        sql: 'INSERT INTO users (username, role, alias, pass_hash, pass_view, created_by_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
        args: [username, role, alias, hashPassword(password), sealPassword(password), user.id],
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
    requireRole(can.seeUsers(user));
    const target = await getUser(Number(um[1]));
    if (!target) throw new HttpError(404, 'Usuario no encontrado');
    if (target.id === user.id) throw new HttpError(400, 'Tu propia contraseña cambiala desde "Cambiar mi contraseña"');
    requireRole(can.manageUser(user, target), 'No podés cambiar este usuario');

    if (um[2] && req.method === 'PUT') {
      const password = cleanPassword((await readJson(req)).password);
      await setPassword(target.id, password);
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
  '.onnx': 'application/octet-stream',
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
    // Siempre, aunque esté logueado: la tienda se revisa en /inicio.
    if (tienda && (await inMaintenance())) return serveFile(res, path.join(PUBLIC_DIR, 'construccion.html'), 'no-cache');
    const rel = url.pathname === '/' ? 'index.html'
      : url.pathname === '/panel' ? 'panel.html'
      : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'No encontrado');
    const cache = rel.startsWith('assets/') ? 'public, max-age=604800' : 'no-cache';
    return serveFile(res, file, cache);
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message, ...(err.extra || {}) });
    console.error(err);
    return send(res, 500, { error: 'Error del servidor. Probá de nuevo.' });
  }
}

initDb().then(loadPerms).then(trimActivity).then(() => {
  setInterval(() => trimActivity().catch((e) => console.error(e)), 12 * 3600e3);
  http.createServer(handle).listen(PORT, HOST, () => {
    console.log(`Carmesí escuchando en http://${HOST}:${PORT} (datos en ${DATA_DIR})`);
  });
}).catch((err) => {
  console.error('No se pudo iniciar la base de datos', err);
  process.exit(1);
});
