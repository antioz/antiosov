# Магазин мерча antiosov.ru/merch — дизайн

Дата: 2026-09-15. Статус: утверждён пользователем по секциям, ожидает независимой проверки (ln-23).

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
| catalog | GET | — | активные товары + варианты с `available = stock − reserved`; кэш 60 с в памяти инстанса |
| product&s= | GET | — | один товар |
| photo&k= | GET | — | редирект на presigned URL фото (TTL 1 ч) |
| cities&q= | GET | — | подсказка городов (Яндекс `location/detect`); режим off → пусто |
| pvz&geo_id= | GET | — | список ПВЗ Яндекса по городу; режим off → пусто |
| quote | POST | — | стоимость и срок доставки до ПВЗ (`pricing-calculator`, tariff self_pickup); режим off → `DELIVERY_FLAT` |
| order | POST | — | создать заказ: валидация, транзакция резерва, запись, Т-Банк Init → `{id, paymentUrl}` |
| status&id= | GET | — | публичный статус: `{id, status, total, is_preorder, ship_by}` без ПД |
| notify | POST | подпись Т-Банка | вебхук: CONFIRMED → paid, письма, заявка Яндекс |
| success | GET | — | возврат из Т-Банка → 302 на `/merch/order/?id=` (статус только через GetState + notify) |
| admin/login | POST | пароль | → JWT (HMAC SECRET, 30 дней) |
| admin/orders | GET | JWT | список с фильтром по статусу |
| admin/order | GET/POST | JWT | карточка / смена статуса / заметка / повтор заявки Яндекс |
| admin/products | GET/POST | JWT | список / создать / изменить / остатки |
| admin/photo | POST/DELETE | JWT | presigned PUT для загрузки в бакет / удаление |
| gc | внутренний | — | вызывается в начале catalog/order: снять резервы `new` старше 20 мин → `expired` |

### 2.2 Данные (YDB)

**products**: `id` (slug, PK), `title`, `description_md`, `price` (int ₽), `images` (JSON `[key]`),
`weight_g`, `dims_cm` (JSON `{x,y,z}`), `sizes` (JSON `[]`), `preorder_allowed` (bool),
`preorder_ship_by` (date?), `active` (bool), `sort` (int), `updated_at`.

**variants**: PK (`product_id`, `size`); `size = "-"` для безразмерных; `stock` (int), `reserved` (int).
Инвариант: `0 ≤ reserved ≤ stock` для обычных; при предзаказе `stock` может быть 0, резерв ведётся
в отдельном поле `preorder_count` (не ограничен). Списание — одна транзакция:
`UPDATE variants SET reserved = reserved + $qty WHERE product_id=$p AND size=$s AND stock − reserved ≥ $qty`
(0 строк → «разобрали»). При `paid`: `stock −= qty, reserved −= qty`. При `expired/cancelled`: `reserved −= qty`.

**orders**: `id` (`M-000123`, PK), `created_at`, `updated_at`, `status`, `product_id`, `size`, `qty`,
`is_preorder`, `price_item`, `price_delivery`, `total`, `customer_name`, `customer_phone`,
`customer_email`, `address_text` (режим off), `pvz_id`, `pvz_address`, `delivery_mode`
(`yandex|flat`), `delivery_days`, `yd_request_id`, `yd_track_url`, `yd_error`, `tb_payment_id`,
`admin_note`. Индекс: `status, created_at desc`.

**counters**: `name` PK, `value` — счётчик номеров заказов (транзакция).

Статусы: `new → paid → packed → shipped → done`; ветки `cancelled`, `expired`.
Переходы только соседние; `cancelled` из `new|paid|packed`; `expired` только из `new` по gc.

### 2.3 Поток покупки

1. Карточка загружает `product`; размер с `available=0`: предзаказ разрешён → метка «предзаказ,
   отправка до <date>» и лимит qty 5; нет → перечёркнут.
2. Форма: имя, телефон, e-mail; **режим yandex**: город (подсказка) → список ПВЗ (адрес, часы) →
   `quote` → «Доставка N ₽, M дн.»; **режим off**: поле «Адрес» текстом, фикс `DELIVERY_FLAT`.
3. «Оплатить <total> ₽» → `order`: сервер пересчитывает цену и доставку сам (клиентским цифрам
   не верит), резервирует, пишет заказ `new`, Т-Банк Init (OrderId = id, Receipt: 2 позиции —
   товар и доставка, Taxation/VAT из env как в пейволле, NotificationURL = `?a=notify`,
   SuccessURL/FailURL = `?a=success&id=`) → 302 на PaymentURL.
4. Т-Банк → `notify` (проверка Token по алгоритму Т-Банка). `CONFIRMED` и заказ `new` → `paid`,
   списание, письма (владельцу + покупателю), заявка Яндекс (offers/create → offers/confirm с
   `pvz_id`), `yd_request_id` в заказ; ошибка Яндекса → `yd_error`, заказ остаётся `paid`.
   Повторный notify по тому же `tb_payment_id` → 200 OK без действий (идемпотентность).
   Любой другой статус → без изменений. Ответ строго `OK`.
5. Возврат покупателя: `success` → GetState по PaymentId → если CONFIRMED и заказ ещё `new`
   (вебхук отстал) — выполнить то же, что notify; → 302 `/merch/order/?id=`.
6. `/merch/order/` опрашивает `status` раз в 3 с до 60 с: `paid` → «спасибо, письмо ушло»;
   `new` → «ждём подтверждения оплаты… / оплатить ещё раз» (ссылка = повторный Init по тому же
   заказу, пока не `expired`); `expired` → «время вышло, оформите заново».

### 2.4 Письма (Postbox, SES-совместимый API, From: shop@antiosov.ru)

1. Владельцу при `paid`: тема «Заказ M-000123 — <title> <size> ×qty — <total> ₽»; тело: покупатель,
   телефон, e-mail, ПВЗ/адрес, предзаказ, ссылка `/merch/admin/#order/M-000123`.
2. Покупателю при `paid`: «Заказ принят»: состав, сумма, ПВЗ, срок (предзаказ — дата отправки).
3. Покупателю при `shipped`: ПВЗ, трек-ссылка.
Отправка ошибка → лог + флаг `mail_error` в заказе, статус не откатывается.
Адрес владельца — `OWNER_EMAIL` env. DNS: DKIM/SPF-записи Postbox для antiosov.ru (ручной шаг).

### 2.5 Яндекс Доставка

Режим `YD_MODE=off|test|prod`. `test` — `b2b.taxi.tst.yandex.net` с тестовым токеном и станцией из
документации; `prod` — `b2b-authproxy.taxi.yandex.net`, `YD_TOKEN`, `YD_STATION_ID`.
Вызовы: `location/detect` (город → geo_id), `pickup-points/list` (geo_id → ПВЗ),
`pricing-calculator` (source.platform_station_id, destination.platform_station_id=pvz,
tariff self_pickup, total_weight, places из dims), `offers/create` → `offers/confirm`,
`request/info` для трека. Заявка создаётся только после `paid`. Кнопка «повторить заявку» в админке.
Владелец может подать заявку на договор параллельно с разработкой; до токена работает режим off.

### 2.6 Админка `/merch/admin/`

SPA на ванильном JS в стиле сайта. Вход: пароль → JWT в localStorage (30 дней).
Сводка: сколько `paid` не отправлено, сколько предзаказов.
Заказы: список (фильтр по статусу), карточка, «следующий статус», «отменить», заметка,
«повторить заявку Яндекс». Товары: список с остатками inline, карточка (все поля), фото:
загрузка с устройства (presigned PUT в бакет, ключ `p/<slug>/<uuid>.jpg`, клиент сжимает до
1600 px через canvas), порядок, удаление. Фото на сайте отдаются через `?a=photo&k=`.

### 2.7 Безопасность

- Пароль админки и `SECRET` — env функции. JWT HMAC-SHA256. Rate-limit логина: 5 неудач/10 мин
  на инстанс (в памяти) — достаточно для одного владельца.
- `notify` — проверка Token Т-Банка; `order` — серверный пересчёт цен; ПД покупателя никогда не
  отдаются публичными эндпоинтами.
- Бакет фото приватный; presigned PUT только из админки, TTL 10 мин, content-type image/*.
- Сервисный аккаунт функции: `ydb.editor`, `storage.uploader`+`viewer` на бакет, `postbox.sender`.
- CORS: Origin `https://antiosov.ru` (и localhost для разработки через env `DEV_ORIGIN`).

### 2.8 Ошибки и наблюдаемость

Все исключения → `console.error` (Cloud Logging) + HTTP 500 JSON `{error}`. Ошибки внешних
сервисов не роняют заказ: Яндекс → `yd_error`, почта → `mail_error`. Двойной notify — идемпотентен.
Резервы протухают через gc (без крона).

### 2.9 Тестирование и приёмка

- Юнит: `merch-api/test.js` — фейковые события (как `paywall/test.js`): quote в режимах off/test,
  order с исчерпанием остатка (гонка: два параллельных резерва последней единицы → один 409),
  notify идемпотентность, переходы статусов.
- Живьём перед сдачей: заказ на 1 ₽ на боевом терминале Т-Банка → `paid` в админке, оба письма
  пришли, заявка в тестовой среде Яндекса создана; отмена и просрочка резерва возвращают остаток;
  загрузка фото с телефона; сайт на antiosov.ru/merch/ открывается и работает.

### 2.10 Ручные шаги владельца

1. Заявка на договор Яндекс Доставки (ИП), получить токен и id станции отгрузки.
2. Подтвердить домен в Postbox (DNS-записи — я подготовлю, вносить в панели регистратора).
3. Загрузить товары и фото через админку.
