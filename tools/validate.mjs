/* ==========================================================================
   Проверка content.json перед сохранением и сборкой.
   Возвращает список ошибок; пустой список — контент в порядке.
   ========================================================================== */

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isString = (v) => typeof v === 'string';
const isArray = Array.isArray;

/** Списки, у которых каждый элемент обязан быть объектом с непустым полем. */
const LISTS = {
  'guardians.items': ['title', 'verb', 'text'],
  'lineup.items': ['name', 'role'],
  'show.setlist': ['title'],
  'news.items': ['date', 'title', 'text'],
  'releases.items': ['title'],
  'quotes.items': ['text', 'caption'],
  'merch.items': ['kind', 'name', 'price'],
};

export function validateContent(c) {
  const errors = [];

  if (!isObject(c)) return ['Контент должен быть объектом JSON'];

  if (!isObject(c.site)) errors.push('site — обязательный объект');
  else {
    if (!isString(c.site.title) || !c.site.title.trim()) errors.push('site.title пустой');
    if (!isString(c.site.description) || !c.site.description.trim())
      errors.push('site.description пустой');
    if (!isObject(c.site.og)) errors.push('site.og — обязательный объект');
  }

  if (!isObject(c.links)) errors.push('links — обязательный объект');

  if (!isObject(c.show)) errors.push('show — обязательный объект');
  else {
    if (!isString(c.show.datetime) || !ISO.test(c.show.datetime))
      errors.push('show.datetime должен быть в формате 2026-12-05T19:00:00+07:00');
    if (!isString(c.show.name) || !c.show.name.trim()) errors.push('show.name пустой');
  }

  if (!isObject(c.hero)) errors.push('hero — обязательный объект');
  if (!isObject(c.nav)) errors.push('nav — обязательный объект');
  if (!isObject(c.footer)) errors.push('footer — обязательный объект');
  if (!isObject(c.cta)) errors.push('cta — обязательный объект');

  if (!isArray(c.marquee)) errors.push('marquee должен быть массивом строк');

  for (const [path, fields] of Object.entries(LISTS)) {
    const [section, key] = path.split('.');
    const node = c[section];
    if (!isObject(node)) continue; // отсутствие секции уже отловлено выше либо допустимо
    const list = node[key];
    if (!isArray(list)) {
      errors.push(`${path} должен быть массивом`);
      continue;
    }
    list.forEach((item, i) => {
      if (!isObject(item)) {
        errors.push(`${path}[${i}] должен быть объектом`);
        return;
      }
      for (const field of fields) {
        if (!isString(item[field]) || !item[field].trim())
          errors.push(`${path}[${i}].${field} пустой`);
      }
      // дата новости — только YYYY-MM-DD
      if (key === 'items' && section === 'news' && item.date && !DATE_ONLY.test(item.date)) {
        errors.push(`${path}[${i}].date должен быть в формате 2026-11-20`);
      }
    });
  }

  // ссылки: значения либо пустые, либо начинаются с разрешённой схемы
  if (isObject(c.links)) {
    for (const [key, url] of Object.entries(c.links)) {
      if (!isString(url)) {
        errors.push(`links.${key} должен быть строкой`);
        continue;
      }
      if (url && !/^(https?:|mailto:|tel:|\/|#)/i.test(url))
        errors.push(`links.${key}: адрес должен начинаться с https://, mailto: или /`);
    }
  }

  return errors;
}
