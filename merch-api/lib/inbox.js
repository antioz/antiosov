// Письма от клиентов (спека 2026-10-06-newsletter-design.md, «Письма от клиентов»): ящик REPLY_TO по IMAP, в YDB не копируем.
// Клиентское письмо = отправитель есть в orders/subscribers ИЛИ ответ на наше (In-Reply-To/References с @antiosov.ru) — личная почта ящика наружу не идёт.
const db = require('./ydb'); const ext = require('./ext'); const clients = require('./clients');
const { HttpError } = require('./util');
const ENV = process.env;
const DAYS = 90, MAX = 100, OUR = /@antiosov\.ru>?/i;

// Соединение на вызов: функция живёт секунды, держать IMAP между вызовами незачем.
async function withBox(fn) {
  if (!ENV.IMAP_USER || !ENV.IMAP_PASS) throw new HttpError(503, 'imap_unavailable');
  let c;
  try { c = await ext.imap.connect({ user: ENV.IMAP_USER, pass: ENV.IMAP_PASS }); }
  catch (e) { console.error('imap connect', e.message); throw new HttpError(503, 'imap_unavailable'); }
  try { return await fn(c); } finally { try { await c.logout(); } catch (_) {} }
}

const knownEmails = async () => {
  const [[o], [s]] = await Promise.all([db.query(`SELECT DISTINCT customer_email AS e FROM orders WHERE customer_email != ''u;`), db.query(`SELECT email AS e FROM subscribers;`)]);
  return new Set([...o, ...s].map(r => String(r.e).toLowerCase()));
};
const isClient = (m, known) => known.has(String(m.from || '').toLowerCase()) || OUR.test(m.in_reply_to || '') || OUR.test(m.references || '');
const clientOf = (all, email) => all.find(c => c.email === String(email || '').toLowerCase()) || null;

async function list() {
  const known = await knownEmails();
  const mine = await withBox(async c => {
    const sel = (await c.recent(DAYS)).filter(m => isClient(m, known)).sort((a, b) => b.date - a.date).slice(0, MAX);
    const sn = await c.snippets(sel.map(m => m.uid)); sel.forEach(m => { m.snippet = sn[m.uid] || ''; }); return sel;
  });
  const all = mine.length ? await clients.listClients() : [];
  const letters = mine.map(m => { const cl = clientOf(all, m.from);
    return { uid: m.uid, date: new Date(m.date).toISOString(), from: m.from, from_name: m.from_name || '', subject: m.subject || '', unread: !m.seen, snippet: m.snippet || '',
      client: cl && { orders_total: cl.orders_total, sum_paid: cl.sum_paid } }; });
  return { unread: letters.filter(l => l.unread).length, letters };
}

// Письмо по uid — только если оно клиентское (иначе 404: uid личного письма админку не откроет).
async function get(uid) {
  const known = await knownEmails();
  const m = await withBox(async c => { const x = await c.fetch(uid); if (x && isClient(x, known)) await c.markSeen(uid); return x; });
  if (!m || !isClient(m, known)) throw new HttpError(404, 'no_letter');
  return { uid: m.uid, date: new Date(m.date).toISOString(), from: m.from, from_name: m.from_name || '', subject: m.subject || '', text: m.text || '',
    attachments: m.attachments || [], message_id: m.message_id || '', client: clientOf(await clients.listClients(), m.from) };
}

async function reply(uid, text) {
  const body = String(text || '').trim(); if (!body || body.length > 20000) throw new HttpError(400, 'validation', { field: 'text' });
  const m = await get(uid);
  const subject = /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`;
  const headers = m.message_id ? { 'In-Reply-To': m.message_id, References: m.message_id } : {};
  const quote = `\n\n${new Date(m.date).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}, ${m.from_name || m.from}:\n` + m.text.split('\n').map(l => '> ' + l).join('\n');
  const raw = await ext.mail.send({ to: m.from, subject, text: body + quote, headers, keepRaw: true });
  // Копия в «Отправленные» ящика — чтобы переписка была видна и в самой почте. Сбой копии ответ не отменяет.
  if (raw) { try { await withBox(c => c.appendSent(raw)); } catch (e) { console.error('imap append', e.message || e.error); } }
  return { ok: true };
}

module.exports = { list, get, reply, isClient };
