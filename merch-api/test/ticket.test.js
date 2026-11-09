// Билет (PDF) для письма покупателю ивента: сборка, разметка, QR-ссылка на страницу вечера.
const test = require('node:test'); const assert = require('node:assert');
const ticket = require('../lib/ticket');

const T = { number: 'M-000111', product: 'tweed-stout', title: 'Стихи & Басни', event_at: '2026-11-27T17:00:00.000Z', venue: 'Tweed & Stout', age_mark: '18+', qty: 2, price_item: 1570, total: 3140 };

test('qrUrl ведёт на страницу вечера', () => {
  assert.strictEqual(ticket.qrUrl('tweed-stout'), 'https://antiosov.ru/products/tweed-stout/');
  assert.strictEqual(ticket.qrUrl('a b'), 'https://antiosov.ru/products/a%20b/');
});

test('PDF собирается: заголовок, разумный размер, одна страница', async () => {
  const buf = await ticket.build(T);
  assert.ok(buf.length > 50000, `маленький PDF: ${buf.length}`);
  assert.strictEqual(buf.slice(0, 5).toString(), '%PDF-');
  const s = buf.toString('latin1');
  assert.match(s, /\/Title \d+ 0 R/); // pdfkit пишет Title в info (косвенная строка)
  assert.strictEqual((s.match(/\/Type \/Page[^s]/g) || []).length, 1);
});

test('PDF собирается без места, возраста и афиши недоступной — короткий вариант', async () => {
  const buf = await ticket.build({ number: 'M-1', product: 'nope-nope', title: 'X', event_at: '2026-11-27T17:00:00.000Z', qty: 1, price_item: 1, total: 1 });
  assert.ok(buf.length > 2000);
  assert.strictEqual(buf.slice(0, 5).toString(), '%PDF-');
});
