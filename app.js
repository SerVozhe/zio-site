/* ==========================================================================
   ZиО — логика страницы.
   1) Ссылки и дата концерта: берутся из site.config.js (его собирает админка).
   2) Обратный отсчёт до концерта.
   3) Появление блоков при скролле.
   4) Мобильное меню, свет за курсором, индикатор прокрутки.
   ========================================================================== */

// --------------------------------------------------------------- настройки

/** Всё, что приходит из content.json через site.config.js. */
const CONFIG = window.ZIO || {};

/** Все внешние ссылки сайта. Пустые — перехватываем и объясняем. */
const LINKS = CONFIG.links || {};

/** Дата и время концерта. Местное время Новокузнецка (UTC+7). */
const SHOW_DATE = new Date(CONFIG.show?.datetime || '2026-12-05T19:00:00+07:00');

const MESSAGES = CONFIG.messages || {};

// ---------------------------------------------------------------- утилиты

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Короткое всплывающее сообщение снизу. */
let toastTimer;
function toast(message) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3200);
}

/** Готовые ссылки: подставляем адрес, пустые — перехватываем и объясняем. */
function initLinks() {
  $$('[data-link]').forEach((el) => {
    const key = el.dataset.link;
    const url = LINKS[key];

    if (!url) {
      el.setAttribute('href', '#');
      el.setAttribute('aria-disabled', 'true');
      el.addEventListener('click', (e) => {
        e.preventDefault();
        toast(MESSAGES.emptyLink || 'Адрес ещё не добавлен. Пришли ссылку — вставлю в сайт.');
      });
      return;
    }

    el.setAttribute('href', url);
    if (!url.startsWith('mailto:') && !url.startsWith('#')) {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

// ----------------------------------------------------------- обратный отсчёт

function initCountdown() {
  const root = $('#countdown');
  if (!root) return;

  const pad = (n) => String(n).padStart(2, '0');
  const fields = {
    days: $('[data-days]', root),
    hours: $('[data-hours]', root),
    minutes: $('[data-minutes]', root),
    seconds: $('[data-seconds]', root),
  };

  const tick = () => {
    const diff = SHOW_DATE - Date.now();

    if (diff <= 0) {
      root.classList.add('is-past');
      const label = CONFIG.show?.pastLabel || 'Концерт состоялся';
      const text = CONFIG.show?.pastText || '';
      root.innerHTML = `<div style="grid-column:1/-1"><b>${label}</b><span>${text}</span></div>`;
      clearInterval(timer);
      return;
    }

    const s = Math.floor(diff / 1000);
    fields.days.textContent = Math.floor(s / 86400);
    fields.hours.textContent = pad(Math.floor((s % 86400) / 3600));
    fields.minutes.textContent = pad(Math.floor((s % 3600) / 60));
    fields.seconds.textContent = pad(s % 60);
  };

  tick();
  const timer = setInterval(tick, 1000);
}

// ------------------------------------------------------ появление при скролле

function initReveal() {
  const items = $$('.reveal');
  if (!items.length) return;

  // если браузер не умеет IntersectionObserver — просто показываем всё
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.12 }
  );

  items.forEach((el) => io.observe(el));
}

// --------------------------------------------------------------- шапка / меню

function initHeader() {
  const header = $('#header');
  const burger = $('#burger');
  const menu = $('#mobileMenu');
  const progress = $('#progress');

  const onScroll = () => {
    const y = window.scrollY;
    header?.classList.toggle('is-stuck', y > 24);

    if (progress) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? Math.min(y / max, 1) : 0;
      progress.style.transform = `scaleX(${ratio})`;
    }
  };

  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  if (!burger || !menu) return;

  const setOpen = (open) => {
    burger.setAttribute('aria-expanded', String(open));
    menu.classList.toggle('is-open', open);
    document.body.style.overflow = open ? 'hidden' : '';
  };

  burger.addEventListener('click', () => {
    setOpen(burger.getAttribute('aria-expanded') !== 'true');
  });

  $$('a', menu).forEach((a) => a.addEventListener('click', () => setOpen(false)));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });

  // при переходе на десктоп меню должно закрыться само
  window.matchMedia('(min-width: 901px)').addEventListener('change', (e) => {
    if (e.matches) setOpen(false);
  });
}

// ------------------------------------------------- свет, следящий за курсором

function initHeroGlow() {
  const hero = $('.hero');
  const glow = $('#heroGlow');
  if (!hero || !glow) return;

  // на тач-устройствах и при отключённой анимации не трогаем
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  hero.addEventListener('pointermove', (e) => {
    const rect = hero.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    glow.style.setProperty('--mx', `${x}%`);
    glow.style.setProperty('--my', `${y}%`);
  });
}

// --------------------------------------------------- плавный переход по якорям

function initAnchors() {
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (!id || id === '#') return;

      const target = document.querySelector(id);
      if (!target) return;

      e.preventDefault();
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      history.replaceState(null, '', id);
    });
  });
}

// ------------------------------------------------------------------ запуск

document.addEventListener('DOMContentLoaded', () => {
  initLinks();
  initCountdown();
  initReveal();
  initHeader();
  initHeroGlow();
  initAnchors();
});
