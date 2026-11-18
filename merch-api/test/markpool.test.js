// Пул кодов «Честного знака» (2026-11-19): добавление/удаление/автоподстановка при отправке маркированного заказа.
require('./_env');
const test = require('node:test'); const assert = require('node:assert');
const db = require('../lib/ydb');
const { handler } = require('../index');
const ev = (a, { method = 'GET', body, headers = {} } = {}) => ({ httpMethod: method, queryStringParameters: { a }, headers, body: body ? JSON.stringify(body) : undefined, isBase64Encoded: false });
const body = r => JSON.parse(r.body);

const P = 'test-mkpool', A = 'mk-a@example.com';
const OID = 'T-MK-1', OID2 = 'T-MK-2';
const C1 = '0104670369003019215AAAAAAAAAA1', C2 = '0104670369003019215AAAAAAAAAA2', C3 = '0104670369003019215AAAAAAAAAA3';
const auth = { 'x-admin-token': null };

let jwt = null;
test.before(async () => {
  const login = await handler(ev('admin/login', { method: 'POST', body: { password: process.env.ADMIN_PASSWORD } }));
  jwt = body(login).token; auth['x-admin-token'] = jwt;
  await db.query(`DECLARE $p AS Utf8; UPSERT INTO products (id, title, description_md, price, images, weight_g, dims_cm, sizes, preorder_allowed, preorder_ship_by, active, sort, updated_at, kind, file_key, marked)
    VALUES ($p, 'Тест пула'u, ''u, 100, Json('[]'), 0, Json('{"x":1,"y":1,"z":1}'), Json('["M"]'), false, ''u, false, 93, CurrentUtcTimestamp(), 'physical'u, ''u, true);`, { $p: db.V.s(P) });
  await db.query(`DECLARE $p AS Utf8; UPSERT INTO variants (product_id, size, stock, reserved, preorder_count) VALUES ($p, 'M', 10, 0, 0);`, { $p: db.V.s(P) });
});
test.after(async () => {
  for (const id of [OID, OID2]) await db.query(`DECLARE $id AS Utf8; DELETE FROM orders WHERE id = $id;`, { $id: db.V.s(id) });
  await db.query(`DECLARE $p AS Utf8; DELETE FROM mark_pool WHERE product_id = $p; DELETE FROM variants WHERE product_id = $p; DELETE FROM products WHERE id = $p;`, { $p: db.V.s(P) });
  (await db.getDriver()).destroy();
});

test('пул: добавить, список, дубль отклонён, удалить', async () => {
  const bad = await handler(ev('admin/mark_pool', { method: 'POST', headers: auth, body: { product_id: P, codes: 'не код' } }));
  assert.equal(bad.statusCode, 400);
  const add = await handler(ev('admin/mark_pool', { method: 'POST', headers: auth, body: { product_id: P, codes: [C1, C2].join('\n') } }));
  assert.equal(add.statusCode, 200); assert.equal(body(add).added, 2);
  const dup = await handler(ev('admin/mark_pool', { method: 'POST', headers: auth, body: { product_id: P, codes: C1 } }));
  assert.equal(dup.statusCode, 400); assert.equal(body(dup).reason, 'duplicate');
  const list = await handler(ev('admin/mark_pool', { headers: auth, q: undefined })); // без product_id — пусто
  const listP = await handler({ ...ev('admin/mark_pool', { headers: auth }), queryStringParameters: { a: 'admin/mark_pool', product_id: P } });
  assert.equal(body(listP).codes.length, 2);
  const del = await handler(ev('admin/mark_pool', { method: 'DELETE', headers: auth, body: { product_id: P, code: C2 } }));
  assert.equal(del.statusCode, 200);
  const list2 = await handler({ ...ev('admin/mark_pool', { headers: auth }), queryStringParameters: { a: 'admin/mark_pool', product_id: P } });
  assert.equal(body(list2).codes.length, 1);
});

test('не маркированному товару пул не добавить', async () => {
  await db.query(`DECLARE $p AS Utf8; UPSERT INTO products (id, title, description_md, price, images, weight_g, dims_cm, sizes, preorder_allowed, preorder_ship_by, active, sort, updated_at, kind, file_key, marked)
    VALUES ($p, 'Тест не марк.'u, ''u, 100, Json('[]'), 0, Json('{"x":1,"y":1,"z":1}'), Json('["M"]'), false, ''u, false, 93, CurrentUtcTimestamp(), 'physical'u, ''u, false);`, { $p: db.V.s('test-mkpool-plain') });
  const r = await handler(ev('admin/mark_pool', { method: 'POST', headers: auth, body: { product_id: 'test-mkpool-plain', codes: C3 } }));
  assert.equal(r.statusCode, 409);
  await db.query(`DECLARE $p AS Utf8; DELETE FROM products WHERE id = $p;`, { $p: db.V.s('test-mkpool-plain') });
});

test('отправка маркированного заказа забирает коды из пула (need_mark_codes до, автоподстановка после)', async () => {
  // заказ qty=1, статус packed
  const mk = id => db.query(`DECLARE $id AS Utf8; DECLARE $p AS Utf8; UPSERT INTO orders (id, k, created_at, updated_at, status, product_id, size, qty, price_item, price_delivery, total, customer_email, delivery_mode, tb_payment_id, prepay_receipt)
    VALUES ($id, 'k'u, CurrentUtcTimestamp(), CurrentUtcTimestamp(), 'packed'u, $p, 'M'u, 1, 100, 0, 100, '${A}'u, 'pickup'u, 'tb-test'u, true);`, { $id: db.V.s(id), $p: db.V.s(P) });
  await mk(OID);
  // закрывающий чек: tb_payment_id=tb-test не пройдёт в Т-Банке, но проверка need_mark_codes идёт ДО вызова —
  // по ошибке closing_failed с need/have нельзя отличить, поэтому проверяем через admin/order next:
  // статус не должен сдвинуться с need_mark_codes, когда пул пуст, и сдвинуться с autopool…
  // sendClosing бросит 502 (фейк payment) — но до этого коды из пула уже записаны в заказ; проверим mark_codes.
  await db.query(`DECLARE $p AS Utf8; DELETE FROM mark_pool WHERE product_id = $p;`, { $p: db.V.s(P) });
  const r1 = await handler(ev('admin/order', { method: 'POST', headers: auth, body: { id: OID, action: 'close_receipt' } }));
  assert.equal(r1.statusCode, 409); assert.equal(body(r1).error, 'need_mark_codes');
  // кладём код в пул → sendClosing берёт его до обращения в Т-Банк и падает 502, но код уже в заказе
  await handler(ev('admin/mark_pool', { method: 'POST', headers: auth, body: { product_id: P, codes: C3 } }));
  const r2 = await handler(ev('admin/order', { method: 'POST', headers: auth, body: { id: OID, action: 'close_receipt' } }));
  assert.equal(r2.statusCode, 502);
  const o = await handler({ ...ev('admin/order', { headers: auth }), queryStringParameters: { a: 'admin/order', id: OID } });
  assert.deepEqual(JSON.parse(body(o).order.mark_codes), [C3]);
  const pool = await handler({ ...ev('admin/mark_pool', { headers: auth }), queryStringParameters: { a: 'admin/mark_pool', product_id: P } });
  assert.equal(body(pool).codes.length, 0); // код взят из пула
});
