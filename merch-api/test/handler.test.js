require('./_env');
const test = require('node:test'); const assert = require('node:assert');
const ext = require('../lib/ext'); const db = require('../lib/ydb'); const { tbToken } = require('../lib/tbank');
ext.tbank.init = async a => ({ paymentId: 'PH1', paymentUrl: 'https://pay.test/' + a.orderId });
ext.tbank.getState = async () => ({ Success: true, Status: 'CONFIRMED', Amount: 50000 });
ext.tbank.cancel = async () => ({ Success: true });
ext.mail.send = async () => {}; ext.yd.mode = () => 'off'; ext.yd.quote = async () => ({ price_rub: 400, days: null }); ext.yd.createRequest = async () => ({ request_id: 'x', track_url: '' });
const { handler } = require('../index');
const ev = (a, { method = 'GET', body, q = {}, headers = {} } = {}) => ({ httpMethod: method, queryStringParameters: { a, ...q }, headers, body: body ? JSON.stringify(body) : undefined, isBase64Encoded: false });
const P = 'test-h';
// Драйвер держит gRPC-соединения — без destroy() процесс node --test не завершится.
test.after(async () => (await db.getDriver()).destroy());
test.before(async () => {
  await db.query(`DECLARE $p AS Utf8; DELETE FROM variants WHERE product_id = $p; DELETE FROM orders WHERE product_id = $p; UPSERT INTO products (id, title, description_md, price, images, weight_g, dims_cm, sizes, preorder_allowed, preorder_ship_by, active, sort, updated_at)
    VALUES ($p, 'H'u, ''u, 100, Json('[]'), 100, Json('{"x":1,"y":1,"z":1}'), Json('[]'), false, ''u, true, 1, CurrentUtcTimestamp());
    UPSERT INTO variants (product_id, size, stock, reserved, preorder_count) VALUES ($p, '-'u, 5, 0, 0);`, { $p: db.V.s(P) });
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
