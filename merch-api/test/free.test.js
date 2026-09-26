// Бесплатный период цифрового товара: до free_until сервер отдаёт бесплатный архив (с объявлением), после — только покупка.
// Время решает сервер: таймер на странице лишь показывает.
require('./_env');
const test = require('node:test'); const assert = require('node:assert');
const ext = require('../lib/ext'); const db = require('../lib/ydb');
ext.tbank.init = async a => ({ paymentId: 'PF1', paymentUrl: 'https://pay.test/' + a.orderId });
ext.mail.send = async () => {};
const { handler } = require('../index'); const orders = require('../lib/orders');
const ev = (a, { method = 'GET', body, q = {}, headers = {} } = {}) => ({ httpMethod: method, queryStringParameters: { a, ...q }, headers, body: body ? JSON.stringify(body) : undefined, isBase64Encoded: false });
const body = r => JSON.parse(r.body);

const F = 'test-free', FK = 'd/test-free/aa11.zip', FFK = 'd/test-free/bb22.zip';
const setProduct = async ({ until = '', ffk = FFK, active = true } = {}) => db.query(`DECLARE $id AS Utf8; DECLARE $fk AS Utf8; DECLARE $ffk AS Utf8; DECLARE $u AS Utf8; DECLARE $a AS Bool;
  UPSERT INTO products (id, title, description_md, price, images, weight_g, dims_cm, sizes, preorder_allowed, preorder_ship_by, active, sort, updated_at, kind, file_key, free_file_key, free_until)
  VALUES ($id, 'Бесплатный тест'u, ''u, 111, Json('[]'), 0, Json('{"x":1,"y":1,"z":1}'), Json('[]'), false, ''u, $a, 92, CurrentUtcTimestamp(), 'digital'u, $fk, $ffk, $u);`,
  { $id: db.V.s(F), $fk: db.V.s(FK), $ffk: db.V.s(ffk), $u: db.V.s(until), $a: db.V.b(active) });
const soon = (min) => new Date(Date.now() + min * 60000).toISOString();
test.after(async () => { await db.query(`DECLARE $id AS Utf8; DELETE FROM products WHERE id = $id; DELETE FROM orders WHERE product_id = $id;`, { $id: db.V.s(F) }); (await db.getDriver()).destroy(); });

test('product во время акции: free_active, free_until, now; ключ бесплатного архива не отдаётся', async () => {
  const until = soon(60); await setProduct({ until });
  const r = body(await handler(ev('product', { q: { s: F } })));
  assert.equal(r.product.free_active, true); assert.equal(r.product.free_until, until); assert.equal(r.product.has_free_file, true);
  assert.ok(!('free_file_key' in r.product) && !('file_key' in r.product)); assert.ok(Date.parse(r.now) > 0);
  const c = body(await handler(ev('catalog', { q: { kind: 'digital' } }))).products.find(p => p.id === F);
  assert.equal(c.free_active, true); assert.equal(c.free_until, until); assert.ok(!('free_file_key' in c));
});

test('free во время акции → 302 на presigned бесплатного архива', async () => {
  await setProduct({ until: soon(60) });
  const r = await handler(ev('free', { q: { s: F } }));
  assert.equal(r.statusCode, 302); const loc = r.headers.Location;
  assert.ok(loc.includes('/d/test-free/bb22.zip') && loc.includes('X-Amz-Signature') && loc.includes('test-free-free.zip'), loc);
});

test('после дедлайна: free → 410 promo_over, free_active=false; покупка платной версии работает', async () => {
  await setProduct({ until: soon(-1) });
  await assert.rejects(orders.freeDownload(F), e => e.code === 410 && e.error === 'promo_over');
  const r = await handler(ev('free', { q: { s: F } })); assert.equal(r.statusCode, 302);
  assert.ok(r.headers.Location.endsWith('/products/p/?s=test-free&free=promo_over'), r.headers.Location);
  const p = body(await handler(ev('product', { q: { s: F } }))).product; assert.equal(p.free_active, false);
  const o = await handler(ev('order', { method: 'POST', body: { product_id: F, email: 'a@b.ru', offer: true, consent: true } }));
  assert.equal(o.statusCode, 200, o.body);
});

test('free: без бесплатного архива → 409, выключенный товар → 404, без акции → 410', async () => {
  await setProduct({ until: soon(60), ffk: '' });
  await assert.rejects(orders.freeDownload(F), e => e.code === 409 && e.error === 'no_file');
  await setProduct({ until: soon(60), active: false });
  await assert.rejects(orders.freeDownload(F), e => e.code === 404);
  await setProduct({ until: '' });
  await assert.rejects(orders.freeDownload(F), e => e.code === 410);
});

test('admin/product: free_until (ISO или пусто) и free_file_key с валидацией, не стираются без полей', async () => {
  const H = { 'X-Admin-Token': body(await handler(ev('admin/login', { method: 'POST', body: { password: process.env.ADMIN_PASSWORD } }))).token };
  await setProduct({ until: '' });
  const base = { id: F, title: 'Бесплатный тест', price: 111, images: [], active: true, sort: 92, kind: 'digital' };
  let r = await handler(ev('admin/product', { method: 'POST', headers: H, body: { ...base, free_until: 'завтра' } })); assert.equal(r.statusCode, 400); assert.equal(body(r).field, 'free_until');
  r = await handler(ev('admin/product', { method: 'POST', headers: H, body: { ...base, free_file_key: 'd/other/aa.zip' } })); assert.equal(r.statusCode, 400); assert.equal(body(r).field, 'free_file_key');
  const until = '2031-01-02T03:04:05.000Z';
  r = await handler(ev('admin/product', { method: 'POST', headers: H, body: { ...base, free_until: '2031-01-02T06:04:05+03:00', free_file_key: 'd/test-free/cc33.zip' } }));
  assert.equal(r.statusCode, 200, r.body); let p = body(r).product; assert.equal(p.free_until, until); assert.equal(p.free_file_key, 'd/test-free/cc33.zip');
  r = await handler(ev('admin/product', { method: 'POST', headers: H, body: { ...base, title: 'Без полей акции' } }));
  p = body(r).product; assert.equal(p.free_until, until); assert.equal(p.free_file_key, 'd/test-free/cc33.zip'); assert.equal(p.file_key, FK);
  r = await handler(ev('admin/product', { method: 'POST', headers: H, body: { ...base, free_until: '', free_file_key: '' } }));
  p = body(r).product; assert.equal(p.free_until, ''); assert.equal(p.has_free_file, false); assert.equal(p.free_active, false);
});
