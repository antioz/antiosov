# New Main Page + /creative/ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Новая минималистичная главная `/` («Нахожу слова»), старая главная переезжает на `/creative/`, остальные URL не меняются.

**Architecture:** Статический сайт на GitHub Pages, без сборки. Новая главная — один HTML-файл с инлайн CSS. Старая главная копируется в `creative/index.html` с `../` в путях; общие jsx/css/assets остаются в корне.

**Tech Stack:** HTML, CSS, Google Fonts (Inter, Cormorant Garamond). Старые страницы — React 18 UMD + Babel standalone.

## Global Constraints

- Спека: `docs/superpowers/specs/2026-09-11-new-main-page-design.md` — тексты, ссылки, размеры брать оттуда дословно.
- Проверка только в браузере через `python3 -m http.server 8080` из корня репо, затем на живом `antiosov.ru`.
- Коммит после каждой задачи, пуш в `main` в конце.

---

### Task 1: Перенос старой главной в `creative/index.html`

**Files:**
- Create: `creative/index.html` (копия `index.html`)
- Modify: `cursor.jsx:69-76`, `about.jsx:25`, `portfolio.jsx:170`, `blog/index.html:105`, `sitemap.xml`

- [ ] **Step 1:** `mkdir creative && cp index.html creative/index.html`
- [ ] **Step 2:** В `creative/index.html`: `href="styles.css` → `href="../styles.css`; `src="tweaks-panel.jsx"` и остальные 7 jsx → `src="../<name>.jsx"`; `href="assets/favicon.svg"` → `href="../assets/favicon.svg"`; canonical и `og:url` → `https://antiosov.ru/creative/`.
- [ ] **Step 3:** `cursor.jsx`: `href="index.html"` → `href="/creative/"`, `href="portfolio.html"` → `href="/portfolio.html"`, `href="blog/index.html"` → `href="/blog/"`. `about.jsx`: `href="portfolio.html"` → `href="/portfolio.html"`. `portfolio.jsx`: `href="index.html"` → `href="/creative/"`. `blog/index.html`: `href="../index.html"` → `href="/"`.
- [ ] **Step 4:** `sitemap.xml`: добавить `<url><loc>https://antiosov.ru/creative/</loc><priority>0.8</priority><changefreq>monthly</changefreq></url>`.
- [ ] **Step 5:** Проверка: сервер, открыть `http://localhost:8080/creative/` — рендерится старый лендинг, консоль без 404; клик по «← D.A. / index», «портфолио», «блог» ведёт на `/creative/`, `/portfolio.html`, `/blog/`.
- [ ] **Step 6:** `git commit -m "feat: move old main page to /creative/"`

### Task 2: Новая главная `index.html`

**Files:**
- Overwrite: `index.html`

- [ ] **Step 1:** Написать `index.html` по спеке §1: head (title, description, canonical, OG, Twitter, JSON-LD Person с sameAs tg/inst/yt, favicon, Google Fonts `Inter:wght@400&family=Cormorant+Garamond:ital,wght@1,300`), инлайн `<style>`, body: `<main>` с `<p class="name">ДМИТРИЙ АНТИОСОВ</p>`, `<h1>Нахожу слова</h1>`, `<nav>` с 4 ссылками, `<div class="social">` с 3 inline-SVG.
- [ ] **Step 2:** Проверка: `http://localhost:8080/` — белый экран, два текста по центру, меню и иконки; ширина 400px — меню столбиком, ничего не вылезает; «Креатив» ведёт на `/creative/`; соцссылки открываются в новой вкладке.
- [ ] **Step 3:** `git commit -m "feat: new minimal main page"`

### Task 3: Деплой и живая проверка

- [ ] **Step 1:** `git push origin main`
- [ ] **Step 2:** Дождаться GitHub Pages (~1–2 мин), `curl -sI https://antiosov.ru/creative/` → 200; открыть `https://antiosov.ru/`, `/creative/`, `/portfolio.html`, `/blog/` — всё работает.
