// Пейволл книги «ВСД» — Yandex Cloud Function (Node.js 18), HTTP-триггер.
// Без базы: факт оплаты подтверждается у Т-Банка (GetState), доступ — HMAC-токен от PaymentId.
//
// Маршруты (?a=...):
//   pay      → создаёт платёж в Т-Банке (Init) и редиректит на платёжную страницу
//   success  → сюда возвращает Т-Банк после оплаты; проверяем статус, выдаём токен, редиректим на сайт
//   notify   → уведомления Т-Банка (проверка подписи, ответ OK)
//   access   → по токену отдаёт подписанные ссылки на страницы 21–112 и PDF из Object Storage
//
// Переменные окружения: TB_TERMINAL, TB_PASSWORD, SECRET, S3_KEY, S3_SECRET, S3_BUCKET,
//                       SITE (https://antiosov.ru), SELF_URL (адрес этой функции), PRICE (в копейках, 50000)

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ENV = process.env;
const SITE = ENV.SITE || 'https://antiosov.ru';
const BOOK_URL = SITE + '/texts/vsd/full/';
const PRICE = parseInt(ENV.PRICE || '50000', 10);
const PAID_PAGES = { from: 21, to: 112 };
const LINK_TTL = 3 * 60 * 60; // секунд

// Т-Банк подписан российским УЦ — добавляем его к системным корням.
const RU_CA = fs.readFileSync(path.join(__dirname, 'ru-ca.pem'));
const agent = new https.Agent({ ca: [...require('tls').rootCertificates, RU_CA.toString()] });

// ---------- Т-Банк ----------
function tbToken(params) {
  const flat = { ...params, Password: ENV.TB_PASSWORD };
  const str = Object.keys(flat)
    .filter(k => typeof flat[k] !== 'object')
    .sort()
    .map(k => String(flat[k]))
    .join('');
  return crypto.createHash('sha256').update(str).digest('hex');
}

function tbCall(method, params) {
  const body = JSON.stringify({ ...params, Token: tbToken(params) });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'securepay.tinkoff.ru', path: '/v2/' + method, method: 'POST', agent,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('bad json: ' + data)); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

// ---------- токен доступа ----------
function sign(paymentId) {
  return crypto.createHmac('sha256', ENV.SECRET).update(String(paymentId)).digest('base64url');
}
function makeAccessToken(paymentId) { return paymentId + '.' + sign(paymentId); }
function verifyAccessToken(t) {
  if (!t || typeof t !== 'string') return null;
  const i = t.indexOf('.'); if (i < 1) return null;
  const pid = t.slice(0, i), sig = Buffer.from(t.slice(i + 1)), good = Buffer.from(sign(pid));
  if (sig.length !== good.length) return null;
  return crypto.timingSafeEqual(sig, good) ? pid : null;
}

// ---------- Object Storage: presigned GET (AWS SigV4) ----------
function presign(key, ttl) {
  const host = 'storage.yandexcloud.net';
  const now = new Date();
  const date = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'; // YYYYMMDDTHHMMSSZ
  const day = date.slice(0, 8);
  const region = 'ru-central1', service = 's3';
  const scope = `${day}/${region}/${service}/aws4_request`;
  const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const canonicalUri = '/' + ENV.S3_BUCKET + '/' + key.split('/').map(enc).join('/');
  const q = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${ENV.S3_KEY}/${scope}`,
    'X-Amz-Date': date,
    'X-Amz-Expires': String(ttl),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(q).sort().map(k => `${enc(k)}=${enc(q[k])}`).join('&');
  const canonicalRequest = ['GET', canonicalUri, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const h = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  const kSigning = h(h(h(h('AWS4' + ENV.S3_SECRET, day), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// ---------- ответы ----------
const redirect = url => ({ statusCode: 302, headers: { Location: url, 'Cache-Control': 'no-store' }, body: '' });
const json = (code, obj) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': SITE, 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
});
const text = (code, s) => ({ statusCode: code, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: s });

// ---------- маршруты ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function receipt(email) {
  // Чек 54-ФЗ для Т-Чеков. TAXATION: osn | usn_income | usn_income_outcome | patent | envd | esn
  return {
    Email: email,
    Taxation: ENV.TAXATION || 'usn_income',
    Items: [{
      Name: 'Книга «ВСД», электронная версия',
      Price: PRICE, Quantity: 1, Amount: PRICE,
      Tax: ENV.VAT || 'none',
      PaymentMethod: 'full_payment',
      PaymentObject: 'intellectual_activity',
    }],
  };
}

async function pay(q) {
  const email = (q.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return redirect(BOOK_URL + '?fail=email');
  const orderId = 'vsd-' + crypto.randomBytes(6).toString('hex');
  const res = await tbCall('Init', {
    TerminalKey: ENV.TB_TERMINAL,
    Amount: PRICE,
    OrderId: orderId,
    Description: 'Книга «ВСД» — полная версия и PDF',
    SuccessURL: ENV.SELF_URL + '?a=success&o=' + orderId,
    FailURL: BOOK_URL + '?fail=1',
    NotificationURL: ENV.SELF_URL + '?a=notify',
    DATA: { Email: email },
    Receipt: receipt(email),
  });
  if (!res.Success || !res.PaymentURL) {
    console.error('Init failed', JSON.stringify(res));
    return redirect(BOOK_URL + '?fail=1');
  }
  console.log('init', orderId, res.PaymentId);
  return redirect(res.PaymentURL);
}

async function success(q) {
  // Т-Банк возвращает покупателя сюда; свой OrderId мы зашили в SuccessURL, PaymentId берём из CheckOrder.
  const orderId = q.o;
  if (!orderId) { console.warn('success without order', JSON.stringify(q)); return redirect(BOOK_URL + '?fail=1'); }
  const st = await tbCall('CheckOrder', { TerminalKey: ENV.TB_TERMINAL, OrderId: orderId });
  const payments = (st.Success && Array.isArray(st.Payments)) ? st.Payments : [];
  const paid = payments.find(p => (p.Status === 'CONFIRMED' || p.Status === 'AUTHORIZED') && Number(p.Amount) === PRICE);
  console.log('success', orderId, JSON.stringify(payments.map(p => [p.PaymentId, p.Status, p.Amount])));
  if (!paid) return redirect(BOOK_URL + '?fail=1');
  return redirect(BOOK_URL + '?t=' + makeAccessToken(paid.PaymentId));
}

function notify(bodyStr) {
  let body; try { body = JSON.parse(bodyStr || '{}'); } catch (e) { return text(400, 'bad json'); }
  const { Token, ...rest } = body;
  if (!Token || Token !== tbToken(rest)) { console.warn('bad notify token'); return text(403, 'bad token'); }
  console.log('notify', rest.Status, rest.OrderId, rest.PaymentId, rest.Amount);
  return text(200, 'OK');
}

function access(q) {
  const pid = verifyAccessToken(q.t);
  if (!pid) return json(403, { error: 'no access' });
  const pages = [];
  for (let i = PAID_PAGES.from; i <= PAID_PAGES.to; i++) pages.push(presign(`pages/${String(i).padStart(2, '0')}.jpg`, LINK_TTL));
  return json(200, { pages, pdf: presign('vsd.pdf', LINK_TTL), ttl: LINK_TTL });
}

module.exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const method = (event.httpMethod || 'GET').toUpperCase();
  if (method === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': SITE, 'Access-Control-Allow-Methods': 'GET, OPTIONS' }, body: '' };
  try {
    switch (q.a) {
      case 'pay': return await pay(q);
      case 'success': return await success(q);
      case 'notify': return notify(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body);
      case 'access': return access(q);
      default: return text(404, 'not found');
    }
  } catch (e) {
    console.error(e);
    return text(500, 'error');
  }
};
