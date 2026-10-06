// IMAP ящика REPLY_TO (imap.yandex.ru, пароль приложения). Только INBOX; отбор клиентских писем — в inbox.js.
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const addr = a => (a && a[0]) || {};
const hdr = (buf, name) => { const m = String(buf || '').match(new RegExp(`^${name}:\\s*([\\s\\S]*?)(?=\\r?\\n\\S|$)`, 'im')); return m ? m[1].replace(/\s+/g, ' ').trim() : ''; };
const strip = html => String(html || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const textOf = p => (p.text || strip(p.html) || '').trim();

async function connect({ user, pass }) {
  const c = new ImapFlow({ host: 'imap.yandex.ru', port: 993, secure: true, auth: { user, pass }, logger: false, socketTimeout: 15000 });
  await c.connect();
  await c.mailboxOpen('INBOX');
  return {
    // Конверты писем за days дней (+ In-Reply-To/References для отбора); сниппет — только для отобранных, вторым проходом через snippets().
    async recent(days) {
      const uids = await c.search({ since: new Date(Date.now() - days * 864e5) }, { uid: true });
      if (!uids || !uids.length) return [];
      const out = [];
      for await (const m of c.fetch(uids, { uid: true, envelope: true, flags: true, headers: ['in-reply-to', 'references'] }, { uid: true })) {
        const f = addr(m.envelope.from);
        out.push({ uid: m.uid, date: m.envelope.date || new Date(0), from: String(f.address || '').toLowerCase(), from_name: f.name || '', subject: m.envelope.subject || '',
          seen: m.flags && m.flags.has('\\Seen'), in_reply_to: hdr(m.headers, 'in-reply-to'), references: hdr(m.headers, 'references') });
      }
      return out;
    },
    async snippets(uids) {
      const res = {}; if (!uids.length) return res;
      for await (const m of c.fetch(uids, { uid: true, source: { maxLength: 60000 } }, { uid: true })) {
        try { res[m.uid] = textOf(await simpleParser(m.source)).replace(/\s+/g, ' ').slice(0, 160); } catch (_) { res[m.uid] = ''; }
      }
      return res;
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
