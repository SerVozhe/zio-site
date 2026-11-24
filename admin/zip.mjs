/* ==========================================================================
   ZIP без зависимостей: складывает файлы сайта для загрузки на хостинг.
   Админка, бэкапы и auth.json в архив не попадают.
   ========================================================================== */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/* CRC32 — таблица считается один раз */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Файлы и папки, которые не должны попасть на хостинг. */
const EXCLUDE_TOP = new Set(['admin', 'tools', 'node_modules']);
const EXCLUDE_FILES = new Set(['content.json', 'site.config.js.tmp']);
const EXCLUDE_EXT = new Set(['.tmp']);

/** Рекурсивно собирает список файлов относительно корня. */
async function walk(root, dir = root, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const full = join(dir, entry.name);
    const rel = relative(root, full).split(sep).join('/');

    if (entry.isDirectory()) {
      if (dir === root && EXCLUDE_TOP.has(entry.name)) continue;
      if (entry.name === 'backups') continue;
      await walk(root, full, out);
      continue;
    }

    if (EXCLUDE_FILES.has(rel)) continue;
    if (EXCLUDE_EXT.has(rel.slice(rel.lastIndexOf('.')))) continue;
    if (entry.name.includes('.tmp-')) continue;
    out.push({ full, rel });
  }
  return out;
}

/* -------------------------------------------------------------- запись ZIP */

function dosTime(date = new Date()) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, day };
}

/**
 * Собирает ZIP со статикой сайта.
 * @param {string} root папка проекта
 * @returns {Promise<Buffer>}
 */
export async function makeZip(root) {
  const files = await walk(root);
  const chunks = [];
  const central = [];
  let offset = 0;

  const { time, day } = dosTime();

  for (const file of files) {
    const data = await readFile(file.full);
    const name = Buffer.from(file.rel, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // версия
    local.writeUInt16LE(0, 6); // флаги
    local.writeUInt16LE(0, 8); // метод: без сжатия
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, name, data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(day, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt16LE(0, 32);
    dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(0, 38);
    dir.writeUInt32LE(offset, 42);

    central.push(dir, name);
    offset += local.length + name.length + data.length;
  }

  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, ...central, end]);
}

/** Для отчёта в админке: что именно уйдёт на хостинг. */
export async function describeZip(root) {
  const files = await walk(root);
  let bytes = 0;
  for (const f of files) bytes += (await stat(f.full)).size;
  return { count: files.length, bytes, files: files.map((f) => f.rel) };
}
