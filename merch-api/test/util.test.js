const test = require('node:test'); const assert = require('node:assert');
const u = require('../lib/util');
test('phone', () => {
  assert.equal(u.validPhone('8 (912) 345-67-89'), '+79123456789');
  assert.equal(u.validPhone('+7 912 345 67 89'), '+79123456789');
  assert.equal(u.validPhone('123'), null);
});
test('email/name', () => {
  assert.equal(u.validEmail(' A@B.ru '), 'a@b.ru');
  assert.equal(u.validEmail('nope'), null);
  assert.equal(u.validName(' Дима '), 'Дима');
  assert.equal(u.validName('Д'), null);
});
test('json response has CORS; DEV_ORIGIN echoed only when it matches', () => {
  process.env.SITE = 'https://antiosov.ru'; process.env.DEV_ORIGIN = 'http://localhost:5500';
  u.setOrigin('http://evil.example');
  assert.equal(u.json(200, { a: 1 }).headers['Access-Control-Allow-Origin'], 'https://antiosov.ru');
  u.setOrigin('http://localhost:5500');
  assert.equal(u.json(200, { a: 1 }).headers['Access-Control-Allow-Origin'], 'http://localhost:5500');
  u.setOrigin('');
  assert.equal(JSON.parse(u.json(200, { a: 1 }).body).a, 1);
});
