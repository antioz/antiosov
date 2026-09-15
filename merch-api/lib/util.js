const crypto = require('crypto');
const ENV = process.env;

class HttpError extends Error {
  constructor(code, error, extra) { super(error); this.code = code; this.error = error; this.extra = extra; }
}

// CORS: боевой origin — SITE; для локальной разработки эхо DEV_ORIGIN, если запрос пришёл с него.
let reqOrigin = '';
const setOrigin = o => { reqOrigin = o || ''; };
const cors = () => ({ 'Access-Control-Allow-Origin': (ENV.DEV_ORIGIN && reqOrigin === ENV.DEV_ORIGIN) ? reqOrigin : (ENV.SITE || 'https://antiosov.ru'), 'Vary': 'Origin' });
const json = (code, obj, extraHeaders = {}) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(), ...extraHeaders },
  body: JSON.stringify(obj),
});
const text = (code, s) => ({ statusCode: code, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: s });
const redirect = url => ({ statusCode: 302, headers: { Location: url, 'Cache-Control': 'no-store' }, body: '' });

const envInt = (name, def) => { const v = parseInt(ENV[name], 10); return Number.isFinite(v) ? v : def; };

function validPhone(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length < 10 || d.length > 15) return null;
  if (d.length === 10) d = '7' + d;
  return '+' + d;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const validEmail = s => { const v = String(s || '').trim().toLowerCase(); return EMAIL_RE.test(v) && v.length <= 120 ? v : null; };
const validName = s => { const v = String(s || '').trim().replace(/\s+/g, ' '); return v.length >= 2 && v.length <= 80 ? v : null; };
const randomKey = () => crypto.randomBytes(8).toString('hex');
const nowIso = () => new Date().toISOString();

module.exports = { HttpError, json, text, redirect, envInt, validPhone, validEmail, validName, randomKey, nowIso, cors, setOrigin };
