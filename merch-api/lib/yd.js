// Яндекс Доставка «в другой день». Режимы: off (фикс-тариф, без ПВЗ), test (тестовая среда), prod.
const https = require('https');
const ENV = process.env;
const HOSTS = { test: 'b2b.taxi.tst.yandex.net', prod: 'b2b-authproxy.taxi.yandex.net' };
const mode = () => (ENV.YD_MODE === 'test' || ENV.YD_MODE === 'prod') ? ENV.YD_MODE : 'off';

// body === null → GET (request/info принимает только GET с query-строкой)
function call(path, body, timeoutMs = 8000) {
  const data = body === null ? '' : JSON.stringify(body || {});
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: HOSTS[mode()], path: '/api/b2b/platform/' + path, method: body === null ? 'GET' : 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Accept-Language': 'ru', Authorization: 'Bearer ' + ENV.YD_TOKEN, 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let s = ''; res.on('data', c => s += c);
      res.on('end', () => {
        let j; try { j = JSON.parse(s || '{}'); } catch (e) { return reject(new Error('yd bad json ' + path + ': ' + s.slice(0, 200))); }
        if (res.statusCode >= 300) { const e = new Error(`yd ${path} ${res.statusCode}: ${s.slice(0, 300)}`); e.code = j && j.code; return reject(e); }
        resolve(j);
      });
      res.on('error', reject);
    });
    req.on('timeout', () => { const e = new Error('yd timeout ' + path); e.code = 'timeout'; req.destroy(e); });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

async function cities(q) {
  if (mode() === 'off' || !q || q.length < 2) return [];
  const r = await call('location/detect', { location: q });
  return (r.variants || []).slice(0, 8).map(v => ({ geo_id: v.geo_id, name: v.address }));
}

async function pvz(geo_id) {
  if (mode() === 'off') return [];
  const r = await call('pickup-points/list', { geo_id: Number(geo_id), type: 'pickup_point', payment_methods: ['already_paid'] });
  return (r.points || []).map(p => ({
    id: p.id, address: p.address && p.address.full_address, lat: p.position && p.position.latitude, lon: p.position && p.position.longitude,
    schedule: (p.schedule && p.schedule.restrictions || []).map(x => `${(x.days || []).join(',')}: ${x.time_from && x.time_from.hours}:00–${x.time_to && x.time_to.hours}:00`).join('; '),
  }));
}

const place = (dims_cm, weight_g, qty) => ({ physical_dims: { weight_gross: weight_g * qty, dx: dims_cm.x, dy: dims_cm.y, dz: dims_cm.z * qty } });

async function quote({ pvz_id, weight_g, dims_cm, qty }) {
  if (mode() === 'off') return { price_rub: parseInt(ENV.DELIVERY_FLAT || '400', 10), days: null };
  const r = await call('pricing-calculator', {
    source: { platform_station_id: ENV.YD_STATION_ID }, destination: { platform_station_id: pvz_id },
    tariff: 'self_pickup', total_weight: weight_g * qty, payment_method: 'already_paid', places: [place(dims_cm, weight_g, qty)],
  });
  // pricing_total приходит строкой вида "181.78 RUB" — берём первый числовой токен
  const num = parseFloat(String(r.pricing_total == null ? '' : r.pricing_total).trim().split(/\s+/)[0].replace(',', '.'));
  if (!Number.isFinite(num)) throw new Error('yd quote: bad pricing_total ' + JSON.stringify(r.pricing_total) + ' in ' + JSON.stringify(r).slice(0, 300));
  const rub = Math.ceil(num);
  if (!(rub > 0)) throw new Error('yd quote empty: ' + JSON.stringify(r).slice(0, 300));
  return { price_rub: rub, days: r.delivery_days == null ? null : Number(r.delivery_days) };
}

// Создать заявку после оплаты. order — строка orders, product — строка products (dims_cm/weight_g распарсены).
async function createRequest(order, product) {
  if (mode() === 'off') throw new Error('yd off');
  const barcode = order.id;
  const body = {
    info: { operator_request_id: order.id, comment: 'antiosov.ru' },
    source: { platform_station: { platform_id: ENV.YD_STATION_ID } },
    destination: { type: 'platform_station', platform_station: { platform_id: order.pvz_id } },
    items: [{ count: order.qty, name: `${product.title} ${order.size && order.size !== '-' ? order.size : ''}`.trim(), article: `${order.product_id}-${order.size}`,
      billing_details: { unit_price: order.price_item * 100, assessed_unit_price: order.price_item * 100, nds: -1 },
      physical_dims: { dx: product.dims_cm.x, dy: product.dims_cm.y, dz: product.dims_cm.z, weight_gross: product.weight_g }, place_barcode: barcode }],
    places: [{ barcode, ...place(product.dims_cm, product.weight_g, order.qty) }],
    billing_info: { payment_method: 'already_paid' },
    recipient_info: { first_name: order.customer_name, phone: order.customer_phone, email: order.customer_email },
    last_mile_policy: 'self_pickup', particular_items_refuse: false,
  };
  const offers = await call('offers/create', body);
  const offer = (offers.offers || [])[0];
  if (!offer) throw new Error('yd no offers: ' + JSON.stringify(offers).slice(0, 300));
  const c = await call('offers/confirm', { offer_id: offer.offer_id });
  const request_id = c.request_id;
  if (!request_id) throw new Error('yd confirm failed: ' + JSON.stringify(c).slice(0, 300));
  // Трек-ссылка: request/info.sharing_url. Сразу после confirm поле часто ещё пустое — одна попытка с коротким таймаутом,
  // иначе '' (домен/админка дозапросят позже через requestInfo). Бюджет createRequest: 8 + 8 + 3 с.
  let track_url = '';
  try { const info = await call('request/info?request_id=' + encodeURIComponent(request_id), null, 3000); if (info && info.sharing_url) track_url = String(info.sharing_url); } catch (e) { /* ссылку получим позже через requestInfo */ }
  return { request_id, track_url, price: offer.offer_details && offer.offer_details.pricing };
}

// Статус заявки: { request_id, state: {status, description, timestamp}, sharing_url, ... }
async function requestInfo(request_id) {
  if (mode() === 'off') throw new Error('yd off');
  return call('request/info?request_id=' + encodeURIComponent(request_id), null);
}

module.exports = { mode, cities, pvz, quote, createRequest, requestInfo };
