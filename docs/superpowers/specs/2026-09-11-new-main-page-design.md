# Новая главная antiosov.ru + перенос старой на /creative/

Дата: 2026-09-11

## Цель

Главная `https://antiosov.ru/` становится минималистичной визиткой («Нахожу слова»).
Текущая главная (React-лендинг креативного директора) переезжает на `https://antiosov.ru/creative/`
без изменения содержимого. URL `/portfolio.html` и `/blog/` не меняются.

## 1. Новая главная — `index.html`

Чистый HTML + CSS, без React/Babel.

- Фон `#ffffff`, `min-height: 100vh`, содержимое центрировано по обеим осям.
- Строка 1: `ДМИТРИЙ АНТИОСОВ` — Inter 400, 13px, `letter-spacing: 0.45em`, `#0a0a0a`, uppercase.
- Строка 2: `Нахожу слова` — Cormorant Garamond Italic 300, `clamp(56px, 9vw, 120px)`, `#0a0a0a`.
- Меню (одна строка, на мобильном — столбиком): Inter 12px, `letter-spacing: 0.2em`, `#888`, hover `#0a0a0a`.
  - «Обо мне» → `#`
  - «Художественные тексты» → `#`
  - «Нехудожественные тексты» → `#`
  - «Креатив» → `/creative/`
- Соцсети — inline SVG 18px, `#888`, hover `#0a0a0a`, `target="_blank" rel="noopener"`:
  - Telegram → `https://t.me/antiosov`
  - Instagram → `https://www.instagram.com/the.antiosov/`
  - YouTube → `https://www.youtube.com/@dimastihi`
- Шрифты: Google Fonts `Inter:wght@400` + `Cormorant+Garamond:ital,wght@1,300`.
- `<head>`: title «Дмитрий Антиосов — Нахожу слова», description, canonical `https://antiosov.ru/`,
  OG/Twitter (og:image как раньше), JSON-LD Person (sameAs: tg, inst, yt), favicon `assets/favicon.svg`.

## 2. Старая главная — `creative/index.html`

Копия текущего `index.html` с правками:
- пути `styles.css`, `*.jsx`, `assets/favicon.svg` → с префиксом `../`;
- canonical и `og:url` → `https://antiosov.ru/creative/`.
Файлы `*.jsx`, `styles.css`, `assets/` остаются в корне (их использует и `portfolio.html`).

## 3. Правки ссылок в существующих файлах

- `cursor.jsx` (TopBar, общий для creative и portfolio): `index.html` → `/creative/`,
  `portfolio.html` → `/portfolio.html`, `blog/index.html` → `/blog/`.
- `about.jsx`: `portfolio.html` → `/portfolio.html`.
- `portfolio.jsx`: «← главная» `index.html` → `/creative/`.
- `blog/index.html`: `../index.html` → `/`.
- `sitemap.xml`: добавить `https://antiosov.ru/creative/` (priority 0.8).

## 4. Проверка

Локально `python3 -m http.server` из корня репо: открыть `/`, `/creative/`, `/portfolio.html`, `/blog/` —
консоль без ошибок, ассеты и jsx грузятся, ссылки ведут куда указано.
После пуша в `main` — те же URL на живом `antiosov.ru`.

## Вне скоупа

Страницы «Обо мне», «Художественные/Нехудожественные тексты» — позже, сейчас якоря `#`.
