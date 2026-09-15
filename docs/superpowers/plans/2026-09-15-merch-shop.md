# Merch Shop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Магазин мерча на antiosov.ru/merch: карточка → размер/кол-во → форма → оплата Т-Банк → заказ в YDB → письма → мини-CRM; доставка до ПВЗ Яндекс Доставкой (режим off до договора).

**Architecture:** Статика на GitHub Pages (`merch/`), одна Yandex Cloud Function `merch-api` (Node 18, `merch-api/`), YDB serverless (products/variants/orders/counters), Object Storage `antiosov-merch` (фото, public-read префикс `p/`), Postbox (SMTP). Все переходы состояния — условные UPDATE в serializable-транзакциях YDB; единственная точка «оплачен» — `confirmPaid`.

**Tech Stack:** Node.js 18 (CommonJS), `ydb-sdk@5`, `nodemailer`, `node:test` для юнитов, `yc` CLI 1.34 (`~/yandex-cloud/bin/yc`), Т-Банк EACQ v2, Яндекс Доставка «в другой день» API, ванильный JS/CSS на фронте (без сборки).

Спецификация: `docs/superpowers/specs/2026-09-15-merch-shop-design.md` — источник истины по требованиям.

## Global Constraints

- Cloud: облако `cloud-dimaantiosov`, папка `default` id `b1gkm69jqok5o2cpgn0p`. `yc` авторизован. Функция `vsd-paywall` (id d4e5js9qf7re9dl0qlud) **не трогается**.
- Секреты только в `merch-api/.env` (локальные тесты) и `merch-api/.deploy.env` (деплой) — оба в `.gitignore`. Никаких секретов в git и в фронтенде.
- Все ответы API — JSON; CORS `Access-Control-Allow-Origin: https://antiosov.ru` (+ `DEV_ORIGIN` из env, если задан). Маршрут — query `?a=`.
- Суммы в базе и API — рубли (Int32); в Т-Банк — копейки (×100). Лимит qty = 5. Резерв/платёж — 20 минут (`RESERVE_MIN=20`). `PREORDER_MAX=20`.
- Статусы: `new → paid → packed → shipped → done`; ветки `cancelled`, `expired`. Каждый переход — `UPDATE … WHERE status=$from`.
- Стиль сайта: белый фон, `Cormorant Garamond` italic для заголовков, `Inter` с разрядкой для подписей, `assets/reveal.css` + `assets/reveal.js` для проявления. Язык — русский.
- Коммит после каждой задачи, пуш в `main` (GitHub Pages деплоится из main).
- Рабочая папка репо: `/Users/imac/Documents/новый/projects/Antiosov`. Все пути ниже — относительно неё.
- Node локально: проверить `node -v` ≥ 18 (для `node --test`).

## File Structure

```
merch-api/
  index.js            HTTP-роутер: парсинг event, CORS, switch по ?a=, единый try/catch
  package.json        ydb-sdk@5, nodemailer; "test": "node --test test/"
  ru-ca.pem           копия paywall/ru-ca.pem (УЦ Минцифры для Т-Банка)
  schema.yql          DDL таблиц
  migrate.js          применяет schema.yql (query-service, CREATE TABLE IF NOT EXISTS)
  deploy.sh           zip + yc serverless function version create с env из .deploy.env
  lib/ydb.js          драйвер (кэш на уровне модуля), query(), tx() с ретраем
  lib/util.js         ответы (json/text/redirect), HttpError, валидаторы, env-числа
  lib/jwt.js          HMAC-JWT для админки
  lib/tbank.js        tbToken/tbCall/receipt/Cancel (порт из paywall)
  lib/s3.js           SigV4: presignPut, deleteObject
  lib/mail.js         nodemailer → Postbox; шаблоны писем
  lib/yd.js           Яндекс Доставка: cities/pvz/quote/createRequest в режимах off|test|prod
  lib/ext.js          реестр внешних вызовов (подменяется в тестах)
  lib/orders.js       домен: каталог, createOrder, confirmPaid, gc, transition, cancel
  lib/admin.js        админ-маршруты (login, orders, products, photo)
  test/*.test.js      node:test; чистые юниты + интеграционные против тестовой YDB
  README.md
merch/
  index.html          каталог
  merch.css           общие стили магазина
  api.js              window.MERCH_API + fetch-обёртка
  p/index.html        карточка + форма (?s=slug)
  order/index.html    статус после оплаты (?id=&k=)
  privacy/index.html  политика ПД
  admin/index.html    мини-CRM
  admin/admin.js
```

---

### Task 1: Облачные ресурсы, скелет функции, YDB-слой и схема

**Files:**
- Create: `merch-api/package.json`, `merch-api/lib/ydb.js`, `merch-api/schema.yql`, `merch-api/migrate.js`, `merch-api/deploy.sh`, `merch-api/.env`, `merch-api/.deploy.env`, `merch-api/test/ydb.test.js`
- Copy: `paywall/ru-ca.pem` → `merch-api/ru-ca.pem`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `lib/ydb.js` → `query(yql, params) → Promise<Array<Array<object>>>` (список result-set'ов), `tx(fn) → Promise<T>` где `fn(run)` и `run(yql, params)` того же вида, `TypedValues` (реэкспорт), `V` — хелперы параметров: `V.s(str)`, `V.i(int)`, `V.b(bool)`, `V.ts(Date)`, `V.j(obj)`.
- Produces env: `YDB_CONNECTION` (grpcs://…/?database=…), в облаке `YDB_METADATA_CREDENTIALS=1`, локально `YDB_ACCESS_TOKEN_CREDENTIALS`.

- [ ] **Step 1: Создать сервисный аккаунт, две YDB, бакет, функцию**

```bash
YC=~/yandex-cloud/bin/yc
F=b1gkm69jqok5o2cpgn0p
$YC iam service-account create --name merch-api --description "функция магазина мерча" --format json
SA=$($YC iam service-account get merch-api --format json | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
$YC resource-manager folder add-access-binding $F --role ydb.editor --subject serviceAccount:$SA
$YC resource-manager folder add-access-binding $F --role postbox.sender --subject serviceAccount:$SA
$YC ydb database create antiosov-merch --serverless --format json
$YC ydb database create antiosov-merch-test --serverless --format json
$YC storage bucket create --name antiosov-merch --default-storage-class standard --max-size 1073741824
$YC storage bucket update --name antiosov-merch --cors '[{"allowed_origins":["https://antiosov.ru","http://localhost:5500","http://127.0.0.1:5500"],"allowed_methods":["PUT","GET"],"allowed_headers":["Content-Type"],"max_age_seconds":3600}]'
$YC serverless function create --name merch-api --description "магазин мерча"
$YC serverless function allow-unauthenticated-invoke merch-api
$YC iam access-key create --service-account-name merch-api --format json   # → S3_KEY / S3_SECRET, сохранить в .deploy.env и .env
$YC iam api-key create --service-account-name merch-api --scopes yc.postbox.send --format json  # → SMTP_USER (id) / SMTP_PASS (secret)
$YC ydb database get antiosov-merch --format json | python3 -c "import json,sys;d=json.load(sys.stdin);print('grpcs://'+d['endpoint'].split('/')[0].replace('grpcs://','')+'/?database='+d['database'])"
$YC ydb database get antiosov-merch-test --format json | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['endpoint'], d['database'])"
```
Expected: все команды без ошибок; записать: `SA`, `S3_KEY/S3_SECRET`, `SMTP_USER/SMTP_PASS`, connection string обеих БД, `http_invoke_url` функции.
Если `storage bucket update --cors` не принимает JSON так — использовать `--cors-file cors.json` с тем же содержимым.
Для бакета также: `$YC storage bucket update --name antiosov-merch --acl public-read` **не делать** (весь бакет не публичный); публичный доступ — только через policy на префикс `p/`:
```bash
cat > /tmp/policy.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::antiosov-merch/p/*"}]}
EOF
$YC storage bucket update --name antiosov-merch --policy-from-file /tmp/policy.json
```
Права на бакет для SA: `$YC storage bucket update --name antiosov-merch --grants grant-type=grant-type-account,grantee-id=$SA,permission=permission-full-control`.

- [ ] **Step 2: Скелет папки и .gitignore**

```bash
cd /Users/imac/Documents/новый/projects/Antiosov
mkdir -p merch-api/lib merch-api/test
cp paywall/ru-ca.pem merch-api/ru-ca.pem
printf 'merch-api/.env\nmerch-api/.deploy.env\nmerch-api/node_modules\nmerch-api/*.zip\n' >> .gitignore
```

`merch-api/package.json`:
```json
{
  "name": "merch-api",
  "version": "1.0.0",
  "private": true,
  "main": "index.js",
  "scripts": { "test": "node --test test/", "migrate": "node migrate.js" },
  "dependencies": { "ydb-sdk": "^5.11.1", "nodemailer": "^6.9.0" }
}
```
`cd merch-api && npm install` → `node_modules` (в .gitignore).

`merch-api/.env` (локальные тесты, тестовая БД):
```
YDB_CONNECTION=grpcs://<endpoint>/?database=<database of antiosov-merch-test>
YDB_ACCESS_TOKEN_CREDENTIALS=<yc iam create-token>
SECRET=<random 48 hex>
ADMIN_PASSWORD=<длинный пароль для тестов>
SITE=http://localhost:5500
SELF_URL=http://localhost/merch-api
S3_KEY=...
S3_SECRET=...
S3_BUCKET=antiosov-merch
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM=shop@antiosov.ru
OWNER_EMAIL=antiosina@gmail.com
TB_TERMINAL=1789121308461DEMO
TB_PASSWORD=<demo password из paywall/.env>
TAXATION=usn_income
VAT=none
YD_MODE=test
YD_TOKEN=<тестовый токен из https://yandex.ru/support/delivery-profile/ru/api/other-day/ раздел «Тестовая среда»>
YD_STATION_ID=fbed3aa1-2cc6-4370-ab4d-59c5cc9bb924
DELIVERY_FLAT=400
RESERVE_MIN=20
PREORDER_MAX=20
```
`merch-api/.deploy.env` — то же, но `YDB_CONNECTION` боевой БД, без `YDB_ACCESS_TOKEN_CREDENTIALS`, плюс `YDB_METADATA_CREDENTIALS=1`, `SITE=https://antiosov.ru`, `SELF_URL=<http_invoke_url>`, боевые `TB_TERMINAL/TB_PASSWORD` из `paywall/prod.env`, `YD_MODE=off`. IAM-токен живёт 12 ч — при протухании `yc iam create-token` заново.

- [ ] **Step 3: Тест на YDB-слой (падает)**

`merch-api/test/_env.js` (общий загрузчик .env для тестов):
```js
// Загружает merch-api/.env в process.env (KEY=VALUE, строки без '=' игнорируются)
const fs = require('fs'), path = require('path');
const p = path.join(__dirname, '..', '.env');
if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i > 0 && !l.startsWith('#')) process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
}
```
`merch-api/test/ydb.test.js`:
```js
require('./_env');
const test = require('node:test'); const assert = require('node:assert');
const db = require('../lib/ydb');

test('query: SELECT 1', async () => {
  const [[row]] = await db.query('SELECT 1 AS one;');
  assert.equal(row.one, 1);
});

test('tx: два параллельных инкремента одного счётчика дают +2', async () => {
  await db.query(`UPSERT INTO counters (name, value) VALUES ('t_inc', 0);`);
  const inc = () => db.tx(async run => {
    const [[c]] = await run(`SELECT value FROM counters WHERE name = 't_inc';`);
    await run(`DECLARE $v AS Int32; UPSERT INTO counters (name, value) VALUES ('t_inc', $v);`, { $v: db.V.i(c.value + 1) });
  });
  await Promise.all([inc(), inc()]);
  const [[c]] = await db.query(`SELECT value FROM counters WHERE name = 't_inc';`);
  assert.equal(c.value, 2);
});
```

- [ ] **Step 4: Запустить — падает**

Run: `cd merch-api && node --test test/ydb.test.js`
Expected: FAIL — `Cannot find module '../lib/ydb'`.

- [ ] **Step 5: lib/ydb.js**

```js
// YDB: драйвер кэшируется на уровне модуля (переживает вызовы функции в одном инстансе).
// query()  — один YQL в авто-транзакции (serializable RW, commit).
// tx(fn)   — интерактивная транзакция; fn(run) выполняет несколько YQL; конфликт
//            (ABORTED / locks invalidated) → повтор всей fn до 5 раз. Так реализуется
//            оптимистичная блокировка: «прочитал остаток → проверил → записал».
const { Driver, getCredentialsFromEnv, TypedValues, TypedData, AUTO_TX } = require('ydb-sdk');

let driver = null;
async function getDriver() {
  if (driver) return driver;
  const d = new Driver({ connectionString: process.env.YDB_CONNECTION, authService: getCredentialsFromEnv() });
  if (!(await d.ready(10000))) throw new Error('YDB not ready');
  driver = d;
  return d;
}

const rows = r => r.resultSets.map(rs => TypedData.createNativeObjects(rs).map(o => ({ ...o })));

async function query(yql, params = {}) {
  const d = await getDriver();
  return d.tableClient.withSessionRetry(s => s.executeQuery(yql, params, AUTO_TX).then(rows));
}

const isRetryable = e => /ABORTED|locks invalidated|Transaction locks|TLI/i.test(String(e && (e.message || e)));

async function tx(fn, retries = 5) {
  const d = await getDriver();
  for (let attempt = 0; ; attempt++) {
    try {
      return await d.tableClient.withSession(async s => {
        const { id } = await s.beginTransaction({ serializableReadWrite: {} });
        const run = (yql, params = {}) => s.executeQuery(yql, params, { txId: id }).then(rows);
        try {
          const out = await fn(run);
          await s.commitTransaction({ txId: id });
          return out;
        } catch (e) {
          try { await s.rollbackTransaction({ txId: id }); } catch (_) { /* уже отменена */ }
          throw e;
        }
      });
    } catch (e) {
      if (attempt < retries && isRetryable(e)) continue;
      throw e;
    }
  }
}

const V = {
  s: v => TypedValues.utf8(String(v)),
  i: v => TypedValues.int32(Number(v)),
  b: v => TypedValues.bool(!!v),
  ts: v => TypedValues.timestamp(v instanceof Date ? v : new Date(v)),
  j: v => TypedValues.json(JSON.stringify(v)),
};

module.exports = { query, tx, V, TypedValues, getDriver };
```

- [ ] **Step 6: schema.yql и migrate.js**

`merch-api/schema.yql`:
```sql
CREATE TABLE IF NOT EXISTS products (
  id Utf8, title Utf8, description_md Utf8, price Int32, images Json, weight_g Int32,
  dims_cm Json, sizes Json, preorder_allowed Bool, preorder_ship_by Utf8, active Bool,
  sort Int32, updated_at Timestamp, PRIMARY KEY (id));
CREATE TABLE IF NOT EXISTS variants (
  product_id Utf8, size Utf8, stock Int32, reserved Int32, preorder_count Int32,
  PRIMARY KEY (product_id, size));
CREATE TABLE IF NOT EXISTS orders (
  id Utf8, k Utf8, created_at Timestamp, updated_at Timestamp, status Utf8,
  product_id Utf8, size Utf8, qty Int32, is_preorder Bool,
  price_item Int32, price_delivery Int32, total Int32,
  customer_name Utf8, customer_phone Utf8, customer_email Utf8, address_text Utf8,
  pvz_id Utf8, pvz_address Utf8, delivery_mode Utf8, yd_env Utf8, delivery_days Int32,
  yd_request_id Utf8, yd_track_url Utf8, yd_error Utf8,
  tb_payment_id Utf8, tb_payment_url Utf8, tb_refund_id Utf8, mail_error Utf8,
  consent_at Timestamp, admin_note Utf8,
  INDEX by_status GLOBAL ON (status),
  PRIMARY KEY (id));
CREATE TABLE IF NOT EXISTS counters (name Utf8, value Int32, PRIMARY KEY (name));
```
`merch-api/migrate.js`:
```js
// node migrate.js — применяет schema.yql к БД из YDB_CONNECTION (.env локально).
require('./test/_env');
const fs = require('fs'); const path = require('path');
const { getDriver } = require('./lib/ydb');
(async () => {
  const d = await getDriver();
  const ddl = fs.readFileSync(path.join(__dirname, 'schema.yql'), 'utf8');
  for (const stmt of ddl.split(';').map(s => s.trim()).filter(Boolean)) {
    await d.queryClient.do({ fn: async s => { await s.execute({ text: stmt + ';' }); } });
    console.log('ok:', stmt.split('(')[0].trim());
  }
  await d.destroy(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
```
Run: `cd merch-api && node migrate.js` → 4 строки `ok: CREATE TABLE IF NOT EXISTS …`.
Если `queryClient.do` падает на DDL — запасной путь: `~/yandex-cloud/bin/yc ydb` не выполняет YQL; тогда установить YDB CLI (`curl -sSL https://install.ydb.tech | bash`) и `ydb -e <endpoint> -d <database> --token-file <(yc iam create-token) yql -f schema.yql`. Зафиксировать рабочий путь в README.
Прогнать миграцию **на обеих** БД (сменив `YDB_CONNECTION` во временном окружении: `YDB_CONNECTION=<prod> node migrate.js`).

- [ ] **Step 7: Тест проходит**

Run: `cd merch-api && node --test test/ydb.test.js`
Expected: `# pass 2`.

- [ ] **Step 8: deploy.sh**

```bash
#!/bin/bash
# Деплой merch-api: zip (без node_modules — облако ставит зависимости из package.json) + новая версия функции.
set -euo pipefail
cd "$(dirname "$0")"
YC=~/yandex-cloud/bin/yc
rm -f merch-api.zip
zip -qr merch-api.zip index.js package.json ru-ca.pem lib schema.yql
ARGS=()
while IFS= read -r line; do [[ "$line" =~ ^[A-Z_]+= ]] && ARGS+=(--environment "$line"); done < .deploy.env
$YC serverless function version create \
  --function-name merch-api --runtime nodejs18 --entrypoint index.handler \
  --memory 256m --execution-timeout 30s --service-account-id "$(grep '^SA_ID=' .deploy.env | cut -d= -f2)" \
  --source-path merch-api.zip "${ARGS[@]}"
echo "deployed: $($YC serverless function get merch-api --format json | python3 -c 'import json,sys;print(json.load(sys.stdin)["http_invoke_url"])')"
```
`chmod +x merch-api/deploy.sh`. В `.deploy.env` добавить строку `SA_ID=<id merch-api>` (она уйдёт и в env — безвредно). Деплой выполняется в Task 6, здесь только файл.

- [ ] **Step 9: Commit**

```bash
git add .gitignore merch-api/package.json merch-api/lib/ydb.js merch-api/schema.yql merch-api/migrate.js merch-api/deploy.sh merch-api/ru-ca.pem merch-api/test/_env.js merch-api/test/ydb.test.js
git commit -m "merch-api: YDB layer, schema, deploy script" && git push origin main
```

---

### Task 2: Утилиты, JWT, Т-Банк, S3-подпись (чистые юниты)

**Files:**
- Create: `merch-api/lib/util.js`, `merch-api/lib/jwt.js`, `merch-api/lib/tbank.js`, `merch-api/lib/s3.js`, `merch-api/test/util.test.js`, `merch-api/test/jwt.test.js`, `merch-api/test/s3.test.js`

**Interfaces:**
- Produces `util`: `json(code, obj)`, `text(code, s)`, `redirect(url)`, `class HttpError(code, error, extra)`, `envInt(name, def)`, `validPhone(s) → normalized|null` (10–15 цифр, `+7…`), `validEmail(s) → lower|null`, `validName(s) → trimmed|null` (2–80), `randomKey() → 16 hex`, `nowIso()`.
- Produces `jwt`: `sign(payload, ttlSec) → string`, `verify(token) → payload|null`.
- Produces `tbank`: `tbToken(params)`, `tbCall(method, params)`, `receipt(email, items)` где items `[{name, price_rub, qty, object:'commodity'|'service', method:'full_payment'|'full_prepayment'}]`, `init({orderId, amountRub, description, email, receiptItems, successUrl, failUrl, notifyUrl, dueDate})`, `getState(paymentId)`, `cancel(paymentId)`.
- Produces `s3`: `presignPut(key, contentType, ttlSec) → url`, `deleteObject(key) → Promise<void>`, `publicUrl(key)`.

- [ ] **Step 1: Тесты (падают)**

`merch-api/test/util.test.js`:
```js
const test = require('node:test'); const assert = require('node:assert');
const u = require('../lib/util');
test('phone', () => {
  assert.equal(u.validPhone('8 (912) 345-67-89'), '+79123456789');
  assert.equal(u.validPhone('+7 912 345 67 89'), '+79123456789');
  assert.equal(u.validPhone('123'), null);
});
test('email/name', () => {
  assert.equal(u.validEmail(' A@B.ru '), 'a@b.ru');
  assert.equal(u.validEmail('nope'), null);
  assert.equal(u.validName(' Дима '), 'Дима');
  assert.equal(u.validName('Д'), null);
});
test('json response has CORS', () => {
  process.env.SITE = 'https://antiosov.ru';
  const r = u.json(200, { a: 1 });
  assert.equal(r.headers['Access-Control-Allow-Origin'], 'https://antiosov.ru');
  assert.equal(JSON.parse(r.body).a, 1);
});
```
`merch-api/test/jwt.test.js`:
```js
const test = require('node:test'); const assert = require('node:assert');
process.env.SECRET = 'test-secret';
const jwt = require('../lib/jwt');
test('sign/verify roundtrip', () => {
  const t = jwt.sign({ role: 'admin' }, 60);
  assert.equal(jwt.verify(t).role, 'admin');
});
test('expired and tampered rejected', () => {
  assert.equal(jwt.verify(jwt.sign({ x: 1 }, -1)), null);
  const t = jwt.sign({ x: 1 }, 60);
  assert.equal(jwt.verify(t.slice(0, -2) + 'zz'), null);
});
```
`merch-api/test/s3.test.js`:
```js
const test = require('node:test'); const assert = require('node:assert');
process.env.S3_KEY = 'AKID'; process.env.S3_SECRET = 'SECRET'; process.env.S3_BUCKET = 'antiosov-merch';
const s3 = require('../lib/s3');
test('presignPut shape', () => {
  const url = s3.presignPut('p/tee/abc.jpg', 'image/jpeg', 600);
  assert.ok(url.startsWith('https://storage.yandexcloud.net/antiosov-merch/p/tee/abc.jpg?'));
  assert.ok(url.includes('X-Amz-SignedHeaders=content-type%3Bhost'));
  assert.ok(/X-Amz-Signature=[0-9a-f]{64}$/.test(url));
});
test('publicUrl', () => {
  assert.equal(s3.publicUrl('p/tee/a.jpg'), 'https://storage.yandexcloud.net/antiosov-merch/p/tee/a.jpg');
});
```
Run: `cd merch-api && node --test test/util.test.js test/jwt.test.js test/s3.test.js` → FAIL (модули не найдены).

- [ ] **Step 2: lib/util.js**

```js
const crypto = require('crypto');
const ENV = process.env;

class HttpError extends Error {
  constructor(code, error, extra) { super(error); this.code = code; this.error = error; this.extra = extra; }
}

const cors = () => {
  const h = { 'Access-Control-Allow-Origin': ENV.SITE || 'https://antiosov.ru', 'Vary': 'Origin' };
  return h;
};
const json = (code, obj, extraHeaders = {}) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(), ...extraHeaders },
  body: JSON.stringify(obj),
});
const text = (code, s) => ({ statusCode: code, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: s });
const redirect = url => ({ statusCode: 302, headers: { Location: url, 'Cache-Control': 'no-store' }, body: '' });

const envInt = (name, def) => { const v = parseInt(ENV[name], 10); return Number.isFinite(v) ? v : def; };

function validPhone(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length < 10 || d.length > 15) return null;
  if (d.length === 10) d = '7' + d;
  return '+' + d;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const validEmail = s => { const v = String(s || '').trim().toLowerCase(); return EMAIL_RE.test(v) && v.length <= 120 ? v : null; };
const validName = s => { const v = String(s || '').trim().replace(/\s+/g, ' '); return v.length >= 2 && v.length <= 80 ? v : null; };
const randomKey = () => crypto.randomBytes(8).toString('hex');
const nowIso = () => new Date().toISOString();

module.exports = { HttpError, json, text, redirect, envInt, validPhone, validEmail, validName, randomKey, nowIso, cors };
```

- [ ] **Step 3: lib/jwt.js**

```js
// Минимальный JWT (HS256) для админки. Отзыв всех токенов — смена SECRET.
const crypto = require('crypto');
const b64 = s => Buffer.from(s).toString('base64url');
const sig = data => crypto.createHmac('sha256', process.env.SECRET).update(data).digest('base64url');

function sign(payload, ttlSec) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSec };
  const data = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + b64(JSON.stringify(body));
  return data + '.' + sig(data);
}
function verify(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = parts[0] + '.' + parts[1];
  const good = Buffer.from(sig(data)), got = Buffer.from(parts[2]);
  if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return null;
  let body; try { body = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); } catch (e) { return null; }
  if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
  return body;
}
module.exports = { sign, verify };
```

- [ ] **Step 4: lib/tbank.js** (порт из `paywall/index.js` + Init/GetState/Cancel обёртки)

```js
// Т-Банк EACQ v2. Т-Банк подписан УЦ Минцифры — ru-ca.pem добавляется к системным корням.
const https = require('https'); const crypto = require('crypto'); const fs = require('fs'); const path = require('path');
const ENV = process.env;
const RU_CA = fs.readFileSync(path.join(__dirname, '..', 'ru-ca.pem'));
const agent = new https.Agent({ ca: [...require('tls').rootCertificates, RU_CA.toString()] });

function tbToken(params) {
  const flat = { ...params, Password: ENV.TB_PASSWORD };
  const str = Object.keys(flat).filter(k => typeof flat[k] !== 'object').sort().map(k => String(flat[k])).join('');
  return crypto.createHash('sha256').update(str).digest('hex');
}

function tbCall(method, params, timeoutMs = 8000) {
  const body = JSON.stringify({ ...params, Token: tbToken(params) });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'securepay.tinkoff.ru', path: '/v2/' + method, method: 'POST', agent, timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('tbank bad json: ' + data.slice(0, 200))); } });
    });
    req.on('timeout', () => req.destroy(new Error('tbank timeout ' + method)));
    req.on('error', reject); req.write(body); req.end();
  });
}

// Чек 54-ФЗ. items: [{name, price_rub, qty, object, method}]
function receipt(email, items) {
  return {
    Email: email,
    Taxation: ENV.TAXATION || 'usn_income',
    Items: items.map(it => ({
      Name: it.name.slice(0, 128), Price: it.price_rub * 100, Quantity: it.qty, Amount: it.price_rub * it.qty * 100,
      Tax: ENV.VAT || 'none', PaymentMethod: it.method || 'full_payment', PaymentObject: it.object || 'commodity',
    })),
  };
}

// dueDate: Date → "YYYY-MM-DDTHH:MM:SS+03:00" (Т-Банк требует смещение)
function tbDate(d) {
  const msk = new Date(d.getTime() + 3 * 3600 * 1000);
  return msk.toISOString().slice(0, 19) + '+03:00';
}

async function init({ orderId, amountRub, description, email, receiptItems, successUrl, failUrl, notifyUrl, dueDate }) {
  const res = await tbCall('Init', {
    TerminalKey: ENV.TB_TERMINAL, Amount: amountRub * 100, OrderId: orderId, Description: description.slice(0, 140),
    SuccessURL: successUrl, FailURL: failUrl, NotificationURL: notifyUrl, RedirectDueDate: tbDate(dueDate),
    DATA: { Email: email }, Receipt: receipt(email, receiptItems),
  });
  if (!res.Success || !res.PaymentURL) throw new Error('tbank init failed: ' + JSON.stringify(res));
  return { paymentId: String(res.PaymentId), paymentUrl: res.PaymentURL };
}
const getState = paymentId => tbCall('GetState', { TerminalKey: ENV.TB_TERMINAL, PaymentId: paymentId });
// Полный возврат: чек не передаётся (Т-Банк формирует чек возврата сам по исходному).
const cancel = paymentId => tbCall('Cancel', { TerminalKey: ENV.TB_TERMINAL, PaymentId: paymentId });

module.exports = { tbToken, tbCall, receipt, init, getState, cancel, tbDate };
```

- [ ] **Step 5: lib/s3.js**

```js
// Object Storage, AWS SigV4. presignPut — для загрузки фото из админки (подписывается точный
// Content-Type, поэтому клиент обязан слать тот же заголовок). deleteObject — подписанный DELETE.
const https = require('https'); const crypto = require('crypto');
const ENV = process.env;
const HOST = 'storage.yandexcloud.net', REGION = 'ru-central1', SERVICE = 's3';
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const amzDate = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
const signingKey = day => hmac(hmac(hmac(hmac('AWS4' + ENV.S3_SECRET, day), REGION), SERVICE), 'aws4_request');
const canonicalUri = key => '/' + ENV.S3_BUCKET + '/' + key.split('/').map(enc).join('/');

function presignPut(key, contentType, ttlSec) {
  const date = amzDate(), day = date.slice(0, 8), scope = `${day}/${REGION}/${SERVICE}/aws4_request`;
  const q = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${ENV.S3_KEY}/${scope}`, 'X-Amz-Date': date,
    'X-Amz-Expires': String(ttlSec), 'X-Amz-SignedHeaders': 'content-type;host',
  };
  const cq = Object.keys(q).sort().map(k => `${enc(k)}=${enc(q[k])}`).join('&');
  const cr = ['PUT', canonicalUri(key), cq, `content-type:${contentType}\nhost:${HOST}\n`, 'content-type;host', 'UNSIGNED-PAYLOAD'].join('\n');
  const sts = ['AWS4-HMAC-SHA256', date, scope, sha(cr)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(day)).update(sts).digest('hex');
  return `https://${HOST}${canonicalUri(key)}?${cq}&X-Amz-Signature=${signature}`;
}

function deleteObject(key) {
  const date = amzDate(), day = date.slice(0, 8), scope = `${day}/${REGION}/${SERVICE}/aws4_request`;
  const payloadHash = sha('');
  const headers = { host: HOST, 'x-amz-content-sha256': payloadHash, 'x-amz-date': date };
  const signed = Object.keys(headers).sort();
  const cr = ['DELETE', canonicalUri(key), '', signed.map(h => `${h}:${headers[h]}\n`).join(''), signed.join(';'), payloadHash].join('\n');
  const sts = ['AWS4-HMAC-SHA256', date, scope, sha(cr)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(day)).update(sts).digest('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${ENV.S3_KEY}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}`;
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: HOST, path: canonicalUri(key), method: 'DELETE', headers: { ...headers, Authorization: auth } }, res => {
      res.resume(); res.on('end', () => (res.statusCode < 300 || res.statusCode === 404) ? resolve() : reject(new Error('s3 delete ' + res.statusCode)));
    });
    req.on('error', reject); req.end();
  });
}

const publicUrl = key => `https://${HOST}/${ENV.S3_BUCKET}/${key}`;
module.exports = { presignPut, deleteObject, publicUrl };
```

- [ ] **Step 6: Прогнать тесты**

Run: `cd merch-api && node --test test/util.test.js test/jwt.test.js test/s3.test.js`
Expected: `# pass 7`.

- [ ] **Step 7: Живая проверка presignPut** (реальный ключ из .env)

```bash
cd merch-api && node -e "
require('./test/_env'); const s3=require('./lib/s3');
const url=s3.presignPut('p/_probe/x.txt','text/plain',300); console.log(url);
" | tail -1 | xargs -I{} curl -s -o /dev/null -w '%{http_code}\n' -X PUT -H 'Content-Type: text/plain' --data 'probe' '{}'
curl -s -o /dev/null -w '%{http_code}\n' https://storage.yandexcloud.net/antiosov-merch/p/_probe/x.txt
cd merch-api && node -e "require('./test/_env'); require('./lib/s3').deleteObject('p/_probe/x.txt').then(()=>console.log('deleted'))"
```
Expected: `200`, затем `200` (публичное чтение по policy), затем `deleted`. Если второй `403` — policy на `p/*` не применилась, поправить в Task 1 Step 1.

- [ ] **Step 8: Commit**

```bash
git add merch-api/lib/util.js merch-api/lib/jwt.js merch-api/lib/tbank.js merch-api/lib/s3.js merch-api/test/util.test.js merch-api/test/jwt.test.js merch-api/test/s3.test.js
git commit -m "merch-api: util, jwt, tbank, s3 signing" && git push origin main
```

---

### Task 3: Почта (Postbox), Яндекс Доставка, реестр внешних вызовов

**Files:**
- Create: `merch-api/lib/mail.js`, `merch-api/lib/yd.js`, `merch-api/lib/ext.js`, `merch-api/test/yd.test.js`, `merch-api/test/mail.test.js`

**Interfaces:**
- Produces `mail`: `send({to, subject, text, html}) → Promise<void>`; шаблоны: `tplOwnerNewOrder(order)`, `tplCustomerPaid(order)`, `tplCustomerShipped(order)`, `tplCustomerCancelled(order)`, `tplOwnerLatePayment(order, paymentId)` — каждый возвращает `{subject, text, html}`. `order` — объект строки `orders` + `product_title`.
- Produces `yd`: `mode() → 'off'|'test'|'prod'`, `cities(q) → [{geo_id, name}]`, `pvz(geo_id) → [{id, address, schedule, lat, lon}]`, `quote({pvz_id, weight_g, dims_cm, qty}) → {price_rub, days}` (в off — `{price_rub: DELIVERY_FLAT, days: null}`), `createRequest(order, product) → {request_id, track_url}` (в off бросает `Error('yd off')`).
- Produces `ext`: `{ tbank: {init, getState, cancel}, mail: {send}, yd: {...} }` — домен вызывает только через `ext.*`; тесты подменяют поля.

- [ ] **Step 1: Тесты (падают)**

`merch-api/test/yd.test.js` (живой вызов тестовой среды Яндекса; при `YD_MODE=off` тесты режима test пропускаются):
```js
require('./_env');
const test = require('node:test'); const assert = require('node:assert');
const yd = require('../lib/yd');

test('off-режим: quote даёт DELIVERY_FLAT', async () => {
  const saved = process.env.YD_MODE; process.env.YD_MODE = 'off'; process.env.DELIVERY_FLAT = '400';
  const q = await yd.quote({ pvz_id: null, weight_g: 300, dims_cm: { x: 30, y: 20, z: 3 }, qty: 1 });
  assert.deepEqual(q, { price_rub: 400, days: null });
  assert.deepEqual(await yd.cities('Мос'), []);
  process.env.YD_MODE = saved;
});

test('test-режим: города → ПВЗ → quote', { skip: process.env.YD_MODE !== 'test' }, async () => {
  const cities = await yd.cities('Москва');
  assert.ok(cities.length > 0 && cities[0].geo_id, JSON.stringify(cities).slice(0, 200));
  const points = await yd.pvz(cities[0].geo_id);
  assert.ok(points.length > 0 && points[0].id && points[0].address, JSON.stringify(points[0]));
  const q = await yd.quote({ pvz_id: points[0].id, weight_g: 300, dims_cm: { x: 30, y: 20, z: 3 }, qty: 1 });
  assert.ok(q.price_rub > 0, JSON.stringify(q));
});
```
`merch-api/test/mail.test.js`:
```js
require('./_env');
const test = require('node:test'); const assert = require('node:assert');
const mail = require('../lib/mail');
const order = { id: 'M-000001', product_title: 'Футболка', size: 'M', qty: 1, total: 1900, price_item: 1500, price_delivery: 400,
  customer_name: 'Тест', customer_phone: '+79990000000', customer_email: process.env.OWNER_EMAIL, address_text: 'Москва, тест', pvz_address: '',
  is_preorder: false, delivery_days: 3, yd_track_url: '' };
test('шаблоны собираются', () => {
  for (const f of ['tplOwnerNewOrder', 'tplCustomerPaid', 'tplCustomerShipped', 'tplCustomerCancelled']) {
    const m = mail[f](order); assert.ok(m.subject.includes('M-000001'), f); assert.ok(m.html.length > 50, f);
  }
});
test('живая отправка владельцу', { skip: !process.env.SMTP_USER }, async () => {
  await mail.send({ to: process.env.OWNER_EMAIL, ...mail.tplOwnerNewOrder(order) });
});
```
Run: `cd merch-api && node --test test/yd.test.js test/mail.test.js` → FAIL (модули не найдены).

- [ ] **Step 2: lib/yd.js**

```js
// Яндекс Доставка «в другой день». Режимы: off (фикс-тариф, без ПВЗ), test (тестовая среда), prod.
const https = require('https');
const ENV = process.env;
const HOSTS = { test: 'b2b.taxi.tst.yandex.net', prod: 'b2b-authproxy.taxi.yandex.net' };
const mode = () => (ENV.YD_MODE === 'test' || ENV.YD_MODE === 'prod') ? ENV.YD_MODE : 'off';

function call(path, body, timeoutMs = 8000) {
  const data = JSON.stringify(body || {});
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: HOSTS[mode()], path: '/api/b2b/platform/' + path, method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Accept-Language': 'ru', Authorization: 'Bearer ' + ENV.YD_TOKEN, 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let s = ''; res.on('data', c => s += c);
      res.on('end', () => {
        let j; try { j = JSON.parse(s || '{}'); } catch (e) { return reject(new Error('yd bad json ' + path + ': ' + s.slice(0, 200))); }
        if (res.statusCode >= 300) return reject(new Error(`yd ${path} ${res.statusCode}: ${s.slice(0, 300)}`));
        resolve(j);
      });
    });
    req.on('timeout', () => req.destroy(new Error('yd timeout ' + path)));
    req.on('error', reject); req.write(data); req.end();
  });
}

async function cities(q) {
  if (mode() === 'off' || !q || q.length < 2) return [];
  const r = await call('location/detect', { location: q });
  return (r.variants || []).slice(0, 8).map(v => ({ geo_id: v.geo_id, name: v.address }));
}

async function pvz(geo_id) {
  if (mode() === 'off') return [];
  const r = await call('pickup-points/list', { geo_id: Number(geo_id), type: 'pickup_point', payment_methods: ['already_paid'] });
  return (r.points || []).map(p => ({
    id: p.id, address: p.address && p.address.full_address, lat: p.position && p.position.latitude, lon: p.position && p.position.longitude,
    schedule: (p.schedule && p.schedule.restrictions || []).map(x => `${x.days.join(',')}: ${x.time_from.hours}:00–${x.time_to.hours}:00`).join('; '),
  }));
}

const place = (dims_cm, weight_g, qty) => ({ physical_dims: { weight_gross: weight_g * qty, dx: dims_cm.x, dy: dims_cm.y, dz: dims_cm.z * qty } });

async function quote({ pvz_id, weight_g, dims_cm, qty }) {
  if (mode() === 'off') return { price_rub: parseInt(ENV.DELIVERY_FLAT || '400', 10), days: null };
  const r = await call('pricing-calculator', {
    source: { platform_station_id: ENV.YD_STATION_ID }, destination: { platform_station_id: pvz_id },
    tariff: 'self_pickup', total_weight: weight_g * qty, payment_method: 'already_paid', places: [place(dims_cm, weight_g, qty)],
  });
  const rub = Math.ceil(parseFloat(String(r.pricing_total || '0').replace(/[^\d.]/g, '')));
  if (!(rub > 0)) throw new Error('yd quote empty: ' + JSON.stringify(r));
  return { price_rub: rub, days: r.delivery_days == null ? null : Number(r.delivery_days) };
}

// Создать заявку после оплаты. order — строка orders, product — строка products (dims_cm/weight_g распарсены).
async function createRequest(order, product) {
  if (mode() === 'off') throw new Error('yd off');
  const barcode = order.id;
  const body = {
    info: { operator_request_id: order.id, comment: 'antiosov.ru' },
    source: { platform_station: { platform_id: ENV.YD_STATION_ID } },
    destination: { type: 'platform_station', platform_station: { platform_id: order.pvz_id } },
    items: [{ count: order.qty, name: `${product.title} ${order.size !== '-' ? order.size : ''}`.trim(), article: `${order.product_id}-${order.size}`,
      billing_details: { unit_price: order.price_item * 100, assessed_unit_price: order.price_item * 100, nds: -1 },
      physical_dims: { dx: product.dims_cm.x, dy: product.dims_cm.y, dz: product.dims_cm.z, weight_gross: product.weight_g }, place_barcode: barcode }],
    places: [{ barcode, ...place(product.dims_cm, product.weight_g, order.qty) }],
    billing_info: { payment_method: 'already_paid' },
    recipient_info: { first_name: order.customer_name, phone: order.customer_phone, email: order.customer_email },
    last_mile_policy: 'self_pickup', particular_items_refuse: false,
  };
  const offers = await call('offers/create', body);
  const offer = (offers.offers || [])[0];
  if (!offer) throw new Error('yd no offers: ' + JSON.stringify(offers).slice(0, 300));
  const c = await call('offers/confirm', { offer_id: offer.offer_id });
  const request_id = c.request_id;
  if (!request_id) throw new Error('yd confirm failed: ' + JSON.stringify(c).slice(0, 300));
  return { request_id, track_url: `https://dostavka.yandex.ru/track/${request_id}`, price: offer.offer_details && offer.offer_details.pricing };
}

module.exports = { mode, cities, pvz, quote, createRequest };
```
Примечание для исполнителя: если тестовая среда возвращает другие имена полей (`variants`, `points`, `pricing_total`) — привести к докам, ссылка в спеке §2.5; `nds: -1` = без НДС (УСН). Формат трек-ссылки уточнить по ответу `request/info` (поле `sharing_url`), если есть — использовать его.

- [ ] **Step 3: lib/mail.js**

```js
// Postbox по SMTP (465, логин = id API-ключа SA со scope yc.postbox.send). Шаблоны — простой HTML.
const nodemailer = require('nodemailer');
const ENV = process.env;
let transport = null;
function getTransport() {
  if (!transport) transport = nodemailer.createTransport({ host: 'postbox.cloud.yandex.net', port: 465, secure: true, auth: { user: ENV.SMTP_USER, pass: ENV.SMTP_PASS }, connectionTimeout: 8000, socketTimeout: 8000 });
  return transport;
}
async function send({ to, subject, text, html }) {
  await getTransport().sendMail({ from: `Антиосов <${ENV.MAIL_FROM || 'shop@antiosov.ru'}>`, to, replyTo: ENV.OWNER_EMAIL, subject, text, html });
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rub = n => `${Number(n).toLocaleString('ru-RU')} ₽`;
const where = o => o.pvz_address ? `Пункт выдачи: ${o.pvz_address}` : `Адрес: ${o.address_text}`;
const item = o => `${o.product_title}${o.size && o.size !== '-' ? ', размер ' + o.size : ''} × ${o.qty}`;
const wrap = (title, lines) => ({
  text: [title, '', ...lines].join('\n'),
  html: `<div style="font-family:Inter,system-ui,sans-serif;font-size:15px;line-height:1.5;color:#0a0a0a;max-width:560px">
<p style="font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:28px;margin:0 0 16px">${esc(title)}</p>
${lines.map(l => `<p style="margin:0 0 8px">${l.startsWith('<') ? l : esc(l)}</p>`).join('\n')}
<p style="margin:24px 0 0;color:#888;font-size:13px;letter-spacing:.2em;text-transform:uppercase">antiosov.ru</p></div>`,
});

function tplOwnerNewOrder(o) {
  const site = ENV.SITE || 'https://antiosov.ru';
  const m = wrap(`Заказ ${o.id}`, [
    item(o), `Сумма: ${rub(o.total)} (товар ${rub(o.price_item * o.qty)} + доставка ${rub(o.price_delivery)})`,
    o.is_preorder ? 'ПРЕДЗАКАЗ' : 'В наличии', `${o.customer_name}, ${o.customer_phone}, ${o.customer_email}`, where(o),
    `<a href="${site}/merch/admin/#order/${o.id}">Открыть в админке</a>`,
  ]);
  return { subject: `Заказ ${o.id} — ${item(o)} — ${rub(o.total)}`, ...m };
}
function tplCustomerPaid(o) {
  const m = wrap('Заказ принят', [
    `Номер заказа: ${o.id}`, item(o), `Оплачено: ${rub(o.total)}`, where(o),
    o.is_preorder ? `Это предзаказ: отправлю до ${o.preorder_ship_by || 'указанной на сайте даты'}.` : (o.delivery_days ? `Срок доставки ~${o.delivery_days} дн. после отправки.` : 'Отправлю в ближайшие дни, напишу трек.'),
    'Вопросы — просто ответьте на это письмо.',
  ]);
  return { subject: `Заказ ${o.id} принят`, ...m };
}
function tplCustomerShipped(o) {
  const m = wrap('Заказ отправлен', [`Номер заказа: ${o.id}`, item(o), where(o),
    o.yd_track_url ? `<a href="${esc(o.yd_track_url)}">Отследить посылку</a>` : (o.admin_note ? `Трек: ${o.admin_note}` : 'Напишу, когда посылка будет в пункте выдачи.')]);
  return { subject: `Заказ ${o.id} отправлен`, ...m };
}
function tplCustomerCancelled(o) {
  const m = wrap('Заказ отменён', [`Номер заказа: ${o.id}`, item(o), `Возврат ${rub(o.total)} придёт на карту в течение 3–10 дней.`, 'Если это ошибка — ответьте на письмо.']);
  return { subject: `Заказ ${o.id} отменён, возврат ${rub(o.total)}`, ...m };
}
function tplOwnerLatePayment(o, paymentId) {
  const m = wrap(`Поздняя оплата ${o.id}`, [`Заказ был в статусе ${o.status}, платёж ${paymentId} подтверждён после срока.`, 'Сделан автоматический возврат через Т-Банк. Проверь в кабинете.', `${o.customer_name}, ${o.customer_phone}, ${o.customer_email}`]);
  return { subject: `Поздняя оплата ${o.id} — возврат`, ...m };
}
module.exports = { send, tplOwnerNewOrder, tplCustomerPaid, tplCustomerShipped, tplCustomerCancelled, tplOwnerLatePayment };
```

- [ ] **Step 4: lib/ext.js**

```js
// Реестр внешних вызовов. Домен (orders.js) обращается только через ext.*, тесты подменяют поля.
const tbank = require('./tbank'); const mail = require('./mail'); const yd = require('./yd');
module.exports = {
  tbank: { init: (...a) => tbank.init(...a), getState: (...a) => tbank.getState(...a), cancel: (...a) => tbank.cancel(...a) },
  mail: { send: (...a) => mail.send(...a) },
  yd: { mode: () => yd.mode(), quote: (...a) => yd.quote(...a), createRequest: (...a) => yd.createRequest(...a), cities: (...a) => yd.cities(...a), pvz: (...a) => yd.pvz(...a) },
};
```

- [ ] **Step 5: Прогнать тесты**

Run: `cd merch-api && node --test test/yd.test.js test/mail.test.js`
Expected: `# pass 4` (или 3 + 1 skipped, если SMTP ещё не настроен — тогда вернуться после Task 6 и убедиться, что письмо реально пришло в почту владельца; проверить папку «Спам»).
Если Postbox отклоняет отправку с неподтверждённого домена — это ожидаемо до Task 6 Step 2; пометить и продолжить.

- [ ] **Step 6: Commit**

```bash
git add merch-api/lib/yd.js merch-api/lib/mail.js merch-api/lib/ext.js merch-api/test/yd.test.js merch-api/test/mail.test.js
git commit -m "merch-api: Yandex Delivery client, Postbox mail, ext registry" && git push origin main
```

---

### Task 4: Домен заказов (orders.js) — резерв, confirmPaid, gc, переходы, отмена с возвратом

**Files:**
- Create: `merch-api/lib/orders.js`, `merch-api/test/orders.test.js`

**Interfaces:**
- Consumes: `lib/ydb` (`query`, `tx`, `V`), `lib/ext`, `lib/util` (`HttpError`, `envInt`, `randomKey`), `lib/mail` шаблоны.
- Produces:
  - `catalog() → [{id,title,price,images:[url],sizes:[],preorder_allowed,preorder_ship_by,variants:[{size,available,preorder_count}]}]` (только `active`)
  - `getProduct(slug, {admin}) → product|null` (распарсенные JSON-поля; `images` → публичные URL в `image_urls`)
  - `createOrder(input) → {id, k, paymentUrl}`; input: `{product_id,size,qty,name,phone,email,address_text?,pvz_id?,pvz_address?,consent:true}`; ошибки `HttpError(400,'validation',{field})`, `HttpError(409,'sold_out')`, `HttpError(404,'no_product')`, `HttpError(502,'payment_init')`.
  - `confirmPaid(orderId, paymentId, amountRub) → {ok, reason}`; при `ok` выполняет побочки. При статусе `expired|cancelled` — `ext.tbank.cancel` + письмо владельцу, `{ok:false, reason:'late_refunded'}`.
  - `gc() → number` (сколько просрочено).
  - `getStatus(id, k) → {id,status,total,is_preorder,preorder_ship_by}|null`
  - `getPayUrl(id, k) → url|null` (только `new`)
  - `transition(id, to, {note}) → order` — `paid→packed`, `packed→shipped` (письмо), `shipped→done`; `HttpError(409,'bad_transition')`.
  - `cancel(id) → order` — из `new` (снять резерв), из `paid|packed` (`ext.tbank.cancel`, счётчики, письмо).
  - `retryYd(id) → order`.
  - `listOrders({status}) → [orders]` (свежие сверху), `getOrder(id) → order` (с `product_title`), `setNote(id, note)`.
  - Внутренний `loadOrderWithProduct(run|null, id)`.

- [ ] **Step 1: Тесты (падают)** — интеграционные против тестовой БД, внешние вызовы подменены.

`merch-api/test/orders.test.js`:
```js
require('./_env');
const test = require('node:test'); const assert = require('node:assert');
const db = require('../lib/ydb'); const ext = require('../lib/ext');
const orders = require('../lib/orders');

// Подмены внешних сервисов
const calls = { init: [], cancel: [], mail: [], yd: [] };
ext.tbank.init = async a => { calls.init.push(a); return { paymentId: 'P' + calls.init.length, paymentUrl: 'https://pay.test/' + a.orderId }; };
ext.tbank.cancel = async pid => { calls.cancel.push(pid); return { Success: true, Status: 'REFUNDED' }; };
ext.mail.send = async m => { calls.mail.push(m); };
ext.yd.quote = async () => ({ price_rub: 300, days: 3 });
ext.yd.mode = () => 'test';
ext.yd.createRequest = async o => { calls.yd.push(o.id); return { request_id: 'R' + o.id, track_url: 'https://t/' + o.id }; };

const P = 'test-tee';
async function seed(stock) {
  await db.query(`DECLARE $p AS Utf8; DELETE FROM variants WHERE product_id = $p; DELETE FROM products WHERE id = $p;`, { $p: db.V.s(P) });
  await db.query(`DECLARE $p AS Utf8; UPSERT INTO products (id, title, description_md, price, images, weight_g, dims_cm, sizes, preorder_allowed, preorder_ship_by, active, sort, updated_at)
    VALUES ($p, 'Тест-футболка', 'md', 1500, '[]', 300, '{"x":30,"y":20,"z":3}', '["M","L"]', true, '2026-10-15', true, 1, CurrentUtcTimestamp());`, { $p: db.V.s(P) });
  await db.query(`DECLARE $p AS Utf8; DECLARE $st AS Int32;
    UPSERT INTO variants (product_id, size, stock, reserved, preorder_count) VALUES ($p, 'M', $st, 0, 0), ($p, 'L', 0, 0, 0);`, { $p: db.V.s(P), $st: db.V.i(stock) });
}
const input = (over = {}) => ({ product_id: P, size: 'M', qty: 1, name: 'Тест Тестов', phone: '89990000000', email: 'buyer@example.com', pvz_id: 'PVZ1', pvz_address: 'Москва, пункт 1', consent: true, ...over });

test('createOrder: резерв, Init, номер и ключ', async () => {
  await seed(2);
  const r = await orders.createOrder(input());
  assert.match(r.id, /^M-\d{6}$/); assert.equal(r.k.length, 16); assert.ok(r.paymentUrl.includes(r.id));
  const [[v]] = await db.query(`DECLARE $p AS Utf8; SELECT reserved FROM variants WHERE product_id=$p AND size='M';`, { $p: db.V.s(P) });
  assert.equal(v.reserved, 1);
  const st = await orders.getStatus(r.id, r.k); assert.equal(st.status, 'new'); assert.equal(st.total, 1800);
  assert.equal(await orders.getStatus(r.id, 'wrongkey'), null);
  assert.equal(calls.init.at(-1).amountRub, 1800);
});

test('гонка: последняя единица — один из двух получает 409', async () => {
  await seed(1);
  const rs = await Promise.allSettled([orders.createOrder(input()), orders.createOrder(input())]);
  const ok = rs.filter(r => r.status === 'fulfilled'), bad = rs.filter(r => r.status === 'rejected');
  assert.equal(ok.length, 1); assert.equal(bad.length, 1); assert.equal(bad[0].reason.error, 'sold_out');
});

test('confirmPaid: идемпотентен, списывает, шлёт 2 письма и заявку', async () => {
  await seed(3); calls.mail.length = 0; calls.yd.length = 0;
  const r = await orders.createOrder(input({ qty: 2 }));
  const rs = await Promise.all([orders.confirmPaid(r.id, 'P1', 3300), orders.confirmPaid(r.id, 'P1', 3300)]);
  assert.equal(rs.filter(x => x.ok).length, 1);
  const [[v]] = await db.query(`DECLARE $p AS Utf8; SELECT stock, reserved FROM variants WHERE product_id=$p AND size='M';`, { $p: db.V.s(P) });
  assert.deepEqual([v.stock, v.reserved], [1, 0]);
  assert.equal(calls.mail.length, 2); assert.deepEqual(calls.yd, [r.id]);
  const o = await orders.getOrder(r.id); assert.equal(o.status, 'paid'); assert.equal(o.yd_request_id, 'R' + r.id);
});

test('confirmPaid: неверная сумма → не оплачен', async () => {
  await seed(1); const r = await orders.createOrder(input());
  const x = await orders.confirmPaid(r.id, 'P9', 1);
  assert.equal(x.ok, false); assert.equal((await orders.getOrder(r.id)).status, 'new');
});

test('предзаказ: без резерва, при оплате растёт preorder_count', async () => {
  await seed(1); calls.init.length = 0;
  const r = await orders.createOrder(input({ size: 'L', qty: 2 }));
  assert.equal(calls.init.at(-1).receiptItems[0].method, 'full_prepayment');
  let [[v]] = await db.query(`DECLARE $p AS Utf8; SELECT reserved, preorder_count FROM variants WHERE product_id=$p AND size='L';`, { $p: db.V.s(P) });
  assert.deepEqual([v.reserved, v.preorder_count], [0, 0]);
  await orders.confirmPaid(r.id, 'P2', 3300);
  [[v]] = await db.query(`DECLARE $p AS Utf8; SELECT preorder_count FROM variants WHERE product_id=$p AND size='L';`, { $p: db.V.s(P) });
  assert.equal(v.preorder_count, 2);
  assert.equal((await orders.getStatus(r.id, r.k)).is_preorder, true);
});

test('gc: просроченный new → expired, резерв снят', async () => {
  await seed(1); const r = await orders.createOrder(input());
  await db.query(`DECLARE $id AS Utf8; UPDATE orders SET created_at = CurrentUtcTimestamp() - Interval("PT30M") WHERE id = $id;`, { $id: db.V.s(r.id) });
  assert.equal(await orders.gc(), 1);
  const [[v]] = await db.query(`DECLARE $p AS Utf8; SELECT reserved FROM variants WHERE product_id=$p AND size='M';`, { $p: db.V.s(P) });
  assert.equal(v.reserved, 0);
  assert.equal(await orders.gc(), 0);
});

test('поздняя оплата expired → возврат и письмо владельцу', async () => {
  await seed(1); const r = await orders.createOrder(input()); calls.cancel.length = 0; calls.mail.length = 0;
  await db.query(`DECLARE $id AS Utf8; UPDATE orders SET status = 'expired' WHERE id = $id;`, { $id: db.V.s(r.id) });
  const x = await orders.confirmPaid(r.id, 'P7', 1800);
  assert.equal(x.reason, 'late_refunded'); assert.deepEqual(calls.cancel, ['P7']); assert.equal(calls.mail.length, 1);
});

test('переходы и отмена с возвратом', async () => {
  await seed(2); const r = await orders.createOrder(input());
  await orders.confirmPaid(r.id, 'P3', 1800);
  await assert.rejects(orders.transition(r.id, 'shipped'), e => e.error === 'bad_transition');
  await orders.transition(r.id, 'packed'); calls.mail.length = 0;
  await orders.transition(r.id, 'shipped'); assert.equal(calls.mail.length, 1);
  await assert.rejects(orders.cancel(r.id), e => e.error === 'bad_transition'); // из shipped нельзя
  const r2 = await orders.createOrder(input()); await orders.confirmPaid(r2.id, 'P4', 1800); calls.cancel.length = 0;
  const o = await orders.cancel(r2.id); assert.equal(o.status, 'cancelled'); assert.deepEqual(calls.cancel, ['P4']);
  const [[v]] = await db.query(`DECLARE $p AS Utf8; SELECT stock, reserved FROM variants WHERE product_id=$p AND size='M';`, { $p: db.V.s(P) });
  assert.deepEqual([v.stock, v.reserved], [0, 0]); // 2 − 1 (shipped) − 1 (cancelled после оплаты: на склад не возвращается автоматически)
});

test('catalog: available и предзаказ', async () => {
  await seed(1);
  const c = (await orders.catalog()).find(p => p.id === P);
  assert.deepEqual(c.variants.map(v => [v.size, v.available]), [['M', 1], ['L', 0]]);
});
```
Run: `cd merch-api && node --test test/orders.test.js` → FAIL (`../lib/orders` не найден).

- [ ] **Step 2: lib/orders.js**

```js
// Домен заказов. Все изменения состояния — условные UPDATE в serializable-транзакциях (db.tx).
const db = require('./ydb'); const ext = require('./ext'); const mail = require('./mail'); const s3 = require('./s3');
const { HttpError, envInt, randomKey, validPhone, validEmail, validName } = require('./util');
const ENV = process.env;
const QTY_MAX = 5;

const parseProduct = p => p && ({ ...p, images: JSON.parse(p.images || '[]'), dims_cm: JSON.parse(p.dims_cm || '{}'), sizes: JSON.parse(p.sizes || '[]') });
const withUrls = p => p && ({ ...p, image_urls: p.images.map(k => s3.publicUrl(k)) });

// ---------- каталог ----------
async function catalog() {
  const [ps, vs] = await db.query(`SELECT * FROM products WHERE active = true ORDER BY sort, id; SELECT * FROM variants;`);
  const byP = {}; for (const v of vs) (byP[v.product_id] = byP[v.product_id] || []).push({ size: v.size, available: Math.max(0, v.stock - v.reserved), preorder_count: v.preorder_count });
  return ps.map(parseProduct).map(withUrls).map(p => ({ id: p.id, title: p.title, price: p.price, image_urls: p.image_urls, sizes: p.sizes,
    preorder_allowed: p.preorder_allowed, preorder_ship_by: p.preorder_ship_by, variants: (byP[p.id] || []).sort((a, b) => p.sizes.indexOf(a.size) - p.sizes.indexOf(b.size)) }));
}
async function getProduct(id, { admin = false } = {}) {
  const [[p], vs] = await db.query(`DECLARE $id AS Utf8; SELECT * FROM products WHERE id = $id; SELECT * FROM variants WHERE product_id = $id;`, { $id: db.V.s(id) });
  if (!p || (!admin && !p.active)) return null;
  const prod = withUrls(parseProduct(p));
  prod.variants = vs.map(v => ({ size: v.size, stock: v.stock, reserved: v.reserved, available: Math.max(0, v.stock - v.reserved), preorder_count: v.preorder_count }))
    .sort((a, b) => prod.sizes.indexOf(a.size) - prod.sizes.indexOf(b.size));
  return prod;
}

// ---------- создание заказа ----------
function validate(i) {
  const bad = f => { throw new HttpError(400, 'validation', { field: f }); };
  const name = validName(i.name) || bad('name'); const phone = validPhone(i.phone) || bad('phone'); const email = validEmail(i.email) || bad('email');
  const qty = parseInt(i.qty, 10); if (!(qty >= 1 && qty <= QTY_MAX)) bad('qty');
  if (i.consent !== true && i.consent !== 'true') bad('consent');
  const size = String(i.size || '-');
  const off = ext.yd.mode() === 'off';
  const address_text = off ? String(i.address_text || '').trim() : ''; if (off && address_text.length < 10) bad('address_text');
  const pvz_id = off ? '' : String(i.pvz_id || ''); if (!off && !pvz_id) bad('pvz_id');
  return { name, phone, email, qty, size, address_text, pvz_id, pvz_address: off ? '' : String(i.pvz_address || '').slice(0, 300) };
}

async function createOrder(input) {
  await gc();
  const v = validate(input);
  const product = await getProduct(String(input.product_id || ''));
  if (!product) throw new HttpError(404, 'no_product');
  if (!(product.sizes.length ? product.sizes.includes(v.size) : v.size === '-')) throw new HttpError(400, 'validation', { field: 'size' });
  const delivery = await ext.yd.quote({ pvz_id: v.pvz_id, weight_g: product.weight_g, dims_cm: product.dims_cm, qty: v.qty });
  const price_delivery = delivery.price_rub, total = product.price * v.qty + price_delivery;
  const k = randomKey();

  const { id, is_preorder } = await db.tx(async run => {
    const [[var_]] = await run(`DECLARE $p AS Utf8; DECLARE $s AS Utf8; SELECT stock, reserved, preorder_count FROM variants WHERE product_id = $p AND size = $s;`, { $p: db.V.s(product.id), $s: db.V.s(v.size) });
    if (!var_) throw new HttpError(404, 'no_variant');
    const available = var_.stock - var_.reserved;
    let is_preorder = false;
    if (available >= v.qty) {
      await run(`DECLARE $p AS Utf8; DECLARE $s AS Utf8; DECLARE $q AS Int32; UPDATE variants SET reserved = reserved + $q WHERE product_id = $p AND size = $s;`, { $p: db.V.s(product.id), $s: db.V.s(v.size), $q: db.V.i(v.qty) });
    } else if (available <= 0 && product.preorder_allowed && var_.preorder_count + v.qty <= envInt('PREORDER_MAX', 20)) {
      is_preorder = true;
    } else throw new HttpError(409, 'sold_out');
    const [[c]] = await run(`SELECT value FROM counters WHERE name = 'order';`);
    const n = (c ? c.value : 0) + 1;
    await run(`DECLARE $n AS Int32; UPSERT INTO counters (name, value) VALUES ('order', $n);`, { $n: db.V.i(n) });
    const id = 'M-' + String(n).padStart(6, '0');
    await run(`DECLARE $id AS Utf8; DECLARE $k AS Utf8; DECLARE $p AS Utf8; DECLARE $s AS Utf8; DECLARE $q AS Int32; DECLARE $pre AS Bool;
      DECLARE $pi AS Int32; DECLARE $pd AS Int32; DECLARE $t AS Int32; DECLARE $n AS Utf8; DECLARE $ph AS Utf8; DECLARE $e AS Utf8;
      DECLARE $addr AS Utf8; DECLARE $pvz AS Utf8; DECLARE $pvza AS Utf8; DECLARE $dm AS Utf8; DECLARE $ydenv AS Utf8; DECLARE $days AS Int32;
      UPSERT INTO orders (id, k, created_at, updated_at, status, product_id, size, qty, is_preorder, price_item, price_delivery, total,
        customer_name, customer_phone, customer_email, address_text, pvz_id, pvz_address, delivery_mode, yd_env, delivery_days,
        yd_request_id, yd_track_url, yd_error, tb_payment_id, tb_payment_url, tb_refund_id, mail_error, consent_at, admin_note)
      VALUES ($id, $k, CurrentUtcTimestamp(), CurrentUtcTimestamp(), 'new', $p, $s, $q, $pre, $pi, $pd, $t, $n, $ph, $e, $addr, $pvz, $pvza, $dm, $ydenv, $days,
        '', '', '', '', '', '', '', CurrentUtcTimestamp(), '');`,
      { $id: db.V.s(id), $k: db.V.s(k), $p: db.V.s(product.id), $s: db.V.s(v.size), $q: db.V.i(v.qty), $pre: db.V.b(is_preorder), $pi: db.V.i(product.price), $pd: db.V.i(price_delivery), $t: db.V.i(total),
        $n: db.V.s(v.name), $ph: db.V.s(v.phone), $e: db.V.s(v.email), $addr: db.V.s(v.address_text), $pvz: db.V.s(v.pvz_id), $pvza: db.V.s(v.pvz_address),
        $dm: db.V.s(ext.yd.mode() === 'off' ? 'flat' : 'yandex'), $ydenv: db.V.s(ext.yd.mode()), $days: db.V.i(delivery.days || 0) });
    return { id, is_preorder };
  });

  const due = new Date(Date.now() + envInt('RESERVE_MIN', 20) * 60000);
  const itemName = `${product.title}${v.size !== '-' ? ' ' + v.size : ''}`;
  let pay;
  try {
    pay = await ext.tbank.init({
      orderId: id, amountRub: total, description: `Заказ ${id}: ${itemName} × ${v.qty}`, email: v.email, dueDate: due,
      receiptItems: [{ name: itemName, price_rub: product.price, qty: v.qty, object: 'commodity', method: is_preorder ? 'full_prepayment' : 'full_payment' },
        ...(price_delivery > 0 ? [{ name: 'Доставка', price_rub: price_delivery, qty: 1, object: 'service', method: 'full_payment' }] : [])],
      successUrl: `${ENV.SELF_URL}?a=success&id=${id}&k=${k}`, failUrl: `${ENV.SITE}/merch/order/?id=${id}&k=${k}&fail=1`, notifyUrl: `${ENV.SELF_URL}?a=notify`,
    });
  } catch (e) {
    console.error('init failed', id, e.message);
    await releaseNew(id, 'cancelled');
    throw new HttpError(502, 'payment_init');
  }
  await db.query(`DECLARE $id AS Utf8; DECLARE $pid AS Utf8; DECLARE $url AS Utf8; UPDATE orders SET tb_payment_id = $pid, tb_payment_url = $url, updated_at = CurrentUtcTimestamp() WHERE id = $id;`,
    { $id: db.V.s(id), $pid: db.V.s(pay.paymentId), $url: db.V.s(pay.paymentUrl) });
  return { id, k, paymentUrl: pay.paymentUrl };
}

// new → expired|cancelled с возвратом резерва (одна транзакция). Возвращает true, если перевёл.
async function releaseNew(id, to) {
  return db.tx(async run => {
    const [[o]] = await run(`DECLARE $id AS Utf8; SELECT status, product_id, size, qty, is_preorder FROM orders WHERE id = $id;`, { $id: db.V.s(id) });
    if (!o || o.status !== 'new') return false;
    await run(`DECLARE $id AS Utf8; DECLARE $to AS Utf8; UPDATE orders SET status = $to, updated_at = CurrentUtcTimestamp() WHERE id = $id AND status = 'new';`, { $id: db.V.s(id), $to: db.V.s(to) });
    if (!o.is_preorder) await run(`DECLARE $p AS Utf8; DECLARE $s AS Utf8; DECLARE $q AS Int32; UPDATE variants SET reserved = reserved - $q WHERE product_id = $p AND size = $s;`, { $p: db.V.s(o.product_id), $s: db.V.s(o.size), $q: db.V.i(o.qty) });
    return true;
  });
}

async function gc() {
  const cutoff = new Date(Date.now() - envInt('RESERVE_MIN', 20) * 60000);
  const [rows] = await db.query(`DECLARE $c AS Timestamp; SELECT id FROM orders VIEW by_status WHERE status = 'new' AND created_at < $c LIMIT 100;`, { $c: db.V.ts(cutoff) });
  let n = 0; for (const r of rows) if (await releaseNew(r.id, 'expired')) n++;
  return n;
}

// ---------- оплата ----------
async function loadOrderWithProduct(id) {
  const [[o]] = await db.query(`DECLARE $id AS Utf8; SELECT * FROM orders WHERE id = $id;`, { $id: db.V.s(id) });
  if (!o) return null;
  const product = await getProduct(o.product_id, { admin: true });
  return { ...o, product_title: product ? product.title : o.product_id, preorder_ship_by: product ? product.preorder_ship_by : '', product };
}

async function confirmPaid(orderId, paymentId, amountRub) {
  const r = await db.tx(async run => {
    const [[o]] = await run(`DECLARE $id AS Utf8; SELECT status, total, product_id, size, qty, is_preorder, tb_payment_id FROM orders WHERE id = $id;`, { $id: db.V.s(orderId) });
    if (!o) return { ok: false, reason: 'no_order' };
    if (o.status !== 'new') return { ok: false, reason: o.status };
    if (Number(amountRub) !== o.total) { console.warn('amount mismatch', orderId, amountRub, o.total); return { ok: false, reason: 'amount' }; }
    await run(`DECLARE $id AS Utf8; DECLARE $pid AS Utf8; UPDATE orders SET status = 'paid', tb_payment_id = $pid, updated_at = CurrentUtcTimestamp() WHERE id = $id AND status = 'new';`, { $id: db.V.s(orderId), $pid: db.V.s(paymentId) });
    const P = { $p: db.V.s(o.product_id), $s: db.V.s(o.size), $q: db.V.i(o.qty) };
    if (o.is_preorder) await run(`DECLARE $p AS Utf8; DECLARE $s AS Utf8; DECLARE $q AS Int32; UPDATE variants SET preorder_count = preorder_count + $q WHERE product_id = $p AND size = $s;`, P);
    else await run(`DECLARE $p AS Utf8; DECLARE $s AS Utf8; DECLARE $q AS Int32; UPDATE variants SET stock = stock - $q, reserved = reserved - $q WHERE product_id = $p AND size = $s;`, P);
    return { ok: true };
  });
  if (!r.ok) {
    if (r.reason === 'expired' || r.reason === 'cancelled') {
      try { await ext.tbank.cancel(paymentId); } catch (e) { console.error('late refund failed', orderId, e.message); }
      const o = await loadOrderWithProduct(orderId);
      try { await ext.mail.send({ to: ENV.OWNER_EMAIL, ...mail.tplOwnerLatePayment(o, paymentId) }); } catch (e) { console.error('mail', e.message); }
      return { ok: false, reason: 'late_refunded' };
    }
    return r;
  }
  await afterPaid(orderId);
  return { ok: true };
}

async function setField(id, field, value) {
  await db.query(`DECLARE $id AS Utf8; DECLARE $v AS Utf8; UPDATE orders SET ${field} = $v, updated_at = CurrentUtcTimestamp() WHERE id = $id;`, { $id: db.V.s(id), $v: db.V.s(value) });
}

async function afterPaid(id) {
  const o = await loadOrderWithProduct(id);
  const errs = [];
  try { await ext.mail.send({ to: ENV.OWNER_EMAIL, ...mail.tplOwnerNewOrder(o) }); } catch (e) { errs.push('owner:' + e.message); }
  try { await ext.mail.send({ to: o.customer_email, ...mail.tplCustomerPaid(o) }); } catch (e) { errs.push('customer:' + e.message); }
  if (errs.length) await setField(id, 'mail_error', errs.join(' | ').slice(0, 500));
  if (o.delivery_mode === 'yandex') await createYd(o);
}

async function createYd(o) {
  try {
    const r = await ext.yd.createRequest(o, o.product);
    await db.query(`DECLARE $id AS Utf8; DECLARE $r AS Utf8; DECLARE $t AS Utf8; UPDATE orders SET yd_request_id = $r, yd_track_url = $t, yd_error = '', updated_at = CurrentUtcTimestamp() WHERE id = $id;`, { $id: db.V.s(o.id), $r: db.V.s(r.request_id), $t: db.V.s(r.track_url || '') });
  } catch (e) { console.error('yd', o.id, e.message); await setField(o.id, 'yd_error', String(e.message).slice(0, 500)); }
}

// ---------- публичные чтения ----------
async function getStatus(id, k) {
  const [[o]] = await db.query(`DECLARE $id AS Utf8; SELECT k, status, total, is_preorder, product_id FROM orders WHERE id = $id;`, { $id: db.V.s(id) });
  if (!o || !k || o.k !== k) return null;
  const p = await getProduct(o.product_id, { admin: true });
  return { id, status: o.status, total: o.total, is_preorder: o.is_preorder, preorder_ship_by: p ? p.preorder_ship_by : '' };
}
async function getPayUrl(id, k) {
  const [[o]] = await db.query(`DECLARE $id AS Utf8; SELECT k, status, tb_payment_url FROM orders WHERE id = $id;`, { $id: db.V.s(id) });
  return (o && o.k === k && o.status === 'new' && o.tb_payment_url) ? o.tb_payment_url : null;
}

// ---------- админ ----------
const NEXT = { paid: 'packed', packed: 'shipped', shipped: 'done' };
async function transition(id, to) {
  const o = await db.tx(async run => {
    const [[o]] = await run(`DECLARE $id AS Utf8; SELECT status, product_id, size, qty, is_preorder FROM orders WHERE id = $id;`, { $id: db.V.s(id) });
    if (!o || NEXT[o.status] !== to) throw new HttpError(409, 'bad_transition', { from: o && o.status, to });
    await run(`DECLARE $id AS Utf8; DECLARE $from AS Utf8; DECLARE $to AS Utf8; UPDATE orders SET status = $to, updated_at = CurrentUtcTimestamp() WHERE id = $id AND status = $from;`, { $id: db.V.s(id), $from: db.V.s(o.status), $to: db.V.s(to) });
    if (to === 'shipped' && o.is_preorder) await run(`DECLARE $p AS Utf8; DECLARE $s AS Utf8; DECLARE $q AS Int32; UPDATE variants SET preorder_count = preorder_count - $q WHERE product_id = $p AND size = $s;`, { $p: db.V.s(o.product_id), $s: db.V.s(o.size), $q: db.V.i(o.qty) });
    return o;
  });
  const full = await loadOrderWithProduct(id);
  if (to === 'shipped') { try { await ext.mail.send({ to: full.customer_email, ...mail.tplCustomerShipped(full) }); } catch (e) { await setField(id, 'mail_error', 'shipped:' + e.message); } }
  return full;
}

async function cancel(id) {
  const cur = await loadOrderWithProduct(id);
  if (!cur) throw new HttpError(404, 'no_order');
  if (cur.status === 'new') { await releaseNew(id, 'cancelled'); return loadOrderWithProduct(id); }
  if (cur.status !== 'paid' && cur.status !== 'packed') throw new HttpError(409, 'bad_transition', { from: cur.status, to: 'cancelled' });
  const res = await ext.tbank.cancel(cur.tb_payment_id);
  if (!res || res.Success === false) throw new HttpError(502, 'refund_failed', { tb: res });
  await db.tx(async run => {
    const [[o]] = await run(`DECLARE $id AS Utf8; SELECT status FROM orders WHERE id = $id;`, { $id: db.V.s(id) });
    if (o.status !== 'paid' && o.status !== 'packed') throw new HttpError(409, 'bad_transition');
    await run(`DECLARE $id AS Utf8; DECLARE $from AS Utf8; DECLARE $r AS Utf8; UPDATE orders SET status = 'cancelled', tb_refund_id = $r, updated_at = CurrentUtcTimestamp() WHERE id = $id AND status = $from;`, { $id: db.V.s(id), $from: db.V.s(o.status), $r: db.V.s(String(res.PaymentId || cur.tb_payment_id)) });
    if (cur.is_preorder) await run(`DECLARE $p AS Utf8; DECLARE $s AS Utf8; DECLARE $q AS Int32; UPDATE variants SET preorder_count = preorder_count - $q WHERE product_id = $p AND size = $s;`, { $p: db.V.s(cur.product_id), $s: db.V.s(cur.size), $q: db.V.i(cur.qty) });
  });
  const full = await loadOrderWithProduct(id);
  try { await ext.mail.send({ to: full.customer_email, ...mail.tplCustomerCancelled(full) }); } catch (e) { await setField(id, 'mail_error', 'cancelled:' + e.message); }
  return full;
}

async function retryYd(id) { const o = await loadOrderWithProduct(id); if (!o) throw new HttpError(404, 'no_order'); await createYd(o); return loadOrderWithProduct(id); }
async function setNote(id, note) { await setField(id, 'admin_note', String(note || '').slice(0, 1000)); return loadOrderWithProduct(id); }
async function listOrders({ status } = {}) {
  const [rows, ps] = status
    ? await db.query(`DECLARE $st AS Utf8; SELECT * FROM orders VIEW by_status WHERE status = $st; SELECT id, title FROM products;`, { $st: db.V.s(status) })
    : await db.query(`SELECT * FROM orders; SELECT id, title FROM products;`);
  const titles = Object.fromEntries(ps.map(p => [p.id, p.title]));
  return rows.sort((a, b) => b.created_at - a.created_at).map(o => ({ ...o, product_title: titles[o.product_id] || o.product_id }));
}
const getOrder = loadOrderWithProduct;

module.exports = { catalog, getProduct, createOrder, confirmPaid, gc, getStatus, getPayUrl, transition, cancel, retryYd, setNote, listOrders, getOrder, QTY_MAX };
```

- [ ] **Step 3: Прогнать**

Run: `cd merch-api && node --test test/orders.test.js`
Expected: `# pass 9`. Типичные проблемы: `Interval("PT30M")` в YQL — верно; `created_at` из YDB приходит `Date`; `ORDER BY` с несколькими result set в одном запросе допустим. Если тест гонки нестабилен — проверить, что `tx()` действительно ретраит `ABORTED` (класс ошибки `Aborted` из `ydb-sdk`; при необходимости расширить `isRetryable` проверкой `e.constructor.name === 'Aborted'`).

- [ ] **Step 4: Commit**

```bash
git add merch-api/lib/orders.js merch-api/test/orders.test.js
git commit -m "merch-api: orders domain (reserve, confirmPaid, gc, transitions, refund)" && git push origin main
```

---

### Task 5: HTTP-роутер (index.js) и админ-маршруты (admin.js)

**Files:**
- Create: `merch-api/index.js`, `merch-api/lib/admin.js`, `merch-api/test/handler.test.js`

**Interfaces:**
- Consumes: всё из Task 2–4.
- Produces: `module.exports.handler(event)` — контракт API из спеки §2.1. Заголовок админки: `Authorization: Bearer <jwt>`. Тело POST — JSON (или base64 JSON при `isBase64Encoded`).
- `admin.js` экспортирует `route(a, method, body, q, auth) → Promise<response>`; маршруты: `admin/login`, `admin/summary`, `admin/orders`, `admin/order` (GET `id`; POST `{id, action:'next'|'cancel'|'retry_yd'|'note', note}`), `admin/products` (GET), `admin/product` (GET `id`; POST полный объект товара + `variants:[{size,stock}]`), `admin/photo` (POST `{product_id, content_type}` → `{key, put_url, public_url}`; DELETE `{key}`).

- [ ] **Step 1: Тест роутера (падает)**

`merch-api/test/handler.test.js`:
```js
require('./_env');
const test = require('node:test'); const assert = require('node:assert');
const ext = require('../lib/ext'); const db = require('../lib/ydb'); const { tbToken } = require('../lib/tbank');
ext.tbank.init = async a => ({ paymentId: 'PH1', paymentUrl: 'https://pay.test/' + a.orderId });
ext.tbank.getState = async () => ({ Success: true, Status: 'CONFIRMED' });
ext.tbank.cancel = async () => ({ Success: true });
ext.mail.send = async () => {}; ext.yd.mode = () => 'off'; ext.yd.quote = async () => ({ price_rub: 400, days: null }); ext.yd.createRequest = async () => ({ request_id: 'x', track_url: '' });
const { handler } = require('../index');
const ev = (a, { method = 'GET', body, q = {}, headers = {} } = {}) => ({ httpMethod: method, queryStringParameters: { a, ...q }, headers, body: body ? JSON.stringify(body) : undefined, isBase64Encoded: false });
const P = 'test-h';
test.before(async () => {
  await db.query(`DECLARE $p AS Utf8; DELETE FROM variants WHERE product_id = $p; UPSERT INTO products (id, title, description_md, price, images, weight_g, dims_cm, sizes, preorder_allowed, preorder_ship_by, active, sort, updated_at)
    VALUES ($p, 'H', '', 100, '[]', 100, '{"x":1,"y":1,"z":1}', '[]', false, '', true, 1, CurrentUtcTimestamp());
    UPSERT INTO variants (product_id, size, stock, reserved, preorder_count) VALUES ($p, '-', 5, 0, 0);`, { $p: db.V.s(P) });
});
test('OPTIONS → 204 с CORS', async () => { const r = await handler({ httpMethod: 'OPTIONS', queryStringParameters: {} }); assert.equal(r.statusCode, 204); assert.ok(r.headers['Access-Control-Allow-Headers'].includes('Authorization')); });
test('catalog', async () => { const r = await handler(ev('catalog')); assert.equal(r.statusCode, 200); assert.ok(JSON.parse(r.body).products.some(p => p.id === P)); });
test('order → notify → status', async () => {
  const body = { product_id: P, size: '-', qty: 1, name: 'Иван Иванов', phone: '+79990000001', email: 'a@b.ru', address_text: 'Москва, ул. Тестовая, 1', consent: true };
  let r = await handler(ev('order', { method: 'POST', body })); assert.equal(r.statusCode, 200, r.body);
  const { id, k, paymentUrl } = JSON.parse(r.body); assert.ok(paymentUrl);
  r = await handler(ev('status', { q: { id, k } })); assert.equal(JSON.parse(r.body).status, 'new');
  r = await handler(ev('pay', { q: { id, k } })); assert.equal(r.statusCode, 302);
  const n = { TerminalKey: process.env.TB_TERMINAL, OrderId: id, PaymentId: 'PH1', Status: 'CONFIRMED', Amount: 50000, Success: true };
  r = await handler(ev('notify', { method: 'POST', body: { ...n, Token: 'bad' } })); assert.equal(r.statusCode, 403);
  r = await handler(ev('notify', { method: 'POST', body: { ...n, Token: tbToken(n) } })); assert.equal(r.body, 'OK');
  r = await handler(ev('status', { q: { id, k } })); assert.equal(JSON.parse(r.body).status, 'paid');
});
test('validation 400 with field', async () => {
  const r = await handler(ev('order', { method: 'POST', body: { product_id: P, qty: 1, name: 'x', phone: '1', email: 'a', consent: true } }));
  assert.equal(r.statusCode, 400); assert.equal(JSON.parse(r.body).field, 'name');
});
test('admin: login, orders, product upsert', async () => {
  let r = await handler(ev('admin/login', { method: 'POST', body: { password: 'wrong' } })); assert.equal(r.statusCode, 401);
  r = await handler(ev('admin/login', { method: 'POST', body: { password: process.env.ADMIN_PASSWORD } })); const { token } = JSON.parse(r.body); assert.ok(token);
  const H = { Authorization: 'Bearer ' + token };
  r = await handler(ev('admin/orders', { headers: H })); assert.equal(r.statusCode, 200); assert.ok(Array.isArray(JSON.parse(r.body).orders));
  r = await handler(ev('admin/orders')); assert.equal(r.statusCode, 401);
  r = await handler(ev('admin/product', { method: 'POST', headers: H, body: { id: 'test-h2', title: 'H2', description_md: '', price: 200, images: [], weight_g: 100, dims_cm: { x: 1, y: 1, z: 1 }, sizes: ['S'], preorder_allowed: false, preorder_ship_by: '', active: false, sort: 2, variants: [{ size: 'S', stock: 3 }] } }));
  assert.equal(r.statusCode, 200, r.body);
  r = await handler(ev('admin/product', { headers: H, q: { id: 'test-h2' } })); assert.equal(JSON.parse(r.body).product.variants[0].stock, 3);
  r = await handler(ev('admin/photo', { method: 'POST', headers: H, body: { product_id: 'test-h2', content_type: 'image/jpeg' } }));
  const ph = JSON.parse(r.body); assert.ok(ph.put_url.includes('X-Amz-Signature')); assert.ok(ph.key.startsWith('p/test-h2/'));
});
```
Run: `cd merch-api && node --test test/handler.test.js` → FAIL.

- [ ] **Step 2: index.js**

```js
// merch-api — Yandex Cloud Function (Node.js 18), HTTP-триггер. Маршрут в ?a=, тело — JSON.
const orders = require('./lib/orders'); const ext = require('./lib/ext'); const admin = require('./lib/admin');
const { tbToken } = require('./lib/tbank');
const { json, text, redirect, HttpError, cors } = require('./lib/util');
const ENV = process.env;

const parseBody = ev => {
  if (!ev.body) return {};
  const raw = ev.isBase64Encoded ? Buffer.from(ev.body, 'base64').toString() : ev.body;
  try { return JSON.parse(raw); } catch (e) { throw new HttpError(400, 'bad_json'); }
};
const rawBody = ev => ev.isBase64Encoded ? Buffer.from(ev.body || '', 'base64').toString() : (ev.body || '');
const header = (ev, name) => { const h = ev.headers || {}; const k = Object.keys(h).find(x => x.toLowerCase() === name); return k ? h[k] : ''; };

async function notify(ev) {
  let body; try { body = JSON.parse(rawBody(ev) || '{}'); } catch (e) { return text(400, 'bad json'); }
  const { Token, ...rest } = body;
  if (!Token || Token !== tbToken(rest)) { console.warn('bad notify token'); return text(403, 'bad token'); }
  if (rest.TerminalKey !== ENV.TB_TERMINAL) return text(403, 'bad terminal');
  console.log('notify', rest.Status, rest.OrderId, rest.PaymentId, rest.Amount);
  if (rest.Status === 'CONFIRMED') {
    const r = await orders.confirmPaid(String(rest.OrderId), String(rest.PaymentId), Number(rest.Amount) / 100);
    console.log('confirmPaid', rest.OrderId, JSON.stringify(r));
  }
  return text(200, 'OK');
}

async function success(q) {
  const id = String(q.id || ''), k = String(q.k || '');
  const back = `${ENV.SITE}/merch/order/?id=${encodeURIComponent(id)}&k=${encodeURIComponent(k)}`;
  const st = await orders.getStatus(id, k);
  if (!st) return redirect(`${ENV.SITE}/merch/`);
  if (st.status === 'new' && q.PaymentId) {
    const s = await ext.tbank.getState(String(q.PaymentId));
    if (s && s.Success && s.Status === 'CONFIRMED') await orders.confirmPaid(id, String(q.PaymentId), Number(s.Amount) / 100 || st.total);
  }
  return redirect(back);
}

module.exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const method = (event.httpMethod || 'GET').toUpperCase();
  if (method === 'OPTIONS') return { statusCode: 204, headers: { ...cors(), 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '3600' }, body: '' };
  try {
    const a = String(q.a || '');
    if (a.startsWith('admin/')) return await admin.route(a, method, method === 'GET' ? {} : parseBody(event), q, header(event, 'authorization'));
    switch (a) {
      case 'catalog': { await orders.gc(); return json(200, { products: await orders.catalog(), yd_mode: ext.yd.mode(), delivery_flat: ext.yd.mode() === 'off' ? parseInt(ENV.DELIVERY_FLAT || '400', 10) : null, qty_max: orders.QTY_MAX }); }
      case 'product': { const p = await orders.getProduct(String(q.s || '')); return p ? json(200, { product: p, yd_mode: ext.yd.mode() }) : json(404, { error: 'no_product' }); }
      case 'cities': return json(200, { cities: await ext.yd.cities(String(q.q || '')) });
      case 'pvz': return json(200, { points: await ext.yd.pvz(String(q.geo_id || '')) });
      case 'quote': {
        if (method !== 'POST') return json(405, { error: 'method' });
        const b = parseBody(event); const p = await orders.getProduct(String(b.product_id || ''));
        if (!p) return json(404, { error: 'no_product' });
        const qty = Math.min(Math.max(parseInt(b.qty, 10) || 1, 1), orders.QTY_MAX);
        const d = await ext.yd.quote({ pvz_id: b.pvz_id || null, weight_g: p.weight_g, dims_cm: p.dims_cm, qty });
        return json(200, { price_delivery: d.price_rub, days: d.days, total: p.price * qty + d.price_rub });
      }
      case 'order': { if (method !== 'POST') return json(405, { error: 'method' }); return json(200, await orders.createOrder(parseBody(event))); }
      case 'status': { const s = await orders.getStatus(String(q.id || ''), String(q.k || '')); return s ? json(200, s) : json(404, { error: 'no_order' }); }
      case 'pay': { const u = await orders.getPayUrl(String(q.id || ''), String(q.k || '')); return u ? redirect(u) : redirect(`${ENV.SITE}/merch/order/?id=${encodeURIComponent(q.id || '')}&k=${encodeURIComponent(q.k || '')}`); }
      case 'success': return await success(q);
      case 'notify': return await notify(event);
      default: return json(404, { error: 'not_found' });
    }
  } catch (e) {
    if (e instanceof HttpError) return json(e.code, { error: e.error, ...(e.extra || {}) });
    console.error(e);
    return json(500, { error: 'internal' });
  }
};
```

- [ ] **Step 3: lib/admin.js**

```js
// Админ-маршруты. Доступ по JWT (пароль в ADMIN_PASSWORD, 30 дней).
const crypto = require('crypto');
const db = require('./ydb'); const orders = require('./orders'); const jwt = require('./jwt'); const s3 = require('./s3');
const { json, HttpError } = require('./util');
const ENV = process.env;
const fails = { n: 0, at: 0 }; // rate-limit логина на инстанс: 5 неудач / 10 мин

function login(body) {
  if (fails.n >= 5 && Date.now() - fails.at < 600000) throw new HttpError(429, 'too_many');
  const a = Buffer.from(String(body.password || '')), b = Buffer.from(ENV.ADMIN_PASSWORD || '');
  if (!b.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) { fails.n++; fails.at = Date.now(); throw new HttpError(401, 'bad_password'); }
  fails.n = 0;
  return json(200, { token: jwt.sign({ role: 'admin' }, 30 * 86400) });
}
const requireAuth = auth => { const t = String(auth || '').replace(/^Bearer\s+/i, ''); const p = jwt.verify(t); if (!p || p.role !== 'admin') throw new HttpError(401, 'unauthorized'); };

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
async function upsertProduct(b) {
  const id = String(b.id || ''); if (!SLUG_RE.test(id)) throw new HttpError(400, 'validation', { field: 'id' });
  const title = String(b.title || '').trim(); if (!title) throw new HttpError(400, 'validation', { field: 'title' });
  const price = parseInt(b.price, 10); if (!(price >= 1)) throw new HttpError(400, 'validation', { field: 'price' });
  const sizes = Array.isArray(b.sizes) ? b.sizes.map(s => String(s).trim()).filter(Boolean) : [];
  const dims = b.dims_cm || {}; const dims_cm = { x: +dims.x || 30, y: +dims.y || 20, z: +dims.z || 3 };
  const images = Array.isArray(b.images) ? b.images.map(String) : [];
  await db.query(`DECLARE $id AS Utf8; DECLARE $title AS Utf8; DECLARE $d AS Utf8; DECLARE $price AS Int32; DECLARE $img AS Json; DECLARE $w AS Int32; DECLARE $dims AS Json;
    DECLARE $sizes AS Json; DECLARE $pa AS Bool; DECLARE $psb AS Utf8; DECLARE $active AS Bool; DECLARE $sort AS Int32;
    UPSERT INTO products (id, title, description_md, price, images, weight_g, dims_cm, sizes, preorder_allowed, preorder_ship_by, active, sort, updated_at)
    VALUES ($id, $title, $d, $price, $img, $w, $dims, $sizes, $pa, $psb, $active, $sort, CurrentUtcTimestamp());`,
    { $id: db.V.s(id), $title: db.V.s(title), $d: db.V.s(String(b.description_md || '')), $price: db.V.i(price), $img: db.V.j(images), $w: db.V.i(parseInt(b.weight_g, 10) || 300),
      $dims: db.V.j(dims_cm), $sizes: db.V.j(sizes), $pa: db.V.b(b.preorder_allowed), $psb: db.V.s(String(b.preorder_ship_by || '')), $active: db.V.b(b.active), $sort: db.V.i(parseInt(b.sort, 10) || 0) });
  // Варианты: набор размеров = sizes (или '-'); stock задаётся, reserved/preorder_count сохраняются.
  const want = sizes.length ? sizes : ['-'];
  const stocks = Object.fromEntries((Array.isArray(b.variants) ? b.variants : []).map(v => [String(v.size), Math.max(0, parseInt(v.stock, 10) || 0)]));
  await db.tx(async run => {
    const [have] = await run(`DECLARE $id AS Utf8; SELECT size, stock, reserved, preorder_count FROM variants WHERE product_id = $id;`, { $id: db.V.s(id) });
    for (const h of have) if (!want.includes(h.size)) await run(`DECLARE $id AS Utf8; DECLARE $s AS Utf8; DELETE FROM variants WHERE product_id = $id AND size = $s;`, { $id: db.V.s(id), $s: db.V.s(h.size) });
    for (const s of want) {
      const h = have.find(x => x.size === s);
      await run(`DECLARE $id AS Utf8; DECLARE $s AS Utf8; DECLARE $st AS Int32; DECLARE $r AS Int32; DECLARE $pc AS Int32;
        UPSERT INTO variants (product_id, size, stock, reserved, preorder_count) VALUES ($id, $s, $st, $r, $pc);`,
        { $id: db.V.s(id), $s: db.V.s(s), $st: db.V.i(stocks[s] != null ? stocks[s] : (h ? h.stock : 0)), $r: db.V.i(h ? h.reserved : 0), $pc: db.V.i(h ? h.preorder_count : 0) });
    }
  });
  return orders.getProduct(id, { admin: true });
}

async function route(a, method, body, q, auth) {
  if (a === 'admin/login') { if (method !== 'POST') throw new HttpError(405, 'method'); return login(body); }
  requireAuth(auth);
  switch (a) {
    case 'admin/summary': {
      const [paid, packed, pre] = await Promise.all([orders.listOrders({ status: 'paid' }), orders.listOrders({ status: 'packed' }), orders.listOrders({ status: 'paid' })]);
      return json(200, { to_ship: paid.length + packed.length, preorders: pre.filter(o => o.is_preorder).length, yd_mode: require('./ext').yd.mode() });
    }
    case 'admin/orders': return json(200, { orders: await orders.listOrders({ status: q.status || undefined }) });
    case 'admin/order': {
      if (method === 'GET') { const o = await orders.getOrder(String(q.id || '')); return o ? json(200, { order: o }) : json(404, { error: 'no_order' }); }
      const id = String(body.id || '');
      switch (body.action) {
        case 'next': { const cur = await orders.getOrder(id); if (!cur) throw new HttpError(404, 'no_order'); const to = { paid: 'packed', packed: 'shipped', shipped: 'done' }[cur.status]; if (!to) throw new HttpError(409, 'bad_transition'); return json(200, { order: await orders.transition(id, to) }); }
        case 'cancel': return json(200, { order: await orders.cancel(id) });
        case 'retry_yd': return json(200, { order: await orders.retryYd(id) });
        case 'note': return json(200, { order: await orders.setNote(id, body.note) });
        default: throw new HttpError(400, 'bad_action');
      }
    }
    case 'admin/products': {
      const [ps, vs] = await db.query(`SELECT * FROM products ORDER BY sort, id; SELECT * FROM variants;`);
      return json(200, { products: ps.map(p => ({ ...p, images: JSON.parse(p.images || '[]'), sizes: JSON.parse(p.sizes || '[]'), dims_cm: JSON.parse(p.dims_cm || '{}'),
        variants: vs.filter(v => v.product_id === p.id).map(v => ({ size: v.size, stock: v.stock, reserved: v.reserved, preorder_count: v.preorder_count })) })) });
    }
    case 'admin/product': {
      if (method === 'GET') { const p = await orders.getProduct(String(q.id || ''), { admin: true }); return p ? json(200, { product: p }) : json(404, { error: 'no_product' }); }
      return json(200, { product: await upsertProduct(body) });
    }
    case 'admin/photo': {
      if (method === 'POST') {
        const pid = String(body.product_id || ''); if (!SLUG_RE.test(pid)) throw new HttpError(400, 'validation', { field: 'product_id' });
        const ct = body.content_type === 'image/png' ? 'image/png' : 'image/jpeg';
        const key = `p/${pid}/${crypto.randomBytes(6).toString('hex')}.${ct === 'image/png' ? 'png' : 'jpg'}`;
        return json(200, { key, put_url: s3.presignPut(key, ct, 600), public_url: s3.publicUrl(key), content_type: ct });
      }
      if (method === 'DELETE') { const key = String(body.key || ''); if (!key.startsWith('p/')) throw new HttpError(400, 'validation', { field: 'key' }); await s3.deleteObject(key); return json(200, { ok: true }); }
      throw new HttpError(405, 'method');
    }
    default: return json(404, { error: 'not_found' });
  }
}
module.exports = { route };
```
Логика остатка при апсерте: задан в форме → он; иначе существующий `stock`; иначе 0. `reserved`/`preorder_count` никогда не трогаются из админки.

- [ ] **Step 4: Прогнать все тесты**

Run: `cd merch-api && npm test`
Expected: все `pass`, 0 `fail` (yd/mail live-тесты могут быть `skipped`).

- [ ] **Step 5: Commit**

```bash
git add merch-api/index.js merch-api/lib/admin.js merch-api/test/handler.test.js
git commit -m "merch-api: HTTP router and admin routes" && git push origin main
```

---

### Task 6: Деплой функции, Postbox-домен, smoke-тест на живом URL

**Files:**
- Create: `merch-api/README.md`
- Modify: `merch-api/.deploy.env` (не в git)

- [ ] **Step 1: Postbox — адрес и DNS**

Postbox не в `yc` 1.34. Сначала `~/yandex-cloud/bin/yc components update` и проверить `yc postbox --help`. Если группа появилась:
```bash
~/yandex-cloud/bin/yc postbox identity create --domain antiosov.ru --format json
```
Если нет — через SES-совместимый API статическим ключом SA с ролью `postbox.admin` (выдать: `yc resource-manager folder add-access-binding b1gkm69jqok5o2cpgn0p --role postbox.admin --subject serviceAccount:$SA`), запрос `POST https://postbox.cloud.yandex.net/v2/email/identities` body `{"EmailIdentity":"antiosov.ru"}` с подписью SigV4 (region `ru-central1`, service `ses`) — написать одноразовый скрипт `merch-api/scripts/postbox-identity.js` по образцу `s3.deleteObject` (тот же SigV4, но с JSON-телом и `x-amz-content-sha256` от тела). Ответ содержит `DkimAttributes.Tokens[]` → DNS.
Если и это не выходит — создать адрес в веб-консоли (Postbox → Адреса → Добавить домен) и снять записи оттуда. Записать в README рабочий путь.

Выдать пользователю для RU-CENTER (формат: имя → значение):
- `<token1>._domainkey.antiosov.ru` CNAME `<token1>.dkim.postbox.cloud.yandex.net`
- `<token2>._domainkey.antiosov.ru` CNAME `<token2>.dkim.postbox.cloud.yandex.net`
- `_dmarc.antiosov.ru` TXT `v=DMARC1; p=none; rua=mailto:antiosina@gmail.com`
Проверить после внесения: `dig +short CNAME <token1>._domainkey.antiosov.ru` → значение; статус адреса в Postbox → `SUCCESS`.

- [ ] **Step 2: Деплой**

```bash
cd merch-api && ./deploy.sh
```
Expected: `deployed: https://functions.yandexcloud.net/<id>`. Проверить `.deploy.env`: `SELF_URL` = этот URL (если функция создана в Task 1 — URL известен заранее), `YDB_METADATA_CREDENTIALS=1`, `YD_MODE=off`.
Если облако не установило зависимости (ошибка `Cannot find module 'ydb-sdk'`) — положить `node_modules` в zip: `npm ci --omit=dev && zip -qr merch-api.zip … node_modules`; при >3.5 МБ — выгрузить zip в бакет и `--package-bucket-name/--package-object-name`.

- [ ] **Step 3: Smoke на живом URL**

```bash
U=$(grep '^SELF_URL=' merch-api/.deploy.env | cut -d= -f2-)
curl -s "$U?a=catalog" | head -c 300; echo
curl -s -X OPTIONS -i "$U" | grep -i access-control
curl -s -X POST "$U?a=admin/login" -H 'Content-Type: application/json' -d '{"password":"wrong"}'; echo
~/yandex-cloud/bin/yc serverless function logs merch-api --since 5m | tail -20
```
Expected: `{"products":[],"yd_mode":"off",...}`; CORS-заголовки; `{"error":"bad_password"}`; в логах нет `Error`.
Живая почта: `cd merch-api && node --test test/mail.test.js` с боевыми SMTP-переменными → письмо в ящике владельца (проверить и «Спам»; если в спаме — DNS ещё не прошли).

- [ ] **Step 4: README**

`merch-api/README.md`: назначение, маршруты (таблица из спеки §2.1), env-переменные, как деплоить (`./deploy.sh`), как гонять тесты (`npm test`, нужен свежий `YDB_ACCESS_TOKEN_CREDENTIALS`), миграция (`node migrate.js`), Postbox/DNS, как переключить `YD_MODE` (изменить `.deploy.env` и передеплоить; в prod задать `YD_TOKEN`, `YD_STATION_ID`), ресурсы облака с id.

- [ ] **Step 5: Commit**

```bash
git add merch-api/README.md merch-api/scripts 2>/dev/null; git commit -m "merch-api: deploy, README" && git push origin main
```

---

### Task 7: Витрина — каталог, карточка с формой, страница заказа, политика ПД

**Files:**
- Create: `merch/merch.css`, `merch/api.js`, `merch/p/index.html`, `merch/order/index.html`, `merch/privacy/index.html`
- Modify: `merch/index.html` (заменить заглушку списком товаров), `sitemap.xml` (добавить `/merch/p/`, `/merch/privacy/`)

**Interfaces:**
- Consumes API из Task 5: `catalog`, `product&s=`, `cities&q=`, `pvz&geo_id=`, `quote` (POST), `order` (POST), `status&id=&k=`, `pay&id=&k=`.
- Produces `window.MERCH_API` (URL функции) и `api(a, {method, body, q}) → Promise<json>` в `merch/api.js`; общие стили `.btn`, `.field`, `.sizes`, `.grid`, `.card`, `.notice` в `merch/merch.css`.
- `reveal.js` наблюдает только элементы, существующие при загрузке; для динамики использовать `showAll()` из `api.js` — добавляет `.in` всем `.r`.

- [ ] **Step 1: merch/api.js и merch/merch.css**

`merch/api.js`:
```js
// Адрес функции merch-api (без секретов). Подставить http_invoke_url из Task 1.
window.MERCH_API = 'https://functions.yandexcloud.net/REPLACE_WITH_FUNCTION_ID';
window.api = async function (a, { method = 'GET', body, q = {}, token } = {}) {
  const u = new URL(window.MERCH_API); u.searchParams.set('a', a); for (const k in q) if (q[k] != null) u.searchParams.set(k, q[k]);
  const headers = {}; if (body) headers['Content-Type'] = 'application/json'; if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(u, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({ error: 'bad_json' }));
  if (!r.ok) { const e = new Error(j.error || 'error'); e.code = r.status; e.data = j; throw e; }
  return j;
};
window.showAll = function () { document.querySelectorAll('.r:not(.in)').forEach(el => el.classList.add('in')); };
window.rub = n => Number(n).toLocaleString('ru-RU') + ' ₽';
window.esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
```
Значение `REPLACE_WITH_FUNCTION_ID` заменить реальным id функции сразу (он известен после Task 1).

`merch/merch.css` (дополняет стили страниц; тон — как на сайте):
```css
:root { --bg:#fff; --ink:#0a0a0a; --dim:#888; --line:#e6e6e6; --serif:'Cormorant Garamond','Times New Roman',Georgia,serif; --sans:'Inter',system-ui,-apple-system,sans-serif; }
*{box-sizing:border-box} html,body{margin:0;background:var(--bg);color:var(--ink)} body{font-family:var(--sans);-webkit-font-smoothing:antialiased}
main{max-width:1040px;margin:0 auto;padding:48px 24px 80px}
.name{margin:0 0 16px;font-size:13px;letter-spacing:.45em;text-indent:.45em;text-transform:uppercase;text-align:center} .name a{color:inherit;text-decoration:none}
h1{margin:0 0 48px;font-family:var(--serif);font-style:italic;font-weight:300;font-size:clamp(40px,6.5vw,88px);line-height:1;letter-spacing:-.01em;text-align:center}
h2{margin:0 0 8px;font-family:var(--serif);font-style:italic;font-weight:400;font-size:34px;line-height:1.05}
.meta{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--dim)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:40px 28px}
.card{display:block;color:inherit;text-decoration:none;text-align:center}
.card .ph{aspect-ratio:4/5;background:#f4f4f4;overflow:hidden;margin-bottom:14px} .card img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .4s ease} .card:hover img{transform:scale(1.02)}
.card .t{font-family:var(--serif);font-style:italic;font-size:26px;line-height:1.05} .card .p{margin-top:6px;font-size:13px;letter-spacing:.1em} .card.out{opacity:.45}
.product{display:grid;grid-template-columns:1.1fr 1fr;gap:48px;align-items:start} @media(max-width:760px){.product{grid-template-columns:1fr;gap:28px}}
.gallery{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch} .gallery img{flex:0 0 100%;scroll-snap-align:start;aspect-ratio:4/5;object-fit:cover;background:#f4f4f4}
.desc{font-size:15px;line-height:1.6;margin:16px 0 24px} .desc p{margin:0 0 10px}
.price{font-size:20px;letter-spacing:.06em;margin:4px 0 20px}
.sizes{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 18px} .sizes button{min-width:48px;height:40px;padding:0 12px;border:1px solid var(--ink);background:#fff;font:inherit;font-size:13px;letter-spacing:.1em;cursor:pointer}
.sizes button.on{background:var(--ink);color:#fff} .sizes button.out{border-color:var(--line);color:#bbb;text-decoration:line-through;cursor:not-allowed} .sizes button.pre{border-style:dashed}
.qty{display:inline-flex;border:1px solid var(--ink);margin-bottom:18px} .qty button{width:40px;height:40px;border:0;background:#fff;font-size:18px;cursor:pointer} .qty span{width:44px;line-height:40px;text-align:center;font-size:14px}
.field{display:block;margin:0 0 14px} .field span{display:block;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--dim);margin-bottom:6px}
.field input,.field textarea,.field select{width:100%;height:44px;padding:0 12px;border:1px solid var(--line);font:inherit;font-size:15px;background:#fff;outline:none} .field textarea{height:auto;padding:10px 12px;min-height:72px} .field input:focus,.field textarea:focus{border-color:var(--ink)} .field.err input,.field.err textarea{border-color:#c33}
.check{display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.4;color:#444;margin:8px 0 18px} .check input{margin-top:2px} .check a{color:inherit}
.btn{display:inline-block;width:100%;height:52px;line-height:52px;text-align:center;background:var(--ink);color:#fff;border:0;font:inherit;font-size:13px;letter-spacing:.25em;text-transform:uppercase;cursor:pointer;text-decoration:none} .btn[disabled]{background:#bbb;cursor:not-allowed} .btn.ghost{background:#fff;color:var(--ink);border:1px solid var(--ink)}
.sum{display:flex;justify-content:space-between;font-size:14px;margin:6px 0} .sum.total{font-size:18px;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
.notice{font-size:13px;color:#444;padding:12px 14px;background:#f6f6f6;margin:12px 0} .notice.err{background:#fdecec;color:#7a1c1c}
.pvz{max-height:260px;overflow:auto;border:1px solid var(--line);margin-bottom:14px} .pvz label{display:block;padding:10px 12px;border-bottom:1px solid var(--line);font-size:13px;line-height:1.4;cursor:pointer} .pvz label:hover{background:#fafafa} .pvz input{margin-right:8px} .pvz small{color:var(--dim)}
.suggest{position:relative} .suggest ul{position:absolute;left:0;right:0;top:100%;z-index:5;margin:0;padding:0;list-style:none;background:#fff;border:1px solid var(--line);border-top:0;max-height:200px;overflow:auto} .suggest li{padding:8px 12px;font-size:14px;cursor:pointer} .suggest li:hover{background:#fafafa}
footer{display:flex;justify-content:center;gap:24px;padding:48px 24px 0} footer a{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--dim);text-decoration:none} footer a:hover{color:var(--ink)}
.center{text-align:center;max-width:560px;margin:0 auto} .center p{font-size:16px;line-height:1.6}
```

- [ ] **Step 2: merch/index.html — каталог**

Сохранить `<head>` текущего файла (мета, OG, шрифты, Метрика), заменить `<style>` на `<link rel="stylesheet" href="merch.css">` + `<link rel="stylesheet" href="../assets/reveal.css">`, OG-описание → «Вещи, которые можно носить.» Тело:
```html
<body>
  <main>
    <p class="name r" style="--i:0"><a href="/">Дмитрий Антиосов</a></p>
    <h1 class="r" style="--i:1">Мерч</h1>
    <div id="grid" class="grid"></div>
    <p id="empty" class="meta r" style="--i:2;text-align:center;display:none">пока пусто — скоро</p>
    <footer class="r" style="--i:3"><a href="/">← на главную</a><a href="/merch/privacy/">персональные данные</a></footer>
  </main>
  <script src="api.js"></script>
  <script>
    (async () => {
      try {
        const { products } = await api('catalog');
        const g = document.getElementById('grid');
        if (!products.length) document.getElementById('empty').style.display = '';
        g.innerHTML = products.map((p, i) => {
          const avail = p.variants.some(v => v.available > 0), pre = !avail && p.preorder_allowed;
          return `<a class="card r ${avail || pre ? '' : 'out'}" style="--i:${i + 2}" href="/merch/p/?s=${encodeURIComponent(p.id)}">
            <div class="ph">${p.image_urls[0] ? `<img src="${esc(p.image_urls[0])}" alt="${esc(p.title)}" loading="lazy">` : ''}</div>
            <div class="t">${esc(p.title)}</div>
            <div class="p">${rub(p.price)}${pre ? ' · <span class="meta">предзаказ</span>' : (avail ? '' : ' · <span class="meta">нет в наличии</span>')}</div></a>`;
        }).join('');
      } catch (e) { document.getElementById('empty').textContent = 'магазин временно недоступен'; document.getElementById('empty').style.display = ''; }
      showAll();
    })();
  </script>
  <script src="../assets/reveal.js"></script>
</body>
```

- [ ] **Step 3: merch/p/index.html — карточка и форма**

`<head>`: как у каталога (пути `../merch.css`, `../../assets/reveal.css`, favicon `../../assets/favicon.svg`, Метрика), `<title>Мерч — Дмитрий Антиосов</title>`, `<meta name="robots" content="noindex">` (страница динамическая, OG нет — принято в спеке).
```html
<body>
<main>
  <p class="name r in"><a href="/">Дмитрий Антиосов</a></p>
  <div id="root"><p class="meta" style="text-align:center">загружаю…</p></div>
  <footer><a href="/merch/">← все вещи</a><a href="/merch/privacy/">персональные данные</a></footer>
</main>
<script src="../api.js"></script>
<script>
(async () => {
  const root = document.getElementById('root');
  const slug = new URLSearchParams(location.search).get('s') || '';
  let P, ydMode;
  try { const r = await api('product', { q: { s: slug } }); P = r.product; ydMode = r.yd_mode; }
  catch (e) { root.innerHTML = '<p class="center">Нет такой вещи. <a href="/merch/">Все вещи</a></p>'; return; }
  document.title = P.title + ' — Мерч — Дмитрий Антиосов';
  const S = { size: null, qty: 1, pvz: null, geo: null, quote: null, busy: false };
  const md = s => esc(s).split(/\n{2,}/).map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('');
  const variant = () => P.variants.find(v => v.size === (P.sizes.length ? S.size : '-'));
  const isPre = () => { const v = variant(); return !!v && v.available <= 0 && P.preorder_allowed; };
  const maxQty = () => { const v = variant(); return !v ? 0 : (isPre() ? 5 : Math.min(5, v.available)); };

  root.innerHTML = `<div class="product">
    <div class="gallery">${P.image_urls.map(u => `<img src="${esc(u)}" alt="${esc(P.title)}">`).join('') || '<img alt="">'}</div>
    <div>
      <h2>${esc(P.title)}</h2><div class="price">${rub(P.price)}</div>
      <div class="desc">${md(P.description_md)}</div>
      ${P.sizes.length ? `<div class="meta">Размер</div><div class="sizes" id="sizes"></div>` : ''}
      <div class="meta">Количество</div><div class="qty"><button type="button" id="minus">−</button><span id="qty">1</span><button type="button" id="plus">+</button></div>
      <div id="preNote" class="notice" style="display:none"></div>
      <form id="f" novalidate>
        <label class="field" data-f="name"><span>Имя</span><input name="name" autocomplete="name" required></label>
        <label class="field" data-f="phone"><span>Телефон</span><input name="phone" type="tel" autocomplete="tel" required></label>
        <label class="field" data-f="email"><span>E-mail</span><input name="email" type="email" autocomplete="email" required></label>
        ${ydMode === 'off'
          ? `<label class="field" data-f="address_text"><span>Адрес доставки</span><textarea name="address_text" placeholder="Город, улица, дом, квартира, индекс" required></textarea></label>`
          : `<label class="field suggest" data-f="city"><span>Город</span><input name="city" autocomplete="off" placeholder="начните вводить"><ul id="cities" style="display:none"></ul></label>
             <div class="meta" id="pvzTitle" style="display:none">Пункт выдачи</div><div class="pvz" id="pvz" style="display:none"></div>`}
        <label class="check"><input type="checkbox" name="consent" required> <span>Согласен на обработку персональных данных для исполнения заказа и доставки (<a href="/merch/privacy/" target="_blank">политика</a>)</span></label>
        <div class="sum"><span>Товар</span><span id="sItem"></span></div>
        <div class="sum"><span>Доставка</span><span id="sDel">—</span></div>
        <div class="sum total"><span>Итого</span><span id="sTotal"></span></div>
        <div id="err" class="notice err" style="display:none"></div>
        <button class="btn" id="pay" type="submit" style="margin-top:16px">Оплатить</button>
      </form>
    </div></div>`;
  const $ = s => root.querySelector(s);

  function renderSizes() {
    const el = $('#sizes'); if (!el) return;
    el.innerHTML = P.sizes.map(s => { const v = P.variants.find(x => x.size === s) || { available: 0 }; const pre = v.available <= 0 && P.preorder_allowed; const out = v.available <= 0 && !P.preorder_allowed;
      return `<button type="button" data-s="${esc(s)}" class="${S.size === s ? 'on' : ''} ${pre ? 'pre' : ''} ${out ? 'out' : ''}" ${out ? 'disabled' : ''}>${esc(s)}</button>`; }).join('');
    el.querySelectorAll('button').forEach(b => b.onclick = () => { S.size = b.dataset.s; S.qty = 1; renderSizes(); renderSum(); });
  }
  async function renderSum() {
    const v = variant(); const pre = isPre(); $('#qty').textContent = S.qty;
    $('#preNote').style.display = pre ? '' : 'none';
    if (pre) $('#preNote').textContent = `Этого размера сейчас нет — предзаказ, отправка до ${P.preorder_ship_by || 'указанной даты'}.`;
    $('#sItem').textContent = rub(P.price * S.qty);
    const canQuote = ydMode === 'off' || S.pvz;
    if (canQuote && v) {
      try { S.quote = await api('quote', { method: 'POST', body: { product_id: P.id, qty: S.qty, pvz_id: S.pvz && S.pvz.id } });
        $('#sDel').textContent = rub(S.quote.price_delivery) + (S.quote.days ? `, ~${S.quote.days} дн.` : ''); $('#sTotal').textContent = rub(S.quote.total);
      } catch (e) { S.quote = null; $('#sDel').textContent = 'не удалось посчитать'; $('#sTotal').textContent = '—'; }
    } else { S.quote = null; $('#sDel').textContent = ydMode === 'off' ? '—' : 'выберите пункт выдачи'; $('#sTotal').textContent = rub(P.price * S.qty); }
    $('#pay').disabled = !v || (!pre && v.available <= 0) || (ydMode !== 'off' && !S.pvz);
    $('#pay').textContent = S.quote ? `Оплатить ${rub(S.quote.total)}` : 'Оплатить';
  }
  $('#minus').onclick = () => { if (S.qty > 1) { S.qty--; renderSum(); } };
  $('#plus').onclick = () => { if (S.qty < maxQty()) { S.qty++; renderSum(); } };

  if (ydMode !== 'off') {
    const cityIn = root.querySelector('[name=city]'), list = $('#cities'); let t;
    cityIn.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
      const q = cityIn.value.trim(); if (q.length < 2) { list.style.display = 'none'; return; }
      const { cities } = await api('cities', { q: { q } });
      list.innerHTML = cities.map(c => `<li data-g="${c.geo_id}">${esc(c.name)}</li>`).join(''); list.style.display = cities.length ? '' : 'none';
      list.querySelectorAll('li').forEach(li => li.onclick = async () => { cityIn.value = li.textContent; list.style.display = 'none'; S.geo = li.dataset.g; S.pvz = null;
        const { points } = await api('pvz', { q: { geo_id: S.geo } });
        $('#pvzTitle').style.display = ''; $('#pvz').style.display = '';
        $('#pvz').innerHTML = points.length ? points.map(p => `<label><input type="radio" name="pvz" value="${esc(p.id)}">${esc(p.address)}<br><small>${esc(p.schedule)}</small></label>`).join('') : '<label>В этом городе пунктов нет</label>';
        $('#pvz').querySelectorAll('input').forEach(r => r.onchange = () => { S.pvz = points.find(p => p.id === r.value); renderSum(); });
        renderSum(); });
    }, 500); };
  }

  $('#f').onsubmit = async e => {
    e.preventDefault(); if (S.busy) return;
    const f = new FormData(e.target); root.querySelectorAll('.field').forEach(x => x.classList.remove('err')); $('#err').style.display = 'none';
    const body = { product_id: P.id, size: P.sizes.length ? S.size : '-', qty: S.qty, name: f.get('name'), phone: f.get('phone'), email: f.get('email'), consent: f.get('consent') === 'on',
      address_text: f.get('address_text') || '', pvz_id: S.pvz && S.pvz.id, pvz_address: S.pvz && S.pvz.address };
    if (!body.consent) { $('#err').textContent = 'Нужно согласие на обработку данных.'; $('#err').style.display = ''; return; }
    S.busy = true; $('#pay').disabled = true; $('#pay').textContent = 'Секунду…';
    try { const r = await api('order', { method: 'POST', body }); location.href = r.paymentUrl; }
    catch (err) {
      S.busy = false; $('#pay').disabled = false; $('#pay').textContent = 'Оплатить';
      const m = { sold_out: 'Этот размер только что разобрали.', validation: 'Проверьте поле: ' + ({ name: 'имя', phone: 'телефон', email: 'e-mail', address_text: 'адрес', pvz_id: 'пункт выдачи', size: 'размер', qty: 'количество', consent: 'согласие' }[err.data && err.data.field] || ''), payment_init: 'Платёжная система не отвечает, попробуйте через минуту.' }[err.message] || 'Что-то пошло не так, попробуйте ещё раз.';
      if (err.data && err.data.field) { const fl = root.querySelector(`.field[data-f="${err.data.field}"]`); if (fl) fl.classList.add('err'); }
      if (err.message === 'sold_out') { const r = await api('product', { q: { s: slug } }); P = r.product; renderSizes(); }
      $('#err').textContent = m; $('#err').style.display = '';
    }
  };
  renderSizes(); renderSum(); showAll();
})();
</script>
<script src="../../assets/reveal.js"></script>
</body>
```

- [ ] **Step 4: merch/order/index.html — статус после оплаты**

`<head>` как у карточки (`noindex`). Тело:
```html
<body><main><p class="name r in"><a href="/">Дмитрий Антиосов</a></p>
<div class="center" id="root"><p class="meta">проверяю оплату…</p></div>
<footer><a href="/merch/">← все вещи</a></footer></main>
<script src="../api.js"></script>
<script>
(async () => {
  const q = new URLSearchParams(location.search), id = q.get('id'), k = q.get('k'), root = document.getElementById('root');
  if (!id || !k) { root.innerHTML = '<p>Заказ не найден.</p>'; return; }
  const payUrl = `${MERCH_API}?a=pay&id=${encodeURIComponent(id)}&k=${encodeURIComponent(k)}`;
  const render = s => {
    const t = { paid: ['Спасибо', `Заказ <b>${esc(id)}</b> оплачен. Письмо с подтверждением ушло на почту.${s.is_preorder ? `<br>Это предзаказ — отправлю до ${esc(s.preorder_ship_by || 'указанной даты')}.` : ''}`],
      packed: ['Собираю', `Заказ <b>${esc(id)}</b> собран и скоро отправится.`], shipped: ['В пути', `Заказ <b>${esc(id)}</b> отправлен — трек в письме.`], done: ['Получен', `Заказ <b>${esc(id)}</b> выполнен. Спасибо.`],
      new: ['Ждём оплату', `Заказ <b>${esc(id)}</b> ещё не оплачен.${q.get('fail') ? ' Оплата не прошла.' : ''}<br><br><a class="btn" href="${payUrl}">Вернуться к оплате</a><br><span class="meta">ссылка действует 20 минут</span>`],
      expired: ['Время вышло', `Заказ <b>${esc(id)}</b> не был оплачен за 20 минут, резерв снят. <a href="/merch/">Оформить заново</a>.`], cancelled: ['Отменён', `Заказ <b>${esc(id)}</b> отменён. Если была оплата — деньги вернутся на карту.`] }[s.status] || ['Заказ', esc(s.status)];
    root.innerHTML = `<h1 style="margin-bottom:24px">${t[0]}</h1><p>${t[1]}</p>`;
  };
  let tries = 0;
  const poll = async () => {
    try { const s = await api('status', { q: { id, k } }); render(s); if (s.status === 'new' && tries++ < 20) setTimeout(poll, 3000); }
    catch (e) { root.innerHTML = '<p>Заказ не найден.</p>'; }
  };
  poll();
})();
</script></body>
```

- [ ] **Step 5: merch/privacy/index.html — политика ПД**

Статический текст в стиле сайта (`h1` «Персональные данные», абзацы `.center`): оператор — ИП (ФИО и ИНН — из реквизитов Т-Банка, спросить у владельца при сдаче, до этого — «ИП Антиосов Д.»), какие данные (имя, телефон, e-mail, адрес/ПВЗ), цели (исполнение заказа, доставка, чек), кому передаются (Т-Банк — оплата и чек, Яндекс Доставка — доставка, Yandex Cloud — хранение), срок хранения 3 года, право на удаление — письмом на e-mail владельца, cookies — Яндекс Метрика. Ссылка «← назад».

- [ ] **Step 6: Локальная проверка в браузере**

```bash
cd /Users/imac/Documents/новый/projects/Antiosov && python3 -m http.server 5500 >/dev/null 2>&1 &
open http://localhost:5500/merch/
```
Для локальной работы CORS: `DEV_ORIGIN=http://localhost:5500` в `.deploy.env`; в `lib/util.js` добавить модульную переменную `let reqOrigin = ''` и `setOrigin(o){ reqOrigin = o || '' }`, а `cors()` возвращать `reqOrigin` если `reqOrigin === ENV.DEV_ORIGIN`, иначе `ENV.SITE`. В `index.js` первой строкой handler: `setOrigin(header(event, 'origin'))`. Экспортировать `setOrigin` из util.
Проверить: каталог рендерится (после добавления тестового товара в Task 8 — вернуться), карточка открывается по `?s=`, несуществующий slug → «Нет такой вещи».

- [ ] **Step 7: sitemap и commit**

В `sitemap.xml` добавить `<url><loc>https://antiosov.ru/merch/privacy/</loc></url>`.
```bash
git add merch sitemap.xml merch-api/lib/util.js merch-api/index.js
git commit -m "merch: storefront — catalog, product page with order form, order status, privacy" && git push origin main
```
Проверить через 1–2 минуты: `curl -s -o /dev/null -w '%{http_code}\n' https://antiosov.ru/merch/p/` → `200`.

---

### Task 8: Мини-CRM `/merch/admin/`

**Files:**
- Create: `merch/admin/index.html`, `merch/admin/admin.js`

**Interfaces:**
- Consumes админ-API из Task 5, `window.api` с `token`.
- Хэш-роутинг: `#orders`, `#orders/paid`, `#order/M-000001`, `#products`, `#product/<slug>`, `#product/new`.

- [ ] **Step 1: index.html**

`<head>`: `noindex,nofollow`, шрифты, `../merch.css`, `<title>Админка — мерч</title>`, без Метрики. Дополнительные стили inline:
```css
.tabs{display:flex;gap:20px;justify-content:center;margin:0 0 28px} .tabs a{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--dim);text-decoration:none} .tabs a.on{color:var(--ink)}
table{width:100%;border-collapse:collapse;font-size:14px} td,th{padding:10px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top} th{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--dim);font-weight:400} tr.row{cursor:pointer} tr.row:hover{background:#fafafa}
.badge{font-size:11px;letter-spacing:.15em;text-transform:uppercase;padding:2px 6px;border:1px solid var(--line)} .badge.paid{border-color:#0a0a0a} .badge.pre{border-style:dashed}
.kv{display:grid;grid-template-columns:140px 1fr;gap:6px 12px;font-size:14px;margin:16px 0} .kv b{font-weight:400;color:var(--dim);font-size:11px;letter-spacing:.2em;text-transform:uppercase;padding-top:3px}
.row-actions{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0} .row-actions .btn{width:auto;padding:0 20px}
.thumbs{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0} .thumbs div{position:relative;width:96px;height:120px;background:#f4f4f4} .thumbs img{width:100%;height:100%;object-fit:cover} .thumbs button{position:absolute;top:2px;right:2px;border:0;background:#fff;cursor:pointer;font-size:12px;padding:2px 6px}
.stock{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px} .stock label span{font-size:12px} .stock input{width:100%;height:40px;border:1px solid var(--line);padding:0 10px;font:inherit}
.summary{display:flex;gap:28px;justify-content:center;margin-bottom:24px;font-size:14px}
```
Тело: `<main><p class="name">Админка</p><div id="app"></div></main><script src="../api.js"></script><script src="admin.js"></script>`.

- [ ] **Step 2: admin.js**

```js
(() => {
  const app = document.getElementById('app');
  const tokKey = 'merchAdminToken';
  let token = null; try { token = localStorage.getItem(tokKey); } catch (e) {}
  const A = (a, o = {}) => api(a, { ...o, token });
  const ST = { new: 'новый', paid: 'оплачен', packed: 'собран', shipped: 'отправлен', done: 'выполнен', cancelled: 'отменён', expired: 'просрочен' };
  const NEXT = { paid: 'Собран', packed: 'Отправлен', shipped: 'Выполнен' };
  const d = s => new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const badge = o => `<span class="badge ${o.status}">${ST[o.status] || o.status}</span>${o.is_preorder ? ' <span class="badge pre">предзаказ</span>' : ''}`;
  const item = o => `${esc(o.product_title)}${o.size && o.size !== '-' ? ' ' + esc(o.size) : ''} × ${o.qty}`;
  const fail = e => { if (e.code === 401) { token = null; try { localStorage.removeItem(tokKey); } catch (_) {} route(); } else alert('Ошибка: ' + (e.data && e.data.error || e.message)); };

  function login() {
    app.innerHTML = `<form id="lf" class="center" style="max-width:320px"><label class="field"><span>Пароль</span><input type="password" name="p" autofocus></label><button class="btn">Войти</button></form>`;
    app.querySelector('#lf').onsubmit = async e => { e.preventDefault(); try { const r = await api('admin/login', { method: 'POST', body: { password: e.target.p.value } }); token = r.token; try { localStorage.setItem(tokKey, token); } catch (_) {} location.hash = '#orders'; route(); } catch (err) { alert(err.message === 'too_many' ? 'Слишком много попыток, подожди 10 минут' : 'Неверный пароль'); } };
  }
  const tabs = cur => `<div class="tabs"><a href="#orders" class="${cur === 'orders' ? 'on' : ''}">Заказы</a><a href="#products" class="${cur === 'products' ? 'on' : ''}">Товары</a><a href="#" id="logout">Выйти</a></div>`;
  const bindLogout = () => { const l = document.getElementById('logout'); if (l) l.onclick = e => { e.preventDefault(); token = null; try { localStorage.removeItem(tokKey); } catch (_) {} route(); }; };

  async function orders(status) {
    const [{ orders }, s] = await Promise.all([A('admin/orders', { q: { status } }), A('admin/summary')]);
    const filters = ['', 'paid', 'packed', 'shipped', 'done', 'new', 'cancelled', 'expired'];
    app.innerHTML = tabs('orders') + `<div class="summary"><span>К отправке: <b>${s.to_ship}</b></span><span>Предзаказов: <b>${s.preorders}</b></span><span class="meta">доставка: ${s.yd_mode}</span></div>
      <div class="tabs">${filters.map(f => `<a href="#orders${f ? '/' + f : ''}" class="${(status || '') === f ? 'on' : ''}">${f ? ST[f] : 'все'}</a>`).join('')}</div>
      <table><tr><th>№</th><th>Дата</th><th>Что</th><th>Кто</th><th>Сумма</th><th>Статус</th></tr>
      ${orders.map(o => `<tr class="row" data-id="${o.id}"><td>${o.id}</td><td>${d(o.created_at)}</td><td>${item(o)}</td><td>${esc(o.customer_name)}</td><td>${rub(o.total)}</td><td>${badge(o)}</td></tr>`).join('') || '<tr><td colspan="6" class="meta">пусто</td></tr>'}</table>`;
    app.querySelectorAll('tr.row').forEach(r => r.onclick = () => location.hash = '#order/' + r.dataset.id); bindLogout();
  }

  async function order(id) {
    const { order: o } = await A('admin/order', { q: { id } });
    app.innerHTML = tabs('orders') + `<p class="meta"><a href="#orders" style="color:inherit;text-decoration:none">← заказы</a></p><h2>${o.id} ${badge(o)}</h2>
      <div class="kv"><b>Создан</b><span>${d(o.created_at)}</span><b>Товар</b><span>${item(o)} — ${rub(o.price_item)} × ${o.qty}</span><b>Доставка</b><span>${rub(o.price_delivery)} (${o.delivery_mode}${o.delivery_days ? ', ~' + o.delivery_days + ' дн.' : ''})</span><b>Итого</b><span>${rub(o.total)}</span>
      <b>Покупатель</b><span>${esc(o.customer_name)}<br><a href="tel:${esc(o.customer_phone)}">${esc(o.customer_phone)}</a> · <a href="mailto:${esc(o.customer_email)}">${esc(o.customer_email)}</a></span>
      <b>Куда</b><span>${esc(o.pvz_address || o.address_text)}</span>
      <b>Яндекс</b><span>${o.yd_request_id ? `заявка ${esc(o.yd_request_id)} ${o.yd_track_url ? `· <a href="${esc(o.yd_track_url)}" target="_blank">трек</a>` : ''}` : (o.delivery_mode === 'yandex' ? '<span class="badge">заявка не создана</span>' : 'вручную')}${o.yd_error ? `<br><small style="color:#7a1c1c">${esc(o.yd_error)}</small>` : ''}</span>
      <b>Платёж</b><span>${esc(o.tb_payment_id || '—')}${o.tb_refund_id ? ' · возврат ' + esc(o.tb_refund_id) : ''}${o.mail_error ? `<br><small style="color:#7a1c1c">почта: ${esc(o.mail_error)}</small>` : ''}</span></div>
      <div class="row-actions">${NEXT[o.status] ? `<button class="btn" data-act="next">→ ${NEXT[o.status]}</button>` : ''}
        ${['new', 'paid', 'packed'].includes(o.status) ? `<button class="btn ghost" data-act="cancel">Отменить${o.status !== 'new' ? ' и вернуть деньги' : ''}</button>` : ''}
        ${o.delivery_mode === 'yandex' && !o.yd_request_id && ['paid', 'packed'].includes(o.status) ? `<button class="btn ghost" data-act="retry_yd">Создать заявку Яндекс</button>` : ''}</div>
      <label class="field"><span>Заметка (при статусе «отправлен» без заявки Яндекса уходит покупателю как трек)</span><textarea id="note">${esc(o.admin_note)}</textarea></label><button class="btn ghost" id="saveNote" style="width:auto;padding:0 20px">Сохранить заметку</button>`;
    app.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
      if (b.dataset.act === 'cancel' && !confirm(o.status === 'new' ? 'Отменить заказ?' : `Отменить и вернуть ${rub(o.total)} покупателю?`)) return;
      b.disabled = true; try { await A('admin/order', { method: 'POST', body: { id, action: b.dataset.act } }); order(id); } catch (e) { fail(e); b.disabled = false; } });
    app.querySelector('#saveNote').onclick = async () => { try { await A('admin/order', { method: 'POST', body: { id, action: 'note', note: app.querySelector('#note').value } }); order(id); } catch (e) { fail(e); } };
    bindLogout();
  }

  async function products() {
    const { products } = await A('admin/products');
    app.innerHTML = tabs('products') + `<p style="text-align:center"><a class="btn" href="#product/new" style="width:auto;padding:0 24px">+ Добавить товар</a></p>
      <table><tr><th>Товар</th><th>Цена</th><th>Остатки (доступно / резерв / предзаказ)</th><th>Показ</th></tr>
      ${products.map(p => `<tr class="row" data-id="${p.id}"><td>${esc(p.title)}<br><small class="meta">${p.id}</small></td><td>${rub(p.price)}</td><td>${p.variants.map(v => `${v.size !== '-' ? v.size + ': ' : ''}${v.stock - v.reserved}/${v.reserved}/${v.preorder_count}`).join(' · ')}</td><td>${p.active ? 'да' : 'нет'}</td></tr>`).join('')}</table>`;
    app.querySelectorAll('tr.row').forEach(r => r.onclick = () => location.hash = '#product/' + r.dataset.id); bindLogout();
  }

  async function product(id) {
    const isNew = id === 'new';
    const p = isNew ? { id: '', title: '', description_md: '', price: '', images: [], weight_g: 300, dims_cm: { x: 30, y: 20, z: 3 }, sizes: [], preorder_allowed: false, preorder_ship_by: '', active: false, sort: 0, variants: [] }
      : (await A('admin/product', { q: { id } })).product;
    const f = (n, label, v, type = 'text', extra = '') => `<label class="field"><span>${label}</span><input name="${n}" type="${type}" value="${esc(v)}" ${extra}></label>`;
    app.innerHTML = tabs('products') + `<p class="meta"><a href="#products" style="color:inherit;text-decoration:none">← товары</a></p><form id="pf">
      ${f('id', 'Slug (латиница, для адреса страницы)', p.id, 'text', isNew ? '' : 'readonly')}${f('title', 'Название', p.title)}
      <label class="field"><span>Описание (абзацы — пустой строкой)</span><textarea name="description_md" style="min-height:140px">${esc(p.description_md)}</textarea></label>
      ${f('price', 'Цена, ₽', p.price, 'number', 'min="1"')}${f('sizes', 'Размеры через запятую (пусто — без размера)', p.sizes.join(', '))}
      <div class="meta" style="margin-bottom:6px">Остатки по размерам</div><div class="stock" id="stock"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-top:14px">${f('weight_g', 'Вес, г', p.weight_g, 'number')}${f('dx', 'Длина, см', p.dims_cm.x, 'number')}${f('dy', 'Ширина, см', p.dims_cm.y, 'number')}${f('dz', 'Высота, см', p.dims_cm.z, 'number')}</div>
      <label class="check"><input type="checkbox" name="preorder_allowed" ${p.preorder_allowed ? 'checked' : ''}> <span>Разрешить предзаказ, когда размера нет</span></label>${f('preorder_ship_by', 'Предзаказ: отправка до (текст, напр. «15 октября»)', p.preorder_ship_by)}
      <label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> <span>Показывать на сайте</span></label>${f('sort', 'Порядок (меньше — выше)', p.sort, 'number')}
      <div class="meta">Фото (первое — главное; ⇠ ⇢ порядок, × удалить)</div><div class="thumbs" id="thumbs"></div>
      <input type="file" id="file" accept="image/*" multiple ${isNew ? 'disabled title="сначала сохраните товар"' : ''}><p class="meta" id="upl"></p>
      <button class="btn" style="margin-top:20px">Сохранить</button></form>`;
    const form = app.querySelector('#pf');
    const sizesOf = () => form.sizes.value.split(',').map(s => s.trim()).filter(Boolean);
    const renderStock = () => { const want = sizesOf().length ? sizesOf() : ['-']; const cur = Object.fromEntries([...app.querySelectorAll('#stock input')].map(i => [i.dataset.s, i.value]));
      app.querySelector('#stock').innerHTML = want.map(s => { const v = p.variants.find(x => x.size === s); return `<label><span>${s === '-' ? 'штук' : s}</span><input type="number" min="0" data-s="${esc(s)}" value="${cur[s] != null ? cur[s] : (v ? v.stock : 0)}"></label>`; }).join(''); };
    form.sizes.oninput = renderStock; renderStock();
    const renderThumbs = () => { app.querySelector('#thumbs').innerHTML = p.images.map((k, i) => `<div><img src="https://storage.yandexcloud.net/antiosov-merch/${esc(k)}"><button type="button" data-i="${i}" data-m="l">⇠</button><button type="button" data-i="${i}" data-m="r" style="right:28px">⇢</button><button type="button" data-i="${i}" data-m="x" style="top:auto;bottom:2px">×</button></div>`).join('');
      app.querySelectorAll('#thumbs button').forEach(b => b.onclick = async () => { const i = +b.dataset.i; if (b.dataset.m === 'x') { if (!confirm('Удалить фото?')) return; try { await A('admin/photo', { method: 'DELETE', body: { key: p.images[i] } }); } catch (e) { fail(e); return; } p.images.splice(i, 1); }
        if (b.dataset.m === 'l' && i > 0) [p.images[i - 1], p.images[i]] = [p.images[i], p.images[i - 1]]; if (b.dataset.m === 'r' && i < p.images.length - 1) [p.images[i + 1], p.images[i]] = [p.images[i], p.images[i + 1]]; renderThumbs(); }); };
    renderThumbs();
    // Загрузка: сжать до 1600px JPEG через canvas → presigned PUT → ключ в images (сохранится с формой)
    app.querySelector('#file').onchange = async e => {
      for (const file of e.target.files) {
        app.querySelector('#upl').textContent = 'загружаю ' + file.name + '…';
        try {
          const blob = await shrink(file); const { key, put_url, content_type } = await A('admin/photo', { method: 'POST', body: { product_id: p.id, content_type: 'image/jpeg' } });
          const r = await fetch(put_url, { method: 'PUT', headers: { 'Content-Type': content_type }, body: blob }); if (!r.ok) throw new Error('upload ' + r.status);
          p.images.push(key); renderThumbs();
        } catch (err) { alert('Не загрузилось: ' + err.message); }
      }
      app.querySelector('#upl').textContent = 'готово — не забудь «Сохранить»'; e.target.value = '';
    };
    form.onsubmit = async ev => { ev.preventDefault();
      const body = { id: form.id.value.trim(), title: form.title.value, description_md: form.description_md.value, price: +form.price.value, images: p.images, weight_g: +form.weight_g.value,
        dims_cm: { x: +form.dx.value, y: +form.dy.value, z: +form.dz.value }, sizes: sizesOf(), preorder_allowed: form.preorder_allowed.checked, preorder_ship_by: form.preorder_ship_by.value, active: form.active.checked, sort: +form.sort.value,
        variants: [...app.querySelectorAll('#stock input')].map(i => ({ size: i.dataset.s, stock: +i.value })) };
      try { await A('admin/product', { method: 'POST', body }); location.hash = '#product/' + body.id; if (!isNew) product(body.id); } catch (err) { fail(err); } };
    bindLogout();
  }
  function shrink(file) { return new Promise((res, rej) => { const img = new Image(); img.onload = () => { const k = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); c.toBlob(b => b ? res(b) : rej(new Error('canvas')), 'image/jpeg', 0.86); URL.revokeObjectURL(img.src); }; img.onerror = () => rej(new Error('not an image')); img.src = URL.createObjectURL(file); }); }

  async function route() {
    if (!token) return login();
    const h = location.hash.replace(/^#/, '') || 'orders'; const [page, arg] = h.split('/');
    try { if (page === 'orders') await orders(arg); else if (page === 'order') await order(arg); else if (page === 'products') await products(); else if (page === 'product') await product(arg); else location.hash = '#orders'; }
    catch (e) { fail(e); }
  }
  window.addEventListener('hashchange', route); route();
})();
```
Примечание: в `product()` при `isNew` после сохранения — `product(body.id)` вызывается через hashchange автоматически (хэш меняется), поэтому условие `if (!isNew)` корректно.

- [ ] **Step 3: Живая проверка**

Открыть `https://antiosov.ru/merch/admin/` (после пуша) или локально. Войти с `ADMIN_PASSWORD` боевого `.deploy.env`. Создать товар `tee-test` (цена 1, размеры `M, L`, остаток M=2, L=0, предзаказ разрешён, «показывать» вкл.), загрузить фото с телефона/файла → миниатюра появляется, после «Сохранить» открыть `/merch/` → карточка с фото и ценой видна; `/merch/p/?s=tee-test` → размеры: M активен, L пунктиром «предзаказ».

- [ ] **Step 4: Commit**

```bash
git add merch/admin && git commit -m "merch: admin mini-CRM (orders, products, photos)" && git push origin main
```

---

### Task 9: Живой E2E, документация, память

**Files:**
- Modify: `CLAUDE.md` (корень контейнера `/Users/imac/Documents/новый/CLAUDE.md` — раздел Antiosov), `merch-api/README.md`
- Modify: память `project_antiosov_site.md`

- [ ] **Step 1: E2E на боевом терминале (1 ₽)**

1. В админке товар `tee-test` с ценой 1 ₽ активен; `DELIVERY_FLAT=0` временно в `.deploy.env` → `./deploy.sh` (чтобы итого = 1 ₽; при 0 ₽ доставки позиция «Доставка» в чек не добавляется — см. `createOrder`).
2. На `https://antiosov.ru/merch/p/?s=tee-test`: размер M, свои имя/телефон/почта владельца, адрес, согласие → «Оплатить 1 ₽» → страница Т-Банка → оплатить реальной картой.
3. Ожидаемо: возврат на `/merch/order/?id=M-…&k=…` → «Спасибо»; в почте владельца письмо «Заказ M-… — …», в почте покупателя (та же) «Заказ M-… принят»; в админке заказ `paid`, остаток M: 1.
4. Логи: `yc serverless function logs merch-api --since 10m` — `notify CONFIRMED` и `confirmPaid … {"ok":true}` (либо `{"ok":false,"reason":"paid"}` для второго канала — норма).
5. В админке: «→ Собран», «→ Отправлен» → письмо «отправлен» пришло. Второй заказ на 1 ₽ → «Отменить и вернуть деньги» → статус `cancelled`, письмо «отменён», в кабинете Т-Банка возврат.
6. Просрочка: создать заказ, не платить, через 21 минуту открыть `/merch/order/…` → «Время вышло», остаток вернулся.
7. Вернуть `DELIVERY_FLAT=400`, передеплоить; товар `tee-test` выключить («показывать» off) или удалить остатки.
8. Яндекс (тестовая среда): локально `YD_MODE=test node --test test/yd.test.js` → pass; заявка `offers/create` в тесте `orders.test.js` подменена — живой `createRequest` проверить одним вызовом: `node -e "require('./test/_env');require('./lib/yd').createRequest({...}, {...}).then(console.log)"` с ПВЗ из `pvz()`; ожидаемо `request_id`. Если тестовая среда отклоняет — зафиксировать текст ошибки в README как «проверить при подключении prod».

Все пункты — с реальным выводом в отчёте (скриншоты/логи/ответы), а не «должно работать».

- [ ] **Step 2: Документация**

`CLAUDE.md` контейнера, раздел Antiosov: добавить подраздел «Мерч» — страницы, функция `merch-api` (id, URL), YDB `antiosov-merch`, бакет, Postbox, `YD_MODE`, админка, где секреты, как деплоить, ссылка на спеку и план. `merch-api/README.md` дополнить итогами E2E и известными ограничениями (Яндекс off, OG у карточек нет).

- [ ] **Step 3: Память**

Обновить `/Users/imac/.claude/projects/-Users-imac-Documents------/memory/project_antiosov_site.md`: добавить блок «Мерч» с id ресурсов (SA, YDB, функция, бакет), состоянием `YD_MODE=off`, открытыми вопросами (договор Яндекс, ФИО/ИНН в политике ПД). В `MEMORY.md` hook строки обновить.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "merch: docs after live E2E" && git push origin main
```
