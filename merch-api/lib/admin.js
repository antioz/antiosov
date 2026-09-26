// Админ-маршруты. Доступ по JWT (пароль в ADMIN_PASSWORD, 30 дней).
const crypto = require('crypto');
const db = require('./ydb'); const orders = require('./orders'); const jwt = require('./jwt'); const s3 = require('./s3'); const ext = require('./ext');
const { json, HttpError } = require('./util');
const ENV = process.env;
const fails = { n: 0, at: 0 }; // rate-limit логина на инстанс: 5 неудач / 10 мин

function login(body) {
  if (Date.now() - fails.at >= 600000) fails.n = 0;
  if (fails.n >= 5) throw new HttpError(429, 'too_many');
  const a = Buffer.from(String(body.password || '')), b = Buffer.from(ENV.ADMIN_PASSWORD || '');
  if (!b.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) { fails.n++; fails.at = Date.now(); throw new HttpError(401, 'bad_password'); }
  fails.n = 0;
  return json(200, { token: jwt.sign({ role: 'admin' }, 30 * 86400) });
}
const requireAuth = auth => { const t = String(auth || '').replace(/^Bearer\s+/i, ''); const p = jwt.verify(t); if (!p || p.role !== 'admin') throw new HttpError(401, 'unauthorized'); };

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const PHOTO_KEY_RE = /^p\/[a-z0-9][a-z0-9-]{1,40}\/[0-9a-f]+\.(jpg|png)$/;
const fileKeyOk = (id, key) => key === '' || (key.startsWith(`d/${id}/`) && /^[0-9a-f]+\.zip$/.test(key.slice(id.length + 3)));
const ORDER_STATUSES = ['new', 'paid', 'packed', 'shipped', 'done', 'cancelled', 'expired'];
async function upsertProduct(b) {
  const id = String(b.id || ''); if (!SLUG_RE.test(id)) throw new HttpError(400, 'validation', { field: 'id' });
  const title = String(b.title || '').trim(); if (!title) throw new HttpError(400, 'validation', { field: 'title' });
  const price = parseInt(b.price, 10); if (!(price >= 1)) throw new HttpError(400, 'validation', { field: 'price' });
  // kind/file_key: не пришли в теле (старая форма админки) → остаются как в БД; новый товар — physical без архива.
  if (b.kind !== undefined && b.kind !== 'digital' && b.kind !== 'physical') throw new HttpError(400, 'validation', { field: 'kind' });
  if (b.file_key !== undefined && b.file_key !== null && !fileKeyOk(id, String(b.file_key))) throw new HttpError(400, 'validation', { field: 'file_key' });
  if (b.free_file_key !== undefined && b.free_file_key !== null && !fileKeyOk(id, String(b.free_file_key))) throw new HttpError(400, 'validation', { field: 'free_file_key' });
  if (b.free_until !== undefined && b.free_until !== null && b.free_until !== '' && !Number.isFinite(Date.parse(String(b.free_until)))) throw new HttpError(400, 'validation', { field: 'free_until' });
  const [[prev]] = await db.query(`DECLARE $id AS Utf8; SELECT kind, file_key, free_file_key, free_until FROM products WHERE id = $id;`, { $id: db.V.s(id) });
  // Поля акции, как kind/file_key: не пришли в теле → остаются как в БД. free_until хранится в ISO UTC.
  const keep = (v, old) => (v !== undefined && v !== null) ? String(v) : ((prev && old) || '');
  const free_file_key = keep(b.free_file_key, prev && prev.free_file_key);
  const free_until = (b.free_until !== undefined && b.free_until !== null) ? (b.free_until === '' ? '' : new Date(String(b.free_until)).toISOString()) : ((prev && prev.free_until) || '');
  const kind = b.kind !== undefined ? b.kind : (prev && prev.kind === 'digital' ? 'digital' : 'physical');
  const file_key = (b.file_key !== undefined && b.file_key !== null) ? String(b.file_key) : ((prev && prev.file_key) || '');
  const digital = kind === 'digital';
  const sizes = digital ? [] : Array.isArray(b.sizes) ? b.sizes.map(s => String(s).trim()).filter(Boolean) : [];
  const dims = b.dims_cm || {}; const dims_cm = { x: +dims.x || 30, y: +dims.y || 20, z: +dims.z || 3 };
  const images = Array.isArray(b.images) ? b.images.map(String) : [];
  // Варианты: набор размеров = sizes (или '-'); stock задаётся, reserved/preorder_count сохраняются.
  const want = digital ? [] : sizes.length ? sizes : ['-']; // у цифрового товара вариантов нет (остатка и резерва тоже)
  const stocks = Object.fromEntries((Array.isArray(b.variants) ? b.variants : []).map(v => [String(v.size), Math.max(0, parseInt(v.stock, 10) || 0)]));
  // Одна транзакция: сначала проверка занятых размеров (409 до любой записи), потом products + variants.
  await db.tx(async run => {
    const [have] = await run(`DECLARE $id AS Utf8; SELECT size, stock, reserved, preorder_count FROM variants WHERE product_id = $id;`, { $id: db.V.s(id) });
    const drop = have.filter(h => !want.includes(h.size));
    for (const h of drop) if (h.reserved > 0 || h.preorder_count > 0) throw new HttpError(409, 'size_in_use', { size: h.size });
    await run(`DECLARE $id AS Utf8; DECLARE $title AS Utf8; DECLARE $d AS Utf8; DECLARE $price AS Int32; DECLARE $img AS Json; DECLARE $w AS Int32; DECLARE $dims AS Json;
      DECLARE $sizes AS Json; DECLARE $pa AS Bool; DECLARE $psb AS Utf8; DECLARE $active AS Bool; DECLARE $sort AS Int32; DECLARE $kind AS Utf8; DECLARE $fk AS Utf8; DECLARE $ffk AS Utf8; DECLARE $fu AS Utf8;
      UPSERT INTO products (id, title, description_md, price, images, weight_g, dims_cm, sizes, preorder_allowed, preorder_ship_by, active, sort, updated_at, kind, file_key, free_file_key, free_until)
      VALUES ($id, $title, $d, $price, $img, $w, $dims, $sizes, $pa, $psb, $active, $sort, CurrentUtcTimestamp(), $kind, $fk, $ffk, $fu);`,
      { $id: db.V.s(id), $title: db.V.s(title), $d: db.V.s(String(b.description_md || '')), $price: db.V.i(price), $img: db.V.j(images), $w: db.V.i(parseInt(b.weight_g, 10) || 300),
        $dims: db.V.j(dims_cm), $sizes: db.V.j(sizes), $pa: db.V.b(!digital && b.preorder_allowed), $psb: db.V.s(String(b.preorder_ship_by || '')), $active: db.V.b(b.active), $sort: db.V.i(parseInt(b.sort, 10) || 0),
        $kind: db.V.s(kind), $fk: db.V.s(file_key), $ffk: db.V.s(free_file_key), $fu: db.V.s(free_until) });
    for (const h of drop) await run(`DECLARE $id AS Utf8; DECLARE $s AS Utf8; DELETE FROM variants WHERE product_id = $id AND size = $s;`, { $id: db.V.s(id), $s: db.V.s(h.size) });
    for (const s of want) {
      const h = have.find(x => x.size === s);
      await run(`DECLARE $id AS Utf8; DECLARE $s AS Utf8; DECLARE $st AS Int32; DECLARE $r AS Int32; DECLARE $pc AS Int32;
        UPSERT INTO variants (product_id, size, stock, reserved, preorder_count) VALUES ($id, $s, $st, $r, $pc);`,
        { $id: db.V.s(id), $s: db.V.s(s), $st: db.V.i(stocks[s] != null ? stocks[s] : (h ? h.stock : 0)), $r: db.V.i(h ? h.reserved : 0), $pc: db.V.i(h ? h.preorder_count : 0) });
    }
  });
  return orders.getProduct(id, { admin: true });
}

async function route(a, method, body, q, auth) {
  if (a === 'admin/login') { if (method !== 'POST') throw new HttpError(405, 'method'); return login(body); }
  requireAuth(auth);
  switch (a) {
    case 'admin/summary': {
      const [paid, packed] = await Promise.all([orders.listOrders({ status: 'paid' }), orders.listOrders({ status: 'packed' })]);
      const open = [...paid, ...packed].filter(o => o.kind !== 'digital'); const mode = ext.yd.mode(); // цифровые не ждут отправки
      return json(200, { to_ship: open.length, preorders: open.filter(o => o.is_preorder).length, yd_mode: mode,
        yd_env_mismatch: open.filter(o => o.delivery_mode === 'yandex' && o.yd_env !== mode).length });
    }
    case 'admin/orders': {
      const st = q.status ? String(q.status) : undefined;
      if (st && !ORDER_STATUSES.includes(st)) throw new HttpError(400, 'validation', { field: 'status' });
      return json(200, { orders: await orders.listOrders({ status: st }) });
    }
    case 'admin/order': {
      if (method === 'GET') { const o = await orders.getOrder(String(q.id || '')); return o ? json(200, { order: o }) : json(404, { error: 'no_order' }); }
      const id = String(body.id || '');
      switch (body.action) {
        case 'next': { const cur = await orders.getOrder(id); if (!cur) throw new HttpError(404, 'no_order'); const to = orders.nextStatus(cur); if (!to) throw new HttpError(409, 'bad_transition'); return json(200, { order: await orders.transition(id, to) }); }
        case 'cancel': return json(200, { order: await orders.cancel(id) });
        case 'retry_yd': return json(200, { order: await orders.retryYd(id) });
        case 'note': return json(200, { order: await orders.setNote(id, body.note) });
        default: throw new HttpError(400, 'bad_action');
      }
    }
    case 'admin/products': {
      const [ps, vs] = await db.query(`SELECT * FROM products ORDER BY sort, id; SELECT * FROM variants;`);
      return json(200, { products: ps.map(p => ({ ...p, kind: p.kind === 'digital' ? 'digital' : 'physical', file_key: p.file_key || '', has_file: !!p.file_key, images: JSON.parse(p.images || '[]'), sizes: JSON.parse(p.sizes || '[]'), dims_cm: JSON.parse(p.dims_cm || '{}'),
        variants: vs.filter(v => v.product_id === p.id).map(v => ({ size: v.size, stock: v.stock, reserved: v.reserved, preorder_count: v.preorder_count })) })) });
    }
    case 'admin/product': {
      if (method === 'GET') { const p = await orders.getProduct(String(q.id || ''), { admin: true }); return p ? json(200, { product: p }) : json(404, { error: 'no_product' }); }
      return json(200, { product: await upsertProduct(body) });
    }
    // Архив цифрового товара: presigned PUT в закрытый d/<id>/ (публично открыт только p/*). Ключ потом сохраняется через admin/product.
    case 'admin/file': {
      if (method !== 'POST') throw new HttpError(405, 'method');
      const pid = String(body.product_id || ''); if (!SLUG_RE.test(pid)) throw new HttpError(400, 'validation', { field: 'product_id' });
      const key = `d/${pid}/${crypto.randomBytes(6).toString('hex')}.zip`;
      return json(200, { key, put_url: s3.presignPut(key, 'application/zip', 600), content_type: 'application/zip' });
    }
    case 'admin/photo': {
      if (method === 'POST') {
        const pid = String(body.product_id || ''); if (!SLUG_RE.test(pid)) throw new HttpError(400, 'validation', { field: 'product_id' });
        const ct = body.content_type === 'image/png' ? 'image/png' : 'image/jpeg';
        const key = `p/${pid}/${crypto.randomBytes(6).toString('hex')}.${ct === 'image/png' ? 'png' : 'jpg'}`;
        return json(200, { key, put_url: s3.presignPut(key, ct, 600), public_url: s3.publicUrl(key), content_type: ct });
      }
      if (method === 'DELETE') { const key = String(body.key || ''); if (!PHOTO_KEY_RE.test(key)) throw new HttpError(400, 'validation', { field: 'key' }); await s3.deleteObject(key); return json(200, { ok: true }); }
      throw new HttpError(405, 'method');
    }
    default: return json(404, { error: 'not_found' });
  }
}
module.exports = { route };
