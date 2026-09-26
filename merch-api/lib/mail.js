// Postbox по SMTP (465, логин = id API-ключа SA со scope yc.postbox.send). Шаблоны — простой HTML.
const nodemailer = require('nodemailer');
const ENV = process.env;
let transport = null;
function getTransport() {
  if (!transport) transport = nodemailer.createTransport({ host: 'postbox.cloud.yandex.net', port: 465, secure: true, auth: { user: ENV.SMTP_USER, pass: ENV.SMTP_PASS }, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 8000 }); // Postbox отвечает на MAIL FROM до ~6 с
  return transport;
}
async function send({ to, subject, text, html }) {
  await getTransport().sendMail({ from: `Антиосов <${ENV.MAIL_FROM || 'shop@antiosov.ru'}>`, to, replyTo: ENV.OWNER_EMAIL, subject, text, html });
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rub = n => { const v = (n == null || n === '') ? NaN : Number(n); return Number.isFinite(v) ? `${v.toLocaleString('ru-RU')} ₽` : '—'; };
const where = o => o.pvz_address ? `Пункт выдачи: ${o.pvz_address}` : `Адрес: ${o.address_text}`;
const item = o => `${o.product_title}${o.size && o.size !== '-' ? ', размер ' + o.size : ''} × ${o.qty}`;
// Ссылка — единственный «сырой» элемент; href и подпись экранируются здесь, шаблон не собирает HTML руками
const link = (href, label) => ({ html: `<a href="${esc(href)}">${esc(label)}</a>`, text: `${label}: ${href}` });
// Строка — либо обычная строка (всегда экранируется), либо объект { html, text } из link()
const wrap = (title, lines) => ({
  text: [title, '', ...lines.map(l => typeof l === 'string' ? l : (l.text != null ? l.text : String(l.html).replace(/<[^>]*>/g, '')))].join('\n'),
  html: `<div style="font-family:Inter,system-ui,sans-serif;font-size:15px;line-height:1.5;color:#0a0a0a;max-width:560px">
<p style="font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:28px;margin:0 0 16px">${esc(title)}</p>
${lines.map(l => `<p style="margin:0 0 8px">${typeof l === 'string' ? esc(l) : l.html}</p>`).join('\n')}
<p style="margin:24px 0 0;color:#888;font-size:13px;letter-spacing:.2em;text-transform:uppercase">antiosov.ru</p></div>`,
});

const digital = o => o.delivery_mode === 'none' || o.delivery_mode === 'event'; // без доставки: цифровой товар или билет (см. orders.js)
function tplOwnerNewOrder(o) {
  const site = ENV.SITE || 'https://antiosov.ru';
  const m = wrap(`Заказ ${o.id}`, [
    item(o), digital(o) ? `Сумма: ${rub(o.total)}` : `Сумма: ${rub(o.total)} (товар ${rub(o.price_item * o.qty)} + доставка ${rub(o.price_delivery)})`,
    o.delivery_mode === 'event' ? 'Билеты: покупатель скачивает билет на странице заказа' : digital(o) ? 'Цифровой товар: покупателю ушла ссылка на скачивание' : (o.is_preorder ? 'ПРЕДЗАКАЗ' : 'В наличии'),
    // Без персональных данных покупателя: письмо может уходить на зарубежную почту (152-ФЗ, трансграничная передача).
    // Имя, телефон, адрес — только в админке (Yandex Cloud, РФ).
    link(`${site}/merch/admin/#order/${o.id}`, 'Покупатель и адрес — в админке'),
  ]);
  return { subject: `Заказ ${o.id} — ${item(o)} — ${rub(o.total)}`, ...m };
}
function tplCustomerPaid(o) {
  const m = wrap('Заказ принят', [
    `Номер заказа: ${o.id}`, item(o), `Оплачено: ${rub(o.total)}`, where(o),
    o.is_preorder ? `Это предзаказ: отправлю до ${o.preorder_ship_by || 'указанной на сайте даты'}.` : (o.delivery_days ? `Срок доставки ~${o.delivery_days} дн. после отправки.` : 'Отправлю в ближайшие дни, напишу трек.'),
    'Вопросы — просто ответьте на это письмо.',
  ]);
  return { subject: `Заказ ${o.id} принят`, ...m };
}
// Цифровой товар: ссылка на страницу заказа с ключом k — там кнопка «Скачать» (presigned-ссылка живёт 10 минут, в письмо её не кладём).
function tplCustomerAccess(o) {
  const site = ENV.SITE || 'https://antiosov.ru';
  const m = wrap('Доступ открыт', [
    `Номер заказа: ${o.id}`, `${o.product_title}`, `Оплачено: ${rub(o.total)}`,
    link(`${site}/products/order/?id=${encodeURIComponent(o.id)}&k=${encodeURIComponent(o.k)}`, 'Скачать и инструкция по установке'),
    'Ссылка постоянная: скачивать можно сколько угодно раз, всегда последнюю версию.',
    'Вернуть деньги можно, пока архив ни разу не скачан. Вопросы — просто ответьте на это письмо.',
  ]);
  return { subject: `Доступ открыт — заказ ${o.id}`, ...m };
}
function tplCustomerShipped(o) {
  const m = wrap('Заказ отправлен', [`Номер заказа: ${o.id}`, item(o), where(o),
    o.yd_track_url ? link(o.yd_track_url, 'Отследить посылку') : (o.admin_note ? `Трек: ${o.admin_note}` : 'Напишу, когда посылка будет в пункте выдачи.')]);
  return { subject: `Заказ ${o.id} отправлен`, ...m };
}
function tplCustomerCancelled(o) {
  const m = wrap('Заказ отменён', [`Номер заказа: ${o.id}`, item(o), `Возврат ${rub(o.total)} придёт на карту в течение 3–10 дней.`, 'Если это ошибка — ответьте на письмо.']);
  return { subject: `Заказ ${o.id} отменён, возврат ${rub(o.total)}`, ...m };
}
function tplOwnerLatePayment(o, paymentId) {
  const m = wrap(`Поздняя оплата ${o.id}`, [`Заказ был в статусе ${o.status}, платёж ${paymentId} подтверждён после срока.`, 'Сделан автоматический возврат через Т-Банк. Проверь в кабинете.', 'Данные покупателя — в админке (без ПД в письме).']);
  return { subject: `Поздняя оплата ${o.id} — возврат`, ...m };
}
module.exports = { send, tplOwnerNewOrder, tplCustomerPaid, tplCustomerAccess, tplCustomerShipped, tplCustomerCancelled, tplOwnerLatePayment };
