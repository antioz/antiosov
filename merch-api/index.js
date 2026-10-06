// merch-api — Yandex Cloud Function (Node.js 18), HTTP-триггер. Маршрут в ?a=, тело — JSON.
// Токен админки передаётся в заголовке X-Admin-Token: заголовок Authorization перехватывает сама платформа Cloud Functions (IAM) и отвечает 403 до вызова кода.
const crypto = require('crypto');
const orders = require('./lib/orders'); const ext = require('./lib/ext'); const admin = require('./lib/admin'); const subscribers = require('./lib/subscribers'); const waitlist = require('./lib/waitlist');
const { tbToken } = require('./lib/tbank');
const { json, text, redirect, HttpError, cors, setOrigin } = require('./lib/util');
const ENV = process.env;

const parseBody = ev => {
  if (!ev.body) return {};
  const raw = ev.isBase64Encoded ? Buffer.from(ev.body, 'base64').toString() : ev.body;
  let v; try { v = JSON.parse(raw); } catch (e) { throw new HttpError(400, 'bad_json'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'bad_json');
  return v;
};
const rawBody = ev => ev.isBase64Encoded ? Buffer.from(ev.body || '', 'base64').toString() : (ev.body || '');
const header = (ev, name) => { const h = ev.headers || {}; const k = Object.keys(h).find(x => x.toLowerCase() === name); return k ? h[k] : ''; };
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

const page = msg => ({ statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  body: `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Антиосов</title></head>
<body style="font-family:Inter,system-ui,sans-serif;font-size:17px;line-height:1.5;color:#0a0a0a;background:#fff;max-width:560px;margin:15vh auto;padding:0 16px"><p>${msg}</p><p><a href="https://antiosov.ru" style="color:#0a0a0a">antiosov.ru</a></p></body></html>` });

async function notify(ev) {
  let body; try { body = JSON.parse(rawBody(ev) || '{}'); } catch (e) { return text(400, 'bad json'); }
  if (!body || typeof body !== 'object') return text(400, 'bad json');
  const { Token, ...rest } = body;
  if (!Token || !safeEq(Token, tbToken(rest))) { console.warn('bad notify token'); return text(403, 'bad token'); }
  if (rest.TerminalKey !== ENV.TB_TERMINAL) return text(403, 'bad terminal');
  console.log('notify', rest.Status, rest.OrderId, rest.PaymentId, rest.Amount);
  if (rest.Status === 'CONFIRMED') {
    const r = await orders.confirmPaid(String(rest.OrderId), String(rest.PaymentId), Number(rest.Amount) / 100);
    console.log('confirmPaid', rest.OrderId, JSON.stringify(r));
  }
  return text(200, 'OK');
}

// PaymentId из URL не используется (его можно подменить) — берём сохранённый при Init.
async function success(q) {
  const id = String(q.id || ''), k = String(q.k || '');
  const info = await orders.getPayInfo(id, k);
  if (!info) return redirect(`${ENV.SITE}/merch/`);
  const back = orders.orderPage(info.kind, id, k);
  // Покупатель всегда попадает на страницу заказа; подтверждение продублирует notify.
  if (info.status === 'new' && info.tb_payment_id) {
    try {
      const s = await ext.tbank.getState(info.tb_payment_id);
      if (s && s.Success && s.Status === 'CONFIRMED' && Number.isFinite(Number(s.Amount))) await orders.confirmPaid(id, info.tb_payment_id, Number(s.Amount) / 100);
    } catch (e) { console.error('success getState', id, e.message); }
  }
  return redirect(back);
}

module.exports.handler = async function (event) {
  setOrigin(header(event, 'origin'));
  const q = event.queryStringParameters || {};
  const method = (event.httpMethod || 'GET').toUpperCase();
  if (method === 'OPTIONS') return { statusCode: 204, headers: { ...cors(), 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'X-Admin-Token, Content-Type', 'Access-Control-Max-Age': '3600' }, body: '' };
  try {
    const a = String(q.a || '');
    if (a.startsWith('admin/')) return await admin.route(a, method, method === 'GET' ? {} : parseBody(event), q, header(event, 'x-admin-token'));
    switch (a) {
      case 'catalog': { await orders.gc(); return json(200, { products: await orders.catalog(q.kind === 'digital' ? 'digital' : 'physical'), now: new Date().toISOString(), yd_mode: ext.yd.mode(), delivery_flat: ext.yd.mode() === 'off' ? parseInt(ENV.DELIVERY_FLAT || '400', 10) : null, qty_max: orders.QTY_MAX }); }
      case 'product': { const p = await orders.getProduct(String(q.s || ''), { promo: String(q.p || '') }); if (p && p.kind === 'digital') p.downloads = await orders.downloadCount(p.id); return p ? json(200, { product: p, yd_mode: ext.yd.mode(), now: new Date().toISOString() }) : json(404, { error: 'no_product' }); }
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
      case 'wait': { if (method !== 'POST') return json(405, { error: 'method' }); return json(200, await waitlist.add(parseBody(event))); }
      case 'order': {
        if (method !== 'POST') return json(405, { error: 'method' });
        const b = parseBody(event); const r = await orders.createOrder(b);
        // Рассылка — отдельное необязательное согласие: ошибка подписки заказ не роняет
        if (b.news === true) { try { await subscribers.subscribe(b.email, r.id); } catch (e) { console.error('subscribe', e.message); } }
        return json(200, r);
      }
      case 'status': { const s = await orders.getStatus(String(q.id || ''), String(q.k || '')); return s ? json(200, s) : json(404, { error: 'no_order' }); }
      case 'pay': {
        const id = String(q.id || ''), k = String(q.k || ''); const i = await orders.getPayInfo(id, k);
        return (i && i.status === 'new' && i.tb_payment_url) ? redirect(i.tb_payment_url) : redirect(orders.orderPage(i && i.kind, id, k));
      }
      // Ссылку открывает браузер: акция кончилась/нет файла → назад на карточку (она покажет покупку), а не JSON с ошибкой.
      case 'free': {
        if (method !== 'GET') return json(405, { error: 'method' });
        const s = String(q.s || '');
        try { return redirect(await orders.freeDownload(s)); }
        catch (e) { if (e instanceof HttpError) return redirect(`${ENV.SITE}/products/p/?s=${encodeURIComponent(s)}&free=${e.error}`); throw e; }
      }
      case 'download': { if (method !== 'GET') return json(405, { error: 'method' }); return redirect(await orders.download(String(q.id || ''), String(q.k || ''))); }
      // Отписка. GET (ссылка из подвала) только показывает кнопку: сканеры ссылок в почте открывают GET сами и отписали бы человека.
      // POST формы → страница; POST one-click почтовика (RFC 8058, тело List-Unsubscribe=One-Click) → OK. Неверный токен = «нет в списке».
      case 'unsub': {
        if (method !== 'POST') return page('Отписаться от писем Антиосова?</p><form method="post"><button style="font:inherit;padding:10px 20px;border:1px solid #0a0a0a;background:#fff;cursor:pointer">Отписаться</button></form><p>');
        const ok = await subscribers.unsubscribe(String(q.e || ''), String(q.t || ''));
        if (/List-Unsubscribe=One-Click/i.test(rawBody(event))) return text(200, 'OK');
        return page(ok ? 'Вы отписались от писем Антиосова.' : 'Этого адреса нет в списке.');
      }
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
