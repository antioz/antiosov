require('./_env');
const test = require('node:test'); const assert = require('node:assert');
const db = require('../lib/ydb'); const ext = require('../lib/ext'); const tbank = require('../lib/tbank');
const orders = require('../lib/orders');

test.after(async () => (await db.getDriver()).destroy());

const calls = { init: [], closing: [] }; let closingRes = { Success: true };
ext.tbank.init = async a => { calls.init.push(a); return { paymentId: 'C' + calls.init.length, paymentUrl: 'https://pay.test/' + a.orderId }; };
ext.tbank.closingReceipt = async (pid, email, items) => { calls.closing.push({ pid, email, items }); return closingRes; };
ext.mail.send = async () => {};
ext.yd.quote = async () => ({ price_rub: 300, days: 3 });
ext.yd.mode = () => 'test';
ext.yd.createRequest = async o => ({ request_id: 'R' + o.id, track_url: 'https://t/' + o.id });

const P = 'test-marked';
async function seed({ stock = 2, marked = true, preorder = false } = {}) {
  await db.query(`DECLARE $p AS Utf8; DELETE FROM variants WHERE product_id = $p; DELETE FROM products WHERE id = $p; DELETE FROM orders WHERE product_id = $p;`, { $p: db.V.s(P) });
  await db.query(`DECLARE $p AS Utf8; DECLARE $pre AS Bool; DECLARE $m AS Bool; UPSERT INTO products (id, title, description_md, price, images, weight_g, dims_cm, sizes, preorder_allowed, preorder_ship_by, active, sort, updated_at, marked)
    VALUES ($p, 'Футболка'u, 'md'u, 1500, Json('[]'), 300, Json('{"x":30,"y":20,"z":3}'), Json('["M"]'), $pre, ''u, true, 1, CurrentUtcTimestamp(), $m);`, { $p: db.V.s(P), $pre: db.V.b(preorder), $m: db.V.b(marked) });
  await db.query(`DECLARE $p AS Utf8; DECLARE $st AS Int32; UPSERT INTO variants (product_id, size, stock, reserved, preorder_count) VALUES ($p, 'M'u, $st, 0, 0);`, { $p: db.V.s(P), $st: db.V.i(stock) });
}
const input = (over = {}) => ({ product_id: P, size: 'M', qty: 2, name: 'Тест Тестов', phone: '89990000000', email: 'buyer@example.com', pvz_id: 'PVZ1', pvz_address: 'Москва, пункт 1', consent: true, offer: true, ...over });
const C1 = '0104670369003026215e"sqNHhYUCfd', C2 = '0104670369003026215AbCdEfGhIjKl\x1d91EE10\x1d92abc';
async function paidOrder(o) { const r = await orders.createOrder(input(o)); await orders.confirmPaid(r.id, 'C' + calls.init.length, calls.init.at(-1).amountRub); await orders.transition(r.id, 'packed'); return r; }

test('чек ФФД 1.2: позиция с кодом маркировки', () => {
  const r = tbank.receipt('a@b.ru', [{ name: 'Ф', price_rub: 100, qty: 1, method: 'full_payment', mark_code: C1 }]);
  assert.equal(r.FfdVersion, '1.2');
  assert.deepEqual(r.Items[0], { Name: 'Ф', Price: 10000, Quantity: 1, Amount: 10000, Tax: 'none', PaymentMethod: 'full_payment', MeasurementUnit: 'шт',
    PaymentObject: 'goods_with_marking_code', MarkProcessingMode: '0', MarkCode: { MarkCodeType: 'RAWCODE', Value: C1 } });
  const plain = tbank.receipt('a@b.ru', [{ name: 'Ф', price_rub: 100, qty: 1 }]);
  assert.equal(plain.FfdVersion, undefined); assert.equal(plain.Items[0].PaymentObject, 'commodity'); assert.equal(plain.Items[0].MeasurementUnit, undefined);
});

test('коды маркировки: проверка формата и дублей', () => {
  assert.deepEqual(orders.parseMarkCodes(` ${C1}\n\n${C2}\n`), [C1, C2]);
  assert.throws(() => orders.parseMarkCodes('4670369003026'), e => e.error === 'validation');
  assert.throws(() => orders.parseMarkCodes(`${C1}\n${C1}`), e => e.extra.reason === 'duplicate');
});

test('маркированный товар в наличии: первый чек — предоплата; без кодов не отправить; с кодами — закрывающий чек', async () => {
  await seed(); calls.closing.length = 0;
  const r = await paidOrder();
  assert.equal(calls.init.at(-1).receiptItems[0].method, 'full_prepayment');
  await assert.rejects(orders.transition(r.id, 'shipped'), e => e.error === 'need_mark_codes');
  assert.equal((await orders.getOrder(r.id)).status, 'packed'); assert.equal(calls.closing.length, 0);
  await assert.rejects(orders.setMarkCodes(r.id, `${C1}\n${C2}\n0104670369003026215zzzzzzzzzzzz`), e => e.extra.reason === 'too_many');
  await orders.setMarkCodes(r.id, `${C1}\n${C2}`);
  const o = await orders.transition(r.id, 'shipped');
  assert.equal(o.status, 'shipped'); assert.ok(o.closing_receipt_at);
  const c = calls.closing.at(-1);
  assert.equal(c.pid, o.tb_payment_id); assert.equal(c.email, 'buyer@example.com');
  assert.deepEqual(c.items.map(i => [i.qty, i.price_rub, i.method, i.mark_code]), [[1, 1500, 'full_payment', C1], [1, 1500, 'full_payment', C2]]);
  await assert.rejects(orders.setMarkCodes(r.id, C1), e => e.error === 'closing_done');
});

test('немаркированный предзаказ: закрывающий чек без кодов при отправке', async () => {
  await seed({ stock: 0, marked: false, preorder: true }); calls.closing.length = 0;
  const r = await paidOrder({ qty: 1 });
  assert.equal(calls.init.at(-1).receiptItems[0].method, 'full_prepayment');
  await orders.transition(r.id, 'shipped');
  assert.equal(calls.closing.length, 1); assert.deepEqual(calls.closing[0].items.map(i => [i.qty, i.mark_code]), [[1, undefined]]);
});

test('немаркированный в наличии: полный расчёт сразу, закрывающий не нужен', async () => {
  await seed({ marked: false }); calls.closing.length = 0;
  const r = await paidOrder({ qty: 1 });
  assert.equal(calls.init.at(-1).receiptItems[0].method, 'full_payment');
  await orders.transition(r.id, 'shipped'); assert.equal(calls.closing.length, 0);
  await assert.rejects(orders.sendClosing(r.id), e => e.error === 'closing_not_needed');
});

test('Т-Банк отказал: статус не меняется, ошибка сохранена, повтор проходит', async () => {
  await seed({ stock: 0, marked: false, preorder: true });
  const r = await paidOrder({ qty: 1 });
  closingRes = { Success: false, ErrorCode: '9999', Message: 'тест' };
  await assert.rejects(orders.transition(r.id, 'shipped'), e => e.error === 'closing_failed');
  let o = await orders.getOrder(r.id); assert.equal(o.status, 'packed'); assert.match(o.closing_error, /9999/);
  closingRes = { Success: true };
  o = await orders.sendClosing(r.id); assert.ok(o.closing_receipt_at); assert.equal(o.closing_error, '');
  o = await orders.transition(r.id, 'shipped'); assert.equal(o.status, 'shipped');
});

test.after(async () => { await db.query(`DECLARE $p AS Utf8; DELETE FROM variants WHERE product_id = $p; DELETE FROM products WHERE id = $p; DELETE FROM orders WHERE product_id = $p;`, { $p: db.V.s(P) }); });
