// Цифровые товары (спека 2026-09-25-products-design.md): заказ без ПД и вариантов, оплата → письма, download, отмена.
require('./_env');
const test = require('node:test'); const assert = require('node:assert');
const ext = require('../lib/ext'); const db = require('../lib/ydb'); const { tbToken } = require('../lib/tbank');
const orders = require('../lib/orders');

const calls = { init: [], cancel: [], mail: [] };
ext.tbank.init = async a => { calls.init.push(a); return { paymentId: 'PD' + calls.init.length, paymentUrl: 'https://pay.test/' + a.orderId }; };
ext.tbank.getState = async () => ({ Success: true, Status: 'CONFIRMED', Amount: 11100 });
ext.tbank.cancel = async pid => { calls.cancel.push(pid); return { Success: true, Status: 'REFUNDED' }; };
ext.mail.send = async m => { calls.mail.push(m); };
ext.yd.mode = () => 'off'; ext.yd.quote = async () => ({ price_rub: 400, days: null });
ext.yd.createRequest = async () => { throw new Error('yd не должен вызываться для цифрового'); };
const { handler } = require('../index');
const ev = (a, { method = 'GET', body, q = {}, headers = {} } = {}) => ({ httpMethod: method, queryStringParameters: { a, ...q }, headers, body: body ? JSON.stringify(body) : undefined, isBase64Encoded: false });
const body = r => JSON.parse(r.body);

const D = 'test-dig', D2 = 'test-dig-nofile', FK = 'd/test-dig/abc123.zip';
test.after(async () => (await db.getDriver()).destroy());
test.before(async () => {
  await db.query(`DECLARE $d AS Utf8; DECLARE $d2 AS Utf8; DECLARE $fk AS Utf8;
    DELETE FROM variants WHERE product_id = $d OR product_id = $d2; DELETE FROM orders WHERE product_id = $d OR product_id = $d2;
    UPSERT INTO products (id, title, description_md, price, images, weight_g, dims_cm, sizes, preorder_allowed, preorder_ship_by, active, sort, updated_at, kind, file_key)
    VALUES ($d, 'Скилл-тест'u, 'md'u, 111, Json('[]'), 0, Json('{"x":1,"y":1,"z":1}'), Json('[]'), false, ''u, true, 90, CurrentUtcTimestamp(), 'digital'u, $fk),
           ($d2, 'Без файла'u, ''u, 50, Json('[]'), 0, Json('{"x":1,"y":1,"z":1}'), Json('[]'), false, ''u, true, 91, CurrentUtcTimestamp(), 'digital'u, ''u);`,
  { $d: db.V.s(D), $d2: db.V.s(D2), $fk: db.V.s(FK) });
});
const ORDER = { product_id: D, email: 'Buyer@Example.com', offer: true, consent: true };
const mkOrder = async (over = {}) => { const r = await handler(ev('order', { method: 'POST', body: { ...ORDER, ...over } })); assert.equal(r.statusCode, 200, r.body); return body(r); };
const pay = async id => { const n = { TerminalKey: process.env.TB_TERMINAL, OrderId: id, PaymentId: 'PAY-' + id, Status: 'CONFIRMED', Amount: 11100, Success: true };
  const r = await handler(ev('notify', { method: 'POST', body: { ...n, Token: tbToken(n) } })); assert.equal(r.body, 'OK'); };
const row = async id => (await db.query(`DECLARE $id AS Utf8; SELECT * FROM orders WHERE id = $id;`, { $id: db.V.s(id) }))[0][0];
const variantsOf = async p => (await db.query(`DECLARE $p AS Utf8; SELECT * FROM variants WHERE product_id = $p;`, { $p: db.V.s(p) }))[0];
const login = async () => { const r = await handler(ev('admin/login', { method: 'POST', body: { password: process.env.ADMIN_PASSWORD } })); return { 'X-Admin-Token': body(r).token }; };

test('catalog: по умолчанию только physical, &kind=digital — только digital', async () => {
  const all = body(await handler(ev('catalog'))).products;
  assert.ok(!all.some(p => p.id === D), 'цифровой товар в витрине мерча');
  assert.ok(all.every(p => p.kind === 'physical'));
  const dig = body(await handler(ev('catalog', { q: { kind: 'digital' } }))).products;
  assert.ok(dig.some(p => p.id === D)); assert.ok(dig.every(p => p.kind === 'digital'));
  assert.ok(dig.every(p => !('file_key' in p) && typeof p.has_file === 'boolean'));
  assert.equal(dig.find(p => p.id === D).has_file, true); assert.equal(dig.find(p => p.id === D2).has_file, false);
});

test('product: kind, has_file, без file_key', async () => {
  let p = body(await handler(ev('product', { q: { s: D } }))).product;
  assert.equal(p.kind, 'digital'); assert.equal(p.has_file, true); assert.ok(!('file_key' in p));
  p = body(await handler(ev('product', { q: { s: D2 } }))).product; assert.equal(p.has_file, false);
});

test('order digital: отказ без offer / consent / email / файла', async () => {
  for (const [over, field] of [[{ offer: false }, 'offer'], [{ consent: undefined }, 'consent'], [{ email: 'nope' }, 'email']]) {
    const r = await handler(ev('order', { method: 'POST', body: { ...ORDER, ...over } }));
    assert.equal(r.statusCode, 400, r.body); assert.equal(body(r).field, field);
  }
  const r = await handler(ev('order', { method: 'POST', body: { ...ORDER, product_id: D2 } }));
  assert.equal(r.statusCode, 409, r.body); assert.equal(body(r).error, 'no_file');
});

test('order digital: без ПД и вариантов, чек intellectual_activity, failUrl /products/order/', async () => {
  calls.init.length = 0;
  const { id, k, paymentUrl } = await mkOrder({ name: 'Иван', phone: '+79990000000', address_text: 'Москва, улица 1', size: 'XL', qty: 3 });
  assert.match(id, /^M-\d{6}$/); assert.equal(k.length, 16); assert.ok(paymentUrl);
  const o = await row(id);
  assert.deepEqual([o.customer_name, o.customer_phone, o.address_text, o.pvz_id, o.pvz_address], ['', '', '', '', '']);
  assert.equal(o.customer_email, 'buyer@example.com');
  assert.deepEqual([o.qty, o.size, o.price_item, o.price_delivery, o.total, o.delivery_mode, o.is_preorder], [1, '-', 111, 0, 111, 'none', false]);
  assert.equal(o.downloaded_at, null);
  assert.equal((await variantsOf(D)).length, 0, 'варианты не создаются');
  const a = calls.init.at(-1);
  assert.equal(a.amountRub, 111);
  assert.deepEqual(a.receiptItems, [{ name: 'Скилл-тест', price_rub: 111, qty: 1, object: 'intellectual_activity', method: 'full_payment' }]);
  assert.ok(a.failUrl.includes(`/products/order/?id=${id}&k=${k}&fail=1`), a.failUrl);
  assert.ok(a.successUrl.includes('a=success'));
});

test('download до оплаты → 403, чужой ключ → 404; оплата → письма; download → 302, повтор → count=2', async () => {
  const { id, k } = await mkOrder();
  let r = await handler(ev('download', { q: { id, k } })); assert.equal(r.statusCode, 403); assert.equal(body(r).error, 'not_paid');
  r = await handler(ev('download', { q: { id, k: 'wrongwrongwrong0' } })); assert.equal(r.statusCode, 404); assert.equal(body(r).error, 'no_order');
  let s = body(await handler(ev('status', { q: { id, k } })));
  assert.deepEqual([s.kind, s.can_download, s.downloaded], ['digital', false, false]);

  calls.mail.length = 0;
  await pay(id);
  assert.equal((await row(id)).status, 'paid');
  assert.equal(calls.mail.length, 2);
  const owner = calls.mail.find(m => m.to === process.env.OWNER_EMAIL), buyer = calls.mail.find(m => m.to === 'buyer@example.com');
  assert.ok(owner && buyer, JSON.stringify(calls.mail.map(m => m.to)));
  assert.ok(!owner.html.includes('buyer@example.com') && !owner.text.includes('buyer@example.com'), 'ПД в письме владельцу');
  assert.ok(buyer.subject.includes('Доступ открыт'), buyer.subject);
  assert.ok(buyer.text.includes(`/products/order/?id=${id}&k=${k}`), buyer.text);

  s = body(await handler(ev('status', { q: { id, k } })));
  assert.deepEqual(Object.keys(s).sort(), ['can_download', 'downloaded', 'id', 'is_preorder', 'kind', 'preorder_ship_by', 'status', 'total']);
  assert.deepEqual([s.status, s.can_download, s.downloaded], ['paid', true, false]);

  r = await handler(ev('download', { q: { id, k } }));
  assert.equal(r.statusCode, 302, r.body);
  const loc = new URL(r.headers.Location);
  assert.equal(loc.host, 'storage.yandexcloud.net'); assert.equal(loc.pathname, `/${process.env.S3_BUCKET}/${FK}`);
  assert.match(loc.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/);
  assert.equal(loc.searchParams.get('X-Amz-Expires'), '600');
  assert.equal(loc.searchParams.get('response-content-disposition'), `attachment; filename="${D}.zip"`);
  let o = await row(id); assert.ok(o.downloaded_at instanceof Date); assert.equal(o.download_count, 1);
  const first = o.downloaded_at.getTime();
  s = body(await handler(ev('status', { q: { id, k } }))); assert.equal(s.downloaded, true);

  r = await handler(ev('download', { q: { id, k } })); assert.equal(r.statusCode, 302);
  o = await row(id); assert.equal(o.download_count, 2); assert.equal(o.downloaded_at.getTime(), first, 'downloaded_at — только первое скачивание');
});

test('download: товар без файла после оплаты → 409 no_file; физический заказ → 404', async () => {
  const { id, k } = await mkOrder();
  await pay(id);
  await db.query(`DECLARE $d AS Utf8; UPDATE products SET file_key = ''u WHERE id = $d;`, { $d: db.V.s(D) });
  try {
    const r = await handler(ev('download', { q: { id, k } })); assert.equal(r.statusCode, 409); assert.equal(body(r).error, 'no_file');
  } finally { await db.query(`DECLARE $d AS Utf8; DECLARE $fk AS Utf8; UPDATE products SET file_key = $fk WHERE id = $d;`, { $d: db.V.s(D), $fk: db.V.s(FK) }); }
});

test('success: цифровой заказ → 302 на /products/order/', async () => {
  const { id, k } = await mkOrder();
  const r = await handler(ev('success', { q: { id, k } })); assert.equal(r.statusCode, 302);
  assert.ok(r.headers.Location.includes(`/products/order/?id=${encodeURIComponent(id)}&k=${encodeURIComponent(k)}`), r.headers.Location);
  assert.equal((await row(id)).status, 'paid');
});

// Просрочка (gc → releaseNew) не проверяется через глобальный gc(): он тронул бы заказы параллельного orders.test.js;
// releaseNew для цифрового заказа проверяет отмена из new.
test('отмена с возвратом из paid и отмена new — без вариантов; admin next → 409', async () => {
  const { id } = await mkOrder(); await pay(id); calls.cancel.length = 0; calls.mail.length = 0;
  const o = await orders.cancel(id);
  assert.equal(o.status, 'cancelled'); assert.deepEqual(calls.cancel, ['PAY-' + id]); assert.equal(calls.mail.length, 1);
  const y = await mkOrder(); assert.equal((await orders.cancel(y.id)).status, 'cancelled');
  assert.equal((await variantsOf(D)).length, 0);
  // admin next для цифрового запрещён: packed/shipped закрыли бы покупателю скачивание
  const z = await mkOrder(); await pay(z.id);
  const H = await login();
  const r = await handler(ev('admin/order', { method: 'POST', headers: H, body: { id: z.id, action: 'next' } }));
  assert.equal(r.statusCode, 409, r.body); assert.equal(body(r).error, 'bad_transition');
  assert.equal((await row(z.id)).status, 'paid');
});

test('admin: product kind/file_key с валидацией, admin/file, admin/orders с downloaded_at/download_count/kind', async () => {
  const H = await login();
  const base = { id: D2, title: 'Без файла', description_md: '', price: 50, images: [], active: true, sort: 91, kind: 'digital' };
  for (const fk of ['d/other/abc.zip', 'd/test-dig-nofile/../x.zip', 'd/test-dig-nofile/ABC.zip', 'p/test-dig-nofile/abc.jpg']) {
    const r = await handler(ev('admin/product', { method: 'POST', headers: H, body: { ...base, file_key: fk } }));
    assert.equal(r.statusCode, 400, fk); assert.equal(body(r).field, 'file_key');
  }
  let r = await handler(ev('admin/product', { method: 'POST', headers: H, body: { ...base, kind: 'weird' } })); assert.equal(r.statusCode, 400); assert.equal(body(r).field, 'kind');

  r = await handler(ev('admin/file', { method: 'POST', headers: H, body: { product_id: D2 } })); assert.equal(r.statusCode, 200, r.body);
  const f = body(r); assert.match(f.key, /^d\/test-dig-nofile\/[0-9a-f]+\.zip$/); assert.ok(f.put_url.includes('X-Amz-Signature'));
  r = await handler(ev('admin/file', { method: 'POST', headers: H, body: { product_id: '../x' } })); assert.equal(r.statusCode, 400);

  r = await handler(ev('admin/product', { method: 'POST', headers: H, body: { ...base, file_key: f.key } })); assert.equal(r.statusCode, 200, r.body);
  let p = body(r).product; assert.equal(p.kind, 'digital'); assert.equal(p.file_key, f.key); assert.equal(p.has_file, true);
  assert.equal((await variantsOf(D2)).length, 0, 'у цифрового товара нет вариантов');
  // Тело без file_key (старая форма админки) не стирает архив
  r = await handler(ev('admin/product', { method: 'POST', headers: H, body: { ...base, title: 'Без файла 2', file_key: undefined } }));
  p = body(r).product; assert.equal(p.file_key, f.key); assert.equal(p.title, 'Без файла 2');
  r = await handler(ev('admin/product', { method: 'POST', headers: H, body: { ...base, file_key: '' } }));
  assert.equal(body(r).product.has_file, false);

  const { id, k } = await mkOrder(); await pay(id); await handler(ev('download', { q: { id, k } }));
  const list = body(await handler(ev('admin/orders', { headers: H }))).orders;
  const o = list.find(x => x.id === id);
  assert.equal(o.kind, 'digital'); assert.equal(o.download_count, 1); assert.ok(o.downloaded_at);
  // admin/order GET и POST (note, cancel) — kind, downloaded_at, download_count для предупреждения перед возвратом
  let one = body(await handler(ev('admin/order', { headers: H, q: { id } }))).order;
  assert.deepEqual([one.kind, one.download_count, one.downloaded_at instanceof Date || typeof one.downloaded_at === 'string'], ['digital', 1, true]);
  one = body(await handler(ev('admin/order', { method: 'POST', headers: H, body: { id, action: 'note', note: 'n' } }))).order;
  assert.deepEqual([one.kind, one.download_count, !!one.downloaded_at], ['digital', 1, true]);
  one = body(await handler(ev('admin/order', { method: 'POST', headers: H, body: { id, action: 'cancel' } }))).order;
  assert.deepEqual([one.status, one.kind, one.download_count, !!one.downloaded_at], ['cancelled', 'digital', 1, true]);
  // Физические заказы параллельных тест-файлов удаляются их очисткой — берём первый, который ещё существует
  let ph = null; for (const x of list.filter(x => x.kind === 'physical')) if ((ph = await orders.getOrder(x.id))) break;
  if (ph) assert.deepEqual([ph.kind, ph.download_count, ph.downloaded_at], ['physical', 0, null]);
  const phys = list.find(x => x.kind !== 'digital'); if (phys) { assert.equal(phys.kind, 'physical'); assert.equal(phys.download_count, 0); }
  const s = body(await handler(ev('admin/summary', { headers: H }))); assert.ok(Number.isFinite(s.to_ship));
});
