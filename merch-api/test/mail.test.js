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
test('HTML из полей клиента экранируется в письмах владельцу', () => {
  const evil = { ...order, customer_name: '<a href="x">Иван</a>' };
  for (const m of [mail.tplOwnerNewOrder(evil), mail.tplOwnerLatePayment({ ...evil, status: 'new' }, 'pay-1')]) {
    assert.ok(m.html.includes('&lt;a href=&quot;x&quot;&gt;Иван&lt;/a&gt;'), m.html);
    assert.ok(!m.html.includes('<a href="x">'), m.html);
  }
  // Ссылки шаблона остаются ссылками, href экранируется
  const shipped = mail.tplCustomerShipped({ ...evil, yd_track_url: 'https://t.example/?a=1&b=2' });
  assert.ok(shipped.html.includes('<a href="https://t.example/?a=1&amp;b=2">Отследить посылку</a>'), shipped.html);
  assert.ok(shipped.text.includes('https://t.example/?a=1&b=2'));
  assert.ok(mail.tplOwnerNewOrder(order).html.includes('<a href="'), 'ссылка в админку');
  assert.ok(mail.tplCustomerCancelled({ ...order, total: undefined }).subject.includes('возврат —'), 'rub(undefined) → —');
});
test('живая отправка владельцу', { skip: !process.env.SMTP_USER }, async (t) => {
  try { await mail.send({ to: process.env.OWNER_EMAIL, ...mail.tplOwnerNewOrder(order) }); }
  catch (e) {
    // До подтверждения домена в Postbox (Task 6) сервер отвечает 550 5.4.1 identity not verified — ожидаемо, не падаем
    if (e.responseCode === 550 && /identity not verified/.test(e.response || '')) return t.skip('Postbox: ' + e.response);
    throw e;
  }
});
