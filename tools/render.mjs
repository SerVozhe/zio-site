/* ==========================================================================
   ZиО — рендер сайта из content.json.
   Чистый Node, без зависимостей. Используется сборщиком (tools/build.mjs)
   и админкой (admin/server.mjs).
   ========================================================================== */

/* ------------------------------------------------------------------ утилиты */

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const attr = (s) => esc(s).replace(/"/g, '&quot;');

/** Поля, где разрешена разметка: <b>, <em>, <br>, <span>. Скрипты вырезаем. */
const rich = (s) =>
  String(s ?? '')
    .replace(/<\s*script/gi, '&lt;script')
    .replace(/<\s*\/\s*script/gi, '&lt;/script')
    .replace(/\son[a-z]+\s*=/gi, ' data-blocked=');

/** Разбор даты из ISO-строки без часовых поясов — берём то, что написал автор. */
function parseDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return { y: 2026, m: 12, d: 5 };
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** Все производные подписи даты: из одного поля datetime. */
function dateParts(datetime) {
  const { y, m, d } = parseDate(datetime);
  const p2 = (n) => String(n).padStart(2, '0');
  const month = MONTHS[(m - 1 + 12) % 12];
  return {
    day: p2(d),
    dayNum: String(d),
    month,
    year: String(y),
    short: `${p2(d)}.${p2(m)}.${y}`,
    long: `${d} ${month} ${y}`,
    badge: `${d} ${month}`,
  };
}

/** «2026-11-20» → «20 ноября 2026» */
function humanDate(iso) {
  const { y, m, d } = parseDate(iso);
  return `${d} ${MONTHS[(m - 1 + 12) % 12]} ${y}`;
}

/* ------------------------------------------------------- подстановка токенов */

function makeTokens(c, date) {
  return {
    'date.day': date.day,
    'date.dayNum': date.dayNum,
    'date.month': date.month,
    'date.year': date.year,
    'date.short': date.short,
    'date.long': date.long,
    'date.badge': date.badge,
    show: c.show?.name || '',
    city: c.site?.city || '',
    tagline: c.site?.tagline || '',
    band: c.site?.bandName || '',
    status: c.site?.status || '',
    guardians: String(c.guardians?.items?.length || 0),
    year: date.year,
  };
}

function tokens(t) {
  return (value) =>
    String(value ?? '').replace(/\{([a-z.]+)\}/gi, (all, key) =>
      Object.prototype.hasOwnProperty.call(t, key) ? t[key] : all
    );
}

/* --------------------------------------------------------------- иконки SVG */

const GLYPHS = {
  eye: `<svg class="guardian__glyph" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                  <path d="M3 24s7.5-11 21-11 21 11 21 11-7.5 11-21 11S3 24 3 24Z" />
                  <circle cx="24" cy="24" r="6.2" />
                  <path d="M24 2v4M24 42v4M2 24h4M42 24h4" opacity=".5" />
                </svg>`,
  mask: `<svg class="guardian__glyph" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                  <path d="M10 12h28v11c0 7.6-6.3 13.8-14 13.8S10 30.6 10 23V12Z" />
                  <path d="M17 21h5M26 21h5M20 29c2.4 1.6 5.6 1.6 8 0" />
                  <path d="M14 8.5h20" opacity=".5" />
                </svg>`,
  headphones: `<svg class="guardian__glyph" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                  <path d="M8 27v-4a16 16 0 0 1 32 0v4" />
                  <rect x="5" y="26" width="8" height="14" rx="4" />
                  <rect x="35" y="26" width="8" height="14" rx="4" />
                  <path d="M24 6v-3" opacity=".5" />
                </svg>`,
  drum: `<svg class="guardian__glyph" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                  <ellipse cx="24" cy="34" rx="13" ry="6.5" />
                  <path d="M24 34V13M24 34l-8-19M24 34l8-19" />
                  <circle cx="24" cy="34" r="2.6" />
                  <path d="M11 40h26" opacity=".5" />
                </svg>`,
};

export const GLYPH_KEYS = Object.keys(GLYPHS);

const ICON_PLAY = `<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5v14l11-7z" fill="currentColor" />
          </svg>`;

const ICON_PLAY_BIG = `<svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5v14l11-7z" fill="currentColor" />
              </svg>`;

const ICON_TICKET = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6">
                <path d="M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2" />
                <rect x="2.5" y="8" width="19" height="11" rx="1.6" />
                <path d="M9 12.5h6M9 16h4" />
              </svg>`;

const delay = (i, step = 60) => (i > 0 ? ` style="--d: ${i * step}ms"` : '');

/* -------------------------------------------------------- порядок и нумерация */

/** Порядок секций на странице. Меняется здесь — нумерация пересчитается сама. */
const SECTION_ORDER = [
  { id: 'manifest', kind: 'manifest' },
  { id: 'guardians', kind: 'guardians' },
  { id: 'lineup', kind: 'lineup' },
  { id: 'show', kind: 'show' },
  { id: 'news', kind: 'news' },
  { id: 'releases', kind: 'releases' },
  { id: 'quotes', kind: 'quotes' },
  { id: 'merch', kind: 'merch' },
];

const isOn = (section) => !section || section.enabled !== false;

/** Секции, которые реально попадут на страницу, с готовыми номерами. */
function visibleSections(c) {
  const out = [];
  for (const item of SECTION_ORDER) {
    const data = c[item.id];
    if (!isOn(data)) continue;

    // пустые списки не рисуем вовсе — раздел не должен висеть пустым
    if (item.id === 'news' && !(data.items || []).length) continue;
    if (item.id === 'releases' && !(data.items || []).length) continue;

    out.push({ ...item, data, num: String(out.length + 1).padStart(2, '0') });
  }
  return out;
}

/* --------------------------------------------------------------- секции */

function renderManifest(data, num, t) {
  const statement = (data.statement || [])
    .map((line) => {
      const text = t(line.text);
      if (line.tone === 'dim') return `<span class="dim">${text}</span>`;
      if (line.tone === 'accent') return `<span class="accent">${text}</span>`;
      return text;
    })
    .join('<br />');

  const body = (data.body || [])
    .map((p, i) => `              <p class="reveal"${delay(i, 80)}>\n                ${rich(t(p))}\n              </p>`)
    .join('\n');

  const facts = (data.facts || [])
    .map(
      (f) => `                <div class="fact">
                  <dt>${esc(t(f.term))}</dt>
                  <dd>${esc(t(f.value))}</dd>
                </div>`
    )
    .join('\n');

  return `      <section class="section" id="manifest">
        <div class="shell">
          <div class="section-head reveal">
            <p class="eyebrow"><span class="num">${num}</span> ${esc(t(data.eyebrow))}</p>
            <h2 class="display section-title">${esc(t(data.title))}</h2>
          </div>

          <div class="manifesto__grid">
            <p class="manifesto__statement reveal">
              ${statement}
            </p>

            <div class="manifesto__body">
${body}

              <dl class="manifesto__facts reveal" style="--d: 220ms">
${facts}
              </dl>
            </div>
          </div>
        </div>
      </section>`;
}

function renderGuardians(data, num, t) {
  const items = (data.items || [])
    .map((g, i) => {
      const glyph = GLYPHS[g.glyph] || GLYPHS.eye;
      return `            <!-- ${i + 1} -->
            <article class="guardian reveal" tabindex="0"${delay(i)}>
              <div class="guardian__hex">
                <span class="guardian__num">${String(i + 1).padStart(2, '0')} / ${esc(t(g.num))}</span>
                ${glyph}
                <span class="guardian__verb">${esc(t(g.verb))}</span>
              </div>
              <dl class="guardian__text">
                <dt>${esc(t(g.title))}</dt>
                <dd>${rich(t(g.text))}</dd>
              </dl>
            </article>`;
    })
    .join('\n\n');

  return `      <section class="section" id="guardians">
        <div class="shell">
          <div class="section-head reveal">
            <p class="eyebrow"><span class="num">${num}</span> ${esc(t(data.eyebrow))}</p>
            <h2 class="display section-title">${esc(t(data.title))}</h2>
            <p class="lede" style="max-width: 62ch">
              ${rich(t(data.lede))}
            </p>
          </div>

          <div class="guardians">
${items}
          </div>

          <p class="lede reveal" style="margin-top: 34px; max-width: 52ch">
            ${rich(t(data.outro))}
          </p>
        </div>
      </section>`;
}

function renderLineup(data, num, t) {
  const items = (data.items || [])
    .map(
      (m, i) => `            <article class="member reveal"${delay(i)}>
              <span class="member__idx">${String(i + 1).padStart(2, '0')}</span>
              <h3 class="member__name">${esc(t(m.name))}</h3>
              <p class="member__role">${esc(t(m.role))}</p>
              <p class="member__note">
                ${rich(t(m.note))}
              </p>
              <span class="member__tag">${esc(t(m.tag))}</span>
            </article>`
    )
    .join('\n\n');

  return `      <section class="section" id="lineup">
        <div class="shell">
          <div class="section-head reveal">
            <p class="eyebrow"><span class="num">${num}</span> ${esc(t(data.eyebrow))}</p>
            <h2 class="display section-title">${esc(t(data.title))}</h2>
            <p class="lede" style="max-width: 60ch">
              ${rich(t(data.lede))}
            </p>
          </div>

          <div class="lineup">
${items}
          </div>
        </div>
      </section>`;
}

function renderShow(data, num, t) {
  const where = (data.where || [])
    .map((w) => `                <span>${esc(t(w))}</span>`)
    .join('\n                <span aria-hidden="true">/</span>\n');

  const units = data.countdownUnits || ['дней', 'часов', 'минут', 'секунд'];
  const countdown = `<div class="countdown" id="countdown" aria-live="polite">
                  <div><b data-days>—</b><span>${esc(units[0])}</span></div>
                  <div><b data-hours>—</b><span>${esc(units[1])}</span></div>
                  <div><b data-minutes>—</b><span>${esc(units[2])}</span></div>
                  <div><b data-seconds>—</b><span>${esc(units[3])}</span></div>
                </div>`;

  const setlist = (data.setlist || [])
    .map(
      (s, i) =>
        `                  <li><i>${String(i + 1).padStart(2, '0')}</i> ${esc(t(s.title))}${
          s.tag ? ` <em>${esc(t(s.tag))}</em>` : ''
        }</li>`
    )
    .join('\n');

  const name = t(data.name);

  return `      <section class="show" id="show">
        <div class="shell">
          <div class="show__grid">
            <div class="reveal">
              <p class="eyebrow"><span class="num">${num}</span> ${esc(t(data.eyebrow))}</p>

              <div class="show__date">
                <span class="d">${t('{date.day}')}</span>
                <span class="my">${t('{date.month}')}<br />${t('{date.year}')}</span>
              </div>

              <h2 class="display show__name">«${esc(name)}<span class="q">»</span></h2>

              <p class="show__where">
${where}
              </p>

              <p class="show__desc">
                ${rich(t(data.desc))}
              </p>
            </div>

            <div class="show__panel reveal" style="--d: 120ms">
              <div>
                <p class="eyebrow" style="margin-bottom: 12px">${esc(t(data.countdownLabel))}</p>
                ${countdown}
              </div>

              <a class="btn btn--primary" data-link="${attr(data.ticketsLink || 'tickets')}" href="#" rel="noopener">
                ${ICON_TICKET}
                ${esc(t(data.ticketsLabel))}
              </a>

              <div>
                <p class="eyebrow" style="margin-bottom: 10px">${esc(t(data.setlistLabel))}</p>
                <ol class="setlist">
${setlist}
                </ol>
              </div>
            </div>
          </div>
        </div>
      </section>`;
}

function renderNews(data, num, t) {
  const items = (data.items || [])
    .map(
      (n, i) => `            <article class="post reveal"${delay(i)}>
              <p class="post__date">${esc(humanDate(n.date))}</p>
              <h3 class="post__title">${esc(t(n.title))}</h3>
              <p class="post__text">${rich(t(n.text))}</p>${
                n.link
                  ? `\n              <a class="post__link" href="${attr(n.link)}" rel="noopener" target="_blank">${esc(
                      t(n.linkLabel) || 'Читать'
                    )} →</a>`
                  : ''
              }
            </article>`
    )
    .join('\n\n');

  return `      <section class="section" id="news">
        <div class="shell">
          <div class="section-head reveal">
            <p class="eyebrow"><span class="num">${num}</span> ${esc(t(data.eyebrow))}</p>
            <h2 class="display section-title">${esc(t(data.title))}</h2>
            <p class="lede" style="max-width: 58ch">${rich(t(data.lede))}</p>
          </div>

          <div class="news">
${items}
          </div>
        </div>
      </section>`;
}

function renderReleases(data, num, t) {
  const items = (data.items || [])
    .map((r, i) => {
      const cover = r.cover
        ? `<img class="release__cover" src="${attr(r.cover)}" alt="Обложка: ${attr(t(r.title))}" loading="lazy" />`
        : `<span class="release__cover release__cover--empty" aria-hidden="true">ZИО</span>`;
      return `            <article class="release reveal"${delay(i)}>
              ${cover}
              <div class="release__meta">
                <p class="release__type">${esc(t(r.type))}${r.year ? ` · ${esc(t(r.year))}` : ''}</p>
                <h3 class="release__name">${esc(t(r.title))}</h3>${
                  r.link
                    ? `\n                <a class="release__link" href="${attr(r.link)}" rel="noopener" target="_blank">${esc(
                        t(r.linkLabel) || 'Слушать'
                      )} →</a>`
                    : ''
                }
              </div>
            </article>`;
    })
    .join('\n\n');

  return `      <section class="section" id="releases">
        <div class="shell">
          <div class="section-head reveal">
            <p class="eyebrow"><span class="num">${num}</span> ${esc(t(data.eyebrow))}</p>
            <h2 class="display section-title">${esc(t(data.title))}</h2>
            <p class="lede" style="max-width: 58ch">${rich(t(data.lede))}</p>
          </div>

          <div class="releases">
${items}
          </div>
        </div>
      </section>`;
}

function renderQuotes(data, num, t) {
  const items = (data.items || [])
    .map(
      (q, i) => `            <figure class="quote ${q.size === 'lg' ? 'quote--lg' : 'quote--sm'} reveal"${delay(i)}>
              <span class="quote__mark" aria-hidden="true">“</span>
              <blockquote>
                ${rich(t(q.text))}
              </blockquote>
              <figcaption>${esc(t(q.caption))}</figcaption>
            </figure>`
    )
    .join('\n\n');

  return `      <section class="section" id="quotes">
        <div class="shell">
          <div class="section-head reveal">
            <p class="eyebrow"><span class="num">${num}</span> ${esc(t(data.eyebrow))}</p>
            <h2 class="display section-title">${esc(t(data.title))}</h2>
          </div>

          <div class="quotes">
${items}
          </div>
        </div>
      </section>`;
}

function renderMerch(data, num, t) {
  const items = (data.items || [])
    .map(
      (m, i) => `            <article class="item reveal"${delay(i)}>
              <span class="item__shape" aria-hidden="true"></span>
              <div class="item__top">
                <p class="item__kind">${esc(t(m.kind))}</p>
                <h3 class="item__name">${esc(t(m.name))}</h3>
              </div>
              <div class="item__bottom">
                <p class="item__price">${esc(t(m.price))}</p>
                <p class="item__note">${esc(t(m.note))}</p>
              </div>
            </article>`
    )
    .join('\n\n');

  return `      <section class="section" id="merch">
        <div class="shell">
          <div class="section-head reveal">
            <p class="eyebrow"><span class="num">${num}</span> ${esc(t(data.eyebrow))}</p>
            <h2 class="display section-title">${esc(t(data.title))}</h2>
            <p class="lede" style="max-width: 58ch">
              ${rich(t(data.lede))}
            </p>
          </div>

          <div class="merch">
${items}
          </div>
        </div>
      </section>`;
}

const RENDERERS = {
  manifest: renderManifest,
  guardians: renderGuardians,
  lineup: renderLineup,
  show: renderShow,
  news: renderNews,
  releases: renderReleases,
  quotes: renderQuotes,
  merch: renderMerch,
};

/* ------------------------------------------------------------ каркас страницы */

function renderNav(c, sections, t) {
  return sections
    .filter((s) => s.data.nav)
    .map((s) => `          <a href="#${s.id}">${esc(t(s.data.navLabel || s.data.eyebrow))}</a>`)
    .join('\n');
}

function renderMobileMenu(c, sections, t) {
  const rows = sections
    .filter((s) => s.data.nav)
    .map(
      (s, i) =>
        `      <a href="#${s.id}"><i>${String(i + 1).padStart(2, '0')}</i> ${esc(
          t(s.data.navLabel || s.data.eyebrow)
        )}</a>`
    );
  rows.push(
    `      <a href="${attr(c.nav.contactHref || '#contacts')}"><i>${String(rows.length + 1).padStart(
      2,
      '0'
    )}</i> ${esc(t(c.nav.contactLabel || 'Связь'))}</a>`
  );
  return rows.join('\n');
}

function renderHero(c, t) {
  const h = c.hero || {};
  const sub = (h.sub || []).map((s) => `<span>${rich(t(s))}</span>`).join('\n            <span aria-hidden="true">/</span>\n            ');
  const meta = (h.meta || [])
    .map((m) => `            <span>${esc(t(m.label))} · <b>${esc(t(m.value))}</b></span>`)
    .join('\n');

  return `      <section class="hero" id="top">
        <div class="hero__glow" id="heroGlow" aria-hidden="true"></div>

        <!-- обновлённый логотип (вариант 3): слитная надпись + глитч на фоне -->
        <div class="hero__mark" aria-hidden="true">
          <span class="hero__mark-word hero__mark-base">${esc(c.site.wordmark)}</span>
          <span class="hero__mark-word hero__mark-ghost hero__mark-ghost--a">${esc(c.site.wordmark)}</span>
          <span class="hero__mark-word hero__mark-ghost hero__mark-ghost--b">${esc(c.site.wordmark)}</span>
        </div>

        <div class="hero__inner">
          <p class="hero__badge reveal">
            <span class="dot" aria-hidden="true"></span>
            ${rich(t(h.badge))}
          </p>

          <h1 class="hero__logo reveal" style="--d: 80ms">
            <span class="hero__word" data-text="${attr(c.site.wordmark)}" aria-hidden="true">${esc(
              c.site.wordmark
            )}</span>
            <span class="sr-only">${esc(t(h.srTitle))}</span>
          </h1>

          <div class="hero__sub reveal" style="--d: 160ms">
            ${sub}
          </div>

          <p class="hero__line reveal" style="--d: 240ms">
            ${rich(t(h.line))}
          </p>

          <div class="hero__actions reveal" style="--d: 320ms">
            <a class="btn btn--primary" data-link="${attr(h.primaryLink || 'listen')}" href="#" rel="noopener">
              ${ICON_PLAY_BIG}
              ${esc(t(h.primaryLabel))}
            </a>
            <a class="btn btn--ghost" href="${attr(h.secondaryHref || '#show')}">
              ${ICON_TICKET}
              ${esc(t(h.secondaryLabel))}
            </a>
          </div>

          <div class="hero__meta reveal" style="--d: 400ms">
${meta}
          </div>
        </div>
      </section>`;
}

function renderMarquee(c, t) {
  const row = (c.marquee || [])
    .map((phrase) => `<span>${esc(t(phrase))}</span><i>◆</i>`)
    .join('');
  return `      <div class="marquee" aria-hidden="true">
        <div class="marquee__track">
          <div class="marquee__group">
            ${row}
          </div>
          <div class="marquee__group">
            ${row}
          </div>
        </div>
      </div>`;
}

function renderCta(c, num, t) {
  const cta = c.cta || {};
  const buttons = (cta.buttons || [])
    .map((b, i) =>
      i === 0
        ? `            <a class="btn btn--primary" data-link="${attr(b.link)}" href="#" rel="noopener">${esc(
            t(b.label)
          )}</a>`
        : `            <a class="btn btn--ghost" data-link="${attr(b.link)}" href="#" rel="noopener">${esc(
            t(b.label)
          )}</a>`
    )
    .join('\n');

  return `      <section class="cta">
        <div class="cta__glow" aria-hidden="true"></div>
        <div class="shell cta__inner">
          <p class="eyebrow reveal"><span class="num">${num}</span> ${esc(t(cta.eyebrow))}</p>
          <h2 class="display cta__title reveal">${esc(t(cta.title))}</h2>
          <p class="cta__text reveal">
            ${rich(t(cta.text))}
          </p>
          <div class="hero__actions reveal">
${buttons}
          </div>
        </div>
      </section>`;
}

function renderFooter(c, t) {
  const f = c.footer || {};
  const links = (f.links || [])
    .map((l) => `            <a data-link="${attr(l.link)}" href="#" rel="noopener">${esc(t(l.label))}</a>`)
    .join('\n');
  const bottom = (f.bottom || [])
    .map((line) => `          <span>${esc(t(line))}</span>`)
    .join('\n');

  return `    <footer class="footer" id="contacts">
      <div class="shell">
        <div class="footer__top">
          <div class="footer__brand">
            <span class="footer__mark" aria-hidden="true">${esc(f.mark)}</span>
            <p>
              ${esc(t(f.brand))}
            </p>
          </div>

          <nav class="footer__links" aria-label="Ссылки">
${links}
          </nav>
        </div>

        <div class="footer__bottom">
${bottom}
        </div>
      </div>
    </footer>`;
}

/* ---------------------------------------------------------------- документ */

export function renderSite(content) {
  const c = content;
  const date = dateParts(c.show?.datetime);
  const t = tokens(makeTokens(c, date));
  const sections = visibleSections(c);

  const body = sections
    .map((s) => RENDERERS[s.kind](s.data, s.num, t))
    .join('\n\n      <!-- ---------------------------------------------------------------- -->\n');

  const ctaNum = String(sections.length + 1).padStart(2, '0');

  const members = (c.lineup?.items || [])
    .map((m) => `          { "@type": "Person", "name": ${JSON.stringify(t(m.name))}, "jobTitle": ${JSON.stringify(t(m.role))} }`)
    .join(',\n');

  const schemaBody = `{
        "@context": "https://schema.org",
        "@type": "MusicGroup",
        "name": ${JSON.stringify(c.site.bandName)},
        "alternateName": ${JSON.stringify(c.site.schema?.alternateName || [])},
        "genre": ${JSON.stringify(c.site.schema?.genre || [])},
        "foundingLocation": { "@type": "Place", "name": ${JSON.stringify(
          c.site.schema?.foundingLocation || ''
        )} },
        "member": [
${members}
        ]
      }`;

  const html = `<!doctype html>
<html lang="${attr(c.site.lang || 'ru')}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(t(c.site.title))}</title>
    <meta
      name="description"
      content="${attr(t(c.site.description))}"
    />
    <meta name="theme-color" content="${attr(c.site.themeColor)}" />
    <link rel="icon" type="image/png" sizes="512x512" href="${attr(c.site.icon)}" />
    <link rel="apple-touch-icon" href="${attr(c.site.icon)}" />

    <!-- Open Graph: превью при отправке ссылки в мессенджерах и соцсетях -->
    <meta property="og:type" content="${attr(c.site.og.type)}" />
    <meta property="og:title" content="${attr(t(c.site.og.title))}" />
    <meta
      property="og:description"
      content="${attr(t(c.site.og.description))}"
    />
    <meta property="og:image" content="${attr(c.site.og.image)}" />
    <meta property="og:image:width" content="${attr(c.site.og.width)}" />
    <meta property="og:image:height" content="${attr(c.site.og.height)}" />
    <meta property="og:locale" content="${attr(c.site.og.locale)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${attr(c.site.og.image)}" />

    <link rel="stylesheet" href="styles.css" />
    <script type="application/ld+json">
      ${schemaBody}
    </script>
  </head>

  <body>
    <div class="scroll-progress" id="progress" aria-hidden="true"></div>
    <div class="grid-lines" aria-hidden="true"></div>
    <div class="grain" aria-hidden="true"></div>

    <a class="skip-link" href="#main">К содержанию</a>

    <!-- ------------------------------------------------------------------ -->
    <header class="header" id="header">
      <div class="header__inner">
        <a class="logo-link" href="#top" aria-label="${attr(c.site.bandName)} — на главную">
          <span class="logo-word" aria-hidden="true">${esc(c.site.wordmark)}</span>
          <span>${esc(c.site.tagline)}</span>
        </a>

        <nav class="nav" aria-label="Основная навигация">
${renderNav(c, sections, t)}
        </nav>

        <a class="header__cta" data-link="${attr(c.nav.ctaLink || 'listen')}" href="#" rel="noopener">
          ${esc(t(c.nav.ctaLabel))}
          ${ICON_PLAY}
        </a>

        <button
          class="burger"
          id="burger"
          aria-label="Меню"
          aria-expanded="false"
          aria-controls="mobileMenu"
        >
          <span></span>
        </button>
      </div>
    </header>

    <div class="mobile-menu" id="mobileMenu" role="dialog" aria-modal="true" aria-label="Меню">
${renderMobileMenu(c, sections, t)}
    </div>

    <main id="main">
      <!-- ---------------------------------------------------------------- -->
${renderHero(c, t)}

      <!-- ---------------------------------------------------------------- -->
${renderMarquee(c, t)}

      <!-- ---------------------------------------------------------------- -->
${body}

      <!-- ---------------------------------------------------------------- -->
${renderCta(c, ctaNum, t)}
    </main>

    <!-- ------------------------------------------------------------------ -->
${renderFooter(c, t)}

    <div class="toast" id="toast" role="status" aria-live="polite"></div>

    <script src="site.config.js" defer></script>
    <script src="app.js" defer></script>
  </body>
</html>
`;

  const config = `/* Сгенерировано сборщиком из content.json — руками не править. */
window.ZIO = {
  links: ${JSON.stringify(c.links || {}, null, 2)},
  show: {
    datetime: ${JSON.stringify(c.show?.datetime || '')},
    city: ${JSON.stringify(c.show?.city || '')},
    name: ${JSON.stringify(c.show?.name || '')},
    countdownUnits: ${JSON.stringify(c.show?.countdownUnits || ['дней', 'часов', 'минут', 'секунд'])},
    pastLabel: ${JSON.stringify(c.show?.pastLabel || 'Концерт состоялся')},
    pastText: ${JSON.stringify(date.long)},
  },
  messages: {
    emptyLink: ${JSON.stringify(c.messages?.emptyLink || 'Адрес ещё не добавлен. Пришли ссылку — вставлю в сайт.')},
  },
};
`;

  return { html, config, sections };
}

export { dateParts, humanDate, esc, attr, rich, tokens, makeTokens, SECTION_ORDER };
