// Клиенты (спека 2026-10-06-newsletter-design.md, раздел «Клиенты»): представление над orders, ключ — e-mail.
require('./_env');
const test = require('node:test'); const assert = require('node:assert');
const db = require('../lib/ydb');
const { handler } = require('../index');
const ev = (a, { method = 'GET', body, headers = {} } = {}) => ({ httpMethod: method, queryStringParameters: { a }, headers, body: body ? JSON.stringify(body) : undefined, isBase64Encoded: false });
const body = r => JSON.parse(r.body);

const P = 'test-cli', A = 'cli-a@example.com', B = 'cli-b@example.com';
const IDS = ['T-CLI-1', 'T-CLI-2', 'T-CLI-3', 'T-CLI-4', 'T-CLI-5'];
const put = (id, at, status, total, email, name, phone) => db.query(`DECLARE $id AS Utf8; DECLARE $at AS Timestamp; DECLARE $st AS Utf8; DECLARE $t AS Int32; DECLARE $e AS Utf8; DECLARE $n AS Utf8; DECLARE $ph AS Utf8; DECLARE $p AS Utf8;
  UPSERT INTO orders (id, k, created_at, updated_at, status, product_id, qty, total, customer_email, customer_name, customer_phone) VALUES ($id, 'k'u, $at, $at, $st, $p, 1, $t, $e, $n, $ph);`,
{ $id: db.V.s(id), $at: db.V.ts(new Date(at)), $st: db.V.s(status), $t: db.V.i(total), $e: db.V.s(email), $n: db.V.s(name), $ph: db.V.s(phone), $p: db.V.s(P) });
const clean = async () => {
  for (const id of IDS) await db.query(`DECLARE $id AS Utf8; DELETE FROM orders WHERE id = $id;`, { $id: db.V.s(id) });
  await db.query(`DECLARE $e AS Utf8; DELETE FROM subscribers WHERE email = $e;`, { $e: db.V.s(A) });
};
test.before(async () => {
  await clean();
  await db.query(`DECLARE $p AS Utf8; UPSERT INTO products (id, title, description_md, price, images, weight_g, dims_cm, sizes, preorder_allowed, preorder_ship_by, active, sort, updated_at, kind, file_key)
    VALUES ($p, 'Тест клиентов'u, ''u, 100, Json('[]'), 0, Json('{"x":1,"y":1,"z":1}'), Json('[]'), false, ''u, false, 93, CurrentUtcTimestamp(), 'digital'u, ''u);`, { $p: db.V.s(P) });
  await put(IDS[0], '2026-10-01T10:00:00Z', 'paid', 300, 'Cli-A@Example.com', 'Аня', '+79990000001');
  await put(IDS[1], '2026-10-03T10:00:00Z', 'done', 200, A, 'Анна', '+79990000002');
  await put(IDS[2], '2026-10-04T10:00:00Z', 'cancelled', 999, A, 'Анна', '');
  await put(IDS[3], '2026-10-02T10:00:00Z', 'new', 500, B, 'Боря', '');
  await put(IDS[4], '2026-10-02T10:00:00Z', 'done', 700, '', '', ''); // обезличен purgePd
  await db.query(`DECLARE $e AS Utf8; UPSERT INTO subscribers (email, token, consent_at, consent_ver, source) VALUES ($e, 'x'u, CurrentUtcTimestamp(), '2026-10-06'u, 'T-CLI-1'u);`, { $e: db.V.s(A) });
});
test.after(async () => { await clean(); (await db.getDriver()).destroy(); });

const login = async () => { const r = await handler(ev('admin/login', { method: 'POST', body: { password: process.env.ADMIN_PASSWORD } })); return { 'X-Admin-Token': body(r).token }; };

test('admin/clients: без токена 401', async () => {
  assert.equal((await handler(ev('admin/clients'))).statusCode, 401);
});

test('admin/clients: e-mail без учёта регистра, сумма только оплаченных, подписка, обезличенные скрыты', async () => {
  const r = await handler(ev('admin/clients', { headers: await login() }));
  assert.equal(r.statusCode, 200, r.body);
  const { clients } = body(r);
  const a = clients.find(c => c.email === A), b = clients.find(c => c.email === B);
  assert.ok(a && b, 'клиенты не найдены');
  assert.equal(a.orders_total, 3); assert.equal(a.orders_paid, 2); assert.equal(a.sum_paid, 500);
  assert.deepEqual(a.names.sort(), ['Анна', 'Аня']); assert.deepEqual(a.phones.sort(), ['+79990000001', '+79990000002']);
  assert.equal(a.first_at.slice(0, 10), '2026-10-01'); assert.equal(a.last_at.slice(0, 10), '2026-10-04');
  assert.equal(a.subscribed, true); assert.ok(a.subscribed_at);
  assert.deepEqual(a.kinds, ['digital']);
  assert.equal(a.orders[0].id, 'T-CLI-3', 'заказы клиента — новые сверху'); assert.equal(a.orders[0].product_title, 'Тест клиентов');
  assert.equal(b.orders_paid, 0); assert.equal(b.sum_paid, 0); assert.equal(b.subscribed, false);
  assert.ok(!clients.some(c => c.email === '' || c.orders.some(o => o.id === 'T-CLI-5')), 'обезличенный заказ попал в клиенты');
});
