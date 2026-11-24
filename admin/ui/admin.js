/* ==========================================================================
   ZиО — админка. Схема полей + редактор поверх content.json.
   ========================================================================== */

/* --------------------------------------------------------------- API */

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {},
    ...options,
  });

  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => ({})) : await res.text();

  if (!res.ok) {
    const err = new Error((data && data.error) || `Ошибка ${res.status}`);
    err.details = data && data.details;
    err.status = res.status;
    throw err;
  }
  return data;
}

/* --------------------------------------------------------------- утилиты */

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
};

let toastTimer;
function toast(message, kind = '') {
  const box = $('#toast');
  box.textContent = message;
  box.className = 'toast is-visible' + (kind ? ` is-${kind}` : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    box.className = 'toast';
  }, 4200);
}

const getPath = (obj, path) =>
  path.split('.').reduce((o, key) => (o == null ? undefined : o[key]), obj);

function setPath(obj, path, value) {
  const parts = path.split('.');
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (node[parts[i]] == null || typeof node[parts[i]] !== 'object') node[parts[i]] = {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
}

/* --------------------------------------------------------------- состояние */

const state = {
  content: null,
  dirty: false,
  active: 'general',
  uploads: [],
};

function markDirty() {
  state.dirty = true;
  $('#dirty').hidden = false;
}

function clearDirty() {
  state.dirty = false;
  $('#dirty').hidden = true;
}

/* ---------------------------------------------------------------- схема */

const TONE_OPTIONS = [
  ['normal', 'обычная строка'],
  ['dim', 'приглушённая'],
  ['accent', 'оранжевый акцент'],
];

const GLYPH_OPTIONS = [
  ['eye', 'глаз (VR)'],
  ['mask', 'маска'],
  ['headphones', 'наушники'],
  ['drum', 'барабаны'],
];

const SIZE_OPTIONS = [
  ['lg', 'крупная'],
  ['sm', 'мелкая'],
];

/** Всё, что можно редактировать, описано здесь. */
const SCHEMA = [
  {
    id: 'general',
    title: 'Общее',
    hint: 'Название, описание и превью для соцсетей. Дату концерта меняй в разделе «Концерт» — она подставится везде.',
    blocks: [
      {
        title: 'Бренд',
        fields: [
          { key: 'site.bandName', label: 'Название группы', type: 'text' },
          { key: 'site.wordmark', label: 'Логотип (капсом)', type: 'text', hint: 'Надпись в шапке, hero и подвале' },
          { key: 'site.tagline', label: 'Подпись под логотипом', type: 'text' },
          { key: 'site.city', label: 'Город', type: 'text' },
          { key: 'site.status', label: 'Статус', type: 'text' },
        ],
      },
      {
        title: 'Метаданные',
        fields: [
          { key: 'site.title', label: 'Title страницы', type: 'text', wide: true, hint: 'Можно использовать {date.badge}, {show}' },
          { key: 'site.description', label: 'Description', type: 'textarea', wide: true },
          { key: 'site.themeColor', label: 'theme-color', type: 'text' },
          { key: 'site.lang', label: 'Язык', type: 'text' },
        ],
      },
      {
        title: 'Превью для соцсетей (Open Graph)',
        fields: [
          { key: 'site.og.title', label: 'Заголовок превью', type: 'text', wide: true },
          { key: 'site.og.description', label: 'Описание превью', type: 'textarea', wide: true },
          { key: 'site.og.image', label: 'Картинка 1200×630', type: 'image' },
          { key: 'site.icon', label: 'Иконка сайта', type: 'image' },
          { key: 'site.og.width', label: 'Ширина', type: 'number' },
          { key: 'site.og.height', label: 'Высота', type: 'number' },
        ],
      },
      {
        title: 'Микроразметка',
        fields: [
          { key: 'site.schema.genre', label: 'Жанры (через запятую)', type: 'csv' },
          { key: 'site.schema.foundingLocation', label: 'Место основания', type: 'text' },
        ],
      },
    ],
  },

  {
    id: 'links',
    title: 'Ссылки',
    hint: 'Все внешние адреса сайта в одном месте. Пустое поле — кнопка покажет подсказку вместо перехода.',
    blocks: [
      {
        title: 'Адреса',
        fields: [
          { key: 'links.listen', label: 'Слушать (Яндекс.Музыка)', type: 'url' },
          { key: 'links.vk', label: 'ВКонтакте', type: 'url' },
          { key: 'links.telegram', label: 'Telegram', type: 'url' },
          { key: 'links.tickets', label: 'Билеты', type: 'url' },
          { key: 'links.email', label: 'Почта организаторов', type: 'url', hint: 'mailto:mail@example.com' },
          { key: 'links.merch', label: 'Заказ мерча', type: 'url' },
        ],
      },
      {
        title: 'Подсказка',
        fields: [{ key: 'messages.emptyLink', label: 'Текст, если адреса нет', type: 'text', wide: true }],
      },
    ],
  },

  {
    id: 'nav',
    title: 'Шапка',
    hint: 'Кнопка «Слушать» в шапке и подпись последнего пункта меню. Пункты меню собираются из разделов.',
    blocks: [
      {
        title: 'Навигация',
        fields: [
          { key: 'nav.ctaLabel', label: 'Кнопка в шапке', type: 'text' },
          { key: 'nav.ctaLink', label: 'Ссылка кнопки (ключ из «Ссылок»)', type: 'text' },
          { key: 'nav.contactLabel', label: 'Последний пункт меню', type: 'text' },
          { key: 'nav.contactHref', label: 'Якорь последнего пункта', type: 'text' },
        ],
      },
    ],
  },

  {
    id: 'hero',
    title: 'Hero',
    hint: 'Первый экран. Токены {date.badge}, {show}, {city} подставляются автоматически.',
    blocks: [
      {
        title: 'Первый экран',
        fields: [
          { key: 'hero.badge', label: 'Плашка сверху', type: 'text', wide: true },
          { key: 'hero.srTitle', label: 'Скрытый заголовок для поиска', type: 'text', wide: true },
          { key: 'hero.line', label: 'Главная фраза', type: 'rich', wide: true },
        ],
      },
      {
        title: 'Кнопки',
        fields: [
          { key: 'hero.primaryLabel', label: 'Главная кнопка', type: 'text' },
          { key: 'hero.primaryLink', label: 'Ключ ссылки', type: 'text' },
          { key: 'hero.secondaryLabel', label: 'Вторая кнопка', type: 'text' },
          { key: 'hero.secondaryHref', label: 'Якорь', type: 'text' },
        ],
      },
      {
        title: 'Строка под логотипом',
        fields: [{ key: 'hero.sub', label: 'Элементы', type: 'strings', wide: true }],
      },
      {
        title: 'Мета-строка',
        fields: [{ key: 'hero.meta', label: 'Пары', type: 'list', wide: true, item: [
          { key: 'label', label: 'Подпись', type: 'text' },
          { key: 'value', label: 'Значение', type: 'text' },
        ] }],
      },
    ],
  },

  {
    id: 'marquee',
    title: 'Бегущая строка',
    hint: 'Фразы идут по кругу. Порядок сохраняется.',
    blocks: [{ title: 'Фразы', fields: [{ key: 'marquee', label: 'Строки', type: 'strings', wide: true }] }],
  },

  {
    id: 'manifest',
    title: 'Манифест',
    section: 'manifest',
    blocks: [
      {
        title: 'Заголовок раздела',
        fields: [
          { key: 'manifest.eyebrow', label: 'Надзаголовок', type: 'text' },
          { key: 'manifest.title', label: 'Заголовок', type: 'text' },
        ],
      },
      {
        title: 'Крупное утверждение',
        fields: [{ key: 'manifest.statement', label: 'Строки', type: 'list', wide: true, item: [
          { key: 'text', label: 'Текст', type: 'text' },
          { key: 'tone', label: 'Стиль', type: 'select', options: TONE_OPTIONS },
        ] }],
      },
      {
        title: 'Абзацы',
        fields: [{ key: 'manifest.body', label: 'Тексты', type: 'richlist', wide: true }],
      },
      {
        title: 'Факты',
        fields: [{ key: 'manifest.facts', label: 'Пары', type: 'list', wide: true, item: [
          { key: 'term', label: 'Подпись', type: 'text' },
          { key: 'value', label: 'Значение', type: 'text' },
        ] }],
      },
    ],
  },

  {
    id: 'guardians',
    title: 'Стражи',
    section: 'guardians',
    blocks: [
      {
        title: 'Заголовок раздела',
        fields: [
          { key: 'guardians.eyebrow', label: 'Надзаголовок', type: 'text' },
          { key: 'guardians.title', label: 'Заголовок', type: 'text' },
          { key: 'guardians.lede', label: 'Вступление', type: 'rich', wide: true },
          { key: 'guardians.outro', label: 'Фраза внизу', type: 'rich', wide: true },
        ],
      },
      {
        title: 'Карточки',
        fields: [{ key: 'guardians.items', label: 'Стражи', type: 'list', wide: true, item: [
          { key: 'glyph', label: 'Иконка', type: 'select', options: GLYPH_OPTIONS },
          { key: 'verb', label: 'Глагол', type: 'text' },
          { key: 'num', label: 'Подпись на гексе', type: 'text' },
          { key: 'title', label: 'Заголовок описания', type: 'text' },
          { key: 'text', label: 'Описание', type: 'textarea', wide: true },
        ] }],
      },
    ],
  },

  {
    id: 'lineup',
    title: 'Состав',
    section: 'lineup',
    blocks: [
      {
        title: 'Заголовок раздела',
        fields: [
          { key: 'lineup.eyebrow', label: 'Надзаголовок', type: 'text' },
          { key: 'lineup.title', label: 'Заголовок', type: 'text' },
          { key: 'lineup.lede', label: 'Вступление', type: 'rich', wide: true },
        ],
      },
      {
        title: 'Участники',
        fields: [{ key: 'lineup.items', label: 'Карточки', type: 'list', wide: true, item: [
          { key: 'name', label: 'Имя', type: 'text' },
          { key: 'role', label: 'Роль', type: 'text' },
          { key: 'tag', label: 'Тег', type: 'text' },
          { key: 'note', label: 'Заметка', type: 'textarea', wide: true },
        ] }],
      },
    ],
  },

  {
    id: 'show',
    title: 'Концерт',
    section: 'show',
    hint: 'Дата отсюда идёт и в обратный отсчёт, и в заголовки, и в меню. Меняешь один раз — меняется везде.',
    blocks: [
      {
        title: 'Главное',
        fields: [
          { key: 'show.datetime', label: 'Дата и время', type: 'datetime', wide: true, hint: 'Формат: 2026-12-05T19:00:00+07:00' },
          { key: 'show.name', label: 'Название концерта', type: 'text' },
          { key: 'show.city', label: 'Город', type: 'text' },
          { key: 'show.eyebrow', label: 'Надзаголовок', type: 'text' },
          { key: 'show.desc', label: 'Описание', type: 'rich', wide: true },
        ],
      },
      {
        title: 'Где и с кем',
        fields: [{ key: 'show.where', label: 'Элементы строки', type: 'strings', wide: true }],
      },
      {
        title: 'Обратный отсчёт',
        fields: [
          { key: 'show.countdownLabel', label: 'Подпись', type: 'text' },
          { key: 'show.pastLabel', label: 'После концерта — заголовок', type: 'text' },
        ],
      },
      {
        title: 'Подписи единиц',
        fields: [{ key: 'show.countdownUnits', label: 'дни / часы / минуты / секунды', type: 'strings', wide: true }],
      },
      {
        title: 'Билеты',
        fields: [
          { key: 'show.ticketsLabel', label: 'Текст кнопки', type: 'text' },
          { key: 'show.ticketsLink', label: 'Ключ ссылки', type: 'text' },
          { key: 'show.setlistLabel', label: 'Заголовок сет-листа', type: 'text' },
        ],
      },
      {
        title: 'Сет-лист',
        fields: [{ key: 'show.setlist', label: 'Песни', type: 'list', wide: true, item: [
          { key: 'title', label: 'Название', type: 'text' },
          { key: 'tag', label: 'Пометка', type: 'text', hint: 'например «финал»' },
        ] }],
      },
    ],
  },

  {
    id: 'news',
    title: 'Новости',
    section: 'news',
    hint: 'Если удалить все записи, раздел исчезнет с сайта, а нумерация остальных пересчитается.',
    blocks: [
      {
        title: 'Заголовок раздела',
        fields: [
          { key: 'news.eyebrow', label: 'Надзаголовок', type: 'text' },
          { key: 'news.title', label: 'Заголовок', type: 'text' },
          { key: 'news.lede', label: 'Вступление', type: 'rich', wide: true },
          { key: 'news.emptyText', label: 'Текст, если записей нет', type: 'text', wide: true },
        ],
      },
      {
        title: 'Записи',
        fields: [{ key: 'news.items', label: 'Новости', type: 'list', wide: true, item: [
          { key: 'date', label: 'Дата', type: 'date' },
          { key: 'title', label: 'Заголовок', type: 'text' },
          { key: 'text', label: 'Текст', type: 'textarea', wide: true },
          { key: 'link', label: 'Ссылка', type: 'url', hint: 'необязательно' },
          { key: 'linkLabel', label: 'Текст ссылки', type: 'text' },
        ] }],
      },
    ],
  },

  {
    id: 'releases',
    title: 'Релизы',
    section: 'releases',
    hint: 'Обложка необязательна — без неё плитка покажет логотип.',
    blocks: [
      {
        title: 'Заголовок раздела',
        fields: [
          { key: 'releases.eyebrow', label: 'Надзаголовок', type: 'text' },
          { key: 'releases.title', label: 'Заголовок', type: 'text' },
          { key: 'releases.lede', label: 'Вступление', type: 'rich', wide: true },
        ],
      },
      {
        title: 'Плитки',
        fields: [{ key: 'releases.items', label: 'Релизы', type: 'list', wide: true, item: [
          { key: 'title', label: 'Название', type: 'text' },
          { key: 'type', label: 'Тип', type: 'text', hint: 'сингл, EP, альбом' },
          { key: 'year', label: 'Год', type: 'text' },
          { key: 'cover', label: 'Обложка', type: 'image' },
          { key: 'link', label: 'Ссылка', type: 'url' },
          { key: 'linkLabel', label: 'Текст ссылки', type: 'text' },
        ] }],
      },
    ],
  },

  {
    id: 'quotes',
    title: 'Цитаты',
    section: 'quotes',
    blocks: [
      {
        title: 'Заголовок раздела',
        fields: [
          { key: 'quotes.eyebrow', label: 'Надзаголовок', type: 'text' },
          { key: 'quotes.title', label: 'Заголовок', type: 'text' },
        ],
      },
      {
        title: 'Цитаты',
        fields: [{ key: 'quotes.items', label: 'Карточки', type: 'list', wide: true, item: [
          { key: 'size', label: 'Размер', type: 'select', options: SIZE_OPTIONS },
          { key: 'caption', label: 'Подпись', type: 'text' },
          { key: 'text', label: 'Цитата', type: 'textarea', wide: true },
        ] }],
      },
    ],
  },

  {
    id: 'merch',
    title: 'Мерч',
    section: 'merch',
    blocks: [
      {
        title: 'Заголовок раздела',
        fields: [
          { key: 'merch.eyebrow', label: 'Надзаголовок', type: 'text' },
          { key: 'merch.title', label: 'Заголовок', type: 'text' },
          { key: 'merch.lede', label: 'Вступление', type: 'rich', wide: true },
        ],
      },
      {
        title: 'Товары',
        fields: [{ key: 'merch.items', label: 'Позиции', type: 'list', wide: true, item: [
          { key: 'kind', label: 'Категория', type: 'text' },
          { key: 'name', label: 'Название', type: 'text' },
          { key: 'price', label: 'Цена', type: 'text' },
          { key: 'note', label: 'Примечание', type: 'text' },
        ] }],
      },
    ],
  },

  {
    id: 'cta',
    title: 'Призыв',
    hint: 'Финальный блок перед подвалом. Номер раздела считается автоматически.',
    blocks: [
      {
        title: 'Текст',
        fields: [
          { key: 'cta.eyebrow', label: 'Надзаголовок', type: 'text' },
          { key: 'cta.title', label: 'Заголовок', type: 'text', wide: true },
          { key: 'cta.text', label: 'Текст', type: 'rich', wide: true },
        ],
      },
      {
        title: 'Кнопки',
        fields: [{ key: 'cta.buttons', label: 'Кнопки', type: 'list', wide: true, item: [
          { key: 'label', label: 'Текст', type: 'text' },
          { key: 'link', label: 'Ключ ссылки', type: 'text' },
        ] }],
      },
    ],
  },

  {
    id: 'footer',
    title: 'Подвал',
    blocks: [
      {
        title: 'Бренд',
        fields: [
          { key: 'footer.mark', label: 'Логотип', type: 'text' },
          { key: 'footer.brand', label: 'Описание', type: 'textarea', wide: true },
        ],
      },
      {
        title: 'Ссылки',
        fields: [{ key: 'footer.links', label: 'Ссылки', type: 'list', wide: true, item: [
          { key: 'label', label: 'Текст', type: 'text' },
          { key: 'link', label: 'Ключ из «Ссылок»', type: 'text' },
        ] }],
      },
      {
        title: 'Нижняя строка',
        fields: [{ key: 'footer.bottom', label: 'Строки', type: 'strings', wide: true }],
      },
    ],
  },
];

/* ------------------------------------------------------------ конструктор */

/** Создаёт поле ввода по описанию. */
function buildField(desc, value, onChange) {
  const wrap = el('label', 'field');
  if (desc.wide) wrap.style.gridColumn = '1 / -1';

  const label = el('span', 'field__label');
  label.textContent = desc.label;
  wrap.append(label);

  const commit = (v) => {
    onChange(v);
    markDirty();
  };

  if (desc.type === 'textarea' || desc.type === 'rich') {
    const area = el('textarea', 'field__area' + (desc.type === 'rich' ? ' field__area--rich' : ''));
    area.value = value ?? '';
    area.addEventListener('input', () => commit(area.value));
    wrap.append(area);
  } else if (desc.type === 'select') {
    const select = el('select', 'field__select');
    for (const [val, name] of desc.options) {
      const option = el('option');
      option.value = val;
      option.textContent = name;
      select.append(option);
    }
    select.value = value ?? desc.options[0][0];
    select.addEventListener('change', () => commit(select.value));
    wrap.append(select);
  } else if (desc.type === 'number') {
    const input = el('input', 'field__input');
    input.type = 'number';
    input.value = value ?? '';
    input.addEventListener('input', () => commit(Number(input.value) || 0));
    wrap.append(input);
  } else if (desc.type === 'date') {
    const input = el('input', 'field__input');
    input.type = 'date';
    input.value = value ?? '';
    input.addEventListener('input', () => commit(input.value));
    wrap.append(input);
  } else if (desc.type === 'datetime') {
    const input = el('input', 'field__input');
    input.value = value ?? '';
    input.placeholder = '2026-12-05T19:00:00+07:00';
    input.addEventListener('input', () => commit(input.value));
    wrap.append(input);
  } else if (desc.type === 'csv') {
    const input = el('input', 'field__input');
    input.value = Array.isArray(value) ? value.join(', ') : value ?? '';
    input.addEventListener('input', () =>
      commit(
        input.value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      )
    );
    wrap.append(input);
  } else if (desc.type === 'image') {
    wrap.append(buildImageField(desc, value, commit));
  } else {
    const input = el('input', 'field__input');
    input.type = 'text';
    input.value = value ?? '';
    input.addEventListener('input', () => commit(input.value));
    wrap.append(input);
  }

  if (desc.hint) {
    const hint = el('span', 'field__hint');
    hint.textContent = desc.hint;
    wrap.append(hint);
  }

  return wrap;
}

/** Поле картинки: превью, путь, загрузка, выбор из загруженных. */
function buildImageField(desc, value, commit) {
  const box = el('div');
  box.style.display = 'grid';
  box.style.gap = '8px';

  const row = el('div', 'field__row');

  const input = el('input', 'field__input');
  input.type = 'text';
  input.value = value ?? '';
  input.placeholder = 'assets/img/…';

  const upload = el('button', 'btn btn--ghost btn--sm');
  upload.type = 'button';
  upload.textContent = 'Загрузить';

  const thumb = el('img', 'thumb__img');
  thumb.alt = '';

  const paint = (src) => {
    if (src) {
      thumb.src = '/' + String(src).replace(/^\/+/, '');
      thumb.hidden = false;
    } else {
      thumb.hidden = true;
    }
  };
  paint(value);

  input.addEventListener('input', () => {
    commit(input.value);
    paint(input.value);
  });

  upload.addEventListener('click', () =>
    pickFile(async (path) => {
      input.value = path;
      commit(path);
      await loadUploads();
      renderPanel(state.active);
    })
  );

  row.append(input, upload);
  box.append(row, thumb);

  // выбор из уже загруженных
  const gallery = el('div', 'gallery');
  for (const file of state.uploads) {
    const btn = el('button', 'gallery__item');
    btn.type = 'button';
    btn.title = file.path;
    const img = el('img');
    img.src = '/' + file.path;
    img.alt = '';
    img.loading = 'lazy';
    btn.append(img);
    btn.addEventListener('click', () => {
      input.value = file.path;
      commit(file.path);
      paint(file.path);
    });
    gallery.append(btn);
  }
  if (state.uploads.length) box.append(gallery);

  void desc;
  return box;
}

/* ------------------------------------------------------------- списки */

function buildStringsField(desc, list, onChange) {
  const wrap = el('div', 'rows');

  const rerender = () => {
    wrap.innerHTML = '';
    list.forEach((text, i) => {
      const row = el('div', 'row');

      const input = el('input', 'field__input');
      input.value = text;
      input.placeholder = 'Текст';
      input.addEventListener('input', () => {
        list[i] = input.value;
        onChange(list);
        markDirty();
      });

      const actions = el('div');
      actions.style.display = 'flex';
      actions.style.gap = '4px';

      actions.append(
        miniBtn('↑', () => {
          if (i === 0) return;
          [list[i - 1], list[i]] = [list[i], list[i - 1]];
          onChange(list);
          markDirty();
          rerender();
        }),
        miniBtn('↓', () => {
          if (i === list.length - 1) return;
          [list[i + 1], list[i]] = [list[i], list[i + 1]];
          onChange(list);
          markDirty();
          rerender();
        }),
        miniBtn('✕', () => {
          list.splice(i, 1);
          onChange(list);
          markDirty();
          rerender();
        }, 'btn--danger')
      );

      row.append(input, actions);
      wrap.append(row);
    });

    const add = el('button', 'btn btn--ghost btn--sm');
    add.type = 'button';
    add.textContent = '+ добавить строку';
    add.addEventListener('click', () => {
      list.push('');
      onChange(list);
      markDirty();
      rerender();
    });
    wrap.append(add);
  };

  rerender();
  return wrap;
}

function buildRichListField(desc, list, onChange) {
  const wrap = el('div', 'rows');

  const rerender = () => {
    wrap.innerHTML = '';
    list.forEach((text, i) => {
      const card = el('div', 'card');
      const head = el('div', 'card__head');
      const title = el('span', 'card__title');
      title.textContent = `абзац ${i + 1}`;
      const actions = el('div', 'card__actions');
      actions.append(
        miniBtn('↑', () => {
          if (i === 0) return;
          [list[i - 1], list[i]] = [list[i], list[i - 1]];
          onChange(list);
          markDirty();
          rerender();
        }),
        miniBtn('↓', () => {
          if (i === list.length - 1) return;
          [list[i + 1], list[i]] = [list[i], list[i + 1]];
          onChange(list);
          markDirty();
          rerender();
        }),
        miniBtn('✕', () => {
          list.splice(i, 1);
          onChange(list);
          markDirty();
          rerender();
        }, 'btn--danger')
      );
      head.append(title, actions);

      const area = el('textarea', 'field__area field__area--rich');
      area.value = text;
      area.addEventListener('input', () => {
        list[i] = area.value;
        onChange(list);
        markDirty();
      });

      card.append(head, area);
      wrap.append(card);
    });

    const add = el('button', 'btn btn--ghost btn--sm');
    add.type = 'button';
    add.textContent = '+ добавить абзац';
    add.addEventListener('click', () => {
      list.push('');
      onChange(list);
      markDirty();
      rerender();
    });
    wrap.append(add);
  };

  rerender();
  return wrap;
}

function buildObjectListField(desc, list, onChange) {
  const wrap = el('div', 'rows');

  const rerender = () => {
    wrap.innerHTML = '';
    list.forEach((item, i) => {
      const card = el('div', 'card');

      const head = el('div', 'card__head');
      const title = el('span', 'card__title');
      const nameKey = desc.item.find((f) => f.key === 'name' || f.key === 'title')?.key;
      title.textContent = `${i + 1}. ${(nameKey && item[nameKey]) || 'без названия'}`;

      const actions = el('div', 'card__actions');
      actions.append(
        miniBtn('↑', () => {
          if (i === 0) return;
          [list[i - 1], list[i]] = [list[i], list[i - 1]];
          onChange(list);
          markDirty();
          rerender();
        }),
        miniBtn('↓', () => {
          if (i === list.length - 1) return;
          [list[i + 1], list[i]] = [list[i], list[i + 1]];
          onChange(list);
          markDirty();
          rerender();
        }),
        miniBtn('✕', () => {
          list.splice(i, 1);
          onChange(list);
          markDirty();
          rerender();
        }, 'btn--danger')
      );
      head.append(title, actions);
      card.append(head);

      const grid = el('div', 'grid-2');
      for (const field of desc.item) {
        const holder = buildField(
          { ...field, wide: field.wide },
          item[field.key],
          (v) => {
            item[field.key] = v;
            onChange(list);
            if (field.key === nameKey) title.textContent = `${i + 1}. ${v || 'без названия'}`;
          }
        );
        grid.append(holder);
      }
      card.append(grid);
      wrap.append(card);
    });

    const add = el('button', 'btn btn--ghost btn--sm');
    add.type = 'button';
    add.textContent = '+ добавить';
    add.addEventListener('click', () => {
      const blank = {};
      for (const f of desc.item) {
        blank[f.key] = f.type === 'select' ? f.options[0][0] : '';
      }
      list.push(blank);
      onChange(list);
      markDirty();
      rerender();
    });
    wrap.append(add);
  };

  rerender();
  return wrap;
}

function miniBtn(text, onClick, extra = '') {
  const btn = el('button', `btn btn--ghost btn--icon ${extra}`);
  btn.type = 'button';
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

/* ------------------------------------------------------------- панели */

function renderPanel(id) {
  const section = SCHEMA.find((s) => s.id === id) || SCHEMA[0];
  const editor = $('#editor');
  editor.innerHTML = '';

  const head = el('div', 'panel__head');
  const title = el('h2', 'panel__title');
  title.textContent = section.title;
  head.append(title);
  if (section.hint) {
    const hint = el('p', 'panel__hint');
    hint.textContent = section.hint;
    head.append(hint);
  }

  // переключатели раздела
  if (section.section) {
    const toggles = el('div', 'grid-2');
    toggles.style.marginTop = '8px';

    toggles.append(
      toggleField('Показывать на сайте', getPath(state.content, `${section.section}.enabled`) !== false, (v) => {
        setPath(state.content, `${section.section}.enabled`, v);
        markDirty();
        renderSidebar();
      }),
      toggleField('Пункт в меню', Boolean(getPath(state.content, `${section.section}.nav`)), (v) => {
        setPath(state.content, `${section.section}.nav`, v);
        markDirty();
      })
    );
    head.append(toggles);

    const navLabel = el('div');
    navLabel.style.marginTop = '12px';
    navLabel.append(
      buildField(
        { key: `${section.section}.navLabel`, label: 'Подпись в меню', type: 'text' },
        getPath(state.content, `${section.section}.navLabel`) ?? '',
        (v) => setPath(state.content, `${section.section}.navLabel`, v)
      )
    );
    head.append(navLabel);
  }

  editor.append(head);

  for (const block of section.blocks) {
    const blockEl = el('div', 'block');

    const blockHead = el('div', 'block__head');
    const blockTitle = el('span', 'block__title');
    blockTitle.textContent = block.title;
    blockHead.append(blockTitle);
    blockEl.append(blockHead);

    const grid = el('div', block.fields.length === 1 ? '' : 'grid-2');
    if (block.fields.length === 1) grid.style.display = 'grid';
    grid.style.gap = '14px';

    for (const field of block.fields) {
      const value = getPath(state.content, field.key);

      let holder;
      if (field.type === 'strings') {
        holder = el('div', 'field');
        if (field.wide) holder.style.gridColumn = '1 / -1';
        const label = el('span', 'field__label');
        label.textContent = field.label;
        holder.append(label);
        holder.append(
          buildStringsField(field, Array.isArray(value) ? value : [], (v) => setPath(state.content, field.key, v))
        );
      } else if (field.type === 'richlist') {
        holder = el('div', 'field');
        if (field.wide) holder.style.gridColumn = '1 / -1';
        const label = el('span', 'field__label');
        label.textContent = field.label;
        holder.append(label);
        holder.append(
          buildRichListField(field, Array.isArray(value) ? value : [], (v) => setPath(state.content, field.key, v))
        );
      } else if (field.type === 'list') {
        holder = el('div', 'field');
        if (field.wide) holder.style.gridColumn = '1 / -1';
        const label = el('span', 'field__label');
        label.textContent = field.label;
        holder.append(label);
        holder.append(
          buildObjectListField(field, Array.isArray(value) ? value : [], (v) => setPath(state.content, field.key, v))
        );
      } else {
        holder = buildField(field, value, (v) => setPath(state.content, field.key, v));
      }

      grid.append(holder);
    }

    blockEl.append(grid);
    editor.append(blockEl);
  }

  editor.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function toggleField(labelText, checked, onChange) {
  const label = el('label', 'toggle');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));

  const text = el('span');
  text.textContent = labelText;

  label.append(input, text);
  return label;
}

function renderSidebar() {
  const nav = $('#sidebar');
  nav.innerHTML = '';

  SCHEMA.forEach((section) => {
    const btn = el('button', 'sidebar__item' + (state.active === section.id ? ' is-active' : ''));
    btn.type = 'button';

    const num = el('span', 'sidebar__num');
    num.textContent = section.section ? '§' : '·';

    const name = el('span');
    name.textContent = section.title;

    btn.append(num, name);

    // счётчик для списков
    const listKey = {
      guardians: 'guardians.items',
      lineup: 'lineup.items',
      news: 'news.items',
      releases: 'releases.items',
      quotes: 'quotes.items',
      merch: 'merch.items',
    }[section.id];

    if (listKey) {
      const count = el('span', 'sidebar__count');
      count.textContent = String((getPath(state.content, listKey) || []).length);
      btn.append(count);
    }

    // выключенный раздел — приглушаем
    if (section.section && getPath(state.content, `${section.section}.enabled`) === false) {
      btn.style.opacity = '0.45';
    }

    btn.addEventListener('click', () => {
      state.active = section.id;
      renderSidebar();
      renderPanel(section.id);
    });

    nav.append(btn);
  });
}

/* ------------------------------------------------------------- действия */

async function save() {
  const btn = $('#btnSave');
  btn.disabled = true;
  $('#statusText').textContent = 'Сохраняю…';

  try {
    const res = await api('/api/save', {
      method: 'POST',
      body: JSON.stringify(state.content),
    });

    clearDirty();
    $('#statusText').textContent = 'Сохранено и собрано';
    $('#statusStats').textContent = `${res.stats.sections.length} разделов · ${res.stats.news} новостей · ${res.stats.releases} релизов`;
    toast('Сохранено. Сайт пересобран.', 'ok');
  } catch (e) {
    $('#statusText').textContent = 'Ошибка сохранения';
    const details = Array.isArray(e.details) ? '\n· ' + e.details.join('\n· ') : '';
    toast(e.message + details, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function buildOnly() {
  $('#statusText').textContent = 'Собираю…';
  try {
    const res = await api('/api/build', { method: 'POST' });
    if (res.ok) {
      toast('Сайт собран из текущего content.json', 'ok');
      $('#statusText').textContent = 'Собрано';
    } else {
      toast('Сборка не прошла: ' + (res.errors || []).join('; '), 'error');
      $('#statusText').textContent = 'Ошибка сборки';
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

function pickFile(onDone) {
  const picker = $('#filePicker');
  picker.value = '';
  picker.onchange = async () => {
    const file = picker.files?.[0];
    if (!file) return;

    const form = new FormData();
    form.append('file', file);

    $('#statusText').textContent = 'Загружаю картинку…';
    try {
      const res = await api('/api/upload', { method: 'POST', body: form });
      await loadUploads();
      onDone(res.path);
      toast(`Загружено: ${res.path}`, 'ok');
      $('#statusText').textContent = 'Картинка загружена';
    } catch (e) {
      toast(e.message, 'error');
      $('#statusText').textContent = 'Ошибка загрузки';
    }
  };
  picker.click();
}

async function loadUploads() {
  try {
    const res = await api('/api/uploads');
    state.uploads = res.files || [];
  } catch {
    state.uploads = [];
  }
}

async function importContent() {
  const picker = $('#jsonPicker');
  picker.value = '';
  picker.onchange = async () => {
    const file = picker.files?.[0];
    if (!file) return;
    if (!confirm(`Заменить весь контент файлом «${file.name}»?\nТекущий сначала уйдёт в резервную копию.`)) return;

    $('#statusText').textContent = 'Читаю файл…';
    try {
      const text = await file.text();
      const res = await api('/api/import', { method: 'POST', body: text });

      clearDirty();
      state.content = await api('/api/content');
      await loadUploads();
      renderSidebar();
      renderPanel(state.active);

      $('#statusText').textContent = 'Импортировано и собрано';
      $('#statusStats').textContent = `${res.stats.sections.length} разделов · ${res.stats.news} новостей · ${res.stats.releases} релизов`;
      toast('Контент восстановлен из файла.', 'ok');
    } catch (e) {
      $('#statusText').textContent = 'Импорт не прошёл';
      const details = Array.isArray(e.details) ? '\n· ' + e.details.join('\n· ') : '';
      toast(e.message + details, 'error');
    }
  };
  picker.click();
}

async function logout() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    /* всё равно покажем вход */
  }
  location.reload();
}

/* ---------------------------------------------------------------- вход */

function showGate(mode) {
  $('#gate').hidden = false;
  $('#app').hidden = true;

  const setup = mode === 'setup';
  $('#gateTitle').textContent = setup ? 'Первый запуск' : 'Вход в админку';
  $('#gateText').textContent = setup
    ? 'Придумай пароль — он сохранится только на этом компьютере.'
    : 'Пароль хранится только на этом компьютере.';
  $('#gateRepeatWrap').hidden = !setup;
  $('#gateSubmit').textContent = setup ? 'Задать пароль' : 'Войти';
  $('#gatePassword').autocomplete = setup ? 'new-password' : 'current-password';

  $('#gateForm').onsubmit = async (event) => {
    event.preventDefault();
    const error = $('#gateError');
    error.textContent = '';

    const password = $('#gatePassword').value;

    if (setup) {
      if (password.length < 6) {
        error.textContent = 'Пароль короче 6 символов';
        return;
      }
      if (password !== $('#gateRepeat').value) {
        error.textContent = 'Пароли не совпадают';
        return;
      }
    }

    try {
      await api(setup ? '/api/setup' : '/api/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      await boot();
    } catch (e) {
      error.textContent = e.message;
    }
  };

  $('#gatePassword').focus();
}

/* ---------------------------------------------------------------- запуск */

async function boot() {
  const info = await api('/api/state');

  if (info.needsSetup) return showGate('setup');
  if (!info.authed) return showGate('login');

  $('#gate').hidden = true;
  $('#app').hidden = false;

  await loadUploads();

  try {
    state.content = await api('/api/content');
  } catch (e) {
    toast('Не удалось прочитать content.json: ' + e.message, 'error');
    return;
  }

  // первый запуск: убедимся, что недостающие блоки существуют
  state.content.meta ||= { version: 1 };

  renderSidebar();
  renderPanel(state.active);
  $('#statusText').textContent = 'Готово';
  $('#statusStats').textContent = `версия ${state.content.meta.version ?? 1} · ${state.content.meta.updated ?? ''}`;
}

/* ------------------------------------------------------------- события */

$('#btnSave')?.addEventListener('click', save);
$('#btnBuild')?.addEventListener('click', buildOnly);
$('#btnLogout')?.addEventListener('click', logout);

$('#btnZip')?.addEventListener('click', () => {
  if (state.dirty && !confirm('Есть несохранённые правки. Скачать ZIP со старым содержимым?')) return;
  window.location.href = '/api/zip';
});

$('#btnExport')?.addEventListener('click', () => {
  window.location.href = '/api/export';
});

$('#btnImport')?.addEventListener('click', () => {
  if (state.dirty && !confirm('Есть несохранённые правки — они пропадут. Продолжить импорт?')) return;
  importContent();
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if ($('#app').hidden) return;
    save();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (!state.dirty) return;
  e.preventDefault();
  e.returnValue = '';
});

boot().catch((e) => {
  console.error(e);
  toast('Сервер не отвечает: ' + e.message, 'error');
});
