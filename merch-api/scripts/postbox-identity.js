// Одноразовый скрипт: создать/прочитать адрес домена в Postbox через SES-совместимый API
// (в yc 1.34 нет группы `postbox`). Авторизация — статический ключ SA (S3_KEY/S3_SECRET),
// SigV4 как в S3, но service=ses. Читает merch-api/.env.
//   node scripts/postbox-identity.js create   → POST /v2/email/identities {"EmailIdentity":"antiosov.ru"}
//   node scripts/postbox-identity.js get      → GET  /v2/email/identities/antiosov.ru (статус, DKIM-токены)
// Печатает DNS-записи для регистратора.
require('../test/_env');
const crypto = require('crypto'), https = require('https');
const HOST = 'postbox.cloud.yandex.net', REGION = 'ru-central1', SERVICE = 'ses';
const DOMAIN = process.env.MAIL_FROM.split('@')[1];

function sigv4(method, path, body) {
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''), day = now.slice(0, 8);
  const scope = `${day}/${REGION}/${SERVICE}/aws4_request`;
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  const headers = { host: HOST, 'x-amz-content-sha256': bodyHash, 'x-amz-date': now };
  if (body) headers['content-type'] = 'application/json';
  const signed = Object.keys(headers).sort();
  const canonical = [method, path, '', ...signed.map(k => `${k}:${headers[k]}`), '', signed.join(';'), bodyHash].join('\n');
  const sts = ['AWS4-HMAC-SHA256', now, scope, crypto.createHash('sha256').update(canonical).digest('hex')].join('\n');
  const h = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  const kSign = h(h(h(h('AWS4' + process.env.S3_SECRET, day), REGION), SERVICE), 'aws4_request');
  const sig = crypto.createHmac('sha256', kSign).update(sts).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${process.env.S3_KEY}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${sig}`;
  return headers;
}

function call(method, path, bodyObj) {
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const headers = sigv4(method, path, body);
  if (body) headers['content-length'] = Buffer.byteLength(body);
  return new Promise((res, rej) => {
    const r = https.request({ host: HOST, method, path, headers }, resp => {
      let d = ''; resp.on('data', c => d += c); resp.on('end', () => res({ status: resp.statusCode, body: d }));
    });
    r.on('error', rej); r.end(body);
  });
}

(async () => {
  const action = process.argv[2] || 'get';
  const r = action === 'create'
    ? await call('POST', '/v2/email/identities', { EmailIdentity: DOMAIN })
    : await call('GET', `/v2/email/identities/${DOMAIN}`);
  console.log('HTTP', r.status);
  let j; try { j = JSON.parse(r.body); } catch (_) { console.log(r.body); process.exit(1); }
  console.log(JSON.stringify(j, null, 2));
  const tokens = (j.DkimAttributes || {}).Tokens || [];
  if (tokens.length) {
    console.log('\nDNS-записи для регистратора (имя → тип → значение):');
    for (const t of tokens) console.log(`${t}._domainkey.${DOMAIN} → CNAME → ${t}.dkim.postbox.cloud.yandex.net`);
    console.log(`_dmarc.${DOMAIN} → TXT → v=DMARC1; p=none; rua=mailto:${process.env.OWNER_EMAIL}`);
  }
  process.exit(r.status >= 300 ? 1 : 0);
})();
