// Разовый скрипт заведения товара coutegier-femme в проде.
// Токен админки живёт только в памяти процесса и никуда не печатается.
const fs = require('fs');
const path = require('path');
const jwt = require('../lib/jwt');

const FN = 'https://functions.yandexcloud.net/d4eh4qtc4a7fria6mgmt';
const PID = 'coutegier-femme';
const PHOTOS = [
  '/Users/imac/Documents/новый/projects/merch-novye-tovary/coutegier-women/IMAGE 2026-11-01 13:10:09.jpg',
  '/Users/imac/Documents/новый/projects/merch-novye-tovary/coutegier-women/IMAGE 2026-11-01 13:10:22.jpg',
];

async function api(a, body, token) {
  const r = await fetch(`${FN}?a=${a}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${a} -> ${r.status}: ${JSON.stringify(d)}`);
  return d;
}

(async () => {
  const token = jwt.sign({ role: 'admin' }, 3600); // 1 час, только в памяти
  const images = [];
  for (const f of PHOTOS) {
    const { key, put_url } = await api('admin/photo', { product_id: PID, content_type: 'image/jpeg' }, token);
    const buf = fs.readFileSync(f);
    const up = await fetch(put_url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: buf });
    if (!up.ok) throw new Error(`upload ${key} -> ${up.status}`);
    images.push(key);
    console.log('photo uploaded:', key);
  }
  const product = JSON.parse(fs.readFileSync(path.join(__dirname, 'product.json'), 'utf8'));
  product.images = images;
  const res = await api('admin/product', product, token);
  console.log('product saved:', res.product.id, res.product.title, res.product.price, 'sizes:', res.product.sizes.join(','));
})().catch(e => { console.error(e.message || e); process.exit(1); });
