// Практикум (kind='diploma'): заказ с именем и e-mail, без вариантов и резерва, чек service; после оплаты — status.diploma.
require('./_env');
const test = require('node:test'); const assert = require('node:assert');
const ext = require('../lib/ext'); const db = require('../lib/ydb'); const { tbToken } = require('../lib/tbank');

const calls = { init: [], cancel: [], mail: [] };
ext.tbank.init = async a => { calls.init.push(a); return { paymentId: 'PDP' + calls.init.length, paymentUrl: 'https://pay.test/' + a.orderId }; };
ext.tbank.getState = async () => ({ Success: true, Status: 'CONFIRMED', Amount: 22200 });
ext.tbank.cancel = async pid => { calls.cancel.push(pid); return { Success: true, Status: 'REFUNDED' }; };
ext.mail.send = async m => { calls.mail.push(m); };
ext.yd.mode = () => 'off'; ext.yd.quote = async () => ({ price_rub: 400, days: null });
ext.yd.createRequest = async () => { throw new Error('yd не должен вызываться для практикума'); };
const { handler } = require('../index');
const ev = (a, { method = 'GET', body, q = {}, headers = {} } = {}) => ({ httpMethod: method, queryStringParameters: { a, ...q }, headers, body: body ? JSON.stringify(body) : undefined, isBase64Encoded: false });
const body = r => JSON.parse(r.body);

const P = 'test-diploma';
const row = async id => (await db.query(`DECLARE $id AS Utf8; SELECT * FROM orders WHERE id = $id;`, { $id: db.V.s(id) }))[0][0];
const variantsOf = async p => (await db.query(`DECLARE $p AS Utf8; SELECT * FROM variants WHERE product_id = $p;`, { $p: db.V.s(p) }))[0];
const login = async () => { const r = await handler(ev('admin/login', { method: 'POST', body: { password: process.env.ADMIN_PASSWORD } })); return { 'X-Admin-Token': body(r).token }; };
test.after(async () => (await db.getDriver()).destroy());
test.before(async () => {
  await db.query(`DECLARE $p AS Utf8;
    DELETE FROM variants WHERE product_id = $p; DELETE FROM orders WHERE product_id = $p;
    UPSERT INTO products (id, title, description_md, price, images, weight_g, dims_cm, sizes, preorder_allowed, preorder_ship_by, active, sort, updated_at, kind, file_key, free_file_key, free_until, event_at, venue, age_mark)
    VALUES ($p, 'Практикум-тест'u, 'md'u, 222, Json('[]'), 0, Json('{"x":1,"y":1,"z":1}'), Json('[]'), false, ''u, true, 97, CurrentUtcTimestamp(), 'diploma'u, ''u, ''u, ''u, ''u, ''u, ''u);`,
  { $p: db.V.s(P) });
});
const ORDER = { product_id: P, name: '  Анна-Мария   д’Арк Ё.  ', email: 'Student@Example.com', offer: true, consent: true };
const mkOrder = async (over = {}) => { const r = await handler(ev('order', { method: 'POST', body: { ...ORDER, ...over } })); assert.equal(r.statusCode, 200, r.body); return body(r); };
const pay = async id => { const n = { TerminalKey: process.env.TB_TERMINAL, OrderId: id, PaymentId: 'PAY-' + id, Status: 'CONFIRMED', Amount: 22200, Success: true };
  const r = await handler(ev('notify', { method: 'POST', body: { ...n, Token: tbToken(n) } })); assert.equal(r.body, 'OK'); };

test('catalog/product: практикум в разделе «Продукты», в мерче его нет', async () => {
  const dig = body(await handler(ev('catalog', { q: { kind: 'digital' } }))).products;
  const d = dig.find(p => p.id === P);
  assert.ok(d, 'практикум в каталоге продуктов');
  assert.deepEqual([d.kind, d.price, d.title, d.has_file, d.free_active], ['diploma', 222, 'Практикум-тест', false, false]);
  assert.ok(!('left' in d) && !('event_at' in d), 'без полей мероприятия');
  const merch = body(await handler(ev('catalog'))).products;
  assert.ok(!merch.some(p => p.id === P));
  const p = body(await handler(ev('product', { q: { s: P } }))).product;
  assert.deepEqual([p.kind, p.price, p.variants.length], ['diploma', 222, 0]);
  assert.ok(!('file_key' in p));
});

test('order: валидация name / email / offer / consent', async () => {
  const cases = [[{ name: undefined }, 'name'], [{ name: 'А' }, 'name'], [{ name: ' А ' }, 'name'], [{ name: 'Я'.repeat(61) }, 'name'],
    [{ name: 'Иван2' }, 'name'], [{ name: 'Иван <b>' }, 'name'], [{ name: 'Ivan_Petrov' }, 'name'],
    [{ email: 'x' }, 'email'], [{ email: '' }, 'email'], [{ offer: false }, 'offer'], [{ offer: undefined }, 'offer'], [{ consent: undefined }, 'consent']];
  for (const [over, field] of cases) {
    const r = await handler(ev('order', { method: 'POST', body: { ...ORDER, ...over } }));
    assert.equal(r.statusCode, 400, JSON.stringify(over) + ' ' + r.body); assert.equal(body(r).field, field, JSON.stringify(over));
  }
  // граница 60 символов и латиница проходят
  const { id } = await mkOrder({ name: 'Jean-Luc O\'Neil ' + 'a'.repeat(44) });
  assert.equal((await row(id)).customer_name.length, 60);
});

test('order → имя сохранено, qty 1, чек service; до оплаты без diploma; оплата → diploma в status, писем покупателю нет; отмена → возврат', async () => {
  calls.init.length = 0; calls.mail.length = 0;
  const { id, k, paymentUrl } = await mkOrder({ qty: 4, phone: '+79990000000' });
  assert.ok(paymentUrl); assert.match(id, /^M-\d{6}$/);
  let o = await row(id);
  assert.deepEqual([o.customer_name, o.customer_phone, o.customer_email, o.qty, o.price_item, o.total, o.delivery_mode, o.size, o.status, o.is_preorder],
    ['Анна-Мария д’Арк Ё.', '', 'student@example.com', 1, 222, 222, 'diploma', '-', 'new', false]);
  assert.equal((await variantsOf(P)).length, 0, 'вариантов и резерва нет');
  const a = calls.init.at(-1);
  assert.equal(a.amountRub, 222); assert.equal(a.description, `Заказ ${id}: Практикум-тест`); assert.equal(a.email, 'student@example.com');
  assert.deepEqual(a.receiptItems, [{ name: 'Практикум: Практикум-тест', price_rub: 222, qty: 1, object: 'service', method: 'full_payment' }]);
  assert.ok(a.failUrl.includes(`/products/order/?id=${id}&k=${k}&fail=1`));
  assert.ok(a.successUrl.includes(`?a=success&id=${id}&k=${k}`)); assert.ok(a.notifyUrl.endsWith('?a=notify'));

  let s = body(await handler(ev('status', { q: { id, k } })));
  assert.equal(s.kind, 'diploma'); assert.equal(s.status, 'new'); assert.ok(!('diploma' in s), 'диплом до оплаты не отдаётся');
  assert.ok(!('ticket' in s)); assert.equal(s.can_download, false);
  assert.equal((await handler(ev('status', { q: { id, k: 'wrong' } }))).statusCode, 404);

  const before = Date.now();
  await pay(id);
  o = await row(id); assert.equal(o.status, 'paid');
  assert.ok(!calls.mail.some(m => m.to === 'student@example.com'), 'покупателю писем нет');
  const owner = calls.mail.find(m => m.to === process.env.OWNER_EMAIL);
  assert.ok(owner, 'письмо владельцу');
  assert.ok(!owner.text.includes('student@example.com') && !owner.text.includes('Анна'), 'письмо владельцу без ПД');
  assert.ok(owner.text.includes('Практикум'), owner.text);
  s = body(await handler(ev('status', { q: { id, k } })));
  assert.deepEqual({ ...s.diploma, date: undefined }, { number: id, name: 'Анна-Мария д’Арк Ё.', title: 'Практикум-тест', date: undefined });
  assert.match(s.diploma.date, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.ok(Math.abs(Date.parse(s.diploma.date) - before) < 120000, 'дата — момент оплаты');
  assert.equal(s.can_download, false); assert.ok(!('ticket' in s));
  const sr = await handler(ev('success', { q: { id, k } }));
  assert.ok(sr.headers.Location.includes(`/products/order/?id=${id}&k=${k}`), sr.headers.Location);
  const pr = await handler(ev('pay', { q: { id, k } }));
  assert.ok(pr.headers.Location.includes(`/products/order/?id=${id}&k=${k}`), pr.headers.Location);
  assert.equal((await handler(ev('download', { q: { id, k } }))).statusCode, 404, 'скачивать нечего');

  const H = await login();
  const list = body(await handler(ev('admin/orders', { headers: H, q: { status: 'paid' } }))).orders;
  const lo = list.find(x => x.id === id); assert.ok(lo); assert.equal(lo.kind, 'diploma'); assert.equal(lo.customer_name, 'Анна-Мария д’Арк Ё.');
  assert.equal((await handler(ev('admin/summary', { headers: H }))).statusCode, 200); // summary считает только kind === 'physical'
  let r = await handler(ev('admin/order', { method: 'POST', headers: H, body: { id, action: 'next' } }));
  assert.equal(r.statusCode, 409, 'у практикума нет «собран/отправлен»');
  r = await handler(ev('admin/order', { method: 'POST', headers: H, body: { id, action: 'cancel' } }));
  assert.equal(r.statusCode, 200, r.body); assert.equal(body(r).order.status, 'cancelled'); assert.equal(body(r).order.kind, 'diploma');
  assert.deepEqual(calls.cancel.at(-1), 'PAY-' + id, 'возврат через Т-Банк');
  assert.equal((await variantsOf(P)).length, 0, 'вариантов не появилось');
  s = body(await handler(ev('status', { q: { id, k } })));
  assert.equal(s.status, 'cancelled'); assert.ok(!('diploma' in s), 'у отменённого диплома нет');
});

test('неоплаченный заказ истекает; поздняя оплата → автовозврат', async () => {
  const { id, k } = await mkOrder();
  await db.query(`DECLARE $id AS Utf8; DECLARE $t AS Timestamp; UPDATE orders SET created_at = $t WHERE id = $id;`, { $id: db.V.s(id), $t: db.V.ts(new Date(Date.now() - 3600000)) });
  await handler(ev('catalog'));
  assert.equal((await row(id)).status, 'expired');
  assert.equal((await variantsOf(P)).length, 0);
  calls.cancel.length = 0;
  await pay(id);
  assert.equal((await row(id)).status, 'expired'); assert.deepEqual(calls.cancel, ['PAY-' + id]);
  assert.ok(!('diploma' in body(await handler(ev('status', { q: { id, k } })))));
});

test('purgePd обезличивает имя практикума', async () => {
  const { id } = await mkOrder();
  await db.query(`DECLARE $id AS Utf8; DECLARE $t AS Timestamp; UPDATE orders SET created_at = $t, status = 'cancelled'u WHERE id = $id;`, { $id: db.V.s(id), $t: db.V.ts(new Date(Date.now() - 1200 * 86400000)) });
  await require('../lib/orders').purgePd();
  const o = await row(id);
  assert.deepEqual([o.customer_name, o.customer_email], ['', '']);
});

test('admin/product: kind diploma — без вариантов, архивов, акции, полей мероприятия; admin/products отдаёт diploma', async () => {
  const H = await login();
  const b = { id: P, title: 'Практикум-тест', description_md: 'md', price: 222, images: [], active: true, sort: 97, kind: 'diploma',
    sizes: ['S', 'M'], variants: [{ size: 'S', stock: 5 }], file_key: `d/${P}/abc.zip`, free_file_key: `d/${P}/def.zip`, free_until: new Date(Date.now() + 86400000).toISOString(),
    event_at: new Date(Date.now() + 86400000).toISOString(), venue: 'Где-то', age_mark: '16+', preorder_allowed: true };
  const r = await handler(ev('admin/product', { method: 'POST', headers: H, body: b }));
  assert.equal(r.statusCode, 200, r.body);
  const p = body(r).product;
  assert.deepEqual([p.kind, p.sizes.length, p.variants.length, p.file_key, p.free_file_key, p.free_until, p.event_at, p.venue, p.age_mark, p.preorder_allowed],
    ['diploma', 0, 0, '', '', '', '', '', '', false]);
  assert.equal((await variantsOf(P)).length, 0);
  // kind не пришёл — остаётся diploma
  const { kind, ...noKind } = b;
  assert.equal(body(await handler(ev('admin/product', { method: 'POST', headers: H, body: noKind }))).product.kind, 'diploma');
  const list = body(await handler(ev('admin/products', { headers: H }))).products;
  assert.equal(list.find(x => x.id === P).kind, 'diploma');
  const bad = await handler(ev('admin/product', { method: 'POST', headers: H, body: { ...b, kind: 'course' } }));
  assert.equal(bad.statusCode, 400); assert.equal(body(bad).field, 'kind');
});
