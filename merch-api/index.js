// merch-api — Yandex Cloud Function (Node.js 18), HTTP-триггер. Маршрут в ?a=, тело — JSON.
const crypto = require('crypto');
const orders = require('./lib/orders'); const ext = require('./lib/ext'); const admin = require('./lib/admin');
const { tbToken } = require('./lib/tbank');
const { json, text, redirect, HttpError, cors, setOrigin } = require('./lib/util');
const ENV = process.env;

const parseBody = ev => {
  if (!ev.body) return {};
  const raw = ev.isBase64Encoded ? Buffer.from(ev.body, 'base64').toString() : ev.body;
  try { return JSON.parse(raw); } catch (e) { throw new HttpError(400, 'bad_json'); }
};
const rawBody = ev => ev.isBase64Encoded ? Buffer.from(ev.body || '', 'base64').toString() : (ev.body || '');
const header = (ev, name) => { const h = ev.headers || {}; const k = Object.keys(h).find(x => x.toLowerCase() === name); return k ? h[k] : ''; };
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

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
  const back = `${ENV.SITE}/merch/order/?id=${encodeURIComponent(id)}&k=${encodeURIComponent(k)}`;
  const info = await orders.getPayInfo(id, k);
  if (!info) return redirect(`${ENV.SITE}/merch/`);
  if (info.status === 'new' && info.tb_payment_id) {
    const s = await ext.tbank.getState(info.tb_payment_id);
    if (s && s.Success && s.Status === 'CONFIRMED' && Number.isFinite(Number(s.Amount))) await orders.confirmPaid(id, info.tb_payment_id, Number(s.Amount) / 100);
  }
  return redirect(back);
}

module.exports.handler = async function (event) {
  setOrigin(header(event, 'origin'));
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
