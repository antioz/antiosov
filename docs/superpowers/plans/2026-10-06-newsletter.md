# Рассылка подписчикам — план

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** необязательная галочка согласия на письма в формах заказа → таблица подписчиков → отправка рассылки из админки через Postbox с отпиской в один клик.

**Architecture:** новый модуль `merch-api/lib/subscribers.js` (YDB-таблицы `subscribers`, `mailings`), хук в `index.js` после `createOrder`, маршрут `?a=unsub`, админ-маршруты в `lib/admin.js`; фронт — галочка в трёх формах, страница `/consent/rassylka/`, вкладка в `/merch/admin/`.

**Tech Stack:** Node 18 Cloud Function, ydb-sdk (`lib/ydb.js`: `db.query`, `db.tx`, `db.V.s/…`), nodemailer (`lib/mail.js`), `node --test` на тестовой БД (`.env` → `antiosov-merch-test`), статический фронт без сборки.

## Global Constraints

- Спека: `docs/superpowers/specs/2026-10-06-newsletter-design.md` — источник правды.
- Подпись у галочки — дословно: «я не против, если Антиосов будет мне иногда присылать письма. А Антиосов точно не будет присылать письма часто, делать ему нечего письма строчить, он же не CRM-маркетолог какой.» + ссылка `(что за письма)` → `/consent/rassylka/`.
- Галочка `name="news"`, не отмечена, не обязательна; тело заказа `news: true|false`. Заказ без неё проходит.
- `NEWS_CONSENT_VER = '2026-10-06'`.
- Внешние вызовы только через `ext.*` (тесты подменяют `ext.mail.send`).
- В `.deploy.env` нельзя значения с `,` и `"`.
- Ничего не деплоить и не пушить из агентов — деплой и живую проверку делает координатор.
- Шелл: никаких `rm` с глобами/относительными путями.

---

### Task A: бэкенд merch-api

**Files:**
- Modify: `merch-api/schema.yql` (2 таблицы), `merch-api/lib/mail.js` (`send` принимает `headers`), `merch-api/index.js` (хук подписки, `case 'unsub'`), `merch-api/lib/admin.js` (3 маршрута), `merch-api/README.md` (раздел «Рассылка»)
- Create: `merch-api/lib/subscribers.js`, `merch-api/test/subscribers.test.js`

**Interfaces (Produces — фронт опирается на них):**
- `POST ?a=order` с `news: true` → после успешного заказа подписка (`source` = id заказа). Ответ заказа не меняется.
- `GET|POST ?a=unsub&e=<email>&t=<token>` → GET: HTML 200 «Вы отписались от писем Антиосова.» либо «Этого адреса нет в списке.»; POST: 200 text `OK`. Неверный токен = «нет в списке», строку не трогает.
- `GET ?a=admin/subscribers` → `{ count, subscribers: [{ email, consent_at, source }] }` (новые сверху).
- `POST ?a=admin/mailing` тело `{ subject, body, test: true }` → одно письмо на `OWNER_EMAIL`, ответ `{ sent: 1, failed: 0, done: true }`.
- `POST ?a=admin/mailing` тело `{ subject, body, mailing_id?, offset }` → до 25 писем подписчикам, отсортированным по email, начиная с `offset`; первый вызов без `mailing_id` создаёт запись в `mailings`; ответ `{ mailing_id, sent, failed, next_offset, total, done }`; счётчики `mailings.sent/failed` накапливаются.
- `GET ?a=admin/mailings` → `{ mailings: [{ id, created_at, subject, sent, failed }] }` (новые сверху).
- Пустые `subject`/`body` → 400 `validation` `{field}`; subject ≤ 200, body ≤ 20000.

- [ ] **A1. Схема.** В `schema.yql` после последнего ALTER:
```sql
-- 2026-10-06 рассылка: подписчики (согласие отдельной галочкой, отписка = DELETE) и журнал рассылок.
CREATE TABLE IF NOT EXISTS subscribers (email Utf8, token Utf8, consent_at Timestamp, consent_ver Utf8, source Utf8, PRIMARY KEY (email));
CREATE TABLE IF NOT EXISTS mailings (id Utf8, created_at Timestamp, subject Utf8, body Utf8, sent Int32, failed Int32, PRIMARY KEY (id));
```
Применить к тестовой БД: `cd merch-api && node migrate.js` (ожидается `ok: CREATE TABLE IF NOT EXISTS subscribers` и `… mailings`). Если YDB «unauthenticated» — `.env` `YDB_ACCESS_TOKEN_CREDENTIALS=$(~/yandex-cloud/bin/yc iam create-token)`.

- [ ] **A2. `mail.send` с заголовками.** `send({ to, subject, text, html, headers })` → передать `headers` в `sendMail` (nodemailer поддерживает объект заголовков). Остальные вызовы не меняются.

- [ ] **A3. Тест (сначала падает)** `test/subscribers.test.js`, по образцу `test/digital.test.js` (`require('./_env')`, подмена `ext.mail.send`, `handler` из `../index`, `test.after` закрывает драйвер). Случаи:
  1. заказ цифрового тестового товара с `news: true` → строка в `subscribers` с `source` = id заказа, `consent_ver` = `'2026-10-06'`, token 32 hex; с `news: false`/без поля → строки нет;
  2. повторная подписка того же email → `consent_at` обновлён, token тот же;
  3. `unsub` GET с неверным токеном → 200, строка на месте; с верным → 200, строки нет; POST верный → 200 `OK`;
  4. `admin/mailing` test → одно письмо на `OWNER_EMAIL`; рассылка на 3 подписчиков → 3 письма, у каждого `headers['List-Unsubscribe']` содержит его email и token, `List-Unsubscribe-Post` = `List-Unsubscribe=One-Click`, текст содержит ссылку отписки; `mailings` sent=3;
  5. ошибка `ext.mail.send` на одном адресе → `failed: 1`, остальные ушли;
  6. пустой subject → 400.
  Тестовые адреса — `*@example.com`, в `before`/`after` удалять свои строки из `subscribers`/`mailings`. Тестовый товар — свой id `test-news`, как `test-dig` в digital.test.js.
  Run: `node --test test/subscribers.test.js` → FAIL.

- [ ] **A4. `lib/subscribers.js`.**
  - `subscribe(email, source)`: `validEmail`; если строка есть — UPSERT с прежним token, иначе `crypto.randomBytes(16).toString('hex')`; `consent_at = CurrentUtcTimestamp()`, `consent_ver = NEWS_CONSENT_VER`.
  - `unsubscribe(email, token)` → `true` если удалил (в `db.tx`: SELECT token, сравнить `crypto.timingSafeEqual` при равной длине, DELETE).
  - `list()`, `count()`.
  - `unsubUrl(email, token)` = `${FUNC_URL}?a=unsub&e=${encodeURIComponent(email)}&t=${token}`, где `FUNC_URL = ENV.FUNC_URL || 'https://functions.yandexcloud.net/d4eh4qtc4a7fria6mgmt'`.
  - `letter({ subject, body, url })` → `{ subject, text, html, headers }`: text = body + `\n\n—\nВы получили это письмо, потому что согласились на письма при заказе на antiosov.ru.\nОтписаться: ${url}`; html — экранированный body, переводы строк `<br>`, URL `https?://\S+` → `<a>`, тот же подвал; headers `List-Unsubscribe: <${url}>`, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
  - `sendMailing({ subject, body, test, mailing_id, offset })` по контракту выше; каждое письмо через `ext.mail.send`, ошибки ловить поштучно (`console.error('mailing', email, e.message)`); тестовое письмо — с фиктивной ссылкой отписки `unsubUrl(OWNER_EMAIL, 'test')`.
  - `listMailings()`.
- [ ] **A5. Хук и маршруты.** `index.js` `case 'order'`: `const b = parseBody(event); const r = await orders.createOrder(b); if (b.news === true) { try { await subscribers.subscribe(b.email, r.id || r.order_id); } catch (e) { console.error('subscribe', e.message); } } return json(200, r);` — проверить, как называется id в ответе `createOrder`, и использовать его. `case 'unsub'`: HTML-ответ (`Content-Type: text/html; charset=utf-8`, простая страница со ссылкой на https://antiosov.ru). `lib/admin.js`: три маршрута за `requireAuth`.
- [ ] **A6.** `node --test test/subscribers.test.js` → PASS; затем `node --test test/digital.test.js test/handler.test.js` → PASS.
- [ ] **A7. README** — раздел «Рассылка» (таблицы, маршруты, порции по 25, отписка = удаление). Коммит (без пуша): `merch-api: рассылка — подписчики, отписка в один клик, админ-маршруты`.

### Task B: фронт

**Files:**
- Modify: `merch/p/index.html`, `products/p/index.html`, `products/buy-block.js`, `merch/privacy/index.html`, `merch/admin/index.html`, `merch/admin/admin.js`; затем `python3 products/build-pages.py` (перегенерирует `products/<slug>/index.html`); версии `?v=` у изменённых `products.css/js`/`buy-block.js` в ссылках — поднять.
- Create: `consent/rassylka/index.html`

**Interfaces (Consumes):** контракт Task A выше.

- [ ] **B1. Галочка** во всех трёх формах сразу после галочки согласия на ПД, той же разметкой (`<label class="check" data-f="news">`), без `required`, текст — дословно из Global Constraints, ссылка `target="_blank"`. В сборе тела заказа: `news: f.get('news') === 'on'`. Галочку не проверять на фронте.
- [ ] **B2. `/consent/rassylka/`** — по образцу `/consent/index.html` (та же шапка, стили, cookie-баннер, реквизиты ИП дословно оттуда). Содержание: Антиосов Д. А. (ИП, ИНН, ОГРНИП, e-mail dimaantiosov@yandex.ru — как в `/consent/`) с моего согласия присылает мне на e-mail письма о своих книгах, вечерах, вещах и других проектах, в том числе рекламного характера (ст. 18 ФЗ «О рекламе»), изредка. Обрабатывается только e-mail (152-ФЗ, цель — эта рассылка; хранится в Yandex Cloud в России). Согласие действует до отзыва. Отозвать: ссылка «Отписаться» в любом письме или письмо на dimaantiosov@yandex.ru; после отзыва адрес удаляется. Согласие необязательно и не влияет на заказ. Редакция от 6 октября 2026 г. Сухо, коротко, без канцелярских нагромождений.
- [ ] **B3. `/merch/privacy/`** — добавить в цели: «рассылка писем о книгах, вечерах и вещах — только тем, кто отдельно согласился (`/consent/rassylka/`); данные — e-mail; до отзыва согласия».
- [ ] **B4. Админка, вкладка «Рассылка»** — по стилю существующих вкладок `merch/admin`: строка «Подписчиков: N» (клик — список email/дата/заказ), поле «Тема», textarea «Текст», кнопки «Отправить себе» (`test: true`) и «Отправить всем (N)» (`confirm('Отправить N подписчикам?')`, затем цикл вызовов `admin/mailing` с `mailing_id`/`next_offset`, пока не `done`, прогресс «ушло X из N, ошибок Y»), журнал из `admin/mailings`. Токен — заголовок `X-Admin-Token`, как в остальном `admin.js`.
- [ ] **B5. Проверка локально:** `python3 -m http.server 8765` в корне `Antiosov/`, headless Chrome (`--user-data-dir` в scratchpad) — открыть `/merch/p/?s=…`, `/products/na-pero/`, `/consent/rassylka/`, `/merch/admin/`: галочка видна, не отмечена, ссылка ведёт на страницу; нет ошибок в консоли. Скриншоты — в scratchpad.
- [ ] **B6.** Коммит (без пуша): `Рассылка: галочка в формах, /consent/rassylka/, политика, вкладка в админке`.

### Task C (координатор): деплой и живая проверка

- [ ] Миграция прод-БД (`YDB_CONNECTION` прод из `.deploy.env`), `./deploy.sh`, пуш.
- [ ] Живой путь: `admin/subscribers` отвечает; заказ с галочкой на выключенном тестовом товаре → подписчик есть → `unsub` по ссылке удаляет. Отправка письма — после `VerifiedForSendingStatus: true` в Postbox; до того фиксируется как непроверенное.
