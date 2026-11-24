#!/usr/bin/env node
/* ==========================================================================
   ZиО — локальная админка.

   Запуск:  node admin/server.mjs
   Открыть: http://127.0.0.1:8787

   Сервер слушает только localhost. Всё, что он делает, — читает и пишет
   файлы в папке сайта. На хостинг уезжает только результат сборки.
   ========================================================================== */

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { build, writeAtomic } from '../tools/build.mjs';
import { validateContent } from '../tools/validate.mjs';
import { makeZip } from './zip.mjs';

const scrypt = promisify(scryptCb);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_DIR = join(ROOT, 'admin');
const UI_DIR = join(ADMIN_DIR, 'ui');
const AUTH_FILE = join(ADMIN_DIR, 'auth.json');
const SESSIONS_FILE = join(ADMIN_DIR, 'sessions.json');
const UPLOAD_DIR = join(ROOT, 'assets', 'img', 'uploads');

const HOST = '127.0.0.1';
const PORT = Number(process.env.ZIO_ADMIN_PORT || 8787);
const SESSION_TTL = 12 * 60 * 60 * 1000; // 12 часов
const MAX_BODY = 2 * 1024 * 1024; // JSON контента
const MAX_UPLOAD = 10 * 1024 * 1024; // картинка
const MAX_ATTEMPTS = 6;
const ATTEMPT_WINDOW = 10 * 60 * 1000;

/* ------------------------------------------------------------- пароль/сессия */

// локальная дата (не UTC), иначе после полуночи по Новокузнецку дата отстаёт на день
function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function hasPassword() {
  const auth = await readJson(AUTH_FILE, null);
  return Boolean(auth?.hash && auth?.salt);
}

async function setPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  await writeAtomic(AUTH_FILE, JSON.stringify({ salt, hash, created: new Date().toISOString() }, null, 2));
}

async function checkPassword(password) {
  const auth = await readJson(AUTH_FILE, null);
  if (!auth?.hash) return false;
  const hash = (await scrypt(password, auth.salt, 64)).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(auth.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

const sessions = new Map();

async function loadSessions() {
  const saved = await readJson(SESSIONS_FILE, []);
  const now = Date.now();
  for (const [token, exp] of saved) {
    if (exp > now) sessions.set(token, exp);
  }
}

const saveSessions = () =>
  writeAtomic(SESSIONS_FILE, JSON.stringify([...sessions.entries()], null, 0)).catch(() => {});

function createSession() {
  const token = randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL);
  saveSessions();
  return token;
}

function sessionValid(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) {
    sessions.delete(token);
    saveSessions();
    return false;
  }
  return true;
}

function cookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const isAuthed = (req) => sessionValid(cookies(req).zio_admin);

/* --------------------------------------------------- ограничение попыток входа */

const attempts = new Map();

function tooManyAttempts(ip) {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > ATTEMPT_WINDOW) {
    attempts.delete(ip);
    return false;
  }
  return rec.count >= MAX_ATTEMPTS;
}

function noteAttempt(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() - rec.first > ATTEMPT_WINDOW) {
    attempts.set(ip, { first: Date.now(), count: 1 });
    return;
  }
  rec.count += 1;
}

/* ---------------------------------------------------------------- утилиты HTTP */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

const json = (res, status, payload, headers = {}) =>
  send(res, status, JSON.stringify(payload), {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Слишком большой запрос'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Безопасный путь внутри разрешённой папки. */
function safeJoin(base, urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  const full = join(base, clean);
  if (!full.startsWith(base + sep) && full !== base) return null;
  return full;
}

/* ------------------------------------------------------------------- API */

/**
 * Общий путь записи контента: валидация → бэкап → атомарная запись → сборка.
 * Импорт и обычное сохранение идут через него, чтобы правила были одинаковые.
 */
async function commitContent(content) {
  const errors = validateContent(content);
  if (errors.length) return { code: 422, error: { error: 'Проверь поля', details: errors } };

  // сначала бэкап текущего файла, потом запись
  try {
    const prev = await readFile(join(ROOT, 'content.json'), 'utf8');
    await mkdir(join(ADMIN_DIR, 'backups'), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await writeFile(join(ADMIN_DIR, 'backups', `content-${stamp}.json`), prev, 'utf8');
  } catch {
    /* первый запуск — бэкапить нечего */
  }

  content.meta = { ...(content.meta || {}), version: (content.meta?.version || 0) + 1, updated: today() };
  await writeAtomic(join(ROOT, 'content.json'), JSON.stringify(content, null, 2) + '\n');

  const result = await build({ silent: true });
  if (!result.ok) return { code: 500, error: { error: 'Контент сохранён, но сборка упала', details: result.errors } };

  return { stats: result.stats };
}

async function handleApi(req, res, url) {
  const route = url.pathname;

  // --- состояние: нужен ли пароль, авторизован ли ---
  if (route === '/api/state' && req.method === 'GET') {
    return json(res, 200, {
      needsSetup: !(await hasPassword()),
      authed: isAuthed(req),
    });
  }

  // --- первый запуск: задать пароль ---
  if (route === '/api/setup' && req.method === 'POST') {
    if (await hasPassword()) return json(res, 409, { error: 'Пароль уже задан' });
    const body = JSON.parse((await readBody(req, 4096)).toString('utf8') || '{}');
    const password = String(body.password || '');
    if (password.length < 6) return json(res, 400, { error: 'Пароль короче 6 символов' });
    await setPassword(password);
    const token = createSession();
    return json(
      res,
      200,
      { ok: true },
      { 'Set-Cookie': `zio_admin=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}` }
    );
  }

  // --- вход ---
  if (route === '/api/login' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || 'local';
    if (tooManyAttempts(ip))
      return json(res, 429, { error: 'Слишком много попыток. Подожди 10 минут.' });

    const body = JSON.parse((await readBody(req, 4096)).toString('utf8') || '{}');
    const ok = await checkPassword(String(body.password || ''));
    if (!ok) {
      noteAttempt(ip);
      return json(res, 401, { error: 'Неверный пароль' });
    }

    attempts.delete(ip);
    const token = createSession();
    return json(
      res,
      200,
      { ok: true },
      { 'Set-Cookie': `zio_admin=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}` }
    );
  }

  // --- выход ---
  if (route === '/api/logout' && req.method === 'POST') {
    const token = cookies(req).zio_admin;
    sessions.delete(token);
    saveSessions();
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'zio_admin=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0' });
  }

  // ниже — только для авторизованных
  if (!isAuthed(req)) return json(res, 401, { error: 'Нужен вход' });

  // --- чтение контента ---
  if (route === '/api/content' && req.method === 'GET') {
    const content = await readJson(join(ROOT, 'content.json'), null);
    if (!content) return json(res, 500, { error: 'content.json не читается' });
    return json(res, 200, content);
  }

  // --- выгрузка content.json (резервная копия) ---
  if (route === '/api/export' && req.method === 'GET') {
    const raw = await readFile(join(ROOT, 'content.json'), 'utf8');
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="zio-content-${today()}.json"`,
      'Cache-Control': 'no-store',
    });
    return res.end(raw);
  }

  // --- сохранение контента + пересборка ---
  if (route === '/api/save' && req.method === 'POST') {
    let content;
    try {
      content = JSON.parse((await readBody(req, MAX_BODY)).toString('utf8'));
    } catch {
      return json(res, 400, { error: 'Битый JSON — ничего не сохранено' });
    }

    const result = await commitContent(content);
    if (result.error) return json(res, result.code, result.error);
    return json(res, 200, { ok: true, stats: result.stats });
  }

  // --- импорт content.json (из резервной копии) ---
  if (route === '/api/import' && req.method === 'POST') {
    let content;
    try {
      content = JSON.parse((await readBody(req, MAX_BODY)).toString('utf8'));
    } catch {
      return json(res, 400, { error: 'Это не JSON — файл не подошёл' });
    }

    const result = await commitContent(content);
    if (result.error) return json(res, result.code, result.error);
    return json(res, 200, { ok: true, stats: result.stats });
  }

  // --- сборка без изменений ---
  if (route === '/api/build' && req.method === 'POST') {
    const result = await build({ silent: true });
    return json(res, result.ok ? 200 : 500, result);
  }

  // --- загрузка картинки ---
  if (route === '/api/upload' && req.method === 'POST') {
    const raw = await readBody(req, MAX_UPLOAD + 1024 * 64);
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(req.headers['content-type'] || '');
    if (!boundary) return json(res, 400, { error: 'Нужен multipart/form-data' });

    const delim = Buffer.from('--' + (boundary[1] || boundary[2]));
    const parts = splitBuffer(raw, delim);

    for (const part of parts) {
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd < 0) continue;
      const head = part.slice(0, headerEnd).toString('utf8');
      if (!/name="file"/.test(head)) continue;

      const nameMatch = /filename="([^"]*)"/.exec(head);
      const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(head);
      const ext = extname(nameMatch?.[1] || '').toLowerCase();
      const type = (typeMatch?.[1] || '').trim();

      const allowed = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
      };
      if (!allowed[ext]) return json(res, 415, { error: 'Только PNG, JPG или WebP' });
      if (type && !Object.values(allowed).includes(type))
        return json(res, 415, { error: 'Файл не похож на картинку' });

      let data = part.slice(headerEnd + 4);
      if (data.slice(-2).toString() === '\r\n') data = data.slice(0, -2);
      if (data.length < 64) return json(res, 400, { error: 'Пустой файл' });

      await mkdir(UPLOAD_DIR, { recursive: true });
      const base = (nameMatch?.[1] || 'image')
        .replace(/\.[^.]+$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'image';
      const filename = `${base}-${Date.now().toString(36)}${ext}`;
      await writeFile(join(UPLOAD_DIR, filename), data);

      return json(res, 200, {
        ok: true,
        path: `assets/img/uploads/${filename}`,
        bytes: data.length,
      });
    }

    return json(res, 400, { error: 'В форме нет файла' });
  }

  // --- список загруженных картинок ---
  if (route === '/api/uploads' && req.method === 'GET') {
    try {
      const files = (await readdir(UPLOAD_DIR)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
      const list = [];
      for (const f of files) {
        const s = await stat(join(UPLOAD_DIR, f));
        list.push({ path: `assets/img/uploads/${f}`, bytes: s.size, mtime: s.mtimeMs });
      }
      list.sort((a, b) => b.mtime - a.mtime);
      return json(res, 200, { files: list });
    } catch {
      return json(res, 200, { files: [] });
    }
  }

  // --- экспорт готового сайта в ZIP ---
  if (route === '/api/zip' && req.method === 'GET') {
    const zip = await makeZip(ROOT);
    return send(res, 200, zip, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="zio-site-${today()}.zip"`,
      'Cache-Control': 'no-store',
    });
  }

  return json(res, 404, { error: 'Нет такого метода' });
}

/** Разбор multipart по границе. */
function splitBuffer(buf, delim) {
  const parts = [];
  let start = buf.indexOf(delim);
  while (start !== -1) {
    const from = start + delim.length;
    const next = buf.indexOf(delim, from);
    if (next === -1) break;
    parts.push(buf.slice(from + 2, next - 2));
    start = next;
  }
  return parts;
}

/* -------------------------------------------------------- статика сайта/UI */

async function serveStatic(req, res, url, base) {
  let pathname = url.pathname;

  // админка живёт на /admin, всё остальное — сам сайт
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  const file = safeJoin(base, pathname);
  if (!file) return send(res, 403, 'Forbidden');

  try {
    const info = await stat(file);
    if (info.isDirectory()) return send(res, 404, 'Not found');
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    send(res, 404, 'Not found');
  }
}

/* ------------------------------------------------------------------ сервер */

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

    // /admin → /admin/ : иначе относительные пути (admin.css, admin.js)
    // разрешаются от корня и попадают в 404
    if (url.pathname === '/admin') {
      res.writeHead(302, { Location: '/admin/' });
      return res.end();
    }

    // /admin и /admin/ → интерфейс админки
    if (url.pathname === '/admin/') {
      return await serveStatic(req, res, new URL('/index.html', url.origin), UI_DIR);
    }
    if (url.pathname.startsWith('/admin/')) {
      const rest = url.pathname.slice('/admin'.length);
      return await serveStatic(req, res, new URL(rest, url.origin), UI_DIR);
    }

    // всё остальное — файлы сайта (чтобы превью работало)
    return await serveStatic(req, res, url, ROOT);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'Внутренняя ошибка', details: String(e?.message || e) });
  }
});

await loadSessions();
await mkdir(UPLOAD_DIR, { recursive: true }).catch(() => {});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ZиО · админка');
  console.log(`  http://${HOST}:${PORT}/admin`);
  console.log('');
  console.log('  Ctrl+C — остановить.');
  console.log('');
});
