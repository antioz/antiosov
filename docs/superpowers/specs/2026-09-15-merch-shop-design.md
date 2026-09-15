# Магазин мерча antiosov.ru/merch — дизайн

Дата: 2026-09-15. Статус: утверждён по секциям; прошёл независимую проверку ln-23 (2026-09-15), замечания внесены.

## 1. Цель и рамки

Продажа мерча (одежда с размерами + безразмерные вещи, 10–15 позиций) с сайта antiosov.ru:
выбор вещи → размер → количество → форма → онлайн-оплата Т-Банк → доставка Яндекс Доставкой
до пункта выдачи (ПВЗ) → заказы и остатки в базе → письма → мини-CRM для владельца.

Не входит: корзина (одна вещь — один заказ), курьерская доставка до двери, промокоды, отчёты,
клиентская база отдельно от заказов, мультивалюта, i18n.

## 2. Архитектура

```
Сайт (GitHub Pages, статика)                 Yandex Cloud (папка default b1gkm69jqok5o2cpgn0p)
/merch/            каталог                    Cloud Function merch-api (Node 18)
/merch/p/?s=<slug> карточка + форма    ←→     YDB serverless: products, variants, orders, counters
/merch/order/?id=  статус после оплаты        Object Storage: bucket antiosov-merch (фото, приватный)
/merch/admin/      мини-CRM                   Postbox: письма с домена antiosov.ru
                                              Внешние: Т-Банк (Init/GetState/Notify), Яндекс Доставка
                                              (pricing-calculator, pickup-points/list, offers/create,
                                              offers/confirm, request/info)
```

Функция `vsd-paywall` не трогается. Общая обвязка Т-Банка выносится в `shared/tbank.js`
(tbToken, tbCall с ru-ca.pem, receipt) и копируется в обе функции при деплое (без npm-пакета).

Карточка — одна страница-шаблон `/merch/p/index.html`, слаг в query (`?s=tee-black`),
т.к. GitHub Pages без серверного роутинга. Каталог ссылается на `/merch/p/?s=<slug>`.

### 2.1 Эндпоинты merch-api

Все ответы JSON, CORS для `https://antiosov.ru`. Маршрут в query `?a=`, как в пейволле.

| a | метод | auth | назначение |
|---|---|---|---|
| catalog | GET | — | активные товары + варианты с `available = stock − reserved` (без кэша — объём не требует) |
| product&s= | GET | — | один товар |
| cities&q= | GET | — | подсказка городов (Яндекс `location/detect`); режим off → пусто |
| pvz&geo_id= | GET | — | список ПВЗ Яндекса по городу; режим off → пусто |
| quote | POST | — | стоимость и срок доставки до ПВЗ (`pricing-calculator`, tariff self_pickup); режим off → `DELIVERY_FLAT` |
| order | POST | — | создать заказ: валидация, транзакция резерва, запись, Т-Банк Init → JSON `{id, k, paymentUrl}` |
| pay&id=&k= | GET | k | повторно отдать сохранённый PaymentURL (один Init на заказ), 302 |
| status&id=&k= | GET | k | публичный статус: `{id, status, total, is_preorder, ship_by}` без ПД; k — случайный ключ заказа (защита от перебора) |
| notify | POST | подпись Т-Банка | вебхук: CONFIRMED → paid, письма, заявка Яндекс |
| success | GET | — | возврат из Т-Банка → 302 на `/merch/order/?id=` (статус только через GetState + notify) |
| admin/login | POST | пароль | → JWT (HMAC SECRET, 30 дней) |
| admin/orders | GET | JWT | список с фильтром по статусу |
| admin/order | GET/POST | JWT | карточка / смена статуса / заметка / повтор заявки Яндекс / отмена с возвратом (T-Bank Cancel) |
| admin/products | GET/POST | JWT | список / создать / изменить / остатки |
| admin/photo | POST/DELETE | JWT | presigned PUT (SigV4 статическим ключом, точный Content-Type image/jpeg, TTL 10 мин) / удаление |
| gc | внутренний | — | в начале catalog/order: заказы `new` старше 20 мин → `expired` условным UPDATE `WHERE status='new'` в одной транзакции со снятием резерва (безопасно при параллельных инстансах) |

### 2.2 Данные (YDB)

**products**: `id` (slug, PK), `title`, `description_md`, `price` (int ₽), `images` (JSON `[key]`),
`weight_g`, `dims_cm` (JSON `{x,y,z}`), `sizes` (JSON `[]`), `preorder_allowed` (bool),
`preorder_ship_by` (date?), `active` (bool), `sort` (int), `updated_at`.

**variants**: PK (`product_id`, `size`); `size = "-"` для безразмерных; `stock` (int), `reserved` (int), `preorder_count` (int, оплаченные предзаказы, ждущие поступления).
Инвариант: `0 ≤ reserved ≤ stock`. Списание обычного товара — одна транзакция:
`UPDATE variants SET reserved = reserved + $qty WHERE product_id=$p AND size=$s AND stock − reserved ≥ $qty`
(0 строк → 409 «разобрали»). При `paid`: `stock −= qty, reserved −= qty`. При `expired/cancelled` из `new`: `reserved −= qty`.
Лимит qty на заказ — 5 (обычный и предзаказ).

**Предзаказ** (`is_preorder=true`, только если `available=0` и `preorder_allowed`): резерв не создаётся,
`stock/reserved` не трогаются. При `paid`: `preorder_count += qty`. При `shipped`: `preorder_count −= qty`.
При `cancelled` из `paid|packed`: `preorder_count −= qty`. gc предзаказ обрабатывает как обычный `new`
(→ `expired`, счётчики не трогает). Лимит на размер: `preorder_count + qty ≤ PREORDER_MAX` (env, по умолчанию 20).
Поступление партии: владелец увеличивает `stock` в админке, предзаказы собирает и отправляет вручную.

**orders**: `id` (`M-000123`, PK), `created_at`, `updated_at`, `status`, `product_id`, `size`, `qty`,
`is_preorder`, `price_item`, `price_delivery`, `total`, `customer_name`, `customer_phone`,
`customer_email`, `address_text` (режим off), `pvz_id`, `pvz_address`, `delivery_mode`
(`yandex|flat`), `yd_env` (`test|prod`), `delivery_days`, `yd_request_id`, `yd_track_url`, `yd_error`,
`tb_payment_id`, `tb_payment_url`, `tb_refund_id`, `mail_error`, `k` (случайный ключ 16 hex),
`consent_at` (согласие на ПД), `admin_note`. Вторичный индекс по `status`; сортировка по `created_at` в коде.
Суммы в таблицах — рубли (int); в Т-Банк передаются копейки (×100).

**counters**: `name` PK, `value` — счётчик номеров заказов (транзакция).

Статусы: `new → paid → packed → shipped → done`; ветки `cancelled`, `expired`.
Переходы только соседние, каждый — условный UPDATE `WHERE status=$from` (0 строк → 409). `cancelled` из
`new|paid|packed`; из `paid|packed` — только с успешным T-Bank `Cancel` (полный возврат, чек возврата
формирует Т-Банк) + письмо покупателю «заказ отменён, деньги вернутся». `expired` только из `new` по gc.

### 2.3 Поток покупки

1. Карточка загружает `product`; размер с `available=0`: предзаказ разрешён → метка «предзаказ,
   отправка до <date>» и лимит qty 5; нет → перечёркнут.
2. Форма: имя, телефон, e-mail; **режим yandex**: город (подсказка) → список ПВЗ (адрес, часы) →
   `quote` → «Доставка N ₽, M дн.»; **режим off**: поле «Адрес» текстом, фикс `DELIVERY_FLAT`.
3. «Оплатить <total> ₽» (чекбокс согласия на обработку ПД обязателен) → `order`: сервер
   пересчитывает цену и доставку сам (клиентским цифрам не верит), резервирует, пишет заказ `new`,
   **один** Т-Банк Init на заказ (OrderId = id, Amount в копейках, `RedirectDueDate` = created+20 мин —
   срок платёжной формы равен сроку резерва; Receipt: 2 позиции — товар `commodity` и доставка
   `service`, Taxation/VAT из env как в пейволле, NotificationURL = `?a=notify`,
   SuccessURL/FailURL = `?a=success&id=&k=`). PaymentURL сохраняется в заказ. Init упал → резерв
   снят, заказ не создан, 502. Ответ клиенту JSON `{id, k, paymentUrl}` → клиент делает переход.
4. **`confirmPaid(orderId, paymentId)`** — единственная точка перевода в `paid`, вызывается из
   `notify` и `success`. Одна YDB-транзакция: `UPDATE orders SET status='paid', tb_payment_id=…
   WHERE id=$id AND status='new'` + списание варианта (или `preorder_count`). Побочные эффекты —
   письма (владельцу + покупателю), заявка Яндекс (offers/create → offers/confirm с `pvz_id`),
   `yd_request_id` в заказ — только если UPDATE затронул 1 строку. Повторный вызов → no-op.
   Ошибка Яндекса → `yd_error`; ошибка почты → `mail_error`; заказ остаётся `paid`.
   `notify`: проверка Token, TerminalKey, `Amount == total×100`, OrderId существует; `CONFIRMED` →
   `confirmPaid`. Если заказ уже `expired|cancelled` (оплата после срока) → T-Bank `Cancel`
   (возврат) + письмо владельцу «поздняя оплата, возврат сделан». Другие статусы → без действий.
   Ответ строго `OK`. Тело может быть base64 (как в пейволле).
5. Возврат покупателя: `success` → GetState по PaymentId → `CONFIRMED` → `confirmPaid` (вебхук
   мог отстать); → 302 `/merch/order/?id=&k=`.
6. `/merch/order/` опрашивает `status` раз в 3 с до 60 с: `paid` → «спасибо, письмо ушло»;
   `new` → «ждём подтверждения… / вернуться к оплате» (ссылка `?a=pay&id=&k=` — тот же PaymentURL,
   не новый Init); `expired` → «время вышло, оформите заново»; `cancelled` → «отменён».
   Таймаут функции 30 с; каждый внешний вызов ≤ 8 с.

### 2.4 Письма (Postbox, SES-совместимый API, From: shop@antiosov.ru)

1. Владельцу при `paid`: тема «Заказ M-000123 — <title> <size> ×qty — <total> ₽»; тело: покупатель,
   телефон, e-mail, ПВЗ/адрес, предзаказ, ссылка `/merch/admin/#order/M-000123`.
2. Покупателю при `paid`: «Заказ принят»: состав, сумма, ПВЗ, срок (предзаказ — дата отправки).
3. Покупателю при `shipped`: ПВЗ, трек-ссылка.
4. Покупателю при `cancelled` из `paid|packed`: «заказ отменён, возврат N ₽ на карту 3–10 дней».
5. Владельцу при поздней оплате (см. поток п.4).
Ошибка отправки → лог + флаг `mail_error`, статус не откатывается. `Reply-To: OWNER_EMAIL`.
Транспорт: SMTP Postbox по API-ключу сервисного аккаунта (проще SigV4; решение фиксируется в плане после
проверки квоты/sandbox Postbox). DNS в RU-CENTER: 2 CNAME DKIM (выдаёт Postbox) + TXT `_dmarc p=none`.

### 2.5 Яндекс Доставка

Режим `YD_MODE=off|test|prod`. `test` — `b2b.taxi.tst.yandex.net` с тестовым токеном и станцией из
документации; `prod` — `b2b-authproxy.taxi.yandex.net`, `YD_TOKEN`, `YD_STATION_ID`.
Вызовы: `location/detect` (город → geo_id), `pickup-points/list` (geo_id → ПВЗ),
`pricing-calculator` (source.platform_station_id, destination.platform_station_id=pvz,
tariff self_pickup, total_weight, places из dims), `offers/create` → `offers/confirm`,
`request/info` для трека. Заявка создаётся только после `paid`; в заказ пишется `yd_env`. Кнопка «повторить заявку» в админке.
Смена `YD_MODE` при наличии незакрытых заказов с другим `yd_env` — админка показывает предупреждение.
Если цена offers/create после оплаты отличается от quote — заявка всё равно создаётся (разницу несёт
владелец), в заказ пишется `yd_error='price_diff:<n>'` для сведения. Ручной шаг владельца отложен
(договор пока не подписан): старт в режиме off. В плане проверить: модель отгрузки для ИП
(склад-станция с забором vs сдача в пункт приёма), обязательные поля offers/create при qty>1.

### 2.6 Админка `/merch/admin/`

SPA на ванильном JS в стиле сайта. Вход: пароль → JWT в localStorage (30 дней).
Сводка: сколько `paid` не отправлено, сколько предзаказов.
Заказы: список (фильтр по статусу), карточка, «следующий статус», «отменить», заметка,
«повторить заявку Яндекс». Товары: список с остатками inline, карточка (все поля), фото:
загрузка с устройства (presigned PUT в бакет, ключ `p/<slug>/<uuid>.jpg`, клиент сжимает до
1600 px JPEG через canvas), порядок, удаление. Бакет `antiosov-merch`: префикс `p/` public-read —
на сайте прямые URL `https://storage.yandexcloud.net/antiosov-merch/p/...`. CORS бакета: PUT с
`https://antiosov.ru`, заголовок Content-Type.

### 2.7 Безопасность

- Пароль админки и `SECRET` — env функции. JWT HMAC-SHA256. Rate-limit логина: 5 неудач/10 мин
  на инстанс (в памяти) — достаточно для одного владельца.
- `notify` — проверка Token Т-Банка; `order` — серверный пересчёт цен; ПД покупателя никогда не
  отдаются публичными эндпоинтами.
- Бакет фото public-read (витрина); presigned PUT только из админки, TTL 10 мин, подписан точный
  `Content-Type: image/jpeg`. Presign — статическим ключом `S3_KEY/S3_SECRET` (как в пейволле).
- Сервисный аккаунт `merch-api` привязан к функции: `ydb.editor` на БД, `postbox.sender`. YDB-доступ из
  функции через метаданные (`YDB_METADATA_CREDENTIALS=1`, `getCredentialsFromEnv` из `ydb-sdk`).
  Функция с `package.json` (`ydb-sdk`), драйвер кэшируется на уровне модуля, `ready(10 s)`.
- Пароль сравнивается `timingSafeEqual`; отзыв JWT — смена `SECRET`. CORS: OPTIONS с `Authorization`.
- 152-ФЗ: чекбокс согласия в форме (`consent_at`), страница `/merch/privacy/` — политика обработки ПД
  (оператор — ИП, цели: исполнение заказа и доставка, срок хранения 3 года, контакт для удаления).
- CORS: Origin `https://antiosov.ru` (и localhost для разработки через env `DEV_ORIGIN`).

### 2.8 Ошибки и наблюдаемость

Все исключения → `console.error` (Cloud Logging) + HTTP 500 JSON `{error}`. Ошибки внешних
сервисов не роняют заказ: Яндекс → `yd_error`, почта → `mail_error`. Двойной notify — идемпотентен.
Резервы протухают через gc (без крона).

### 2.9 Тестирование и приёмка

- Юнит: `merch-api/test.js` — фейковые события (как `paywall/test.js`) против отдельной тестовой YDB
  (`YDB_DATABASE` из `.env`, локальный Docker YDB не используем): quote в режимах off/test, order с
  исчерпанием остатка (гонка: два параллельных резерва последней единицы → один 409), confirmPaid
  идемпотентность (два параллельных вызова → одно списание), поздняя оплата → Cancel, предзаказ,
  переходы статусов, gc.
- Живьём перед сдачей: заказ на 1 ₽ на боевом терминале Т-Банка → `paid` в админке, оба письма
  пришли, заявка в тестовой среде Яндекса создана; отмена и просрочка резерва возвращают остаток;
  загрузка фото с телефона; сайт на antiosov.ru/merch/ открывается и работает.

### 2.10 Деплой

`merch-api/`: `index.js`, `lib/` (ydb.js, tbank.js — копия shared, yd.js, mail.js, s3.js, jwt.js),
`package.json`, `ru-ca.pem`, `deploy.sh` (zip → `yc serverless function version create` с env из
`.deploy.env`, в .gitignore). Ресурсы создаются `yc` CLI: YDB serverless `antiosov`, бакет
`antiosov-merch`, SA `merch-api`, Postbox-адрес. `?s=slug` на GitHub Pages: OG-превью карточек не
будет (принято); неизвестный слаг → «нет такой вещи» на клиенте. Валидация: телефон — 10–15 цифр после
нормализации; e-mail — RFC-простая; имя 2–80 символов; `DELIVERY_FLAT` env (₽).

### 2.11 Ручные шаги владельца

1. (Отложено) Заявка на договор Яндекс Доставки (ИП), токен и id станции отгрузки.
2. Внести DNS-записи Postbox в RU-CENTER (подготовлю после создания адреса в облаке).
3. Загрузить товары и фото через админку.
