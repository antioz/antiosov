// «Сообщите мне, когда будет ещё»: заявки на вещь после закрытия предзаказа. Согласие — /consent/soobshchit/ (имя + e-mail, один год).
// Ключ (product_id, email): повторная заявка обновляет имя и дату. Рассылку не подписывает.
const db = require('./ydb');
const { HttpError, validEmail, validName, envInt } = require('./util');
const WAIT_CONSENT_VER = '2026-10-06';

async function add(b) {
  const pid = String(b.product_id || '');
  const name = validName(b.name); if (!name) throw new HttpError(400, 'validation', { field: 'name' });
  const email = validEmail(b.email); if (!email) throw new HttpError(400, 'validation', { field: 'email' });
  if (b.consent !== true) throw new HttpError(400, 'validation', { field: 'consent' });
  const [[p]] = await db.query(`DECLARE $id AS Utf8; SELECT id FROM products WHERE id = $id AND active = true;`, { $id: db.V.s(pid) });
  if (!p) throw new HttpError(404, 'no_product');
  await db.query(`DECLARE $p AS Utf8; DECLARE $e AS Utf8; DECLARE $n AS Utf8; DECLARE $v AS Utf8;
    UPSERT INTO waitlist (product_id, email, name, created_at, consent_ver) VALUES ($p, $e, $n, CurrentUtcTimestamp(), $v);`,
  { $p: db.V.s(pid), $e: db.V.s(email), $n: db.V.s(name), $v: db.V.s(WAIT_CONSENT_VER) });
  return { ok: true };
}

const list = async pid => (await db.query(`DECLARE $p AS Utf8; SELECT email, name, created_at FROM waitlist WHERE product_id = $p ORDER BY created_at DESC;`, { $p: db.V.s(String(pid || '')) }))[0];
const remove = async (pid, email) => db.query(`DECLARE $p AS Utf8; DECLARE $e AS Utf8; DELETE FROM waitlist WHERE product_id = $p AND email = $e;`, { $p: db.V.s(String(pid || '')), $e: db.V.s(String(email || '')) });

// Срок согласия — год (WAIT_RETENTION_DAYS); зовётся из orders.gc не чаще раза в 6 ч.
async function purge() {
  const cutoff = new Date(Date.now() - envInt('WAIT_RETENTION_DAYS', 365) * 86400000);
  await db.query(`DECLARE $c AS Timestamp; DELETE FROM waitlist WHERE created_at < $c;`, { $c: db.V.ts(cutoff) });
}

module.exports = { WAIT_CONSENT_VER, add, list, remove, purge };
