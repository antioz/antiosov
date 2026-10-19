// IMAP ящика REPLY_TO (imap.yandex.ru, пароль приложения). Только INBOX; отбор клиентских писем — в inbox.js.
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const addr = a => (a && a[0]) || {};
const hdr = (buf, name) => { const m = String(buf || '').match(new RegExp(`^${name}:\\s*([\\s\\S]*?)(?=\\r?\\n\\S|$)`, 'im')); return m ? m[1].replace(/\s+/g, ' ').trim() : ''; };
const strip = html => String(html || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const textOf = p => (p.text || strip(p.html) || '').trim();

// Яндекс отдаёт «холодное» письмо ~0,6–1,5 с (первое обращение; потом минуты в кэше), FLAGS — мгновенно.
// Поэтому: конверты и сниппеты кэшируем в экземпляре (письмо по uid неизменно при той же UIDVALIDITY),
// недостающее тянем параллельно через PAR соединений — иначе 18 холодных писем ≈ 2×12 с и функция падает по таймауту 30 с.
const PAR = 4;
const cache = { validity: null, env: new Map(), snip: new Map() };
const open = async ({ user, pass }) => {
  const c = new ImapFlow({ host: 'imap.yandex.ru', port: 993, secure: true, auth: { user, pass }, logger: false, socketTimeout: 15000 });
  await c.connect(); const box = await c.mailboxOpen('INBOX');
  const v = String(box.uidValidity); if (cache.validity !== v) { cache.validity = v; cache.env.clear(); cache.snip.clear(); }
  return c;
};
// Разложить uids по соединениям: основное + до PAR-1 дополнительных (не больше, чем писем).
async function spread(main, auth, uids, query, onMsg) {
  if (!uids.length) return;
  const n = Math.min(PAR, uids.length), extra = await Promise.all(Array.from({ length: n - 1 }, () => open(auth).catch(() => null)));
  const conns = [main, ...extra.filter(Boolean)];
  try {
    await Promise.all(conns.map(async (cc, i) => { const part = uids.filter((_, j) => j % conns.length === i);
      for await (const m of cc.fetch(part, query, { uid: true })) await onMsg(m); }));
  } finally { await Promise.all(conns.slice(1).map(cc => cc.logout().catch(() => {}))); }
}

async function connect(auth) {
  const c = await open(auth);
  return {
    // Конверты писем за days дней (+ In-Reply-To/References для отбора); сниппет — только для отобранных, вторым проходом через snippets().
    async recent(days) {
      const uids = await c.search({ since: new Date(Date.now() - days * 864e5) }, { uid: true });
      if (!uids || !uids.length) return [];
      const seen = new Map();
      for await (const m of c.fetch(uids, { uid: true, flags: true }, { uid: true })) seen.set(m.uid, m.flags && m.flags.has('\\Seen'));
      await spread(c, auth, uids.filter(u => !cache.env.has(u)), { uid: true, envelope: true, headers: ['in-reply-to', 'references'] }, m => {
        const f = addr(m.envelope.from);
        cache.env.set(m.uid, { uid: m.uid, date: m.envelope.date || new Date(0), from: String(f.address || '').toLowerCase(), from_name: f.name || '', subject: m.envelope.subject || '',
          in_reply_to: hdr(m.headers, 'in-reply-to'), references: hdr(m.headers, 'references') });
      });
      return uids.filter(u => cache.env.has(u)).map(u => ({ ...cache.env.get(u), seen: !!seen.get(u) }));
    },
    async snippets(uids) {
      await spread(c, auth, uids.filter(u => !cache.snip.has(u)), { uid: true, source: { maxLength: 60000 } }, async m => {
        try { cache.snip.set(m.uid, textOf(await simpleParser(m.source)).replace(/\s+/g, ' ').slice(0, 160)); } catch (_) { cache.snip.set(m.uid, ''); }
      });
      return Object.fromEntries(uids.map(u => [u, cache.snip.get(u) || '']));
    },
    async fetch(uid) {
      const m = await c.fetchOne(String(uid), { uid: true, source: true, flags: true }, { uid: true });
      if (!m) return null;
      const p = await simpleParser(m.source); const f = addr(p.from && p.from.value);
      return { uid: m.uid, date: p.date || new Date(0), from: String(f.address || '').toLowerCase(), from_name: f.name || '', subject: p.subject || '', text: textOf(p),
        message_id: p.messageId || '', in_reply_to: p.inReplyTo || '', references: [].concat(p.references || []).join(' '),
        attachments: (p.attachments || []).map(a => a.filename || 'вложение'), seen: m.flags && m.flags.has('\\Seen') };
    },
    markSeen: uid => c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }),
    async appendSent(raw) {
      const box = (await c.list()).find(b => b.specialUse === '\\Sent');
      if (box) await c.append(box.path, raw, ['\\Seen']);
    },
    logout: () => c.logout(),
  };
}

module.exports = { connect };
