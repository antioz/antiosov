// Рассылка (спека 2026-10-06-newsletter-design.md). Подписка — отдельная галочка в заказе, отписка = DELETE строки.
// Письма — каждому отдельно, через ext.mail; порциями до BATCH за вызов (таймаут функции 30 с), админка зовёт с offset, пока не done.
const crypto = require('crypto');
const db = require('./ydb'); const ext = require('./ext');
const { HttpError, validEmail } = require('./util');
const ENV = process.env;
const NEWS_CONSENT_VER = '2026-10-06';
const BATCH = 25, BUDGET_MS = 20000; // Postbox отвечает до ~6 с на письмо: порция обрывается по времени раньше 25, next_offset это учитывает

const funcUrl = () => ENV.SELF_URL || 'https://functions.yandexcloud.net/d4eh4qtc4a7fria6mgmt';
const unsubUrl = (email, token) => `${funcUrl()}?a=unsub&e=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function subscribe(email, source) {
  const e = validEmail(email); if (!e) return false;
  await db.tx(async run => {
    const [[old]] = await run(`DECLARE $e AS Utf8; SELECT token FROM subscribers WHERE email = $e;`, { $e: db.V.s(e) });
    await run(`DECLARE $e AS Utf8; DECLARE $t AS Utf8; DECLARE $v AS Utf8; DECLARE $s AS Utf8;
      UPSERT INTO subscribers (email, token, consent_at, consent_ver, source) VALUES ($e, $t, CurrentUtcTimestamp(), $v, $s);`,
    { $e: db.V.s(e), $t: db.V.s(old ? old.token : crypto.randomBytes(16).toString('hex')), $v: db.V.s(NEWS_CONSENT_VER), $s: db.V.s(String(source || '')) });
  });
  return true;
}

// true — строка удалена. Неверный токен и отсутствие адреса неразличимы снаружи.
async function unsubscribe(email, token) {
  const e = validEmail(email); if (!e || !token) return false;
  return db.tx(async run => {
    const [[row]] = await run(`DECLARE $e AS Utf8; SELECT token FROM subscribers WHERE email = $e;`, { $e: db.V.s(e) });
    if (!row) return false;
    const a = Buffer.from(String(token)), b = Buffer.from(row.token);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    await run(`DECLARE $e AS Utf8; DELETE FROM subscribers WHERE email = $e;`, { $e: db.V.s(e) });
    return true;
  });
}

const list = async () => (await db.query(`SELECT email, consent_at, source FROM subscribers ORDER BY consent_at DESC;`))[0];
const count = async () => Number((await db.query(`SELECT COUNT(*) AS n FROM subscribers;`))[0][0].n);
const listMailings = async () => (await db.query(`SELECT id, created_at, subject, sent, failed FROM mailings ORDER BY created_at DESC;`))[0];

function letter({ subject, body, url }) {
  const foot = 'Вы получили это письмо, потому что согласились на письма при заказе на antiosov.ru.';
  const html = `<div style="font-family:Inter,system-ui,sans-serif;font-size:15px;line-height:1.5;color:#0a0a0a;max-width:560px">
<p style="margin:0">${esc(body).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}">${u}</a>`).replace(/\r?\n/g, '<br>')}</p>
<p style="margin:24px 0 0;color:#888;font-size:13px">—<br>${foot}<br><a href="${esc(url)}" style="color:#888">Отписаться</a></p></div>`;
  return { subject, text: `${body}\n\n—\n${foot}\nОтписаться: ${url}`, html,
    headers: { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
}

async function sendOne(to, m) {
  try { await ext.mail.send({ to, ...m }); return true; } catch (e) { console.error('mailing', to, e.message); return false; }
}

async function sendMailing(b) {
  const subject = String(b.subject || '').trim(), body = String(b.body || '');
  if (!subject || subject.length > 200) throw new HttpError(400, 'validation', { field: 'subject' });
  if (!body.trim() || body.length > 20000) throw new HttpError(400, 'validation', { field: 'body' });
  if (b.test === true) {
    const ok = await sendOne(ENV.OWNER_EMAIL, letter({ subject, body, url: unsubUrl(ENV.OWNER_EMAIL, 'test') }));
    return { sent: ok ? 1 : 0, failed: ok ? 0 : 1, done: true };
  }
  let id = b.mailing_id ? String(b.mailing_id) : '';
  if (id) {
    const [[m]] = await db.query(`DECLARE $id AS Utf8; SELECT id FROM mailings WHERE id = $id;`, { $id: db.V.s(id) });
    if (!m) throw new HttpError(404, 'no_mailing');
  } else {
    id = `N-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(4).toString('hex')}`;
    await db.query(`DECLARE $id AS Utf8; DECLARE $s AS Utf8; DECLARE $b AS Utf8;
      UPSERT INTO mailings (id, created_at, subject, body, sent, failed) VALUES ($id, CurrentUtcTimestamp(), $s, $b, 0, 0);`, { $id: db.V.s(id), $s: db.V.s(subject), $b: db.V.s(body) });
  }
  const offset = Math.max(0, parseInt(b.offset, 10) || 0);
  const [[{ n }], chunk] = await db.query(`DECLARE $o AS Uint64; SELECT COUNT(*) AS n FROM subscribers;
    SELECT email, token FROM subscribers ORDER BY email LIMIT ${BATCH} OFFSET $o;`, { $o: db.TypedValues.uint64(offset) });
  const total = Number(n), t0 = Date.now();
  let sent = 0, failed = 0, i = 0;
  for (; i < chunk.length && (i === 0 || Date.now() - t0 < BUDGET_MS); i++) {
    if (await sendOne(chunk[i].email, letter({ subject, body, url: unsubUrl(chunk[i].email, chunk[i].token) }))) sent++; else failed++;
  }
  await db.query(`DECLARE $id AS Utf8; DECLARE $s AS Int32; DECLARE $f AS Int32; UPDATE mailings SET sent = sent + $s, failed = failed + $f WHERE id = $id;`,
    { $id: db.V.s(id), $s: db.V.i(sent), $f: db.V.i(failed) });
  const next_offset = offset + i;
  return { mailing_id: id, sent, failed, next_offset, total, done: next_offset >= total || !chunk.length };
}

module.exports = { NEWS_CONSENT_VER, subscribe, unsubscribe, list, count, listMailings, unsubUrl, letter, sendMailing };
