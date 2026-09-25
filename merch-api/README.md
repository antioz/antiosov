# merch-api

Бэкенд мерч-магазина antiosov.ru: одна Yandex Cloud Function (Node.js 18, HTTP-триггер), данные в YDB serverless,
фото в Object Storage, письма через Postbox, оплата Т-Банк, доставка Яндекс (или плоский тариф в режиме `off`).
Спека: `docs/superpowers/specs/2026-09-15-merch-shop-design.md`.

Живой URL: `https://functions.yandexcloud.net/d4eh4qtc4a7fria6mgmt` (= `SELF_URL`).

## Маршруты

Маршрут в query `?a=`, тело — JSON, ответы JSON, CORS для `SITE` (и `DEV_ORIGIN` при совпадении `Origin`).

| a | метод | auth | назначение |
|---|---|---|---|
| catalog | GET | — | активные товары + варианты с `available = stock − reserved`; перед этим `gc` |
| product&s= | GET | — | один товар |
| cities&q= | GET | — | подсказка городов (Яндекс); режим `off` → пусто |
| pvz&geo_id= | GET | — | список ПВЗ по городу; режим `off` → пусто |
| quote | POST | — | стоимость и срок доставки до ПВЗ; режим `off` → `DELIVERY_FLAT` |
| order | POST | — | создать заказ: валидация, резерв в транзакции, Т-Банк Init → `{id, k, paymentUrl}` |
| pay&id=&k= | GET | k | 302 на сохранённый PaymentURL (один Init на заказ) |
| status&id=&k= | GET | k | публичный статус без ПД; `k` — случайный ключ заказа |
| notify | POST | подпись Т-Банка | вебхук: CONFIRMED → paid, письма, заявка Яндекс |
| success | GET | — | возврат из Т-Банка → 302 на `/merch/order/?id=…&k=…` |
| admin/login | POST | пароль | → JWT (HMAC `SECRET`, 30 дней); неверный пароль → 401 `bad_password` |
| admin/orders | GET | JWT | список заказов с фильтром по статусу |
| admin/order | GET/POST | JWT | карточка / смена статуса / заметка / повтор заявки Яндекс / отмена с возвратом |
| admin/products | GET/POST | JWT | список / создать / изменить / остатки |
| admin/photo | POST/DELETE | JWT | presigned PUT в бакет (image/jpeg, TTL 10 мин) / удаление |
| gc | внутренний | — | в начале catalog/order: заказы `new` старше `RESERVE_MIN` минут → `expired`, резерв снимается |

Неизвестный `a` → 404 `{"error":"not_found"}`. Необработанное исключение → 500 `{"error":"internal"}` + stack в логах.

## Переменные окружения

Все — в `merch-api/.deploy.env` (не в git, `chmod 600`), `deploy.sh` передаёт их функции через `--environment`.
Значения не могут содержать `,` и `"` (yc не поддерживает; deploy.sh откажется деплоить).

| Ключ | Назначение |
|---|---|
| `YDB_CONNECTION` | `grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/<cloud>/<db>` (форма из `yc ydb database get`; `lib/ydb.js` нормализует) |
| `YDB_METADATA_CREDENTIALS=1` | в облаке — токен сервисного аккаунта функции через metadata (требует пакет `@yandex-cloud/nodejs-sdk`, см. «Деплой») |
| `SA_ID` | id сервисного аккаунта функции (только для deploy.sh) |
| `SITE` | `https://antiosov.ru` — CORS и редиректы |
| `SELF_URL` | http_invoke_url функции (для NotificationURL/SuccessURL Т-Банка) |
| `DEV_ORIGIN` | `http://localhost:5500` — CORS для локальной разработки |
| `SECRET` | HMAC-ключ JWT админки |
| `ADMIN_PASSWORD` | пароль админки |
| `S3_KEY`, `S3_SECRET`, `S3_BUCKET` | статический ключ SA и имя бакета (`antiosov-merch`) — presigned PUT/DELETE фото; тот же ключ подписывает вызовы Postbox API |
| `SMTP_USER`, `SMTP_PASS` | API-ключ SA со scope `yc.postbox.send` (id ключа / секрет) |
| `MAIL_FROM` | `shop@antiosov.ru` (домен = Postbox identity) |
| `OWNER_EMAIL` | куда слать уведомления о заказах |
| `TB_TERMINAL`, `TB_PASSWORD` | боевой терминал Т-Банка (тот же, что у `paywall/prod.env`) |
| `TAXATION`, `VAT` | чек: `usn_income`, `none` |
| `YD_MODE` | `off` / `test` / `prod` — доставка Яндекс |
| `YD_TOKEN`, `YD_STATION_ID` | токен и станция отгрузки Яндекс Доставки (нужны при `test`/`prod`) |
| `DELIVERY_FLAT` | плоская стоимость доставки в режиме `off`, ₽ (400) |
| `RESERVE_MIN` | время жизни неоплаченного заказа, мин (20) |
| `PREORDER_MAX` | лимит предзаказов на размер (20) |

Локально (`merch-api/.env`, тоже не в git) — те же ключи, но вместо `YDB_METADATA_CREDENTIALS` —
`YDB_ACCESS_TOKEN_CREDENTIALS=<IAM-токен>` (`~/yandex-cloud/bin/yc iam create-token`, живёт 12 ч), `YDB_CONNECTION` — тестовая БД.

**Важно:** `test/_env.js` записывает значения из `.env` поверх переменных шелла. `YDB_CONNECTION=<prod> node migrate.js`
**не** переключит БД — см. «Миграция».

## Деплой

```bash
cd merch-api && ./deploy.sh
# → создаёт версию функции merch-api (zip: index.js, package.json, package-lock.json, ru-ca.pem, lib, schema.yql)
# → печатает "deployed: https://functions.yandexcloud.net/d4eh4qtc4a7fria6mgmt"
```

Облако само ставит зависимости из `package.json`/`package-lock.json` при создании версии (node_modules в zip не нужны).
`@yandex-cloud/nodejs-sdk` в `dependencies` обязателен: это optional peer-dependency `ydb-sdk`, без него
`YDB_METADATA_CREDENTIALS` падает с `MODULE_NOT_FOUND` → любой запрос к БД отвечает 500.

`yc serverless function version create` печатает в stdout весь блок `environment` (включая секреты) — не запускать
деплой там, где вывод логируется.

Smoke после деплоя:

```bash
U=$(grep '^SELF_URL=' .deploy.env | cut -d= -f2-)
curl -s "$U?a=catalog"                     # {"products":[...],"yd_mode":"off","delivery_flat":400,"qty_max":5}
curl -s -X OPTIONS -i "$U" | grep -i access-control
curl -s -X POST "$U?a=admin/login" -H 'Content-Type: application/json' -d '{"password":"wrong"}'   # {"error":"bad_password"}
```

Логи: `yc logging read --group-id e23b0oej510bh8e8asp8 --since 5m --limit 200` (группа `default`;
`yc serverless function logs merch-api` у CLI 1.34 подвисает). Поток `build` засоряет группу npm-логами уровня ERROR —
фильтровать `--filter 'stream_name != "build"'` или искать по `Version: <id>`.

## Тесты

```bash
cd merch-api
export YDB_ACCESS_TOKEN_CREDENTIALS=$(~/yandex-cloud/bin/yc iam create-token)   # или обновить в .env
npm test                 # node --test test/*.test.js — против тестовой БД из .env
node --test test/mail.test.js   # живая отправка владельцу; до верификации домена Postbox тест skip (550 identity not verified)
```

## Миграция схемы

`schema.yql` — `CREATE TABLE IF NOT EXISTS …`, идемпотентно.

```bash
cd merch-api && node migrate.js     # БД из .env (тестовая)
# prod — .env перекрывает переменные шелла, поэтому override делается после require('./test/_env'):
node -e 'require("./test/_env");
process.env.YDB_CONNECTION="grpcs://ydb.serverless.yandexcloud.net:2135/?database=/ru-central1/b1gqspi79qu9qncaoa1r/etn19vjf952qb0cf7umg";
process.env.YDB_ACCESS_TOKEN_CREDENTIALS=process.argv[1]; require("./migrate");' "$(~/yandex-cloud/bin/yc iam create-token)"
```

## Postbox и DNS

В yc 1.34 нет группы `postbox`, адрес домена создан через SES-совместимый API скриптом
`scripts/postbox-identity.js` (SigV4 статическим ключом SA, service `ses`, host `postbox.cloud.yandex.net`):

```bash
cd merch-api
node scripts/postbox-identity.js create   # POST /v2/email/identities {"EmailIdentity":"antiosov.ru"} — уже сделано
node scripts/postbox-identity.js get      # статус: DkimAttributes.Status, VerifiedForSendingStatus + DNS-записи
```

DNS-записи для регистратора (RU-CENTER):

- `egtp7umel198887u1an6-1._domainkey.antiosov.ru` → CNAME → `egtp7umel198887u1an6-1.dkim.postbox.cloud.yandex.net`
- `egtp7umel198887u1an6-2._domainkey.antiosov.ru` → CNAME → `egtp7umel198887u1an6-2.dkim.postbox.cloud.yandex.net`
- `_dmarc.antiosov.ru` → TXT → `v=DMARC1; p=none; rua=mailto:dimaantiosov@yandex.ru`

Проверка: `dig +short CNAME egtp7umel198887u1an6-1._domainkey.antiosov.ru` должен вернуть значение;
`node scripts/postbox-identity.js get` → `DkimAttributes.Status: SUCCESS`, `VerifiedForSendingStatus: true`.
Пока записей нет, SMTP отвечает `550 5.4.1 identity not verified`, статус identity — `FAILED`
(Postbox помечает так после неудачной попытки проверки; после появления записей проверка повторяется автоматически,
если статус не меняется — `create` заново).

## Переключение доставки (`YD_MODE`)

1. В `.deploy.env` поставить `YD_MODE=test` или `prod`, задать `YD_TOKEN` и `YD_STATION_ID` (в `prod` — боевые).
2. `./deploy.sh` (env живёт в версии функции, без передеплоя не меняется).
3. Проверить `curl "$U?a=catalog"` → `"yd_mode":"test"`, `"delivery_flat":null`.

Обратно: `YD_MODE=off` + передеплой — доставка по `DELIVERY_FLAT`.

## Ресурсы облака (папка `default` b1gkm69jqok5o2cpgn0p, cloud b1gqspi79qu9qncaoa1r)

| Ресурс | Значение |
|---|---|
| Функция `merch-api` | id `d4eh4qtc4a7fria6mgmt`; `https://functions.yandexcloud.net/d4eh4qtc4a7fria6mgmt`; unauthenticated invoke; 256 MB, 30 s |
| Сервисный аккаунт `merch-api` | `ajetveq53kvjmk993qdq`; роли на папке: `ydb.editor`, `postbox.sender`, `postbox.admin` |
| Статический ключ SA (S3 / Postbox API) | access key id `ajeh4f336hngk2kful7d` |
| API-ключ SA (Postbox SMTP) | id `ajecopq29fleg5ffltjk` |
| YDB `antiosov-merch` (prod) | id `etn19vjf952qb0cf7umg` |
| YDB `antiosov-merch-test` | id `etnfc6b72p4f2ugukf8g` |
| Бакет `antiosov-merch` | resource_id `e3es1nd94rektkoi9olu`; CORS для antiosov.ru / localhost:5500 / 127.0.0.1:5500 |
| Postbox identity | `antiosov.ru` (DOMAIN) |
| Логи | группа `default` `e23b0oej510bh8e8asp8` |

Функция и SA `vsd-paywall` не трогаются.

### Принятый риск: публичность бакета

У бакета включён флаг публичного чтения (anonymous `read=true`) — без него policy с `Principal:*` не даёт анонимного
доступа. Анонимный доступ ограничивает **policy**: `s3:GetObject` только на `p/*`, остальное (и листинг) — 403; полный
доступ — SA `merch-api` и владелец. Если policy удалить или сломать, весь бакет станет публичным на чтение.
При смене SA/владельца policy надо править (в ней явные `CanonicalUser`).

## Живой E2E (15.09.2026)
Заказ M-000002 (tee-test, 1 ₽, DELIVERY_FLAT временно 0) оплачен на боевом терминале → notify → `paid` → админка `→ packed` →
«Отменить и вернуть деньги» → `cancelled`, T-Bank GetState = `REFUNDED`. Неоплаченный M-000001 отменён — резерв вернулся.
Письма не ушли (`550 identity not verified`) — до DNS Postbox; заказ при этом проведён, `mail_error` заполнен.
Важно: токен админки — заголовок `X-Admin-Token`; `Authorization: Bearer` платформа Cloud Functions перехватывает (403 до кода).
