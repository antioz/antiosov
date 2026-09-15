const test = require('node:test'); const assert = require('node:assert');
process.env.S3_KEY = 'AKID'; process.env.S3_SECRET = 'SECRET'; process.env.S3_BUCKET = 'antiosov-merch';
const s3 = require('../lib/s3');
test('presignPut shape', () => {
  const url = s3.presignPut('p/tee/abc.jpg', 'image/jpeg', 600);
  assert.ok(url.startsWith('https://storage.yandexcloud.net/antiosov-merch/p/tee/abc.jpg?'));
  assert.ok(url.includes('X-Amz-SignedHeaders=content-type%3Bhost'));
  assert.ok(/X-Amz-Signature=[0-9a-f]{64}$/.test(url));
});
test('publicUrl', () => {
  assert.equal(s3.publicUrl('p/tee/a.jpg'), 'https://storage.yandexcloud.net/antiosov-merch/p/tee/a.jpg');
});
