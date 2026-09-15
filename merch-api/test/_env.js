// Загружает merch-api/.env в process.env (KEY=VALUE, строки без '=' игнорируются)
const fs = require('fs'), path = require('path');
const p = path.join(__dirname, '..', '.env');
if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i > 0 && !l.startsWith('#')) process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
}
