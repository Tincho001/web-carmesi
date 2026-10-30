// Carmesí Bags — web pública + panel para cargar categorías y productos.
// Node puro (http) + SQLite local vía @libsql/client. Sin frameworks para que sea liviano.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');
const { buildXlsx } = require('./xlsx');
const NOVEDADES = require('./novedades');

loadEnvFile(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3200);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
// Copias de seguridad: al lado de los datos (en el servidor, /var/www/carmesi-backups).
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(path.dirname(DATA_DIR), 'carmesi-backups'));
const BACKUP_KEEP_DAYS = 14;
const NUEVO_DIAS = 15; // un producto lleva la etiqueta "Nuevo" sus primeros 15 días
const PUBLIC_DIR = path.join(__dirname, 'public');
const SITE_URL = (process.env.SITE_URL || 'https://carmesibags.com.ar').replace(/\/+$/, '');
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
const DEFAULT_SETTINGS = { whatsapp: '5492612554003', instagram: 'bags_carmesi', tiktok: 'bags_carmesi' };

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

// "Ver como": Pixel Cuyo mira el panel como otro usuario sin cerrar su sesión.
// Es una cookie aparte, firmada, que solo vale junto con la sesión de Pixel Cuyo que la creó (no sirve para entrar sola).
const COMO_HORAS = 12;
function comoCookie(req, target, superUser) {
  if (!target) return `cb_como=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`;
  const payload = b64url(JSON.stringify({ como: target.id, by: superUser.id, exp: Date.now() + COMO_HORAS * 3600e3 }));
  return `cb_como=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COMO_HORAS * 3600}${isHttps(req) ? '; Secure' : ''}`;
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
  // Último día en que cada uno cerró el aviso de la cuota (sale una vez por día).
  if (!userCols.includes('fee_notice_day')) await db.execute("ALTER TABLE users ADD COLUMN fee_notice_day TEXT NOT NULL DEFAULT ''");
  // "Para arrancar": qué primeros pasos ya hizo cada uno.
  if (!userCols.includes('first_steps')) await db.execute("ALTER TABLE users ADD COLUMN first_steps TEXT NOT NULL DEFAULT '[]'");
  // Hasta qué novedad del panel leyó cada uno.
  if (!userCols.includes('news_seen')) await db.execute('ALTER TABLE users ADD COLUMN news_seen INTEGER NOT NULL DEFAULT 0');
  // Descripción opcional de cada producto (medidas, material, detalles).
  if (!(await db.execute('PRAGMA table_info(products)')).rows.some((r) => r.name === 'description')) {
    await db.execute("ALTER TABLE products ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  }
  // Precio anterior tachado (oferta): vacío = sin oferta.
  if (!(await db.execute('PRAGMA table_info(products)')).rows.some((r) => r.name === 'old_price')) {
    await db.execute('ALTER TABLE products ADD COLUMN old_price INTEGER');
  }
  // Cuándo se cargó cada producto (para la etiqueta "Nuevo"). Los que ya estaban quedan sin fecha.
  if (!(await db.execute('PRAGMA table_info(products)')).rows.some((r) => r.name === 'created_at')) {
    await db.execute('ALTER TABLE products ADD COLUMN created_at INTEGER');
  }
  // Noticias que Pixel Cuyo escribe desde su panel para el equipo (se suman a las de novedades.js).
  await db.execute(`CREATE TABLE IF NOT EXISTS panel_news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    icono TEXT NOT NULL DEFAULT '📣',
    titulo TEXT NOT NULL,
    texto TEXT NOT NULL,
    para TEXT NOT NULL DEFAULT 'todos',
    created_at INTEGER NOT NULL
  )`);
  // Qué noticia vio cada uno: si ya le saltó la ventanita y si ya la leyó (si no, queda en la campanita).
  await db.execute(`CREATE TABLE IF NOT EXISTS news_state (
    user_id INTEGER NOT NULL,
    news_key TEXT NOT NULL,
    popup_at INTEGER,
    read_at INTEGER,
    PRIMARY KEY (user_id, news_key)
  )`);
  // Cambios que los administradores le piden a Pixel Cuyo (hasta 3 por mes entre todas).
  await db.execute(`CREATE TABLE IF NOT EXISTS change_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    who TEXT NOT NULL,
    text TEXT NOT NULL,
    month TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'nuevo',
    updated_at INTEGER
  )`);
  // Si el pedido cuenta para el cupo del mes (Pixel Cuyo puede devolverlo).
  if (!(await db.execute('PRAGMA table_info(change_requests)')).rows.some((r) => r.name === 'counts')) {
    await db.execute('ALTER TABLE change_requests ADD COLUMN counts INTEGER NOT NULL DEFAULT 1');
  }
  // "Avisame cuando vuelva": clientes que dejaron su WhatsApp en un producto sin stock.
  await db.execute(`CREATE TABLE IF NOT EXISTS stock_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    notified_at INTEGER
  )`);
  // Qué miran los clientes: un contador por producto, día y tipo (vista, agregado, whatsapp, compartir, pedido).
  await db.execute(`CREATE TABLE IF NOT EXISTS product_stats (
    product_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    kind TEXT NOT NULL,
    n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (product_id, day, kind)
  )`);
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

// Preguntas frecuentes de la tienda: las edita la dueña desde el panel.
const DEFAULT_FAQ = [
  { q: '¿Cómo hago un pedido?', a: 'Elegí los productos que te gustan, tocá "Agregar al pedido" y después "Enviar pedido por WhatsApp". Te respondemos para coordinar todo.' },
  { q: '¿Hacen envíos?', a: 'Sí, coordinamos la entrega o el envío en Gran Mendoza: Capital, Godoy Cruz, Guaymallén, Las Heras, Maipú y Luján de Cuyo. Escribinos y te pasamos el costo.' },
  { q: '¿Cómo puedo pagar?', a: 'El pago lo coordinamos por WhatsApp. Escribinos y te contamos las opciones.' },
  { q: '¿Qué pasa si un producto no tiene stock?', a: 'Tocá "Avisame cuando vuelva", dejá tu WhatsApp y te escribimos apenas entre de nuevo.' },
];
// Textos de la tienda que edita la dueña: el "Carmesí Bags" de abajo y las frases de la cinta.
const DEFAULT_TEXTOS = {
  sobreTitulo: 'Carmesí Bags',
  sobre: `Somos una tienda de **carteras y bolsos en Mendoza**. Tenemos carteras, bolsos tote, set materos, organizadores, neceseres y porta botellas, en distintos colores y estampados.

Elegís lo que te gusta desde la web y nos mandás el pedido por WhatsApp. Coordinamos la entrega o el envío en **Capital, Godoy Cruz, Guaymallén, Las Heras, Maipú y Luján de Cuyo**.`,
  cinta: ['✨ Nuevos ingresos', '💬 Pedidos por WhatsApp', '🚚 Coordinamos entrega o envío', '👜 Carteras y bolsos en Mendoza', '🔔 Te avisamos cuando vuelve el stock'],
};
async function getTextos() {
  let saved = {};
  try { saved = JSON.parse((await getMeta('textos')) || '{}'); } catch { saved = {}; }
  return { ...DEFAULT_TEXTOS, ...saved };
}

// Anuncios para los clientes: una tarjeta que sube desde abajo y una barrita fina arriba. Los maneja la dueña.
const DEFAULT_ANUNCIOS = {
  tarjeta: { activo: false, titulo: '', texto: '', foto: '', boton: 'Ver', destino: '', desde: '', hasta: '', version: 0 },
  barra: { activo: false, texto: '', destino: '', desde: '', hasta: '' },
};
async function getAnuncios() {
  let saved = {};
  try { saved = JSON.parse((await getMeta('anuncios')) || '{}'); } catch { saved = {}; }
  return { tarjeta: { ...DEFAULT_ANUNCIOS.tarjeta, ...saved.tarjeta }, barra: { ...DEFAULT_ANUNCIOS.barra, ...saved.barra } };
}
// Si un anuncio está prendido y hoy cae dentro de sus fechas (vacías = sin límite).
const anuncioVigente = (a, hoy = diaAR(Date.now())) => a.activo && (!a.desde || hoy >= a.desde) && (!a.hasta || hoy <= a.hasta);
// Lo que ve la tienda: solo lo vigente.
async function anunciosPublicos() {
  const { tarjeta, barra } = await getAnuncios();
  return {
    tarjeta: anuncioVigente(tarjeta) ? { titulo: tarjeta.titulo, texto: tarjeta.texto, foto: tarjeta.foto ? photoUrl(tarjeta.foto) : '', boton: tarjeta.boton, destino: tarjeta.destino, version: tarjeta.version } : null,
    barra: anuncioVigente(barra) ? { texto: barra.texto, destino: barra.destino } : null,
  };
}
const fechaValida = (f) => (f === '' || /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : null);
const destinoValido = (d) => (/^(|nuevos|whatsapp|categoria:\d+|producto:\d+)$/.test(d) ? d : '');

async function getFaq() {
  try {
    const saved = JSON.parse((await getMeta('faq')) || 'null');
    if (Array.isArray(saved)) return saved;
  } catch { /* se usa la de fábrica */ }
  return DEFAULT_FAQ;
}

// Cuota mensual de la web (la cobra Pixel Cuyo): aviso a los administradores unos días antes del vencimiento.
const DEFAULT_CUOTA = { activo: true, dia: 28, aviso: 5, monto: '', alias: '', titular: '' };
async function getCuota() {
  let saved = {};
  try { saved = JSON.parse((await getMeta('cuota')) || '{}'); } catch { saved = {}; }
  return { ...DEFAULT_CUOTA, ...saved };
}
// Si hoy toca avisar: desde "aviso" días antes hasta el día del vencimiento, inclusive.
function cuotaHoy(c, ahora = Date.now()) {
  const hoy = Number(diaAR(ahora).slice(8, 10));
  const faltan = c.dia - hoy;
  return { toca: c.activo && faltan >= 0 && faltan <= c.aviso, faltan };
}

// Teléfono argentino a formato de WhatsApp: "261 555-1234" → 5492615551234.
function normalizePhone(value) {
  let d = String(value || '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.startsWith('54') && !d.startsWith('549') && d.length === 12) d = '549' + d.slice(2);
  if (d.length === 10) d = '549' + d;
  if (!d || d.length < 11 || d.length > 15) throw new HttpError(400, 'Revisá el número: poné el WhatsApp con la característica, ej: 261 555 1234');
  return d;
}

// Límite simple por IP para lo que los clientes mandan sin cuenta.
const publicHits = new Map();
function tooManyHits(ip, kind, max) {
  const key = kind + ':' + ip;
  const now = Date.now();
  const h = (publicHits.get(key) || []).filter((t) => now - t < 3600e3);
  h.push(now);
  publicHits.set(key, h);
  if (publicHits.size > 5000) publicHits.clear();
  return h.length > max;
}
const STAT_KINDS = ['vista', 'agregado', 'whatsapp', 'compartir', 'pedido'];
const CAMBIOS_POR_MES = 3;

// Todas las noticias que le tocan a un usuario, con su estado (ya le saltó / ya la leyó), de la más vieja a la más nueva.
const PARA_NOTICIA = { todos: 'Todos', admin: 'Solo administradores', vendedor: 'Solo vendedores' };
async function noticiasDe(user) {
  const enObra = await inMaintenance();
  const estado = new Map((await db.execute({ sql: 'SELECT * FROM news_state WHERE user_id = ?', args: [user.id] })).rows.map((r) => [r.news_key, r]));
  // Antes de la bandeja, "news_seen" guardaba hasta qué novedad había leído: esas cuentan como leídas.
  const vistoViejo = Number((await getUser(user.id)).news_seen) || 0;
  const desdeArchivo = NOVEDADES
    .filter((n) => (!n.perm || n.perm.split('|').some((k) => can.do(user, k))) && (!n.rol || n.rol === user.role || can.super(user)))
    .map((n) => ({
      key: 'n' + n.id, icono: n.icono, titulo: n.titulo, texto: n.texto, fecha: Date.parse(n.fecha + 'T00:00:00-03:00') + n.id, viejo: n.id <= vistoViejo,
      // La de "publicar tu web" queda fijada hasta que la web se publique.
      fijada: n.fijada === 'hasta-publicar' ? enObra : !!n.fijada,
      // Para quién es (Pixel Cuyo ve todas y así sabe a quién le llega cada una).
      para: n.rol ? PARA_NOTICIA[n.rol] : n.perm ? 'Según permisos' : 'Todos',
    }));
  const escritas = (await db.execute('SELECT * FROM panel_news ORDER BY created_at')).rows
    .filter((n) => n.para === 'todos' || n.para === user.role || can.super(user))
    .map((n) => ({ key: 'm' + n.id, icono: n.icono, titulo: n.titulo, texto: n.texto, fecha: n.created_at, deMartin: true, para: PARA_NOTICIA[n.para] }));
  return [...desdeArchivo, ...escritas].sort((a, b) => a.fecha - b.fecha).map(({ viejo, ...n }) => {
    const e = estado.get(n.key) || {};
    return { ...n, popup: viejo || !!e.popup_at, leido: viejo || !!e.read_at };
  });
}
const mesAR = (ms = Date.now()) => diaAR(ms).slice(0, 7); // 2026-10
const cambioPublico = (c) => ({ id: c.id, quien: c.who, texto: c.text, mes: c.month, fecha: c.created_at, estado: c.status, actualizado: c.updated_at, cuenta: !!c.counts });
const cambiosUsados = async () => Number((await db.execute({ sql: 'SELECT COUNT(*) AS n FROM change_requests WHERE month = ? AND counts = 1', args: [mesAR()] })).rows[0].n);

async function getSettings() {
  return {
    whatsapp: (await getMeta('whatsapp')) || DEFAULT_SETTINGS.whatsapp,
    instagram: (await getMeta('instagram')) || DEFAULT_SETTINGS.instagram,
    // TikTok: vacío en la base = el de fábrica; "-" = no mostrarlo.
    tiktok: ((await getMeta('tiktok')) ?? DEFAULT_SETTINGS.tiktok).replace(/^-$/, ''),
  };
}

async function getUser(id) {
  const r = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [id] });
  return r.rows[0] || null;
}

async function currentUser(req) {
  const cookies = parseCookies(req);
  const data = readToken(cookies.cb_session);
  if (!data || !data.uid) return null;
  const user = await getUser(data.uid);
  if (!user || passVersion(user.pass_hash) !== data.pv) return null;
  // Pixel Cuyo viendo como otro: se usa ese usuario (con sus permisos) y se guarda quién es en realidad.
  if (user.role === 'super' && cookies.cb_como) {
    const c = readToken(cookies.cb_como);
    if (c && c.como && c.by === user.id) {
      const target = await getUser(c.como);
      if (target && target.role !== 'super') return { ...target, _real: user };
    }
  }
  return user;
}

const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role, alias: u.alias || '' });
const whoName = (u) => (u.alias ? `${u.alias} (${u.username})` : u.username);
// Quién queda anotado: si Pixel Cuyo está "viendo como" alguien, figura Pixel Cuyo (así no parece que lo hizo la otra persona).
const quien = (u) => (u._real ? `${whoName(u._real)} (viendo como ${u.alias || u.username})` : whoName(u));

// Permisos que Pixel Cuyo prende o apaga por rol desde el panel (super siempre tiene todo).
// Ver contraseñas, cupos, permisos y la web en construcción es solo de super, fijo.
const PERMISSIONS = [
  { key: 'products_edit', label: 'Cargar y editar productos y stock' },
  { key: 'products_delete', label: 'Borrar productos' },
  { key: 'categories', label: 'Crear, ordenar y borrar categorías' },
  { key: 'settings', label: 'Cambiar WhatsApp, Instagram, TikTok y preguntas frecuentes' },
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
    args: [kind, entityId, name, quien(user), action, JSON.stringify(changes), Date.now(), (user._real || user).id, (user._real || user).role],
  });
}

// La dueña y su equipo no ven lo que hace Pixel Cuyo.
const activityScope = (u) => (u.role === 'super' ? '' : "AND (actor_role IS NULL OR actor_role != 'super')");

// El historial guarda solo los últimos 6 meses (para no llenar el servidor).
const ACTIVITY_DAYS = 183;
const ACTIVITY_WARN_DAYS = 10; // aviso en la campanita antes de que se borre
const ZONA = 'America/Argentina/Mendoza';
const fechaAR = (ms) => new Date(ms).toLocaleDateString('es-AR', { timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric' });
const diaAR = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: ZONA }); // 2026-10-29
const horaAR = (ms) => new Date(ms).toLocaleTimeString('es-AR', { timeZone: ZONA, hour: '2-digit', minute: '2-digit' });
async function trimActivity() {
  const r = await db.execute({ sql: 'DELETE FROM activity WHERE at < ?', args: [Date.now() - ACTIVITY_DAYS * 864e5] });
  if (r.rowsAffected) console.log(`Historial: ${r.rowsAffected} cambios de hace más de 6 meses borrados`);
  const limite = Date.now() - ACTIVITY_DAYS * 864e5;
  await db.execute({ sql: 'DELETE FROM stock_alerts WHERE created_at < ?', args: [limite] });
  await db.execute({ sql: 'DELETE FROM product_stats WHERE day < ?', args: [diaAR(limite)] });
}

// ---------- copia de seguridad diaria ----------
// Todos los días (desde las 4 de la mañana) se guarda una copia de la base; quedan las últimas 14.
// Las fotos se copian a BACKUP_DIR/fotos (cada foto tiene nombre único, así que solo se suman las nuevas).
async function dailyBackup() {
  const hoy = diaAR(Date.now()).replace(/-/g, '');
  const hora = Number(new Date().toLocaleString('en-US', { timeZone: ZONA, hour: 'numeric', hour12: false }));
  fs.mkdirSync(path.join(BACKUP_DIR, 'fotos'), { recursive: true });
  const archivo = path.join(BACKUP_DIR, `diaria-${hoy}.db`);
  // Si todavía no hay ninguna, se hace en el momento.
  if ((hora >= 4 || !lastBackup()) && !fs.existsSync(archivo)) {
    await db.execute({ sql: 'VACUUM INTO ?', args: [archivo] });
    console.log('Copia de seguridad:', archivo);
  }
  const corte = Date.now() - BACKUP_KEEP_DAYS * 864e5;
  for (const f of fs.readdirSync(BACKUP_DIR)) {
    if (/^diaria-\d{8}\.db$/.test(f) && fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs < corte) fs.unlinkSync(path.join(BACKUP_DIR, f));
  }
  if (fs.existsSync(UPLOADS_DIR)) {
    for (const f of fs.readdirSync(UPLOADS_DIR)) {
      const destino = path.join(BACKUP_DIR, 'fotos', f);
      if (!fs.existsSync(destino)) fs.copyFileSync(path.join(UPLOADS_DIR, f), destino);
    }
  }
}

function lastBackup() {
  try {
    const f = fs.readdirSync(BACKUP_DIR).filter((x) => /^diaria-\d{8}\.db$/.test(x)).sort().pop();
    return f ? fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs : 0;
  } catch { return 0; }
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
    soldOut: !!p.sold_out, hidden: !!p.hidden, position: p.position, createdAt: p.created_at || null,
    updatedBy: p.updated_by, updatedAt: p.updated_at,
  };
}

const PRODUCT_ORDER = 'ORDER BY c.position, c.id, p.position, p.id';

// Lo que necesita la web pública: categorías en orden y productos visibles.
async function publicCatalog() {
  const cats = (await db.execute('SELECT id, name FROM categories ORDER BY position, id')).rows;
  const prods = (await db.execute(`SELECT p.* FROM products p JOIN categories c ON c.id = p.category_id WHERE p.hidden = 0 ${PRODUCT_ORDER}`)).rows;
  const slugs = await productSlugs();
  return {
    ...(await getSettings()),
    categorias: cats.map((c) => ({ id: String(c.id), nombre: c.name })),
    productos: prods.map((p) => ({
      id: String(p.id), nombre: p.name, color: p.color, descripcion: p.description || '', categoria: String(p.category_id), precio: p.price, precioAnterior: p.old_price || null,
      foto: photoUrl(p.photo), miniatura: photoUrl(p.thumb || p.photo), agotado: !!p.sold_out,
      fotos: [p.photo, ...galleryOf(p)].filter(Boolean).map(photoUrl),
      url: '/producto/' + slugs.get(String(p.id)),
      nuevo: !!p.created_at && p.created_at > Date.now() - NUEVO_DIAS * 864e5,
    })),
    preguntas: await getFaq(),
    anuncios: await anunciosPublicos(),
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

  // "Avisame cuando vuelva": quien compra deja su WhatsApp en un producto sin stock.
  if (route === 'POST /api/avisame') {
    if (tooManyHits(ip, 'avisame', 10)) throw new HttpError(429, 'Probá de nuevo en un rato');
    const body = await readJson(req);
    const p = (await db.execute({ sql: 'SELECT id, sold_out, hidden FROM products WHERE id = ?', args: [Number(body.productId) || 0] })).rows[0];
    if (!p || p.hidden) throw new HttpError(404, 'Ese producto ya no está');
    const phone = normalizePhone(body.telefono);
    const name = cleanText(body.nombre, 40);
    const ya = (await db.execute({ sql: 'SELECT id FROM stock_alerts WHERE product_id = ? AND phone = ? AND notified_at IS NULL', args: [p.id, phone] })).rows[0];
    if (!ya) await db.execute({ sql: 'INSERT INTO stock_alerts (product_id, name, phone, created_at) VALUES (?, ?, ?, ?)', args: [p.id, name, phone, Date.now()] });
    return send(res, 200, { ok: true });
  }

  // Qué miran los clientes. No se cuenta lo que hace el equipo con sesión iniciada.
  if (route === 'POST /api/evento') {
    const body = await readJson(req).catch(() => ({}));
    const kind = String(body.tipo || '');
    const id = Number(body.productId) || 0;
    if (!STAT_KINDS.includes(kind) || !id || tooManyHits(ip, 'evento', 400) || (await currentUser(req))) return send(res, 200, { ok: true });
    const existe = (await db.execute({ sql: 'SELECT 1 FROM products WHERE id = ?', args: [id] })).rows[0];
    if (existe) {
      await db.execute({
        sql: 'INSERT INTO product_stats (product_id, day, kind, n) VALUES (?, ?, ?, 1) ON CONFLICT (product_id, day, kind) DO UPDATE SET n = n + 1',
        args: [id, diaAR(Date.now()), kind],
      });
    }
    return send(res, 200, { ok: true });
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
    return send(res, 200, { ok: true }, { 'Set-Cookie': [sessionCookie(req, '', 0), comoCookie(req, null)] });
  }

  const user = await currentUser(req);
  if (!user) throw new HttpError(401, 'Iniciá sesión');

  // ----- ver como (solo Pixel Cuyo) -----
  if (route === 'POST /api/como') {
    const real = user._real || user;
    requireRole(can.super(real), 'Solo Pixel Cuyo');
    const target = await getUser(Number((await readJson(req)).userId) || 0);
    if (!target || target.role === 'super') throw new HttpError(404, 'Ese usuario no existe');
    return send(res, 200, { ok: true }, { 'Set-Cookie': comoCookie(req, target, real) });
  }
  if (route === 'POST /api/como/salir') return send(res, 200, { ok: true }, { 'Set-Cookie': comoCookie(req, null) });

  // Mientras Pixel Cuyo mira como otra persona, no se tocan sus cosas personales.
  if (user._real && route === 'PUT /api/me/password') throw new HttpError(403, 'Estás viendo como otra persona: su contraseña no se puede cambiar desde acá');
  if (user._real && ['POST /api/novedades/visto', 'POST /api/novedades/estado', 'POST /api/cuota/visto'].includes(route)) return send(res, 200, { ok: true, prueba: true });

  if (route === 'GET /api/me') {
    let pasos = [];
    try { pasos = JSON.parse((await getUser(user.id)).first_steps || '[]'); } catch { pasos = []; }
    return send(res, 200, {
      user: publicUser(user), perms: permsOf(user), maintenance: await inMaintenance(), pasos,
      como: user._real ? { alias: user.alias || user.username, role: user.role } : null,
    });
  }
  if (route === 'POST /api/me/pasos') {
    if (user._real) {
      let pasos = [];
      try { pasos = JSON.parse((await getUser(user.id)).first_steps || '[]'); } catch { pasos = []; }
      return send(res, 200, { pasos, prueba: true });
    }
    const paso = String((await readJson(req)).paso || '');
    if (!["guia","clave","app","productos","textos","faq"].includes(paso)) throw new HttpError(400, 'Paso desconocido');
    let pasos = [];
    try { pasos = JSON.parse((await getUser(user.id)).first_steps || '[]'); } catch { pasos = []; }
    if (!pasos.includes(paso)) pasos.push(paso);
    await db.execute({ sql: 'UPDATE users SET first_steps = ? WHERE id = ?', args: [JSON.stringify(pasos), user.id] });
    return send(res, 200, { pasos });
  }

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
  // Publicar la web: lo hace la dueña (o alguien de administración) una sola vez, desde su panel.
  if (route === 'POST /api/publicar') {
    requireRole(user.role === 'admin' || can.super(user), 'Solo los administradores pueden publicar la web');
    if (user._real) throw new HttpError(403, 'Estás viendo como otra persona: para probar usá la simulación de tu panel');
    if (!(await inMaintenance())) return send(res, 200, { ok: true, yaEstaba: true });
    await setMeta('maintenance', '0');
    await logActivity('site', null, 'la web', user, 'update', ['🚀 web publicada: ya la ve todo el mundo']);
    return send(res, 200, { ok: true });
  }

  if (route === 'PUT /api/maintenance') {
    requireRole(can.super(user), 'Solo Pixel Cuyo puede poner la web en mantenimiento');
    const on = !!(await readJson(req)).on;
    await setMeta('maintenance', on ? '1' : '0');
    await logActivity('site', null, 'web', user, 'update', [on ? 'puso la web en mantenimiento' : 'volvió a abrir la web']);
    return send(res, 200, { maintenance: on });
  }

  // ----- datos del negocio (WhatsApp e Instagram) -----
  // Aviso de la cuota: solo para administradores (no vendedores ni Pixel Cuyo), una vez por día.
  if (route === 'GET /api/cuota') {
    const c = await getCuota();
    const { toca, faltan } = cuotaHoy(c);
    const visto = (await getUser(user.id)).fee_notice_day === diaAR(Date.now());
    const mostrar = user.role === 'admin' && toca && !visto;
    return send(res, 200, mostrar || url.searchParams.has('prueba') && can.super(user)
      // En la vista de prueba, si hoy no toca, se muestra como si faltaran unos días.
      ? { mostrar: true, dia: c.dia, faltan: toca ? faltan : Math.min(3, c.aviso), monto: c.monto, alias: c.alias, titular: c.titular, datos: c.alias || c.titular ? '' : (c.datos || '') }
      : { mostrar: false });
  }
  if (route === 'POST /api/cuota/visto') {
    await db.execute({ sql: 'UPDATE users SET fee_notice_day = ? WHERE id = ?', args: [diaAR(Date.now()), user.id] });
    return send(res, 200, { ok: true });
  }
  if (route === 'GET /api/cuota/config') {
    requireRole(can.super(user), 'Solo Pixel Cuyo');
    return send(res, 200, await getCuota());
  }
  if (route === 'PUT /api/cuota/config') {
    requireRole(can.super(user), 'Solo Pixel Cuyo');
    const body = await readJson(req);
    const dia = Math.round(Number(body.dia));
    const aviso = Math.round(Number(body.aviso));
    if (!(dia >= 1 && dia <= 28)) throw new HttpError(400, 'El día tiene que ser entre 1 y 28 (así existe en todos los meses)');
    if (!(aviso >= 0 && aviso <= 15)) throw new HttpError(400, 'Los días de aviso tienen que ser entre 0 y 15');
    const alias = cleanText(body.alias, 60).replace(/\s+/g, '');
    const c = { activo: !!body.activo, dia, aviso, monto: cleanText(body.monto, 30), alias, titular: cleanText(body.titular, 80) };
    // Lo que estaba en el campo viejo "Datos para pagar" se guarda hasta que se carguen alias o titular.
    const viejo = (await getCuota()).datos;
    if (viejo && !c.alias && !c.titular) c.datos = viejo;
    await setMeta('cuota', JSON.stringify(c));
    return send(res, 200, c);
  }

  // ----- cambios en la web (los administradores piden, Pixel Cuyo lee) -----
  if (route === 'GET /api/cambios') {
    if (can.super(user)) {
      const r = await db.execute('SELECT * FROM change_requests ORDER BY created_at DESC LIMIT 300');
      const usados = await cambiosUsados();
      return send(res, 200, { cambios: r.rows.map(cambioPublico), nuevos: r.rows.filter((c) => c.status === 'nuevo').length, usados, limite: CAMBIOS_POR_MES, mes: mesAR() });
    }
    requireRole(user.role === 'admin', 'Solo los administradores pueden pedir cambios');
    const r = await db.execute({ sql: 'SELECT * FROM change_requests WHERE month = ? ORDER BY created_at', args: [mesAR()] });
    return send(res, 200, { cambios: r.rows.map(cambioPublico), limite: CAMBIOS_POR_MES, quedan: Math.max(0, CAMBIOS_POR_MES - (await cambiosUsados())) });
  }
  if (route === 'POST /api/cambios') {
    requireRole(user.role === 'admin', 'Solo los administradores pueden pedir cambios');
    const texto = cleanDescription((await readJson(req)).texto).slice(0, 2000);
    if (texto.length < 5) throw new HttpError(400, 'Contanos un poquito más qué cambio querés');
    const usados = await cambiosUsados();
    if (usados >= CAMBIOS_POR_MES) throw new HttpError(409, `Ya usaste los ${CAMBIOS_POR_MES} cambios de este mes. El mes que viene tenés ${CAMBIOS_POR_MES} más.`);
    await db.execute({
      sql: 'INSERT INTO change_requests (user_id, who, text, month, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [user.id, quien(user), texto, mesAR(), Date.now()],
    });
    return send(res, 201, { ok: true, quedan: CAMBIOS_POR_MES - usados - 1 });
  }
  // Resetear el cupo del mes: los pedidos quedan en la lista, pero dejan de contar.
  if (route === 'POST /api/cambios/resetear-mes') {
    requireRole(can.super(user), 'Solo Pixel Cuyo');
    await db.execute({ sql: 'UPDATE change_requests SET counts = 0 WHERE month = ?', args: [mesAR()] });
    return send(res, 200, { ok: true });
  }
  const cambioId = url.pathname.match(/^\/api\/cambios\/(\d+)$/);
  if (cambioId) {
    requireRole(can.super(user), 'Solo Pixel Cuyo');
    const id = Number(cambioId[1]);
    if (req.method === 'PATCH') {
      const body = await readJson(req);
      // Devolver (o volver a cobrar) el cupo de ese pedido.
      if (body.cuenta !== undefined) {
        await db.execute({ sql: 'UPDATE change_requests SET counts = ? WHERE id = ?', args: [body.cuenta ? 1 : 0, id] });
        return send(res, 200, { ok: true });
      }
      const estado = String(body.estado || '');
      if (!['nuevo', 'visto', 'hecho'].includes(estado)) throw new HttpError(400, 'Estado inválido');
      await db.execute({ sql: 'UPDATE change_requests SET status = ?, updated_at = ? WHERE id = ?', args: [estado, Date.now(), id] });
      return send(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      await db.execute({ sql: 'DELETE FROM change_requests WHERE id = ?', args: [id] });
      return send(res, 200, { ok: true });
    }
    throw new HttpError(405, 'Método no permitido');
  }

  // ----- anuncios en la web (tarjeta y barrita) -----
  if (route === 'GET /api/anuncios') {
    requireRole(can.do(user, 'settings'), 'No tenés permiso para los anuncios de la web');
    const a = await getAnuncios();
    return send(res, 200, { ...a, tarjeta: { ...a.tarjeta, foto: a.tarjeta.foto ? photoUrl(a.tarjeta.foto) : '' }, hoy: diaAR(Date.now()) });
  }
  if (route === 'PUT /api/anuncios') {
    requireRole(can.do(user, 'settings'), 'No tenés permiso para los anuncios de la web');
    const body = await readJson(req);
    const antes = await getAnuncios();
    const t = body.tarjeta || {};
    const b = body.barra || {};
    const fechas = [t.desde, t.hasta, b.desde, b.hasta].map((f) => fechaValida(String(f || '')));
    if (fechas.includes(null)) throw new HttpError(400, 'Revisá las fechas');
    if (fechas[0] && fechas[1] && fechas[0] > fechas[1]) throw new HttpError(400, 'En la tarjeta, la fecha "hasta" es antes que "desde"');
    if (fechas[2] && fechas[3] && fechas[2] > fechas[3]) throw new HttpError(400, 'En la barrita, la fecha "hasta" es antes que "desde"');
    // Foto de la tarjeta: nueva (data:), la misma, o ninguna.
    let foto = antes.tarjeta.foto;
    if (typeof t.foto === 'string' && t.foto.startsWith('data:')) foto = saveImage(t.foto, `a${newPhotoName()}`);
    else if (!t.foto) foto = '';
    if (foto !== antes.tarjeta.foto) removeUpload(antes.tarjeta.foto);
    const tarjeta = {
      activo: !!t.activo,
      titulo: cleanText(t.titulo, 60),
      texto: cleanDescription(t.texto).slice(0, 220),
      foto,
      boton: cleanText(t.boton, 24) || 'Ver',
      destino: destinoValido(String(t.destino || '')),
      desde: fechas[0], hasta: fechas[1],
    };
    if (tarjeta.activo && !tarjeta.titulo) throw new HttpError(400, 'La tarjeta necesita un título');
    // Si cambia lo que se ve, los clientes la vuelven a ver una vez.
    const cambio = ['titulo', 'texto', 'foto', 'boton', 'destino'].some((k) => tarjeta[k] !== antes.tarjeta[k]) || (tarjeta.activo && !antes.tarjeta.activo);
    tarjeta.version = cambio ? Date.now() : antes.tarjeta.version;
    const barra = { activo: !!b.activo, texto: cleanText(b.texto, 90), destino: destinoValido(String(b.destino || '')), desde: fechas[2], hasta: fechas[3] };
    if (barra.activo && !barra.texto) throw new HttpError(400, 'La barrita necesita un texto');
    await setMeta('anuncios', JSON.stringify({ tarjeta, barra }));
    const changes = [];
    if (cambio || tarjeta.activo !== antes.tarjeta.activo || tarjeta.desde !== antes.tarjeta.desde || tarjeta.hasta !== antes.tarjeta.hasta) changes.push(`tarjeta: ${tarjeta.activo ? `"${tarjeta.titulo}"` : 'apagada'}`);
    if (['activo', 'texto', 'destino', 'desde', 'hasta'].some((k) => barra[k] !== antes.barra[k])) changes.push(`barrita: ${barra.activo ? `"${barra.texto}"` : 'apagada'}`);
    if (changes.length) await logActivity('site', null, 'anuncio en la web', user, 'update', changes);
    return send(res, 200, { ok: true });
  }

  if (route === 'GET /api/textos') return send(res, 200, await getTextos());
  if (route === 'PUT /api/textos') {
    requireRole(can.do(user, 'settings'), 'No tenés permiso para cambiar los textos de la web');
    const body = await readJson(req);
    const nuevo = {
      sobreTitulo: cleanText(body.sobreTitulo, 60),
      sobre: cleanDescription(body.sobre).slice(0, 1500),
      cinta: (Array.isArray(body.cinta) ? body.cinta : []).map((f) => cleanText(f, 60)).filter(Boolean).slice(0, 8),
    };
    const antes = await getTextos();
    await setMeta('textos', JSON.stringify(nuevo));
    const changes = [];
    if (antes.sobreTitulo !== nuevo.sobreTitulo) changes.push(`título: "${antes.sobreTitulo}" → "${nuevo.sobreTitulo}"`);
    if (antes.sobre !== nuevo.sobre) changes.push('texto de "sobre la tienda" cambiado');
    if (antes.cinta.join('|') !== nuevo.cinta.join('|')) changes.push('frases de la cinta cambiadas');
    if (changes.length) await logActivity('site', null, 'textos de la web', user, 'update', changes);
    return send(res, 200, nuevo);
  }

  if (route === 'GET /api/faq') return send(res, 200, { preguntas: await getFaq() });
  if (route === 'PUT /api/faq') {
    requireRole(can.do(user, 'settings'), 'No tenés permiso para cambiar las preguntas frecuentes');
    const body = await readJson(req);
    const lista = (Array.isArray(body.preguntas) ? body.preguntas : [])
      .map((x) => ({ q: cleanText(x.q, 120), a: cleanDescription(x.a).slice(0, 600) }))
      .filter((x) => x.q && x.a)
      .slice(0, 15);
    const antes = await getFaq();
    await setMeta('faq', JSON.stringify(lista));
    const changes = [];
    lista.filter((x) => !antes.some((y) => y.q === x.q)).forEach((x) => changes.push(`pregunta nueva: "${x.q}"`));
    antes.filter((x) => !lista.some((y) => y.q === x.q)).forEach((x) => changes.push(`pregunta borrada: "${x.q}"`));
    lista.filter((x) => antes.some((y) => y.q === x.q && y.a !== x.a)).forEach((x) => changes.push(`respuesta cambiada: "${x.q}"`));
    if (changes.length || lista.length !== antes.length) await logActivity('site', null, 'preguntas frecuentes', user, 'update', changes);
    return send(res, 200, { preguntas: lista });
  }

  // Estadísticas: lo más visto, agregado y consultado en los últimos días.
  if (route === 'GET /api/stats') {
    requireRole(can.do(user, 'activity'), 'No tenés permiso para ver las estadísticas');
    const dias = Math.min(183, Math.max(1, Number(url.searchParams.get('dias')) || 30));
    const desde = diaAR(Date.now() - (dias - 1) * 864e5);
    const r = await db.execute({ sql: 'SELECT product_id, kind, SUM(n) AS n FROM product_stats WHERE day >= ? GROUP BY product_id, kind', args: [desde] });
    const por = new Map();
    for (const row of r.rows) {
      const k = String(row.product_id);
      if (!por.has(k)) por.set(k, { productId: Number(row.product_id), vista: 0, agregado: 0, whatsapp: 0, compartir: 0, pedido: 0 });
      por.get(k)[row.kind] = Number(row.n);
    }
    return send(res, 200, { dias, desde, productos: [...por.values()].sort((a, b) => b.vista - a.vista || b.agregado - a.agregado) });
  }

  // Clientes que esperan que vuelva un producto.
  if (route === 'GET /api/avisame') {
    requireRole(can.do(user, 'products_edit'));
    const r = await db.execute('SELECT * FROM stock_alerts ORDER BY created_at');
    const slugs = await productSlugs();
    return send(res, 200, {
      avisos: r.rows.map((a) => ({
        id: a.id, productId: a.product_id, nombre: a.name, telefono: a.phone, createdAt: a.created_at, notifiedAt: a.notified_at,
        url: `${SITE_URL}/producto/${slugs.get(String(a.product_id))}`,
      })),
    });
  }
  const alerta = url.pathname.match(/^\/api\/avisame\/(\d+)$/);
  if (alerta) {
    requireRole(can.do(user, 'products_edit'));
    const id = Number(alerta[1]);
    if (req.method === 'POST') await db.execute({ sql: 'UPDATE stock_alerts SET notified_at = ? WHERE id = ?', args: [Date.now(), id] });
    else if (req.method === 'DELETE') await db.execute({ sql: 'DELETE FROM stock_alerts WHERE id = ?', args: [id] });
    else throw new HttpError(405, 'Método no permitido');
    return send(res, 200, { ok: true });
  }

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
    const tiktok = String(body.tiktok ?? '').trim().replace(/^@/, '');
    if (tiktok && !/^[\w.]{2,24}$/.test(tiktok)) throw new HttpError(400, 'Usuario de TikTok inválido');
    const before = await getSettings();
    await setMeta('whatsapp', whatsapp);
    await setMeta('instagram', instagram);
    await setMeta('tiktok', tiktok || '-');
    const changes = [];
    if (before.whatsapp !== whatsapp) changes.push(`WhatsApp: ${before.whatsapp} → ${whatsapp}`);
    if (before.instagram !== instagram) changes.push(`Instagram: @${before.instagram} → @${instagram}`);
    if (before.tiktok !== tiktok) changes.push(tiktok ? `TikTok: @${tiktok}` : 'TikTok quitado');
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
      sql: `INSERT INTO products (name, color, description, category_id, price, old_price, photo, thumb, gallery, sold_out, hidden, position, updated_by, updated_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      args: [p.name, p.color, p.description, p.categoryId, p.price, p.oldPrice, photo, thumb, JSON.stringify(gallery), p.soldOut, p.hidden, pos, user.username, Date.now(), Date.now()],
    });
    await logActivity('product', r.rows[0].id, productLabel(r.rows[0]), user, 'create');
    return send(res, 201, { product: adminProduct(r.rows[0]) });
  }

  // Link para compartir un producto (desde el panel).
  const plink = url.pathname.match(/^\/api\/products\/(\d+)\/link$/);
  if (plink && req.method === 'GET') {
    const s = (await productSlugs()).get(plink[1]);
    if (!s) throw new HttpError(404, 'El producto no existe');
    return send(res, 200, { url: `${SITE_URL}/producto/${s}`, enObra: await inMaintenance() });
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
      await db.execute({ sql: 'DELETE FROM stock_alerts WHERE product_id = ?', args: [id] });
      await db.execute({ sql: 'DELETE FROM product_stats WHERE product_id = ?', args: [id] });
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

  // Borrar un cambio del historial: solo Pixel Cuyo. Desaparece para todos (inicio, historial y Excel).
  const borrarCambio = url.pathname.match(/^\/api\/activity\/(\d+)$/);
  if (borrarCambio && req.method === 'DELETE') {
    requireRole(can.super(user), 'Solo Pixel Cuyo puede borrar cambios del historial');
    await db.execute({ sql: 'DELETE FROM activity WHERE id = ?', args: [Number(borrarCambio[1])] });
    return send(res, 200, { ok: true });
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
  // Novedades del panel (novedades.js): cada uno ve las de lo que puede hacer.
  // Bandeja de noticias del panel: las de novedades.js (las deja Martín con cada mejora) + las que escribe desde su panel.
  if (route === 'GET /api/novedades') {
    const items = await noticiasDe(user);
    return send(res, 200, { items, primeraVez: !items.some((n) => n.popup || n.leido) });
  }
  // Marcar que ya le saltó la ventanita ("popup") o que ya la leyó ("leido").
  if (route === 'POST /api/novedades/estado') {
    const body = await readJson(req);
    const campo = body.accion === 'leido' ? 'read_at' : 'popup_at';
    const keys = (Array.isArray(body.keys) ? body.keys : []).map(String).filter((k) => /^[nm]\d+$/.test(k)).slice(0, 200);
    for (const k of keys) {
      await db.execute({
        sql: `INSERT INTO news_state (user_id, news_key, ${campo}) VALUES (?, ?, ?) ON CONFLICT (user_id, news_key) DO UPDATE SET ${campo} = COALESCE(${campo}, excluded.${campo})`,
        args: [user.id, k, Date.now()],
      });
    }
    return send(res, 200, { ok: true });
  }

  // ----- noticias que escribe Pixel Cuyo -----
  if (route === 'GET /api/noticias') {
    requireRole(can.super(user), 'Solo Pixel Cuyo');
    const news = (await db.execute('SELECT * FROM panel_news ORDER BY created_at DESC')).rows;
    const users = (await db.execute("SELECT id, username, alias, role FROM users WHERE role != 'super'")).rows;
    const leidas = (await db.execute("SELECT user_id, news_key FROM news_state WHERE read_at IS NOT NULL AND news_key LIKE 'm%'")).rows;
    return send(res, 200, {
      noticias: news.map((n) => ({
        id: n.id, icono: n.icono, titulo: n.titulo, texto: n.texto, para: n.para, fecha: n.created_at,
        lectores: users.filter((u) => n.para === 'todos' || n.para === u.role).map((u) => ({
          nombre: u.alias || u.username,
          leyo: leidas.some((l) => l.user_id === u.id && l.news_key === 'm' + n.id),
        })),
      })),
    });
  }
  if (route === 'POST /api/noticias') {
    requireRole(can.super(user), 'Solo Pixel Cuyo');
    const body = await readJson(req);
    const titulo = cleanText(body.titulo, 90);
    const texto = cleanDescription(body.texto).slice(0, 2000);
    const para = ['todos', 'admin', 'vendedor'].includes(body.para) ? body.para : 'todos';
    const icono = cleanText(body.icono, 8) || '📣';
    if (!titulo || !texto) throw new HttpError(400, 'Poné un título y el texto de la noticia');
    await db.execute({ sql: 'INSERT INTO panel_news (icono, titulo, texto, para, created_at) VALUES (?, ?, ?, ?, ?)', args: [icono, titulo, texto, para, Date.now()] });
    return send(res, 201, { ok: true });
  }
  const noticiaId = url.pathname.match(/^\/api\/noticias\/(\d+)$/);
  if (noticiaId && req.method === 'DELETE') {
    requireRole(can.super(user), 'Solo Pixel Cuyo');
    await db.execute({ sql: 'DELETE FROM panel_news WHERE id = ?', args: [Number(noticiaId[1])] });
    await db.execute({ sql: 'DELETE FROM news_state WHERE news_key = ?', args: ['m' + noticiaId[1]] });
    return send(res, 200, { ok: true });
  }
  if (route === 'POST /api/novedades/visto') {
    const ultimo = Math.max(0, ...NOVEDADES.map((n) => n.id));
    await db.execute({ sql: 'UPDATE users SET news_seen = ? WHERE id = ?', args: [ultimo, user.id] });
    return send(res, 200, { ok: true });
  }

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
    if (can.do(user, 'products_edit')) {
      // Clientes esperando un producto que ya volvió a tener stock.
      const r = await db.execute(`SELECT p.id, p.name, p.color, COUNT(*) AS n FROM stock_alerts a JOIN products p ON p.id = a.product_id
        WHERE a.notified_at IS NULL AND p.sold_out = 0 AND p.hidden = 0 GROUP BY p.id ORDER BY MIN(a.created_at)`);
      for (const p of r.rows) {
        avisos.push({
          id: 'stock-' + p.id,
          icono: '🛍️',
          titulo: `${p.n} ${Number(p.n) === 1 ? 'persona espera' : 'personas esperan'} la ${p.name}${p.color ? ' ' + p.color : ''}`,
          texto: 'Ya tiene stock de nuevo: abrí el producto y avisales por WhatsApp con un toque.',
          producto: Number(p.id),
        });
      }
    }
    if (user.role === 'super') {
      const nuevos = Number((await db.execute("SELECT COUNT(*) AS n FROM change_requests WHERE status = 'nuevo'")).rows[0].n);
      if (nuevos) avisos.push({ id: 'cambios', icono: '📬', titulo: `${nuevos} ${nuevos === 1 ? 'cambio sugerido nuevo' : 'cambios sugeridos nuevos'}`, texto: 'Valentina te pidió cambios en la web. Los ves en ⋯ Más → 📬 Cambios sugeridos.', cambios: true });
      const ultima = lastBackup();
      if (Date.now() - ultima > 2 * 864e5) {
        avisos.push({ id: 'backup', icono: '💾', titulo: 'La copia de seguridad diaria no se hizo', texto: ultima ? `La última es del ${fechaAR(ultima)}. Revisá el servidor.` : 'Todavía no hay ninguna copia diaria. Revisá el servidor.' });
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
  '.mp4': 'video/mp4',
};

function serveFile(res, file, cache, req) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'No encontrado');
    const headers = {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
    };
    // Pedazos del archivo (los videos se piden así, sobre todo en iPhone).
    const rango = req && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (rango && (rango[1] || rango[2])) {
      let desde = rango[1] ? Number(rango[1]) : st.size - Number(rango[2]);
      let hasta = rango[1] && rango[2] ? Number(rango[2]) : st.size - 1;
      desde = Math.max(0, desde);
      hasta = Math.min(hasta, st.size - 1);
      if (desde > hasta) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${desde}-${hasta}/${st.size}`, 'Content-Length': hasta - desde + 1 });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start: desde, end: hasta }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req && req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- SEO ----------
// Link de cada producto: /producto/cartera-monos-negro. Si dos se llaman igual, el más nuevo lleva el número.
const slugify = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'producto';
async function productSlugs() {
  const rows = (await db.execute('SELECT id, name, color FROM products ORDER BY id')).rows;
  const usados = new Set(), out = new Map();
  for (const p of rows) {
    let s = slugify(`${p.name} ${p.color}`);
    if (usados.has(s)) s = `${s}-${p.id}`;
    usados.add(s);
    out.set(String(p.id), s);
  }
  return out;
}

// La tienda arma sus productos con JS; para Google el servidor ya los manda dentro del HTML
// (tarjetas + datos estructurados), así los encuentra aunque no ejecute el JS.
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const abs = (u) => (u && u.startsWith('/') ? SITE_URL + u : u);
const plataAR = (n) => '$' + Number(n).toLocaleString('es-AR');
const ZONAS = ['Mendoza', 'Godoy Cruz', 'Guaymallén', 'Las Heras', 'Maipú', 'Luján de Cuyo'];

async function datosTienda() {
  const cat = await publicCatalog();
  const nombreCat = (id) => (cat.categorias.find((c) => c.id === id) || {}).nombre || '';
  const tienda = {
    '@context': 'https://schema.org',
    '@type': 'Store',
    '@id': SITE_URL + '/#tienda',
    name: 'Carmesí Bags',
    description: 'Tienda de carteras, bolsos y accesorios en Mendoza. Pedidos por WhatsApp.',
    url: SITE_URL + '/',
    logo: SITE_URL + '/assets/img/logo-completo.jpg',
    image: SITE_URL + '/assets/img/logo-completo.jpg',
    telephone: '+' + cat.whatsapp,
    priceRange: '$$',
    currenciesAccepted: 'ARS',
    address: { '@type': 'PostalAddress', addressLocality: 'Mendoza', addressRegion: 'Mendoza', addressCountry: 'AR' },
    areaServed: ZONAS.map((name) => ({ '@type': 'City', name })),
    sameAs: [
      ...(cat.instagram ? [`https://www.instagram.com/${cat.instagram}/`] : []),
      ...(cat.tiktok ? [`https://www.tiktok.com/@${cat.tiktok}`] : []),
    ],
  };
  const lista = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Carteras y bolsos de Carmesí Bags',
    itemListElement: cat.productos.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: SITE_URL + p.url,
      name: [p.nombre, p.color].filter(Boolean).join(' '),
    })),
  };
  const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
  return { cat, tienda, lista, ld, nombreCat };
}

// Datos de Google de un producto (su página).
function productoLd(p, nombreCat) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: [p.nombre, p.color].filter(Boolean).join(' '),
    image: p.fotos.map(abs),
    ...(p.descripcion ? { description: p.descripcion } : {}),
    sku: p.id,
    category: nombreCat(p.categoria),
    ...(p.color ? { color: p.color } : {}),
    brand: { '@type': 'Brand', name: 'Carmesí Bags' },
    offers: {
      '@type': 'Offer',
      url: SITE_URL + p.url,
      price: p.precio,
      priceCurrency: 'ARS',
      availability: p.agotado ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@id': SITE_URL + '/#tienda' },
    },
  };
}

function tarjetasHtml(productos) {
  return productos.map((p) => {
    const nom = escHtml([p.nombre, p.color].filter(Boolean).join(' '));
    return `<article class="tarjeta${p.agotado ? ' tarjeta--agotada' : ''}"><a class="tarjeta__foto" href="${escHtml(p.url)}">${p.nuevo ? '<span class="tarjeta__nuevo">Nuevo</span>' : ''}<img src="${escHtml(p.miniatura)}" alt="${nom} — Carmesí Bags Mendoza" loading="lazy" width="720" height="900"></a><h3 class="tarjeta__nombre">${escHtml(p.nombre)}</h3><p class="tarjeta__color">${escHtml(p.color)}</p><p class="tarjeta__precio">${p.precioAnterior ? `<s>${plataAR(p.precioAnterior)}</s> ` : ''}${plataAR(p.precio)}</p></article>`;
  }).join('');
}

// Texto con un renglón vacío entre párrafos y **negrita**.
const textoHtml = (t) => t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  .map((p) => `<p>${escHtml(p).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}</p>`).join('\n      ');
function sobreHtml(t) {
  if (!t.sobre && !t.sobreTitulo) return '';
  return `<section class="sobre">
      ${t.sobreTitulo ? `<h2 class="etiqueta">${escHtml(t.sobreTitulo)}</h2>` : ''}
      ${textoHtml(t.sobre)}
    </section>`;
}
function cintaHtml(frases) {
  if (!frases.length) return '';
  // Con pocas frases se repiten, así la cinta siempre llena el ancho.
  const lleno = Array.from({ length: Math.ceil(6 / frases.length) }, () => frases).flat();
  const grupo = (oculto) => `<div class="cinta__grupo"${oculto ? ' aria-hidden="true"' : ''}>${lleno.map((f) => `<span>${escHtml(f)}</span>`).join('')}</div>`;
  return `<div class="cinta">
      <div class="cinta__pista">${grupo(false)}${grupo(true)}</div>
    </div>`;
}
const conTextos = (html, t) => html.replace('<!--SOBRE-->', sobreHtml(t)).replace('<!--CINTA-->', cintaHtml(t.cinta));

// Preguntas frecuentes: van en el HTML (y en los datos para Google).
function preguntasHtml(preguntas) {
  if (!preguntas.length) return '';
  return `<section class="preguntas" id="preguntas">
      <h2 class="etiqueta">Preguntas frecuentes</h2>
      ${preguntas.map((x) => `<details class="pregunta"><summary>${escHtml(x.q)}</summary><p>${escHtml(x.a)}</p></details>`).join('\n      ')}
    </section>`;
}
function preguntasLd(preguntas) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: preguntas.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })),
  };
}

async function renderTienda() {
  const html = conTextos(fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8'), await getTextos());
  const { cat, tienda, lista, ld } = await datosTienda();
  return html
    .replace('<!--SEO-->', ld(tienda) + '\n  ' + ld(lista) + (cat.preguntas.length ? '\n  ' + ld(preguntasLd(cat.preguntas)) : ''))
    .replace('<!--GRILLA-->', tarjetasHtml(cat.productos))
    .replace('<!--PREGUNTAS-->', preguntasHtml(cat.preguntas));
}

// Página propia de un producto: misma tienda, con el producto arriba y sus datos para Google.
async function renderProducto(slug) {
  const { cat, tienda, ld, nombreCat } = await datosTienda();
  const p = cat.productos.find((x) => x.url === '/producto/' + slug);
  if (!p) return null;
  const nombre = [p.nombre, p.color].filter(Boolean).join(' ');
  const url = SITE_URL + p.url;
  const desc = (p.descripcion ? p.descripcion.replace(/\s+/g, ' ').slice(0, 120) + '. ' : '')
    + `${nombre} a ${plataAR(p.precio)}${p.agotado ? ' (sin stock por ahora)' : ''}. Pedila por WhatsApp en Carmesí Bags, carteras y bolsos en Mendoza.`;
  const migas = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Inicio', item: SITE_URL + '/' },
      { '@type': 'ListItem', position: 2, name: nombreCat(p.categoria), item: SITE_URL + '/#productos' },
      { '@type': 'ListItem', position: 3, name: nombre, item: url },
    ],
  };
  const meta = `<title>${escHtml(nombre)} — Carmesí Bags Mendoza</title>
  <meta name="description" content="${escHtml(desc)}">
  <meta name="theme-color" content="#5e1a22">
  <link rel="canonical" href="${escHtml(url)}">
  <meta property="og:type" content="product">
  <meta property="og:locale" content="es_AR">
  <meta property="og:site_name" content="Carmesí Bags">
  <meta property="og:url" content="${escHtml(url)}">
  <meta property="og:title" content="${escHtml(nombre)} — ${plataAR(p.precio)}">
  <meta property="og:description" content="${escHtml(desc)}">
  <meta property="og:image" content="${escHtml(abs(p.foto))}">
  <meta property="product:price:amount" content="${p.precio}">
  <meta property="product:price:currency" content="ARS">
  <meta name="twitter:card" content="summary_large_image">`;
  const varias = p.fotos.length > 1;
  const seccion = `<section class="producto" id="producto" data-id="${escHtml(p.id)}">
      <nav class="migas" aria-label="Estás en"><a href="/">Inicio</a><span>›</span><a href="/#productos">${escHtml(nombreCat(p.categoria))}</a><span>›</span><span>${escHtml(nombre)}</span></nav>
      <div class="producto__caja">
        <div class="detalle__galeria">
          <div class="detalle__fotos" id="prodFotos">${p.fotos.map((src, i) => `<img src="${escHtml(src)}" alt="${escHtml(nombre)}${varias ? ` (foto ${i + 1} de ${p.fotos.length})` : ''}"${i ? ' loading="lazy"' : ''}>`).join('')}</div>
          <button class="detalle__flecha detalle__flecha--izq" type="button" id="prodAnterior" aria-label="Foto anterior"${varias ? '' : ' hidden'}>‹</button>
          <button class="detalle__flecha detalle__flecha--der" type="button" id="prodSiguiente" aria-label="Foto siguiente"${varias ? '' : ' hidden'}>›</button>
          <div class="detalle__puntos" id="prodPuntos">${!varias ? '' : p.fotos.map((_, i) => `<span${i ? '' : ' class="on"'}></span>`).join('')}</div>
        </div>
        <div class="detalle__info">
          <p class="detalle__cat">${escHtml(nombreCat(p.categoria))}</p>
          ${p.nuevo ? '<span class="chip-nuevo">✨ Nuevo</span>' : ''}
          <h1>${escHtml(p.nombre)}</h1>
          <p class="detalle__color">${escHtml(p.color)}</p>
          <p class="detalle__precio">${p.precioAnterior ? `<s class="precio-antes">${plataAR(p.precioAnterior)}</s> <span class="precio-oferta">${plataAR(p.precio)}</span> <span class="chip-oferta">-${Math.round((1 - p.precio / p.precioAnterior) * 100)}%</span>` : plataAR(p.precio)}</p>
          ${p.descripcion ? `<p class="detalle__desc">${escHtml(p.descripcion)}</p>` : ''}
          <button class="boton boton--bordo" type="button" id="prodAgregar"${p.agotado ? ' disabled' : ''}>${p.agotado ? 'Sin stock' : 'Agregar al pedido'}</button>
          ${p.agotado ? '<button class="boton boton--bordo" type="button" id="prodAvisame">🔔 Avisame cuando vuelva</button>' : ''}
          <a class="boton boton--borde-bordo" id="prodConsultar" href="https://wa.me/${escHtml(cat.whatsapp)}" target="_blank" rel="noopener">Consultar por WhatsApp</a>
          <button class="compartir" type="button" id="prodCompartir">🔗 Compartir este producto</button>
        </div>
      </div>
    </section>`;
  // Abajo, primero los de la misma categoría.
  const resto = [...cat.productos.filter((x) => x !== p && x.categoria === p.categoria), ...cat.productos.filter((x) => x.categoria !== p.categoria)];
  return conTextos(fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8'), await getTextos())
    .replace(/<!--META-->[\s\S]*?<!--\/META-->/, meta)
    .replace(/<!--PORTADA-->[\s\S]*?<!--\/PORTADA-->/, '')
    .replace('<!--PRODUCTO-->', seccion)
    .replace('<!--SEO-->', ld(tienda) + '\n  ' + ld(productoLd(p, nombreCat)) + '\n  ' + ld(migas))
    .replace('<!--GRILLA-->', tarjetasHtml(resto))
    .replace('<!--PREGUNTAS-->', preguntasHtml(cat.preguntas));
}

async function sitemapXml() {
  const dia = (t) => new Date(Number(t) || Date.now()).toISOString().slice(0, 10);
  const slugs = await productSlugs();
  const rows = (await db.execute('SELECT id, updated_at FROM products WHERE hidden = 0 ORDER BY id')).rows;
  const ultimo = Math.max(0, ...rows.map((r) => Number(r.updated_at) || 0));
  const urls = [`  <url><loc>${SITE_URL}/</loc><lastmod>${dia(ultimo)}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
    ...rows.map((r) => `  <url><loc>${SITE_URL}/producto/${slugs.get(String(r.id))}</loc><lastmod>${dia(r.updated_at)}</lastmod><priority>0.8</priority></url>`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}

const ROBOTS_TXT = `User-agent: *
Allow: /
Disallow: /panel
Disallow: /api/
Disallow: /inicio

Sitemap: ${SITE_URL}/sitemap.xml
`;

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
    // Página de cada producto. En construcción solo se ve con ?vista=1 (y Google no la indexa).
    const prod = url.pathname.match(/^\/producto\/([a-z0-9-]+)\/?$/);
    if (prod) {
      const vista = url.searchParams.has('vista');
      if (!vista && (await inMaintenance())) return serveFile(res, path.join(PUBLIC_DIR, 'construccion.html'), 'no-cache');
      const html = await renderProducto(prod[1]);
      // Producto borrado, oculto o con otro nombre: a la tienda.
      if (!html) return send(res, 302, '', { Location: vista ? '/inicio' : '/#productos' });
      return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...(vista ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}) });
    }
    if (url.pathname === '/robots.txt') return send(res, 200, ROBOTS_TXT, { 'Cache-Control': 'public, max-age=3600' });
    // El mapa del sitio recién se publica cuando la web está abierta.
    if (url.pathname === '/sitemap.xml') {
      if (await inMaintenance()) return send(res, 404, 'No encontrado');
      return send(res, 200, await sitemapXml(), { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    }
    // Vista previa de la tienda: se ve aunque la portada esté en construcción (Google no la indexa).
    if (url.pathname === '/inicio' && !(await inMaintenance())) return send(res, 302, '', { Location: '/' });
    if (url.pathname === '/inicio') {
      return send(res, 200, await renderTienda(), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex, nofollow' });
    }
    // En construcción: la tienda no se ve (ni por /index.html), el panel y las imágenes sí.
    const tienda = url.pathname === '/' || url.pathname === '/index.html';
    // Siempre, aunque esté logueado: la tienda se revisa en /inicio.
    if (tienda && (await inMaintenance())) return serveFile(res, path.join(PUBLIC_DIR, 'construccion.html'), 'no-cache');
    if (url.pathname === '/index.html') return send(res, 301, '', { Location: '/' });
    if (tienda) return send(res, 200, await renderTienda(), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    const rel = url.pathname === '/' ? 'index.html'
      : url.pathname === '/panel' ? 'panel.html'
      : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'No encontrado');
    const cache = rel.startsWith('assets/') ? 'public, max-age=604800' : 'no-cache';
    return serveFile(res, file, cache, req);
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message, ...(err.extra || {}) });
    console.error(err);
    return send(res, 500, { error: 'Error del servidor. Probá de nuevo.' });
  }
}

initDb().then(loadPerms).then(trimActivity).then(() => {
  setInterval(() => trimActivity().catch((e) => console.error(e)), 12 * 3600e3);
  // La copia diaria se revisa cada hora (y al arrancar).
  const backup = () => dailyBackup().catch((e) => console.error('Copia de seguridad:', e));
  backup();
  setInterval(backup, 3600e3);
  http.createServer(handle).listen(PORT, HOST, () => {
    console.log(`Carmesí escuchando en http://${HOST}:${PORT} (datos en ${DATA_DIR})`);
  });
}).catch((err) => {
  console.error('No se pudo iniciar la base de datos', err);
  process.exit(1);
});
