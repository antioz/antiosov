// Object Storage, AWS SigV4. presignPut — для загрузки фото из админки (подписывается точный
// Content-Type, поэтому клиент обязан слать тот же заголовок). presignGet — выдача архива цифрового товара из закрытого d/*.
// deleteObject — подписанный DELETE.
const https = require('https'); const crypto = require('crypto');
const ENV = process.env;
const HOST = 'storage.yandexcloud.net', REGION = 'ru-central1', SERVICE = 's3';
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const amzDate = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
const signingKey = day => hmac(hmac(hmac(hmac('AWS4' + ENV.S3_SECRET, day), REGION), SERVICE), 'aws4_request');
const canonicalUri = key => '/' + ENV.S3_BUCKET + '/' + key.split('/').map(enc).join('/');

function presignPut(key, contentType, ttlSec) {
  const date = amzDate(), day = date.slice(0, 8), scope = `${day}/${REGION}/${SERVICE}/aws4_request`;
  const q = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${ENV.S3_KEY}/${scope}`, 'X-Amz-Date': date,
    'X-Amz-Expires': String(ttlSec), 'X-Amz-SignedHeaders': 'content-type;host',
  };
  const cq = Object.keys(q).sort().map(k => `${enc(k)}=${enc(q[k])}`).join('&');
  const cr = ['PUT', canonicalUri(key), cq, `content-type:${contentType}\nhost:${HOST}\n`, 'content-type;host', 'UNSIGNED-PAYLOAD'].join('\n');
  const sts = ['AWS4-HMAC-SHA256', date, scope, sha(cr)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(day)).update(sts).digest('hex');
  return `https://${HOST}${canonicalUri(key)}?${cq}&X-Amz-Signature=${signature}`;
}

// response-content-disposition входит в подпись: имя файла при скачивании задаём мы, а не ключ в бакете (d/<id>/<hex>.zip).
function presignGet(key, ttlSec, filename) {
  const date = amzDate(), day = date.slice(0, 8), scope = `${day}/${REGION}/${SERVICE}/aws4_request`;
  const q = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${ENV.S3_KEY}/${scope}`, 'X-Amz-Date': date,
    'X-Amz-Expires': String(ttlSec), 'X-Amz-SignedHeaders': 'host',
    ...(filename ? { 'response-content-disposition': `attachment; filename="${String(filename).replace(/["\\\r\n]/g, '')}"` } : {}),
  };
  const cq = Object.keys(q).sort().map(k => `${enc(k)}=${enc(q[k])}`).join('&');
  const cr = ['GET', canonicalUri(key), cq, `host:${HOST}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const sts = ['AWS4-HMAC-SHA256', date, scope, sha(cr)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(day)).update(sts).digest('hex');
  return `https://${HOST}${canonicalUri(key)}?${cq}&X-Amz-Signature=${signature}`;
}

function deleteObject(key) {
  const date = amzDate(), day = date.slice(0, 8), scope = `${day}/${REGION}/${SERVICE}/aws4_request`;
  const payloadHash = sha('');
  const headers = { host: HOST, 'x-amz-content-sha256': payloadHash, 'x-amz-date': date };
  const signed = Object.keys(headers).sort();
  const cr = ['DELETE', canonicalUri(key), '', signed.map(h => `${h}:${headers[h]}\n`).join(''), signed.join(';'), payloadHash].join('\n');
  const sts = ['AWS4-HMAC-SHA256', date, scope, sha(cr)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(day)).update(sts).digest('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${ENV.S3_KEY}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}`;
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: HOST, path: canonicalUri(key), method: 'DELETE', headers: { ...headers, Authorization: auth } }, res => {
      res.resume(); res.on('end', () => (res.statusCode < 300 || res.statusCode === 404) ? resolve() : reject(new Error('s3 delete ' + res.statusCode)));
    });
    req.on('error', reject); req.end();
  });
}

const publicUrl = key => `https://${HOST}/${ENV.S3_BUCKET}/${key}`;
module.exports = { presignPut, presignGet, deleteObject, publicUrl };
