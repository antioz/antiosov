// Разовый скрипт заведения товара knock-down в проде.
// Токен админки живёт только в памяти процесса.
const fs = require('fs');
const path = require('path');
const jwt = require('../lib/jwt');

const FN = 'https://functions.yandexcloud.net/d4eh4qtc4a7fria6mgmt';
const PID = 'knock-down';
const PHOTOS = [
  '/Users/imac/Documents/новый/projects/merch-novye-tovary/knock-down/2026-11-01 18.11.20.jpg',
  '/Users/imac/Documents/новый/projects/merch-novye-tovary/knock-down/2026-11-01 18.11.26.jpg',
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
  const token = jwt.sign({ role: 'admin' }, 3600);
  const images = [];
  for (const f of PHOTOS) {
    const { key, put_url } = await api('admin/photo', { product_id: PID, content_type: 'image/jpeg' }, token);
    const up = await fetch(put_url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: fs.readFileSync(f) });
    if (!up.ok) throw new Error(`upload ${key} -> ${up.status}`);
    images.push(key);
    console.log('photo uploaded:', key);
  }
  const description_md = fs.readFileSync(path.join(__dirname, 'knockdown-description.md'), 'utf8');
  const res = await api('admin/product', {
    id: PID, title: 'Knock-down', description_md, price: 3553,
    images, weight_g: 220, dims_cm: { x: 30, y: 25, z: 3 },
    sizes: ['S', 'M', 'L', 'XL'], preorder_allowed: true, active: true, sort: 2,
    kind: 'physical', marked: false,
    variants: [{ size: 'S', stock: 0 }, { size: 'M', stock: 0 }, { size: 'L', stock: 0 }, { size: 'XL', stock: 0 }],
  }, token);
  console.log('product saved:', res.product.id, '|', res.product.title, '|', res.product.price, '| sizes:', res.product.sizes.join(','));
})().catch(e => { console.error(e.message || e); process.exit(1); });
