// Клиенты (спека 2026-10-06-newsletter-design.md, раздел «Клиенты»): представление над orders без своей таблицы —
// копия ПД жила бы вне purgePd; обезличенный заказ (customer_email = '') из клиентов выпадает сам.
// Ключ — e-mail в нижнем регистре; по телефону не склеиваем (общий телефон семьи → ложное слияние).
const db = require('./ydb');
const PAID = ['paid', 'packed', 'shipped', 'done'];
const iso = d => d instanceof Date ? d.toISOString() : (d ? String(d) : '');

// Serverless YDB отдаёт в ответе не больше 1000 строк — читаем orders страницами по id.
async function allOrders() {
  const out = []; let last = '';
  for (;;) {
    const [rows] = await db.query(`DECLARE $l AS Utf8; SELECT id, created_at, status, product_id, total, customer_email, customer_name, customer_phone
      FROM orders WHERE id > $l ORDER BY id LIMIT 1000;`, { $l: db.V.s(last) });
    out.push(...rows); if (rows.length < 1000) return out; last = rows[rows.length - 1].id;
  }
}

async function listClients() {
  const [orders, [products], [subs]] = await Promise.all([allOrders(),
    db.query(`SELECT id, title, kind FROM products;`), db.query(`SELECT email, consent_at FROM subscribers;`)]);
  const prod = Object.fromEntries(products.map(p => [p.id, p]));
  const sub = Object.fromEntries(subs.map(s => [s.email, iso(s.consent_at)]));
  const by = new Map();
  for (const o of orders) {
    const email = String(o.customer_email || '').trim().toLowerCase(); if (!email) continue;
    let c = by.get(email);
    if (!c) by.set(email, c = { email, names: new Set(), phones: new Set(), kinds: new Set(), orders: [] });
    if (o.customer_name) c.names.add(o.customer_name); if (o.customer_phone) c.phones.add(o.customer_phone);
    const p = prod[o.product_id] || {}; c.kinds.add(p.kind || 'physical');
    c.orders.push({ id: o.id, created_at: iso(o.created_at), status: o.status, product_id: o.product_id, product_title: p.title || o.product_id, total: Number(o.total) || 0 });
  }
  return [...by.values()].map(c => {
    const os = c.orders.sort((a, b) => b.created_at.localeCompare(a.created_at)), paid = os.filter(o => PAID.includes(o.status));
    return { email: c.email, names: [...c.names], phones: [...c.phones], kinds: [...c.kinds].sort(),
      orders_total: os.length, orders_paid: paid.length, sum_paid: paid.reduce((s, o) => s + o.total, 0),
      first_at: os[os.length - 1].created_at, last_at: os[0].created_at,
      subscribed: c.email in sub, subscribed_at: sub[c.email] || null, orders: os };
  }).sort((a, b) => b.last_at.localeCompare(a.last_at));
}

module.exports = { listClients };
