// Билеты на мероприятия (спека 2026-09-26-event-tickets-design.md): места в variants('-'), заказ без ПД, чек service, билет в status.
require('./_env');
const test = require('node:test'); const assert = require('node:assert');
const ext = require('../lib/ext'); const db = require('../lib/ydb'); const { tbToken } = require('../lib/tbank');

const calls = { init: [], cancel: [], mail: [] };
ext.tbank.init = async a => { calls.init.push(a); return { paymentId: 'PE' + calls.init.length, paymentUrl: 'https://pay.test/' + a.orderId }; };
ext.tbank.getState = async () => ({ Success: true, Status: 'CONFIRMED', Amount: 30000 });
ext.tbank.cancel = async pid => { calls.cancel.push(pid); return { Success: true, Status: 'REFUNDED' }; };
ext.mail.send = async m => { calls.mail.push(m); };
ext.yd.mode = () => 'off'; ext.yd.quote = async () => ({ price_rub: 400, days: null });
ext.yd.createRequest = async () => { throw new Error('yd не должен вызываться для билета'); };
const { handler } = require('../index');
const ev = (a, { method = 'GET', body, q = {}, headers = {} } = {}) => ({ httpMethod: method, queryStringParameters: { a, ...q }, headers, body: body ? JSON.stringify(body) : undefined, isBase64Encoded: false });
const body = r => JSON.parse(r.body);

const E = 'test-event', EP = 'test-event-past';
const FUTURE = new Date(Date.now() + 7 * 86400000).toISOString(), PAST = new Date(Date.now() - 3600000).toISOString();
const seat = async (p, stock, reserved = 0) => db.query(`DECLARE $p AS Utf8; DECLARE $s AS Int32; DECLARE $r AS Int32; UPSERT INTO variants (product_id, size, stock, reserved, preorder_count) VALUES ($p, '-'u, $s, $r, 0);`, { $p: db.V.s(p), $s: db.V.i(stock), $r: db.V.i(reserved) });
const variant = async p => (await db.query(`DECLARE $p AS Utf8; SELECT * FROM variants WHERE product_id = $p AND size = '-'u;`, { $p: db.V.s(p) }))[0][0];
const row = async id => (await db.query(`DECLARE $id AS Utf8; SELECT * FROM orders WHERE id = $id;`, { $id: db.V.s(id) }))[0][0];
test.after(async () => (await db.getDriver()).destroy());
test.before(async () => {
  await db.query(`DECLARE $e AS Utf8; DECLARE $ep AS Utf8; DECLARE $f AS Utf8; DECLARE $pa AS Utf8;
    DELETE FROM variants WHERE product_id = $e OR product_id = $ep; DELETE FROM orders WHERE product_id = $e OR product_id = $ep;
    UPSERT INTO products (id, title, description_md, price, images, weight_g, dims_cm, sizes, preorder_allowed, preorder_ship_by, active, sort, updated_at, kind, file_key, event_at, venue, age_mark)
    VALUES ($e, 'Вечер-тест'u, 'md'u, 300, Json('[]'), 0, Json('{"x":1,"y":1,"z":1}'), Json('[]'), false, ''u, true, 95, CurrentUtcTimestamp(), 'event'u, ''u, $f, 'Москва, Тестовая 1'u, '16+'u),
           ($ep, 'Прошедший'u, ''u, 100, Json('[]'), 0, Json('{"x":1,"y":1,"z":1}'), Json('[]'), false, ''u, true, 96, CurrentUtcTimestamp(), 'event'u, ''u, $pa, 'Там'u, '0+'u);`,
  { $e: db.V.s(E), $ep: db.V.s(EP), $f: db.V.s(FUTURE), $pa: db.V.s(PAST) });
  await seat(E, 60); await seat(EP, 10);
});
const ORDER = { product_id: E, email: 'Guest@Example.com', qty: 2, offer: true, consent: true };
const mkOrder = async (over = {}) => { const r = await handler(ev('order', { method: 'POST', body: { ...ORDER, ...over } })); assert.equal(r.statusCode, 200, r.body); return body(r); };
const pay = async (id, rub) => { const n = { TerminalKey: process.env.TB_TERMINAL, OrderId: id, PaymentId: 'PAY-' + id, Status: 'CONFIRMED', Amount: rub * 100, Success: true };
  const r = await handler(ev('notify', { method: 'POST', body: { ...n, Token: tbToken(n) } })); assert.equal(r.body, 'OK'); };

test('catalog: мероприятия в разделе «Продукты» с остатком, в мерче их нет', async () => {
  const dig = body(await handler(ev('catalog', { q: { kind: 'digital' } }))).products;
  const e = dig.find(p => p.id === E), ep = dig.find(p => p.id === EP);
  assert.ok(e && ep, 'мероприятия в каталоге продуктов');
  assert.deepEqual([e.kind, e.event_at, e.venue, e.age_mark, e.left, e.sales_open], ['event', FUTURE, 'Москва, Тестовая 1', '16+', 60, true]);
  assert.equal(ep.sales_open, false, 'прошедшее — продажа закрыта');
  const merch = body(await handler(ev('catalog'))).products;
  assert.ok(!merch.some(p => p.kind === 'event'));
  const p = body(await handler(ev('product', { q: { s: E } }))).product;
  assert.deepEqual([p.kind, p.left, p.sales_open, p.qty_max], ['event', 60, true, 5]);
});

test('order: валидация, sales_closed, sold_out', async () => {
  for (const [over, field] of [[{ email: 'x' }, 'email'], [{ qty: 0 }, 'qty'], [{ qty: 6 }, 'qty'], [{ offer: false }, 'offer'], [{ consent: undefined }, 'consent']]) {
    const r = await handler(ev('order', { method: 'POST', body: { ...ORDER, ...over } }));
    assert.equal(r.statusCode, 400, r.body); assert.equal(body(r).field, field);
  }
  let r = await handler(ev('order', { method: 'POST', body: { ...ORDER, product_id: EP } }));
  assert.equal(r.statusCode, 409); assert.equal(body(r).error, 'sales_closed');
  await seat(E, 3, 2);
  try {
    r = await handler(ev('order', { method: 'POST', body: { ...ORDER, qty: 2 } }));
    assert.equal(r.statusCode, 409, r.body); assert.deepEqual(body(r), { error: 'sold_out', left: 1 });
  } finally { await seat(E, 60); }
});

test('order → резерв, чек service, без ПД; оплата → места списаны, писем покупателю нет; билет в status; отмена → места вернулись', async () => {
  calls.init.length = 0; calls.mail.length = 0;
  const { id, k, paymentUrl } = await mkOrder({ name: 'Иван', phone: '+79990000000' });
  assert.ok(paymentUrl);
  let o = await row(id);
  assert.deepEqual([o.customer_name, o.customer_phone, o.customer_email, o.qty, o.price_item, o.total, o.delivery_mode, o.size], ['', '', 'guest@example.com', 2, 300, 600, 'event', '-']);
  let v = await variant(E); assert.deepEqual([v.stock, v.reserved], [60, 2]);
  const a = calls.init.at(-1);
  assert.equal(a.amountRub, 600);
  assert.equal(a.receiptItems.length, 1);
  assert.deepEqual({ ...a.receiptItems[0], name: undefined }, { name: undefined, price_rub: 300, qty: 2, object: 'service', method: 'full_payment' });
  assert.match(a.receiptItems[0].name, /^Билет: Вечер-тест, \d\d\.\d\d\.\d{4} \d\d:\d\d$/);
  assert.ok(a.failUrl.includes(`/products/order/?id=${id}&k=${k}&fail=1`));
  let s = body(await handler(ev('status', { q: { id, k } })));
  assert.equal(s.kind, 'event'); assert.ok(!('ticket' in s), 'билет до оплаты не отдаётся');
  assert.equal(body(await handler(ev('product', { q: { s: E } }))).product.left, 58);

  await pay(id, 600);
  o = await row(id); assert.equal(o.status, 'paid');
  v = await variant(E); assert.deepEqual([v.stock, v.reserved], [58, 0]);
  assert.ok(!calls.mail.some(m => m.to === 'guest@example.com'), 'покупателю писем нет');
  const owner = calls.mail.find(m => m.to === process.env.OWNER_EMAIL);
  assert.ok(owner && !owner.text.includes('guest@example.com'), 'письмо владельцу без ПД');
  s = body(await handler(ev('status', { q: { id, k } })));
  assert.deepEqual(s.ticket, { number: id, title: 'Вечер-тест', event_at: FUTURE, venue: 'Москва, Тестовая 1', age_mark: '16+', qty: 2, price_item: 300, total: 600 });
  assert.equal(s.can_download, false);
  const sr = await handler(ev('success', { q: { id, k } }));
  assert.ok(sr.headers.Location.includes(`/products/order/?id=${id}&k=${k}`), sr.headers.Location);

  const tok = body(await handler(ev('admin/login', { method: 'POST', body: { password: process.env.ADMIN_PASSWORD } }))).token;
  const H = { 'X-Admin-Token': tok };
  let r = await handler(ev('admin/order', { method: 'POST', headers: H, body: { id, action: 'next' } }));
  assert.equal(r.statusCode, 409, 'у билета нет «собран/отправлен»');
  r = await handler(ev('admin/order', { method: 'POST', headers: H, body: { id, action: 'cancel' } }));
  assert.equal(r.statusCode, 200, r.body); assert.equal(body(r).order.status, 'cancelled'); assert.equal(body(r).order.kind, 'event');
  v = await variant(E); assert.deepEqual([v.stock, v.reserved], [60, 0], 'места вернулись в продажу');
});

test('неоплаченный заказ истекает — резерв снимается', async () => {
  const { id } = await mkOrder({ qty: 3 });
  assert.equal((await variant(E)).reserved, 3);
  await db.query(`DECLARE $id AS Utf8; DECLARE $t AS Timestamp; UPDATE orders SET created_at = $t WHERE id = $id;`, { $id: db.V.s(id), $t: db.V.ts(new Date(Date.now() - 3600000)) });
  await handler(ev('catalog'));
  assert.equal((await row(id)).status, 'expired');
  const v = await variant(E); assert.deepEqual([v.stock, v.reserved], [60, 0]);
});

test('admin/product: мероприятие сохраняется с полями и местами; неверный знак — 400', async () => {
  const tok = body(await handler(ev('admin/login', { method: 'POST', body: { password: process.env.ADMIN_PASSWORD } }))).token;
  const H = { 'X-Admin-Token': tok };
  const b = { id: E, title: 'Вечер-тест', description_md: 'md', price: 300, images: [], active: true, sort: 95, kind: 'event', event_at: FUTURE, venue: ' Москва, Тестовая 1 ', age_mark: '16+', sizes: ['S'], variants: [{ size: '-', stock: 60 }] };
  let r = await handler(ev('admin/product', { method: 'POST', headers: H, body: b }));
  assert.equal(r.statusCode, 200, r.body);
  const p = body(r).product;
  assert.deepEqual([p.kind, p.event_at, p.venue, p.age_mark, p.sizes.length, p.left], ['event', FUTURE, 'Москва, Тестовая 1', '16+', 0, 60]);
  r = await handler(ev('admin/product', { method: 'POST', headers: H, body: { ...b, age_mark: '21+' } }));
  assert.equal(r.statusCode, 400); assert.equal(body(r).field, 'age_mark');
  const list = body(await handler(ev('admin/products', { headers: H }))).products;
  assert.equal(list.find(x => x.id === E).kind, 'event');
});
