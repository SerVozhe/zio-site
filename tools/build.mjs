#!/usr/bin/env node
/* ==========================================================================
   Сборка сайта: content.json → index.html + site.config.js.

   Запуск:  node tools/build.mjs
   Из админки вызывается автоматически после сохранения.
   ========================================================================== */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderSite } from './render.mjs';
import { validateContent } from './validate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Запись через временный файл: недописанный файл никогда не попадёт на место сайта. */
export async function writeAtomic(path, data) {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, data, 'utf8');
  await rename(tmp, path);
}

/**
 * Собирает сайт из готового объекта контента.
 * @returns {{ok: boolean, errors: string[], stats: object}}
 */
export async function build({ silent = false } = {}) {
  const raw = await readFile(join(ROOT, 'content.json'), 'utf8');

  let content;
  try {
    content = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errors: [`content.json — битый JSON: ${e.message}`], stats: {} };
  }

  const errors = validateContent(content);
  if (errors.length) return { ok: false, errors, stats: {} };

  const { html, config, sections } = renderSite(content);

  await writeAtomic(join(ROOT, 'index.html'), html);
  await writeAtomic(join(ROOT, 'site.config.js'), config);

  const stats = {
    sections: sections.map((s) => s.id),
    news: content.news?.items?.length || 0,
    releases: content.releases?.items?.length || 0,
    bytes: Buffer.byteLength(html, 'utf8'),
  };

  if (!silent) {
    console.log(`✓ index.html — ${stats.bytes} байт`);
    console.log(`✓ site.config.js`);
    console.log(`✓ секции: ${stats.sections.join(', ')}`);
  }

  return { ok: true, errors: [], stats };
}

// запуск напрямую: node tools/build.mjs
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const res = await build();
  if (!res.ok) {
    console.error('✗ Сборка не выполнена:');
    for (const e of res.errors) console.error('  - ' + e);
    process.exit(1);
  }
}
