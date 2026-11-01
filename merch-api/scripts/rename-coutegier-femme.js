// Переименование товара coutegier-femme -> «Coutegière» (как на принте).
// Токен админки живёт только в памяти процесса.
const fs = require('fs');
const path = require('path');
const jwt = require('../lib/jwt');

const FN = 'https://functions.yandexcloud.net/d4eh4qtc4a7fria6mgmt';

(async () => {
  const token = jwt.sign({ role: 'admin' }, 3600);
  const g = await fetch(`${FN}?a=product&s=coutegier-femme`);
  const { product: p } = await g.json();
  const description_md = fs.readFileSync(path.join(__dirname, 'description.md'), 'utf8');
  const body = {
    id: p.id, title: 'Coutegière Femme', description_md, price: p.price,
    images: p.images, weight_g: p.weight_g, dims_cm: p.dims_cm, sizes: p.sizes,
    preorder_allowed: p.preorder_allowed, active: p.active, sort: p.sort, kind: p.kind,
    variants: p.variants.map(v => ({ size: v.size, stock: v.stock })),
  };
  const r = await fetch(`${FN}?a=admin/product`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`admin/product -> ${r.status}: ${JSON.stringify(d)}`);
  console.log('renamed:', d.product.id, '|', d.product.title, '| images:', d.product.images.length, '| sizes:', d.product.sizes.join(','));
})().catch(e => { console.error(e.message || e); process.exit(1); });
