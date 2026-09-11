# Пейволл «ВСД»

Yandex Cloud Function (Node.js 18) + Object Storage. Код — `index.js`, сертификаты Минцифры — `ru-ca.pem`
(Т-Банк подписан российским УЦ).

## Поток
1. Кнопка «Открыть за 500 ₽» → `SELF_URL?a=pay` → Init в Т-Банке → редирект на оплату.
2. Т-Банк возвращает на `SELF_URL?a=success&PaymentId=…` → GetState → если CONFIRMED —
   редирект на `antiosov.ru/texts/vsd/full/?t=<PaymentId>.<HMAC>`.
3. Страница сохраняет токен в localStorage и запрашивает `SELF_URL?a=access&t=…` →
   получает подписанные ссылки (3 часа) на страницы 21–112 и PDF из приватного бакета.

## Переменные окружения функции
`TB_TERMINAL`, `TB_PASSWORD`, `SECRET` (случайная строка ≥32 символов), `S3_KEY`, `S3_SECRET`
(статический ключ сервисного аккаунта с ролью storage.viewer), `S3_BUCKET`, `SITE`, `SELF_URL`, `PRICE`.

## Бакет
Приватный. Объекты: `pages/21.jpg … pages/112.jpg`, `vsd.pdf`.

## Терминалы
Боевой — `prod.env` (в .gitignore), тестовый DEMO — `.env`. Переключение: передеплой функции
с другими TB_TERMINAL/TB_PASSWORD (см. историю команд в сессии или README-скрипт ниже).

## Локальный прогон
`node test.js` — вызывает handler с фейковыми событиями (нужен `.env` рядом, см. test.js).
