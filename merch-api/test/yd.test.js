require('./_env');
const test = require('node:test'); const assert = require('node:assert');
const yd = require('../lib/yd');

test('off-режим: quote даёт DELIVERY_FLAT', async () => {
  const saved = process.env.YD_MODE; process.env.YD_MODE = 'off'; process.env.DELIVERY_FLAT = '400';
  const q = await yd.quote({ pvz_id: null, weight_g: 300, dims_cm: { x: 30, y: 20, z: 3 }, qty: 1 });
  assert.deepEqual(q, { price_rub: 400, days: null });
  assert.deepEqual(await yd.cities('Мос'), []);
  process.env.YD_MODE = saved;
});

test('test-режим: города → ПВЗ → quote', { skip: process.env.YD_MODE !== 'test' }, async () => {
  const cities = await yd.cities('Москва');
  assert.ok(cities.length > 0 && cities[0].geo_id, JSON.stringify(cities).slice(0, 200));
  const points = await yd.pvz(cities[0].geo_id);
  assert.ok(points.length > 0 && points[0].id && points[0].address, JSON.stringify(points[0]));
  // В тестовой среде не для всех ПВЗ есть маршрут от тестового склада (400 no_delivery_options) — ищем первый, который считается
  let q = null, lastErr = null;
  for (const pt of points.slice(0, 40)) {
    try { q = await yd.quote({ pvz_id: pt.id, weight_g: 300, dims_cm: { x: 30, y: 20, z: 3 }, qty: 1 }); break; }
    catch (e) { lastErr = e; if (e.code !== 'no_delivery_options') throw e; }
  }
  assert.ok(q && q.price_rub > 0, JSON.stringify(q) + ' ' + (lastErr && lastErr.message));
});
