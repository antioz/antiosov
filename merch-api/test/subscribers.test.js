// Рассылка (спека 2026-10-06-newsletter-design.md): подписка галочкой в заказе, отписка в один клик, рассылка из админки.
require('./_env');
const test = require('node:test'); const assert = require('node:assert');
const ext = require('../lib/ext'); const db = require('../lib/ydb');

const calls = { mail: [] }; let failFor = null;
ext.tbank.init = async a => ({ paymentId: 'PN' + Date.now(), paymentUrl: 'https://pay.test/' + a.orderId });
ext.mail.send = async m => { if (failFor && m.to === failFor) throw new Error('smtp down'); calls.mail.push(m); };
ext.yd.mode = () => 'off';
const { handler } = require('../index');
const ev = (a, { method = 'GET', body, q = {}, headers = {} } = {}) => ({ httpMethod: method, queryStringParameters: { a, ...q }, headers, body: body ? JSON.stringify(body) : undefined, isBase64Encoded: false });
const body = r => JSON.parse(r.body);

const P = 'test-news', FK = 'd/test-news/abc123.zip';
const E1 = 'news-a@example.com', E2 = 'news-b@example.com', E3 = 'news-c@example.com', MINE = [E1, E2, E3, 'news-no@example.com', 'news-none@example.com'];
const mailingIds = [];
const clean = async () => {
  for (const e of MINE) await db.query(`DECLARE $e AS Utf8; DELETE FROM subscribers WHERE email = $e;`, { $e: db.V.s(e) });
  for (const id of mailingIds) await db.query(`DECLARE $id AS Utf8; DELETE FROM mailings WHERE id = $id;`, { $id: db.V.s(id) });
};
test.before(async () => {
  await db.query(`DECLARE $p AS Utf8; DECLARE $fk AS Utf8; DELETE FROM orders WHERE product_id = $p;
    UPSERT INTO products (id, title, description_md, price, images, weight_g, dims_cm, sizes, preorder_allowed, preorder_ship_by, active, sort, updated_at, kind, file_key)
    VALUES ($p, 'Тест рассылки'u, ''u, 111, Json('[]'), 0, Json('{"x":1,"y":1,"z":1}'), Json('[]'), false, ''u, true, 92, CurrentUtcTimestamp(), 'digital'u, $fk);`,
  { $p: db.V.s(P), $fk: db.V.s(FK) });
  await clean();
});
test.after(async () => { await clean(); await db.query(`DECLARE $p AS Utf8; DELETE FROM orders WHERE product_id = $p;`, { $p: db.V.s(P) }); (await db.getDriver()).destroy(); });

const sub = async e => (await db.query(`DECLARE $e AS Utf8; SELECT * FROM subscribers WHERE email = $e;`, { $e: db.V.s(e) }))[0][0];
const order = async over => { const r = await handler(ev('order', { method: 'POST', body: { product_id: P, offer: true, consent: true, ...over } })); assert.equal(r.statusCode, 200, r.body); return body(r); };
const login = async () => { const r = await handler(ev('admin/login', { method: 'POST', body: { password: process.env.ADMIN_PASSWORD } })); return { 'X-Admin-Token': body(r).token }; };

test('заказ с news:true подписывает (source = id заказа), news:false / без поля — нет', async () => {
  const { id } = await order({ email: 'News-A@Example.com', news: true });
  const s = await sub(E1);
  assert.ok(s, 'подписчик не создан');
  assert.equal(s.source, id); assert.equal(s.consent_ver, '2026-10-06'); assert.match(s.token, /^[0-9a-f]{32}$/); assert.ok(s.consent_at instanceof Date);
  await order({ email: 'news-no@example.com', news: false }); await order({ email: 'news-none@example.com' });
  assert.equal(await sub('news-no@example.com'), undefined); assert.equal(await sub('news-none@example.com'), undefined);
});

test('повторная подписка: consent_at и source обновлены, token прежний', async () => {
  const before = await sub(E1);
  await new Promise(r => setTimeout(r, 20));
  const { id } = await order({ email: E1, news: true });
  const after = await sub(E1);
  assert.equal(after.token, before.token); assert.equal(after.source, id);
  assert.ok(after.consent_at.getTime() > before.consent_at.getTime());
});

test('unsub: GET только кнопка (сканеры ссылок не отписывают), POST формы удаляет, неверный токен не удаляет, one-click → OK', async () => {
  const { token } = await sub(E1);
  const post = (e, t, b) => handler({ ...ev('unsub', { method: 'POST', q: { e, t } }), body: b });
  let r = await handler(ev('unsub', { q: { e: E1, t: token } }));
  assert.equal(r.statusCode, 200); assert.match(r.headers['Content-Type'], /text\/html/); assert.ok(r.body.includes('<form method="post"'), r.body);
  assert.ok(await sub(E1), 'GET удалил строку');
  r = await post(E1, 'f'.repeat(32), 'go=1');
  assert.ok(r.body.includes('нет в списке'), r.body); assert.ok(await sub(E1), 'неверный токен удалил строку');
  r = await post(E1, token, 'go=1');
  assert.equal(r.statusCode, 200); assert.match(r.headers['Content-Type'], /text\/html/); assert.ok(r.body.includes('Вы отписались'), r.body);
  assert.equal(await sub(E1), undefined);
  r = await post(E1, token, 'go=1'); assert.ok(r.body.includes('нет в списке'));
  await order({ email: E2, news: true }); const t2 = (await sub(E2)).token;
  r = await handler({ ...ev('unsub', { method: 'POST', q: { e: E2, t: t2 } }), body: 'List-Unsubscribe=One-Click' });
  assert.equal(r.statusCode, 200); assert.equal(r.body, 'OK'); assert.equal(await sub(E2), undefined);
});

test('admin: subscribers, mailing test, рассылка с List-Unsubscribe, ошибка одного адреса, журнал, валидация', async () => {
  const H = await login();
  assert.equal((await handler(ev('admin/subscribers'))).statusCode, 401);
  for (const e of [E1, E2, E3]) await order({ email: e, news: true });
  let r = await handler(ev('admin/subscribers', { headers: H })); assert.equal(r.statusCode, 200, r.body);
  const L = body(r); assert.ok(L.count >= 3); assert.equal(L.subscribers.length, L.count);
  const s3 = L.subscribers.find(x => x.email === E3); assert.ok(s3 && s3.source && s3.consent_at); assert.ok(!('token' in s3), 'токен наружу');

  // Пустые поля и лимиты
  for (const [b, field] of [[{ subject: '', body: 'x' }, 'subject'], [{ subject: 'x', body: ' ' }, 'body'], [{ subject: 'x'.repeat(201), body: 'x' }, 'subject'], [{ subject: 'x', body: 'x'.repeat(20001) }, 'body']]) {
    r = await handler(ev('admin/mailing', { method: 'POST', headers: H, body: { ...b, test: true } }));
    assert.equal(r.statusCode, 400, r.body); assert.equal(body(r).error, 'validation'); assert.equal(body(r).field, field);
  }

  calls.mail.length = 0;
  r = await handler(ev('admin/mailing', { method: 'POST', headers: H, body: { subject: 'Проба', body: 'Привет <b>всем</b>\nhttps://antiosov.ru/x', test: true } }));
  assert.equal(r.statusCode, 200, r.body); assert.deepEqual(body(r), { sent: 1, failed: 0, done: true });
  assert.equal(calls.mail.length, 1); assert.equal(calls.mail[0].to, process.env.OWNER_EMAIL);
  const m0 = calls.mail[0];
  assert.ok(m0.html.includes('&lt;b&gt;всем&lt;/b&gt;<br>'), m0.html); assert.ok(m0.html.includes('<a href="https://antiosov.ru/x">'), m0.html);
  assert.ok(m0.text.startsWith('Привет <b>всем</b>\nhttps://antiosov.ru/x\n\n—\n'), m0.text);

  // Рассылка всем порциями (один из адресов падает)
  calls.mail.length = 0; failFor = E2;
  let mid, offset = 0, sent = 0, failed = 0, done = false, total;
  try {
    for (let i = 0; !done && i < 50; i++) {
      r = await handler(ev('admin/mailing', { method: 'POST', headers: H, body: { subject: 'Новости', body: 'Текст письма', mailing_id: mid, offset } }));
      assert.equal(r.statusCode, 200, r.body); const b = body(r);
      if (!mid) { mid = b.mailing_id; mailingIds.push(mid); } else assert.equal(b.mailing_id, mid);
      sent += b.sent; failed += b.failed; offset = b.next_offset; done = b.done; total = b.total;
    }
  } finally { failFor = null; }
  assert.ok(done); assert.equal(sent + failed, total); assert.equal(offset, total); assert.ok(failed >= 1);
  const to = calls.mail.map(m => m.to);
  assert.ok(to.includes(E1) && to.includes(E3) && !to.includes(E2), JSON.stringify(to));
  assert.equal(new Set(to).size, to.length, 'дубли писем');
  for (const e of [E1, E3]) {
    const m = calls.mail.find(x => x.to === e); const { token } = await sub(e);
    const lu = m.headers['List-Unsubscribe'];
    assert.ok(lu.includes(encodeURIComponent(e)) && lu.includes(token) && lu.startsWith('<') && lu.endsWith('>'), lu);
    assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.ok(m.text.includes(`a=unsub&e=${encodeURIComponent(e)}&t=${token}`), m.text);
    assert.ok(m.text.includes('Отписаться:') && m.html.includes('Отписаться'), m.html);
    assert.equal(m.subject, 'Новости');
  }
  const [[row]] = await db.query(`DECLARE $id AS Utf8; SELECT * FROM mailings WHERE id = $id;`, { $id: db.V.s(mid) });
  assert.deepEqual([row.sent, row.failed, row.subject], [sent, failed, 'Новости']);

  // Порция с offset: последний адрес по алфавиту, счётчики журнала копятся; чужой mailing_id → 404
  calls.mail.length = 0;
  r = body(await handler(ev('admin/mailing', { method: 'POST', headers: H, body: { subject: 'Новости', body: 'Текст письма', mailing_id: mid, offset: total - 1 } })));
  assert.deepEqual([r.mailing_id, r.sent + r.failed, r.next_offset, r.done], [mid, 1, total, true]); sent += r.sent; failed += r.failed;
  assert.equal(calls.mail.length, r.sent);
  if (r.sent) assert.equal(calls.mail[0].to, L.subscribers.map(x => x.email).sort().at(-1));
  r = await handler(ev('admin/mailing', { method: 'POST', headers: H, body: { subject: 'x', body: 'x', mailing_id: 'N-nope', offset: 0 } })); assert.equal(r.statusCode, 404);
  const [[row2]] = await db.query(`DECLARE $id AS Utf8; SELECT * FROM mailings WHERE id = $id;`, { $id: db.V.s(mid) });
  assert.deepEqual([row2.sent, row2.failed], [sent, failed]);

  r = await handler(ev('admin/mailings', { headers: H })); assert.equal(r.statusCode, 200, r.body);
  const j = body(r).mailings.find(x => x.id === mid); assert.ok(j); assert.deepEqual([j.sent, j.failed, j.subject], [sent, failed, 'Новости']); assert.ok(j.created_at);
  assert.ok(!('body' in j));
});

test('рассылка по товару: только подписчики с оплаченным заказом товара; by_product считает их', async () => {
  const H = await login();
  for (const e of [E1, E2]) await db.query(`DECLARE $e AS Utf8; UPSERT INTO subscribers (email, token, consent_at, consent_ver, source) VALUES ($e, 'f'u, CurrentUtcTimestamp(), '2026-10-06'u, ''u);`, { $e: db.V.s(e) });
  await db.query(`DECLARE $p AS Utf8; DECLARE $e AS Utf8; DECLARE $e2 AS Utf8; UPSERT INTO orders (id, k, created_at, updated_at, status, product_id, qty, total, customer_email)
    VALUES ('T-AUD-1'u, 'k'u, CurrentUtcTimestamp(), CurrentUtcTimestamp(), 'paid'u, $p, 1, 1, $e), ('T-AUD-2'u, 'k'u, CurrentUtcTimestamp(), CurrentUtcTimestamp(), 'new'u, $p, 1, 1, $e2);`,
  { $p: db.V.s(P), $e: db.V.s(E1), $e2: db.V.s(E2) });
  try {
    const subs = body(await handler(ev('admin/subscribers', { headers: H })));
    assert.equal(subs.by_product[P], 1, JSON.stringify(subs.by_product));
    calls.mail.length = 0;
    const r = body(await handler(ev('admin/mailing', { method: 'POST', headers: H, body: { subject: 'Покупателям', body: 'текст', product_id: P } })));
    mailingIds.push(r.mailing_id);
    assert.equal(r.total, 1); assert.deepEqual(calls.mail.map(m => m.to), [E1], 'неоплаченный (E2) не должен получить');
    const j = body(await handler(ev('admin/mailings', { headers: H }))).mailings.find(m => m.id === r.mailing_id);
    assert.equal(j.audience, P);
  } finally { await db.query(`DELETE FROM orders WHERE id = 'T-AUD-1'u OR id = 'T-AUD-2'u;`); await clean(); }
});
