// Письма от клиентов (спека 2026-10-06-newsletter-design.md, «Письма от клиентов»): IMAP подменён, YDB — тестовая.
require('./_env');
const test = require('node:test'); const assert = require('node:assert');
const ext = require('../lib/ext'); const db = require('../lib/ydb');
process.env.IMAP_USER = 'box@yandex.ru'; process.env.IMAP_PASS = 'x';
const sent = [], appended = [], seen = []; let down = false;
const BOX = [
  { uid: 1, date: new Date('2026-10-06T10:00:00Z'), from: 'inb-client@example.com', from_name: 'Клиент', subject: 'Вопрос', seen: false, in_reply_to: '', references: '' },
  { uid: 2, date: new Date('2026-10-06T11:00:00Z'), from: 'stranger@example.com', from_name: 'Незнакомец', subject: 'Re: Заказ', seen: true, in_reply_to: '<abc@antiosov.ru>', references: '' },
  { uid: 3, date: new Date('2026-10-06T12:00:00Z'), from: 'friend@example.com', from_name: 'Друг', subject: 'Личное', seen: false, in_reply_to: '', references: '' },
];
ext.imap.connect = async () => { if (down) throw new Error('auth failed'); return {
  recent: async () => BOX.map(m => ({ ...m })),
  snippets: async uids => Object.fromEntries(uids.map(u => [u, 'начало ' + u])),
  fetch: async uid => { const m = BOX.find(x => x.uid === uid); return m && { ...m, text: 'Текст письма ' + uid, message_id: `<m${uid}@mail.example>`, attachments: [] }; },
  markSeen: async uid => { seen.push(uid); }, appendSent: async raw => { appended.push(String(raw)); }, logout: async () => {},
}; };
ext.mail.send = async m => { sent.push(m); return Buffer.from('RAW ' + m.subject); };
const { handler } = require('../index');
const ev = (a, { method = 'GET', body, q = {}, headers = {} } = {}) => ({ httpMethod: method, queryStringParameters: { a, ...q }, headers, body: body ? JSON.stringify(body) : undefined, isBase64Encoded: false });
const body = r => JSON.parse(r.body);
const login = async () => { const r = await handler(ev('admin/login', { method: 'POST', body: { password: process.env.ADMIN_PASSWORD } })); return { 'X-Admin-Token': body(r).token }; };

test.before(async () => db.query(`UPSERT INTO orders (id, k, created_at, updated_at, status, product_id, qty, total, customer_email) VALUES ('T-INB-1'u, 'k'u, CurrentUtcTimestamp(), CurrentUtcTimestamp(), 'paid'u, 'test-cli'u, 1, 250, 'inb-client@example.com'u);`));
test.after(async () => { await db.query(`DELETE FROM orders WHERE id = 'T-INB-1'u;`); (await db.getDriver()).destroy(); });

test('admin/inbox: только клиенты и ответы на наши письма, личное скрыто; unread и клиент', async () => {
  const H = await login();
  assert.equal((await handler(ev('admin/inbox'))).statusCode, 401);
  const r = body(await handler(ev('admin/inbox', { headers: H })));
  assert.deepEqual(r.letters.map(l => l.uid), [2, 1], 'новые сверху, личное (uid 3) скрыто');
  assert.equal(r.unread, 1);
  const c = r.letters.find(l => l.uid === 1);
  assert.equal(c.client.orders_total, 1); assert.equal(c.client.sum_paid, 250); assert.equal(c.snippet, 'начало 1');
  assert.equal(r.letters.find(l => l.uid === 2).client, null);
});

test('admin/letter: открывает клиентское и помечает прочитанным; личное — 404 и не помечается', async () => {
  const H = await login();
  const r = await handler(ev('admin/letter', { headers: H, q: { uid: '1' } }));
  assert.equal(r.statusCode, 200, r.body); assert.equal(body(r).text, 'Текст письма 1'); assert.ok(body(r).client); assert.deepEqual(seen, [1]);
  assert.equal((await handler(ev('admin/letter', { headers: H, q: { uid: '3' } }))).statusCode, 404); assert.deepEqual(seen, [1]);
});

test('admin/reply: письмо клиенту с Re:, In-Reply-To и цитатой; копия в «Отправленные»; пустой текст 400', async () => {
  const H = await login();
  const r = await handler(ev('admin/reply', { method: 'POST', headers: H, body: { uid: 1, text: 'Ответ владельца' } }));
  assert.equal(r.statusCode, 200, r.body);
  const m = sent.at(-1);
  assert.equal(m.to, 'inb-client@example.com'); assert.equal(m.subject, 'Re: Вопрос'); assert.equal(m.headers['In-Reply-To'], '<m1@mail.example>');
  assert.ok(m.text.startsWith('Ответ владельца') && m.text.includes('> Текст письма 1'), m.text); assert.equal(m.keepRaw, true);
  assert.equal(appended.at(-1), 'RAW Re: Вопрос');
  assert.equal((await handler(ev('admin/reply', { method: 'POST', headers: H, body: { uid: 1, text: ' ' } }))).statusCode, 400);
  assert.equal((await handler(ev('admin/reply', { method: 'POST', headers: H, body: { uid: 3, text: 'x' } }))).statusCode, 404, 'на личное ответить нельзя');
});

test('IMAP недоступен → 503 imap_unavailable', async () => {
  const H = await login(); down = true;
  const r = await handler(ev('admin/inbox', { headers: H })); down = false;
  assert.equal(r.statusCode, 503); assert.equal(body(r).error, 'imap_unavailable');
});
