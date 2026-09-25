// Домен заказов. Все изменения состояния — условные UPDATE (WHERE status = $from) в serializable-транзакциях (db.tx).
// Побочные эффекты (письма, Т-Банк, Яндекс Доставка) — только после коммита транзакции и только в той ветке, которая перевела статус.
const db = require('./ydb'); const ext = require('./ext'); const mail = require('./mail'); const s3 = require('./s3');
const { HttpError, envInt, randomKey, validPhone, validEmail, validName } = require('./util');
const ENV = process.env;
const QTY_MAX = 5;

const parseJson = (s, def) => { try { return s == null || s === '' ? def : JSON.parse(s); } catch (_) { return def; } };
const asArr = x => Array.isArray(x) ? x : [];
const asDims = d => { const n = k => Number(d && d[k]); return (d && typeof d === 'object' && [n('x'), n('y'), n('z')].every(v => Number.isFinite(v) && v > 0)) ? { x: n('x'), y: n('y'), z: n('z') } : { x: 30, y: 20, z: 3 }; };
const parseProduct = p => p && ({ ...p, images: asArr(parseJson(p.images, [])), dims_cm: asDims(parseJson(p.dims_cm, null)), sizes: asArr(parseJson(p.sizes, [])) });
const withUrls = p => p && ({ ...p, image_urls: p.images.map(k => s3.publicUrl(k)) });
const bySizeOrder = sizes => (a, b) => sizes.indexOf(a.size) - sizes.indexOf(b.size);

// ---------- каталог ----------
async function catalog() {
  const [ps, vs] = await db.query(`SELECT * FROM products WHERE active = true ORDER BY sort, id; SELECT * FROM variants;`);
  const byP = {};
  for (const v of vs) (byP[v.product_id] = byP[v.product_id] || []).push({ size: v.size, available: Math.max(0, v.stock - v.reserved), preorder_count: v.preorder_count });
  return ps.map(parseProduct).map(withUrls).map(p => ({
    id: p.id, title: p.title, price: p.price, image_urls: p.image_urls, sizes: p.sizes,
    preorder_allowed: p.preorder_allowed, preorder_ship_by: p.preorder_ship_by,
    variants: (byP[p.id] || []).sort(bySizeOrder(p.sizes)),
  }));
}

async function getProduct(id, { admin = false } = {}) {
  const [[p], vs] = await db.query(`DECLARE $id AS Utf8; SELECT * FROM products WHERE id = $id; SELECT * FROM variants WHERE product_id = $id;`, { $id: db.V.s(id) });
  if (!p || (!admin && !p.active)) return null;
  const prod = withUrls(parseProduct(p));
  prod.variants = vs.map(v => ({ size: v.size, stock: v.stock, reserved: v.reserved, available: Math.max(0, v.stock - v.reserved), preorder_count: v.preorder_count }))
    .sort(bySizeOrder(prod.sizes));
  return prod;
}

// ---------- создание заказа ----------
function validate(i) {
  const bad = f => { throw new HttpError(400, 'validation', { field: f }); };
  const name = validName(i.name) || bad('name'); const phone = validPhone(i.phone) || bad('phone'); const email = validEmail(i.email) || bad('email');
  const qty = parseInt(i.qty, 10); if (!(qty >= 1 && qty <= QTY_MAX)) bad('qty');
  if (i.offer !== true && i.offer !== 'true') bad('offer');
  if (i.consent !== true && i.consent !== 'true') bad('consent');
  const size = String(i.size || '-');
  const off = ext.yd.mode() === 'off';
  const address_text = off ? String(i.address_text || '').trim() : ''; if (off && address_text.length < 10) bad('address_text');
  const pvz_id = off ? '' : String(i.pvz_id || ''); if (!off && !pvz_id) bad('pvz_id');
  return { name, phone, email, qty, size, address_text, pvz_id, pvz_address: off ? '' : String(i.pvz_address || '').slice(0, 300) };
}

async function createOrder(input) {
  await gc();
  const v = validate(input);
  const product = await getProduct(String(input.product_id || ''));
  if (!product) throw new HttpError(404, 'no_product');
  if (!(product.sizes.length ? product.sizes.includes(v.size) : v.size === '-')) throw new HttpError(400, 'validation', { field: 'size' });
  const delivery = await ext.yd.quote({ pvz_id: v.pvz_id, weight_g: product.weight_g, dims_cm: product.dims_cm, qty: v.qty });
  const price_delivery = delivery.price_rub, total = product.price * v.qty + price_delivery;
  const k = randomKey();
  const ydMode = ext.yd.mode();

  // Резерв + номер + запись заказа — одна транзакция; конфликт по variants/counters → tx() повторяет целиком.
  const { id, is_preorder } = await db.tx(async run => {
    const [[var_]] = await run(`DECLARE $p AS Utf8; DECLARE $s AS Utf8; SELECT stock, reserved, preorder_count FROM variants WHERE product_id = $p AND size = $s;`, { $p: db.V.s(product.id), $s: db.V.s(v.size) });
    if (!var_) throw new HttpError(404, 'no_variant');
    const available = var_.stock - var_.reserved;
    let is_preorder = false;
    if (available >= v.qty) {
      await run(`DECLARE $p AS Utf8; DECLARE $s AS Utf8; DECLARE $q AS Int32; UPDATE variants SET reserved = reserved + $q WHERE product_id = $p AND size = $s;`, { $p: db.V.s(product.id), $s: db.V.s(v.size), $q: db.V.i(v.qty) });
    } else if (available <= 0 && product.preorder_allowed && var_.preorder_count + v.qty <= envInt('PREORDER_MAX', 20)) {
      is_preorder = true;
    } else throw new HttpError(409, 'sold_out');
    const [[c]] = await run(`SELECT value FROM counters WHERE name = 'order'u;`);
    const n = (c ? c.value : 0) + 1;
    await run(`DECLARE $n AS Int32; UPSERT INTO counters (name, value) VALUES ('order'u, $n);`, { $n: db.V.i(n) });
    const id = 'M-' + String(n).padStart(6, '0');
    await run(`DECLARE $id AS Utf8; DECLARE $k AS Utf8; DECLARE $p AS Utf8; DECLARE $s AS Utf8; DECLARE $q AS Int32; DECLARE $pre AS Bool;
      DECLARE $pi AS Int32; DECLARE $pd AS Int32; DECLARE $t AS Int32; DECLARE $n AS Utf8; DECLARE $ph AS Utf8; DECLARE $e AS Utf8;
      DECLARE $addr AS Utf8; DECLARE $pvz AS Utf8; DECLARE $pvza AS Utf8; DECLARE $dm AS Utf8; DECLARE $ydenv AS Utf8; DECLARE $days AS Int32;
      UPSERT INTO orders (id, k, created_at, updated_at, status, product_id, size, qty, is_preorder, price_item, price_delivery, total,
        customer_name, customer_phone, customer_email, address_text, pvz_id, pvz_address, delivery_mode, yd_env, delivery_days,
        yd_request_id, yd_track_url, yd_error, tb_payment_id, tb_payment_url, tb_refund_id, mail_error, consent_at, admin_note)
      VALUES ($id, $k, CurrentUtcTimestamp(), CurrentUtcTimestamp(), 'new'u, $p, $s, $q, $pre, $pi, $pd, $t, $n, $ph, $e, $addr, $pvz, $pvza, $dm, $ydenv, $days,
        ''u, ''u, ''u, ''u, ''u, ''u, ''u, CurrentUtcTimestamp(), ''u);`,
      { $id: db.V.s(id), $k: db.V.s(k), $p: db.V.s(product.id), $s: db.V.s(v.size), $q: db.V.i(v.qty), $pre: db.V.b(is_preorder), $pi: db.V.i(product.price), $pd: db.V.i(price_delivery), $t: db.V.i(total),
        $n: db.V.s(v.name), $ph: db.V.s(v.phone), $e: db.V.s(v.email), $addr: db.V.s(v.address_text), $pvz: db.V.s(v.pvz_id), $pvza: db.V.s(v.pvz_address),
        $dm: db.V.s(ydMode === 'off' ? 'flat' : 'yandex'), $ydenv: db.V.s(ydMode), $days: db.V.i(delivery.days || 0) });
    return { id, is_preorder };
  });

  const due = new Date(Date.now() + envInt('RESERVE_MIN', 20) * 60000);
  const itemName = `${product.title}${v.size !== '-' ? ' ' + v.size : ''}`;
  let pay;
  try {
    pay = await ext.tbank.init({
      orderId: id, amountRub: total, description: `Заказ ${id}: ${itemName} × ${v.qty}`, email: v.email, dueDate: due,
      receiptItems: [{ name: itemName, price_rub: product.price, qty: v.qty, object: 'commodity', method: is_preorder ? 'full_prepayment' : 'full_payment' },
        ...(price_delivery > 0 ? [{ name: 'Доставка', price_rub: price_delivery, qty: 1, object: 'service', method: 'full_payment' }] : [])],
      successUrl: `${ENV.SELF_URL}?a=success&id=${id}&k=${k}`, failUrl: `${ENV.SITE}/merch/order/?id=${id}&k=${k}&fail=1`, notifyUrl: `${ENV.SELF_URL}?a=notify`,
    });
  } catch (e) {
    console.error('init failed', id, e.message);
    await releaseNew(id, 'cancelled');
    throw new HttpError(502, 'payment_init');
  }
  await db.query(`DECLARE $id AS Utf8; DECLARE $pid AS Utf8; DECLARE $url AS Utf8; UPDATE orders SET tb_payment_id = $pid, tb_payment_url = $url, updated_at = CurrentUtcTimestamp() WHERE id = $id;`,
    { $id: db.V.s(id), $pid: db.V.s(String(pay.paymentId)), $url: db.V.s(String(pay.paymentUrl)) });
  return { id, k, paymentUrl: pay.paymentUrl };
}

// new → expired|cancelled с возвратом резерва (одна транзакция). Возвращает true, если перевёл.
async function releaseNew(id, to) {
  return db.tx(async run => {
    const [[o]] = await run(`DECLARE $id AS Utf8; SELECT status, product_id, size, qty, is_preorder FROM orders WHERE id = $id;`, { $id: db.V.s(id) });
    if (!o || o.status !== 'new') return false;
    await run(`DECLARE $id AS Utf8; DECLARE $to AS Utf8; UPDATE orders SET status = $to, updated_at = CurrentUtcTimestamp() WHERE id = $id AND status = 'new'u;`, { $id: db.V.s(id), $to: db.V.s(to) });
    if (!o.is_preorder) await run(`DECLARE $p AS Utf8; DECLARE $s AS Utf8; DECLARE $q AS Int32; UPDATE variants SET reserved = Greatest(reserved - $q, 0) WHERE product_id = $p AND size = $s;`, { $p: db.V.s(o.product_id), $s: db.V.s(o.size), $q: db.V.i(o.qty) });
    return true;
  });
}

let lastPurge = 0;
async function gc() {
  const cutoff = new Date(Date.now() - envInt('RESERVE_MIN', 20) * 60000);
  const [rows] = await db.query(`DECLARE $c AS Timestamp; SELECT id FROM orders VIEW by_status WHERE status = 'new'u AND created_at < $c LIMIT 100;`, { $c: db.V.ts(cutoff) });
  let n = 0; for (const r of rows) if (await releaseNew(r.id, 'expired')) n++;
  // purgePd сканирует всю таблицу orders — не чаще раза в 6 часов на экземпляр функции, а не на каждый запрос каталога.
  if (Date.now() - lastPurge > 6 * 3600000) { lastPurge = Date.now(); try { await purgePd(); } catch (e) { console.error('purgePd', e.message); } }
  return n;
}

// Срок хранения ПД из политики и согласия (/merch/privacy/, /consent/) — 3 года с даты заказа. Потом заказ обезличивается:
// контакты и адрес стираются, номер, товар и суммы остаются для учёта. Возвращает число обезличенных заказов.
async function purgePd() {
  const cutoff = new Date(Date.now() - envInt('PD_RETENTION_DAYS', 1095) * 86400000);
  const [rows] = await db.query(`DECLARE $c AS Timestamp; SELECT id FROM orders WHERE created_at < $c AND customer_email != ''u LIMIT 100;`, { $c: db.V.ts(cutoff) });
  for (const r of rows) {
    await db.query(`DECLARE $id AS Utf8; UPDATE orders SET customer_name = ''u, customer_phone = ''u, customer_email = ''u, address_text = ''u, pvz_address = ''u, updated_at = CurrentUtcTimestamp() WHERE id = $id;`, { $id: db.V.s(r.id) });
    console.log('purgePd', r.id);
  }
  return rows.length;
}

// ---------- оплата ----------
// run — функция транзакции (читать внутри tx) или null (авто-транзакция).
async function loadOrderWithProduct(run, id) {
  if (id === undefined) { id = run; run = null; }
  const q = run || db.query;
  const [[o]] = await q(`DECLARE $id AS Utf8; SELECT * FROM orders WHERE id = $id;`, { $id: db.V.s(id) });
  if (!o) return null;
  const product = await getProduct(o.product_id, { admin: true });
  return { ...o, product_title: product ? product.title : o.product_id, preorder_ship_by: product ? product.preorder_ship_by : '', product };
}

async function confirmPaid(orderId, paymentId, amountRub) {
  const r = await db.tx(async run => {
    const [[o]] = await run(`DECLARE $id AS Utf8; SELECT status, total, product_id, size, qty, is_preorder, tb_payment_id FROM orders WHERE id = $id;`, { $id: db.V.s(orderId) });
    if (!o) return { ok: false, reason: 'no_order' };
    if (o.status !== 'new') return { ok: false, reason: o.status };
    if (Number(amountRub) !== o.total) { console.error('AMOUNT MISMATCH', orderId, amountRub, o.total); return { ok: false, reason: 'amount' }; }
    await run(`DECLARE $id AS Utf8; DECLARE $pid AS Utf8; UPDATE orders SET status = 'paid'u, tb_payment_id = $pid, updated_at = CurrentUtcTimestamp() WHERE id = $id AND status = 'new'u;`, { $id: db.V.s(orderId), $pid: db.V.s(String(paymentId)) });
    const P = { $p: db.V.s(o.product_id), $s: db.V.s(o.size), $q: db.V.i(o.qty) };
    if (o.is_preorder) await run(`DECLARE $p AS Utf8; DECLARE $s AS Utf8; DECLARE $q AS Int32; UPDATE variants SET preorder_count = preorder_count + $q WHERE product_id = $p AND size = $s;`, P);
    else await run(`DECLARE $p AS Utf8; DECLARE $s AS Utf8; DECLARE $q AS Int32; UPDATE variants SET stock = Greatest(stock - $q, 0), reserved = Greatest(reserved - $q, 0) WHERE product_id = $p AND size = $s;`, P);
    return { ok: true };
  });
  if (!r.ok) {
    if (r.reason === 'expired' || r.reason === 'cancelled') {
      try { await ext.tbank.cancel(paymentId); } catch (e) { console.error('late refund failed', orderId, e.message); }
      const o = await loadOrderWithProduct(orderId);
      try { await ext.mail.send({ to: ENV.OWNER_EMAIL, ...mail.tplOwnerLatePayment(o, paymentId) }); } catch (e) { console.error('mail', e.message); }
      return { ok: false, reason: 'late_refunded' };
    }
    if (r.reason === 'amount') {
      const o = await loadOrderWithProduct(orderId);
      try { await ext.mail.send({ to: ENV.OWNER_EMAIL, subject: `Сумма платежа не совпала: ${orderId}`, text: `Заказ ${orderId}: ожидалось ${o.total} ₽, банк подтвердил ${amountRub} ₽, платёж ${paymentId}. Заказ оставлен в new — разберись вручную.`, html: '' }); } catch (e) { console.error('mail', e.message); }
    }
    return r;
  }
  // Статус уже paid — сбой побочных эффектов не должен ронять notify (банк повторит, но следующий вызов увидит paid и ничего не сделает).
  try { await afterPaid(orderId); } catch (e) { console.error('afterPaid', orderId, e.message); }
  return { ok: true };
}

const FIELDS = new Set(['mail_error', 'yd_error', 'admin_note']);
async function setField(id, field, value) {
  if (!FIELDS.has(field)) throw new Error('bad field ' + field);
  await db.query(`DECLARE $id AS Utf8; DECLARE $v AS Utf8; UPDATE orders SET ${field} = $v, updated_at = CurrentUtcTimestamp() WHERE id = $id;`, { $id: db.V.s(id), $v: db.V.s(value) });
}

async function afterPaid(id) {
  const o = await loadOrderWithProduct(id);
  const errs = [];
  try { await ext.mail.send({ to: ENV.OWNER_EMAIL, ...mail.tplOwnerNewOrder(o) }); } catch (e) { errs.push('owner:' + e.message); }
  try { await ext.mail.send({ to: o.customer_email, ...mail.tplCustomerPaid(o) }); } catch (e) { errs.push('customer:' + e.message); }
  if (errs.length) await setField(id, 'mail_error', errs.join(' | ').slice(0, 500));
  if (o.delivery_mode === 'yandex') await createYd(o);
}

async function createYd(o) {
  try {
    const r = await ext.yd.createRequest(o, o.product);
    const got = Math.ceil(parseFloat(String(r.price || '0').replace(/[^\d.]/g, ''))) || 0;
    const err = (got && got !== o.price_delivery) ? `price_diff:${got - o.price_delivery}` : '';
    await db.query(`DECLARE $id AS Utf8; DECLARE $r AS Utf8; DECLARE $t AS Utf8; DECLARE $e AS Utf8; UPDATE orders SET yd_request_id = $r, yd_track_url = $t, yd_error = $e, updated_at = CurrentUtcTimestamp() WHERE id = $id;`,
      { $id: db.V.s(o.id), $r: db.V.s(String(r.request_id || '')), $t: db.V.s(String(r.track_url || '')), $e: db.V.s(err) });
  } catch (e) { console.error('yd', o.id, e.message); await setField(o.id, 'yd_error', String(e.code ? e.code + ': ' : '') + String(e.message).slice(0, 500)); }
}

// ---------- публичные чтения ----------
async function getStatus(id, k) {
  const [[o]] = await db.query(`DECLARE $id AS Utf8; SELECT k, status, total, is_preorder, product_id FROM orders WHERE id = $id;`, { $id: db.V.s(id) });
  if (!o || !k || o.k !== k) return null;
  const p = await getProduct(o.product_id, { admin: true });
  return { id, status: o.status, total: o.total, is_preorder: o.is_preorder, preorder_ship_by: p ? p.preorder_ship_by : '' };
}
async function getPayInfo(id, k) {
  const [[o]] = await db.query(`DECLARE $id AS Utf8; SELECT k, status, total, tb_payment_id, tb_payment_url FROM orders WHERE id = $id;`, { $id: db.V.s(id) });
  return (o && k && o.k === k) ? { status: o.status, total: o.total, tb_payment_id: o.tb_payment_id, tb_payment_url: o.tb_payment_url } : null;
}
async function getPayUrl(id, k) { const i = await getPayInfo(id, k); return (i && i.status === 'new' && i.tb_payment_url) ? i.tb_payment_url : null; }

// ---------- админ ----------
const NEXT = { paid: 'packed', packed: 'shipped', shipped: 'done' };
async function transition(id, to, { note } = {}) {
  const o = await db.tx(async run => {
    const [[o]] = await run(`DECLARE $id AS Utf8; SELECT status, product_id, size, qty, is_preorder FROM orders WHERE id = $id;`, { $id: db.V.s(id) });
    if (!o || NEXT[o.status] !== to) throw new HttpError(409, 'bad_transition', { from: o && o.status, to });
    await run(`DECLARE $id AS Utf8; DECLARE $from AS Utf8; DECLARE $to AS Utf8; UPDATE orders SET status = $to, updated_at = CurrentUtcTimestamp() WHERE id = $id AND status = $from;`, { $id: db.V.s(id), $from: db.V.s(o.status), $to: db.V.s(to) });
    if (to === 'shipped' && o.is_preorder) await run(`DECLARE $p AS Utf8; DECLARE $s AS Utf8; DECLARE $q AS Int32; UPDATE variants SET preorder_count = Greatest(preorder_count - $q, 0) WHERE product_id = $p AND size = $s;`, { $p: db.V.s(o.product_id), $s: db.V.s(o.size), $q: db.V.i(o.qty) });
    return o;
  });
  if (note !== undefined && note !== null) await setField(id, 'admin_note', String(note).slice(0, 1000));
  const full = await loadOrderWithProduct(id);
  if (to === 'shipped') { try { await ext.mail.send({ to: full.customer_email, ...mail.tplCustomerShipped(full) }); } catch (e) { await setField(id, 'mail_error', 'shipped:' + e.message); } }
  return full;
}

async function cancel(id) {
  const cur = await loadOrderWithProduct(id);
  if (!cur) throw new HttpError(404, 'no_order');
  if (cur.status === 'new') {
    if (!(await releaseNew(id, 'cancelled'))) { const now = await loadOrderWithProduct(id); throw new HttpError(409, 'bad_transition', { from: now && now.status, to: 'cancelled' }); }
    return loadOrderWithProduct(id);
  }
  if (cur.status !== 'paid' && cur.status !== 'packed') throw new HttpError(409, 'bad_transition', { from: cur.status, to: 'cancelled' });
  const res = await ext.tbank.cancel(cur.tb_payment_id);
  if (!res || res.Success === false) throw new HttpError(502, 'refund_failed', { tb: res });
  await db.tx(async run => {
    const [[o]] = await run(`DECLARE $id AS Utf8; SELECT status, product_id, size, qty, is_preorder FROM orders WHERE id = $id;`, { $id: db.V.s(id) });
    if (!o || (o.status !== 'paid' && o.status !== 'packed')) throw new HttpError(409, 'bad_transition', { from: o && o.status, to: 'cancelled' });
    await run(`DECLARE $id AS Utf8; DECLARE $from AS Utf8; DECLARE $r AS Utf8; UPDATE orders SET status = 'cancelled'u, tb_refund_id = $r, updated_at = CurrentUtcTimestamp() WHERE id = $id AND status = $from;`, { $id: db.V.s(id), $from: db.V.s(o.status), $r: db.V.s(String(res.PaymentId || cur.tb_payment_id)) });
    if (o.is_preorder) await run(`DECLARE $p AS Utf8; DECLARE $s AS Utf8; DECLARE $q AS Int32; UPDATE variants SET preorder_count = Greatest(preorder_count - $q, 0) WHERE product_id = $p AND size = $s;`, { $p: db.V.s(o.product_id), $s: db.V.s(o.size), $q: db.V.i(o.qty) });
  });
  const full = await loadOrderWithProduct(id);
  try { await ext.mail.send({ to: full.customer_email, ...mail.tplCustomerCancelled(full) }); } catch (e) { await setField(id, 'mail_error', 'cancelled:' + e.message); }
  return full;
}

async function retryYd(id) { const o = await loadOrderWithProduct(id); if (!o) throw new HttpError(404, 'no_order'); await createYd(o); return loadOrderWithProduct(id); }
async function setNote(id, note) { await setField(id, 'admin_note', String(note || '').slice(0, 1000)); return loadOrderWithProduct(id); }
async function listOrders({ status } = {}) {
  const [rows, ps] = status
    ? await db.query(`DECLARE $st AS Utf8; SELECT * FROM orders VIEW by_status WHERE status = $st; SELECT id, title FROM products;`, { $st: db.V.s(status) })
    : await db.query(`SELECT * FROM orders; SELECT id, title FROM products;`);
  const titles = Object.fromEntries(ps.map(p => [p.id, p.title]));
  return rows.sort((a, b) => b.created_at - a.created_at).map(o => ({ ...o, product_title: titles[o.product_id] || o.product_id }));
}
const getOrder = id => loadOrderWithProduct(id);

module.exports = { catalog, getProduct, createOrder, confirmPaid, gc, purgePd, getStatus, getPayInfo, getPayUrl, transition, cancel, retryYd, setNote, listOrders, getOrder, loadOrderWithProduct, QTY_MAX };
