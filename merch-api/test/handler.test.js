require('./_env');
const test = require('node:test'); const assert = require('node:assert');
const ext = require('../lib/ext'); const db = require('../lib/ydb'); const { tbToken } = require('../lib/tbank');
ext.tbank.init = async a => ({ paymentId: 'PH1', paymentUrl: 'https://pay.test/' + a.orderId });
ext.tbank.getState = async () => ({ Success: true, Status: 'CONFIRMED', Amount: 50000 });
ext.tbank.cancel = async () => ({ Success: true });
ext.mail.send = async () => {}; ext.yd.mode = () => 'off'; ext.yd.quote = async () => ({ price_rub: 400, days: null }); ext.yd.createRequest = async () => ({ request_id: 'x', track_url: '' });
const { handler } = require('../index');
const ev = (a, { method = 'GET', body, q = {}, headers = {} } = {}) => ({ httpMethod: method, queryStringParameters: { a, ...q }, headers, body: body ? JSON.stringify(body) : undefined, isBase64Encoded: false });
const P = 'test-h', P2 = 'test-h2';
// Драйвер держит gRPC-соединения — без destroy() процесс node --test не завершится.
test.after(async () => (await db.getDriver()).destroy());
test.before(async () => {
  await db.query(`DECLARE $p AS Utf8; DECLARE $p2 AS Utf8;
    DELETE FROM variants WHERE product_id = $p OR product_id = $p2; DELETE FROM orders WHERE product_id = $p OR product_id = $p2; DELETE FROM products WHERE id = $p2;
    UPSERT INTO products (id, title, description_md, price, images, weight_g, dims_cm, sizes, preorder_allowed, preorder_ship_by, active, sort, updated_at)
    VALUES ($p, 'H'u, ''u, 100, Json('[]'), 100, Json('{"x":1,"y":1,"z":1}'), Json('[]'), false, ''u, true, 1, CurrentUtcTimestamp());
    UPSERT INTO variants (product_id, size, stock, reserved, preorder_count) VALUES ($p, '-'u, 5, 0, 0);`, { $p: db.V.s(P), $p2: db.V.s(P2) });
});
test('OPTIONS → 204 с CORS', async () => { const r = await handler({ httpMethod: 'OPTIONS', queryStringParameters: {} }); assert.equal(r.statusCode, 204); assert.ok(r.headers['Access-Control-Allow-Headers'].includes('X-Admin-Token')); });
test('catalog', async () => { const r = await handler(ev('catalog')); assert.equal(r.statusCode, 200); assert.ok(JSON.parse(r.body).products.some(p => p.id === P)); });
test('order → notify → status', async () => {
  const body = { product_id: P, size: '-', qty: 1, name: 'Иван Иванов', phone: '+79990000001', email: 'a@b.ru', address_text: 'Москва, ул. Тестовая, 1', consent: true, offer: true };
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
  const r = await handler(ev('order', { method: 'POST', body: { product_id: P, qty: 1, name: 'x', phone: '1', email: 'a', consent: true, offer: true } }));
  assert.equal(r.statusCode, 400); assert.equal(JSON.parse(r.body).field, 'name');
});
test('admin: login, orders, product upsert', async () => {
  let r = await handler(ev('admin/login', { method: 'POST', body: { password: 'wrong' } })); assert.equal(r.statusCode, 401);
  r = await handler(ev('admin/login', { method: 'POST', body: { password: process.env.ADMIN_PASSWORD } })); const { token } = JSON.parse(r.body); assert.ok(token);
  const H = { 'X-Admin-Token': token };
  r = await handler(ev('admin/orders', { headers: H })); assert.equal(r.statusCode, 200); assert.ok(Array.isArray(JSON.parse(r.body).orders));
  r = await handler(ev('admin/orders')); assert.equal(r.statusCode, 401);
  r = await handler(ev('admin/product', { method: 'POST', headers: H, body: { id: 'test-h2', title: 'H2', description_md: '', price: 200, images: [], weight_g: 100, dims_cm: { x: 1, y: 1, z: 1 }, sizes: ['S'], preorder_allowed: false, preorder_ship_by: '', active: false, sort: 2, variants: [{ size: 'S', stock: 3 }] } }));
  assert.equal(r.statusCode, 200, r.body);
  r = await handler(ev('admin/product', { headers: H, q: { id: 'test-h2' } })); assert.equal(JSON.parse(r.body).product.variants[0].stock, 3);
  r = await handler(ev('admin/photo', { method: 'POST', headers: H, body: { product_id: 'test-h2', content_type: 'image/jpeg' } }));
  const ph = JSON.parse(r.body); assert.ok(ph.put_url.includes('X-Amz-Signature')); assert.ok(ph.key.startsWith('p/test-h2/'));
});

const ORDER = { product_id: P, size: '-', qty: 1, name: 'Иван Иванов', phone: '+79990000002', email: 'a@b.ru', address_text: 'Москва, ул. Тестовая, 1', consent: true, offer: true };
const mkOrder = async () => { const r = await handler(ev('order', { method: 'POST', body: ORDER })); assert.equal(r.statusCode, 200, r.body); return JSON.parse(r.body); };
const login = async () => { const r = await handler(ev('admin/login', { method: 'POST', body: { password: process.env.ADMIN_PASSWORD } })); return { 'X-Admin-Token': JSON.parse(r.body).token }; };
test('parseBody: не-объект → 400 bad_json', async () => {
  for (const body of ['[1]', 'null', '42']) {
    const r = await handler({ httpMethod: 'POST', queryStringParameters: { a: 'order' }, headers: {}, body, isBase64Encoded: false });
    assert.equal(r.statusCode, 400, body); assert.equal(JSON.parse(r.body).error, 'bad_json');
  }
});
test('notify: base64-тело → OK; чужой TerminalKey → 403', async () => {
  const { id } = await mkOrder();
  const n = { TerminalKey: process.env.TB_TERMINAL, OrderId: id, PaymentId: 'PH1', Status: 'CONFIRMED', Amount: 50000, Success: true };
  let r = await handler({ httpMethod: 'POST', queryStringParameters: { a: 'notify' }, headers: {}, body: Buffer.from(JSON.stringify({ ...n, Token: tbToken(n) })).toString('base64'), isBase64Encoded: true });
  assert.equal(r.statusCode, 200); assert.equal(r.body, 'OK');
  const bad = { ...n, TerminalKey: 'OTHER' };
  r = await handler(ev('notify', { method: 'POST', body: { ...bad, Token: tbToken(bad) } })); assert.equal(r.statusCode, 403); assert.equal(r.body, 'bad terminal');
});
test('success: getState CONFIRMED → 302 на заказ, статус paid', async () => {
  const { id, k } = await mkOrder();
  const r = await handler(ev('success', { q: { id, k } })); assert.equal(r.statusCode, 302);
  assert.ok(r.headers.Location.includes(`/merch/order/?id=${encodeURIComponent(id)}&k=${encodeURIComponent(k)}`), r.headers.Location);
  const s = await handler(ev('status', { q: { id, k } })); assert.equal(JSON.parse(s.body).status, 'paid');
});
test('success: getState бросает → всё равно 302 на заказ', async () => {
  const { id, k } = await mkOrder();
  const orig = ext.tbank.getState; ext.tbank.getState = async () => { throw new Error('tbank down'); };
  try {
    const r = await handler(ev('success', { q: { id, k } })); assert.equal(r.statusCode, 302);
    assert.ok(r.headers.Location.includes(`/merch/order/?id=${encodeURIComponent(id)}&k=`), r.headers.Location);
    const s = await handler(ev('status', { q: { id, k } })); assert.equal(JSON.parse(s.body).status, 'new');
  } finally { ext.tbank.getState = orig; }
});
test('admin: подделанный токен → 401; неверный status → 400', async () => {
  const H = await login();
  const t = H['X-Admin-Token']; const parts = t.split('.'); parts[1] = Buffer.from(JSON.stringify({ role: 'admin', exp: 9999999999 })).toString('base64url');
  let r = await handler(ev('admin/orders', { headers: { 'X-Admin-Token': parts.join('.') } })); assert.equal(r.statusCode, 401);
  r = await handler(ev('admin/orders', { headers: { 'X-Admin-Token': t.slice(0, -2) + 'zz' } })); assert.equal(r.statusCode, 401);
  r = await handler(ev('admin/orders', { headers: H, q: { status: 'hacked' } })); assert.equal(r.statusCode, 400); assert.equal(JSON.parse(r.body).field, 'status');
  r = await handler(ev('admin/orders', { headers: H, q: { status: 'paid' } })); assert.equal(r.statusCode, 200);
});
test('admin/product: удаление размера с reserved>0 → 409, sizes не меняются', async () => {
  const H = await login();
  const base = { id: P2, title: 'H2', description_md: '', price: 200, images: [], weight_g: 100, dims_cm: { x: 1, y: 1, z: 1 }, preorder_allowed: false, preorder_ship_by: '', active: true, sort: 2 };
  let r = await handler(ev('admin/product', { method: 'POST', headers: H, body: { ...base, sizes: ['S', 'M'], variants: [{ size: 'S', stock: 3 }, { size: 'M', stock: 3 }] } }));
  assert.equal(r.statusCode, 200, r.body);
  r = await handler(ev('order', { method: 'POST', body: { ...ORDER, product_id: P2, size: 'S' } })); assert.equal(r.statusCode, 200, r.body);
  r = await handler(ev('admin/product', { method: 'POST', headers: H, body: { ...base, title: 'H2-changed', sizes: ['M'], variants: [{ size: 'M', stock: 3 }] } }));
  assert.equal(r.statusCode, 409, r.body); assert.equal(JSON.parse(r.body).error, 'size_in_use'); assert.equal(JSON.parse(r.body).size, 'S');
  r = await handler(ev('admin/product', { headers: H, q: { id: P2 } })); const p = JSON.parse(r.body).product;
  assert.deepEqual(p.sizes, ['S', 'M']); assert.equal(p.title, 'H2');
  assert.equal(p.variants.find(v => v.size === 'S').reserved, 1);
});
test('admin/photo DELETE: плохой ключ → 400', async () => {
  const H = await login();
  for (const key of ['p/../x', 'p/test-h2/../../etc', 'p/test-h2/abc.exe', 'q/test-h2/abc.jpg']) {
    const r = await handler(ev('admin/photo', { method: 'DELETE', headers: H, body: { key } })); assert.equal(r.statusCode, 400, key); assert.equal(JSON.parse(r.body).field, 'key');
  }
});
