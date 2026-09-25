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
test('HTML из пользовательских полей экранируется во всех письмах', () => {
  const evil = { ...order, customer_name: '<a href="x">Иван</a>', address_text: '<img src=x onerror=1>', product_title: '<b>Ф</b>' };
  for (const m of [mail.tplOwnerNewOrder(evil), mail.tplOwnerLatePayment({ ...evil, status: 'new' }, 'pay-1'), mail.tplCustomerPaid(evil), mail.tplCustomerShipped(evil), mail.tplCustomerCancelled(evil)]) {
    assert.ok(!m.html.includes('<a href="x">') && !m.html.includes('<img') && !m.html.includes('<b>'), m.html);
  }
  assert.ok(mail.tplCustomerPaid(evil).html.includes('&lt;img src=x onerror=1&gt;'), 'адрес экранирован, а не удалён');
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

test('письма владельцу не содержат ПД покупателя', () => {
  for (const m of [mail.tplOwnerNewOrder(order), mail.tplOwnerLatePayment(order, 'P1')]) {
    for (const pd of [order.customer_name, order.customer_phone, order.customer_email, order.address_text]) {
      assert.ok(!m.html.includes(pd) && !m.text.includes(pd), `ПД в письме владельцу: ${pd}`);
    }
  }
});

test('цифровой заказ: «Доступ открыт» со ссылкой, владельцу — без ПД и без доставки', () => {
  const d = { ...order, k: 'abc<def', size: '-', delivery_mode: 'none', price_delivery: 0, total: 111, price_item: 111, customer_name: '', customer_phone: '', address_text: '', product_title: '<b>Скилл</b>' };
  const m = mail.tplCustomerAccess(d);
  assert.ok(m.subject.includes('Доступ открыт') && m.subject.includes('M-000001'), m.subject);
  assert.ok(m.text.includes('/products/order/?id=M-000001&k=abc%3Cdef'), m.text);
  assert.ok(m.html.includes('<a href="') && !m.html.includes('<b>'), m.html);
  const o = mail.tplOwnerNewOrder(d);
  assert.ok(!o.text.includes('доставка') && !o.html.includes(d.customer_email) && !o.text.includes(d.customer_email), o.text);
});
