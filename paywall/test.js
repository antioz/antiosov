// Локальный прогон: node test.js  (читает .env в этой папке: KEY=VALUE)
const fs = require('fs'); const path = require('path');
for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) { const i = l.indexOf('='); if (i > 0) process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
const { handler } = require('./index.js');
(async () => {
  let r = await handler({ httpMethod: 'GET', queryStringParameters: { a: 'pay' } });
  console.log('pay →', r.statusCode, r.headers.Location);
  r = await handler({ httpMethod: 'GET', queryStringParameters: { a: 'access', t: 'nope.nope' } });
  console.log('access bad →', r.statusCode, r.body);
  const crypto = require('crypto');
  const tok = '123.' + crypto.createHmac('sha256', process.env.SECRET).update('123').digest('base64url');
  r = await handler({ httpMethod: 'GET', queryStringParameters: { a: 'access', t: tok } });
  const b = JSON.parse(r.body); console.log('access ok →', r.statusCode, b.pages.length, 'pages; pdf:', b.pdf.slice(0, 90) + '…');
  r = await handler({ httpMethod: 'POST', queryStringParameters: { a: 'notify' }, body: JSON.stringify({ TerminalKey: process.env.TB_TERMINAL, Status: 'CONFIRMED', Token: 'x' }) });
  console.log('notify bad →', r.statusCode, r.body);
  r = await handler({ httpMethod: 'GET', queryStringParameters: { a: 'success', PaymentId: '9226566362' } });
  console.log('success (NEW payment) →', r.statusCode, r.headers.Location);
})();
