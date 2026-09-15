// Минимальный JWT (HS256) для админки. Отзыв всех токенов — смена SECRET.
const crypto = require('crypto');
const b64 = s => Buffer.from(s).toString('base64url');
const sig = data => crypto.createHmac('sha256', process.env.SECRET).update(data).digest('base64url');

function sign(payload, ttlSec) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSec };
  const data = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + b64(JSON.stringify(body));
  return data + '.' + sig(data);
}
function verify(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = parts[0] + '.' + parts[1];
  const good = Buffer.from(sig(data)), got = Buffer.from(parts[2]);
  if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return null;
  let body; try { body = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); } catch (e) { return null; }
  if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
  return body;
}
module.exports = { sign, verify };
