require('./_env');
const test = require('node:test'); const assert = require('node:assert');
const mail = require('../lib/mail');
const order = { id: 'M-000001', product_title: 'Футболка', size: 'M', qty: 1, total: 1900, price_item: 1500, price_delivery: 400,
  customer_name: 'Тест', customer_phone: '+79990000000', customer_email: process.env.OWNER_EMAIL, address_text: 'Москва, тест', pvz_address: '',
  is_preorder: false, delivery_days: 3, yd_track_url: '' };
test('шаблоны собираются', () => {
  for (const f of ['tplOwnerNewOrder', 'tplCustomerPaid', 'tplCustomerShipped', 'tplCustomerCancelled']) {
    const m = mail[f](order); assert.ok(m.subject.includes('M-000001'), f); assert.ok(m.html.length > 50, f);
  }
});
test('живая отправка владельцу', { skip: !process.env.SMTP_USER }, async (t) => {
  try { await mail.send({ to: process.env.OWNER_EMAIL, ...mail.tplOwnerNewOrder(order) }); }
  catch (e) {
    // До подтверждения домена в Postbox (Task 6) сервер отвечает 550 5.4.1 identity not verified — ожидаемо, не падаем
    if (e.responseCode === 550 && /identity not verified/.test(e.response || '')) return t.skip('Postbox: ' + e.response);
    throw e;
  }
});
