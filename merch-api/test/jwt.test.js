const test = require('node:test'); const assert = require('node:assert');
process.env.SECRET = 'test-secret';
const jwt = require('../lib/jwt');
test('sign/verify roundtrip', () => {
  const t = jwt.sign({ role: 'admin' }, 60);
  assert.equal(jwt.verify(t).role, 'admin');
});
test('expired and tampered rejected', () => {
  assert.equal(jwt.verify(jwt.sign({ x: 1 }, -1)), null);
  const t = jwt.sign({ x: 1 }, 60);
  assert.equal(jwt.verify(t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A')), null);
});
