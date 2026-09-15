require('./_env');
const test = require('node:test'); const assert = require('node:assert');
const db = require('../lib/ydb'); const ext = require('../lib/ext');
const orders = require('../lib/orders');

// Драйвер держит gRPC-соединения — без destroy() процесс node --test не завершится.
test.after(async () => (await db.getDriver()).destroy());

// Подмены внешних сервисов
const calls = { init: [], cancel: [], mail: [], yd: [] };
ext.tbank.init = async a => { calls.init.push(a); return { paymentId: 'P' + calls.init.length, paymentUrl: 'https://pay.test/' + a.orderId }; };
ext.tbank.cancel = async pid => { calls.cancel.push(pid); return { Success: true, Status: 'REFUNDED' }; };
ext.mail.send = async m => { calls.mail.push(m); };
ext.yd.quote = async () => ({ price_rub: 300, days: 3 });
ext.yd.mode = () => 'test';
ext.yd.createRequest = async o => { calls.yd.push(o.id); return { request_id: 'R' + o.id, track_url: 'https://t/' + o.id }; };

const P = 'test-tee';
async function seed(stock, preorder = false) {
  await db.query(`DECLARE $p AS Utf8; DELETE FROM variants WHERE product_id = $p; DELETE FROM products WHERE id = $p; DELETE FROM orders WHERE product_id = $p;`, { $p: db.V.s(P) });
  await db.query(`DECLARE $p AS Utf8; DECLARE $pre AS Bool; UPSERT INTO products (id, title, description_md, price, images, weight_g, dims_cm, sizes, preorder_allowed, preorder_ship_by, active, sort, updated_at)
    VALUES ($p, 'Тест-футболка'u, 'md'u, 1500, Json('[]'), 300, Json('{"x":30,"y":20,"z":3}'), Json('["M","L"]'), $pre, '2026-10-15'u, true, 1, CurrentUtcTimestamp());`, { $p: db.V.s(P), $pre: db.V.b(preorder) });
  await db.query(`DECLARE $p AS Utf8; DECLARE $st AS Int32;
    UPSERT INTO variants (product_id, size, stock, reserved, preorder_count) VALUES ($p, 'M'u, $st, 0, 0), ($p, 'L'u, 0, 0, 0);`, { $p: db.V.s(P), $st: db.V.i(stock) });
}
const input = (over = {}) => ({ product_id: P, size: 'M', qty: 1, name: 'Тест Тестов', phone: '89990000000', email: 'buyer@example.com', pvz_id: 'PVZ1', pvz_address: 'Москва, пункт 1', consent: true, ...over });

test('createOrder: резерв, Init, номер и ключ', async () => {
  await seed(2);
  const r = await orders.createOrder(input());
  assert.match(r.id, /^M-\d{6}$/); assert.equal(r.k.length, 16); assert.ok(r.paymentUrl.includes(r.id));
  const [[v]] = await db.query(`DECLARE $p AS Utf8; SELECT reserved FROM variants WHERE product_id=$p AND size='M'u;`, { $p: db.V.s(P) });
  assert.equal(v.reserved, 1);
  const st = await orders.getStatus(r.id, r.k); assert.equal(st.status, 'new'); assert.equal(st.total, 1800);
  assert.equal(await orders.getStatus(r.id, 'wrongkey'), null);
  assert.equal(calls.init.at(-1).amountRub, 1800);
});

test('гонка: последняя единица — один из двух получает 409', async () => {
  await seed(1, false);
  const rs = await Promise.allSettled([orders.createOrder(input()), orders.createOrder(input())]);
  const ok = rs.filter(r => r.status === 'fulfilled'), bad = rs.filter(r => r.status === 'rejected');
  assert.equal(ok.length, 1); assert.equal(bad.length, 1); assert.equal(bad[0].reason.error, 'sold_out');
  const [[v]] = await db.query(`DECLARE $p AS Utf8; SELECT reserved FROM variants WHERE product_id=$p AND size='M'u;`, { $p: db.V.s(P) }); assert.equal(v.reserved, 1);
});

test('confirmPaid: идемпотентен, списывает, шлёт 2 письма и заявку', async () => {
  await seed(3); calls.mail.length = 0; calls.yd.length = 0;
  const r = await orders.createOrder(input({ qty: 2 }));
  const rs = await Promise.all([orders.confirmPaid(r.id, 'P1', 3300), orders.confirmPaid(r.id, 'P1', 3300)]);
  assert.equal(rs.filter(x => x.ok).length, 1);
  const [[v]] = await db.query(`DECLARE $p AS Utf8; SELECT stock, reserved FROM variants WHERE product_id=$p AND size='M'u;`, { $p: db.V.s(P) });
  assert.deepEqual([v.stock, v.reserved], [1, 0]);
  assert.equal(calls.mail.length, 2); assert.deepEqual(calls.yd, [r.id]);
  const o = await orders.getOrder(r.id); assert.equal(o.status, 'paid'); assert.equal(o.yd_request_id, 'R' + r.id);
});

test('confirmPaid: неверная сумма → не оплачен', async () => {
  await seed(1); const r = await orders.createOrder(input());
  const err = console.error; console.error = () => {}; // домен логирует AMOUNT MISMATCH — вывод тестов оставляем чистым
  const x = await orders.confirmPaid(r.id, 'P9', 1).finally(() => { console.error = err; });
  assert.equal(x.ok, false); assert.equal(x.reason, 'amount'); assert.equal((await orders.getOrder(r.id)).status, 'new');
});

test('предзаказ: без резерва, при оплате растёт preorder_count', async () => {
  await seed(1, true); calls.init.length = 0;
  const r = await orders.createOrder(input({ size: 'L', qty: 2 }));
  assert.equal(calls.init.at(-1).receiptItems[0].method, 'full_prepayment');
  let [[v]] = await db.query(`DECLARE $p AS Utf8; SELECT reserved, preorder_count FROM variants WHERE product_id=$p AND size='L'u;`, { $p: db.V.s(P) });
  assert.deepEqual([v.reserved, v.preorder_count], [0, 0]);
  await orders.confirmPaid(r.id, 'P2', 3300);
  [[v]] = await db.query(`DECLARE $p AS Utf8; SELECT preorder_count FROM variants WHERE product_id=$p AND size='L'u;`, { $p: db.V.s(P) });
  assert.equal(v.preorder_count, 2);
  assert.equal((await orders.getStatus(r.id, r.k)).is_preorder, true);
});

test('gc: просроченный new → expired, резерв снят', async () => {
  await seed(1); const r = await orders.createOrder(input());
  await db.query(`DECLARE $id AS Utf8; UPDATE orders SET created_at = CurrentUtcTimestamp() - Interval("PT30M") WHERE id = $id;`, { $id: db.V.s(r.id) });
  assert.equal(await orders.gc(), 1);
  const [[v]] = await db.query(`DECLARE $p AS Utf8; SELECT reserved FROM variants WHERE product_id=$p AND size='M'u;`, { $p: db.V.s(P) });
  assert.equal(v.reserved, 0);
  assert.equal(await orders.gc(), 0);
});

test('поздняя оплата expired → возврат и письмо владельцу', async () => {
  await seed(1); const r = await orders.createOrder(input()); calls.cancel.length = 0; calls.mail.length = 0;
  await db.query(`DECLARE $id AS Utf8; UPDATE orders SET status = 'expired'u WHERE id = $id;`, { $id: db.V.s(r.id) });
  const x = await orders.confirmPaid(r.id, 'P7', 1800);
  assert.equal(x.reason, 'late_refunded'); assert.deepEqual(calls.cancel, ['P7']); assert.equal(calls.mail.length, 1);
});

test('переходы и отмена с возвратом', async () => {
  await seed(2); const r = await orders.createOrder(input());
  await orders.confirmPaid(r.id, 'P3', 1800);
  await assert.rejects(orders.transition(r.id, 'shipped'), e => e.error === 'bad_transition');
  await orders.transition(r.id, 'packed'); calls.mail.length = 0;
  await orders.transition(r.id, 'shipped'); assert.equal(calls.mail.length, 1);
  await assert.rejects(orders.cancel(r.id), e => e.error === 'bad_transition'); // из shipped нельзя
  const r2 = await orders.createOrder(input()); await orders.confirmPaid(r2.id, 'P4', 1800); calls.cancel.length = 0;
  const o = await orders.cancel(r2.id); assert.equal(o.status, 'cancelled'); assert.deepEqual(calls.cancel, ['P4']);
  const [[v]] = await db.query(`DECLARE $p AS Utf8; SELECT stock, reserved FROM variants WHERE product_id=$p AND size='M'u;`, { $p: db.V.s(P) });
  assert.deepEqual([v.stock, v.reserved], [0, 0]); // 2 − 1 (shipped) − 1 (cancelled после оплаты: на склад не возвращается автоматически)
});

test('catalog: available и предзаказ', async () => {
  await seed(1);
  const c = (await orders.catalog()).find(p => p.id === P);
  assert.deepEqual(c.variants.map(v => [v.size, v.available]), [['M', 1], ['L', 0]]);
});
