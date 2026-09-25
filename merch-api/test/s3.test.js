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
test('presignGet: TTL, attachment-имя подписано, только host в SignedHeaders', () => {
  const u = new URL(s3.presignGet('d/skill/ab12.zip', 600, 'skill.zip'));
  assert.equal(u.origin + u.pathname, 'https://storage.yandexcloud.net/antiosov-merch/d/skill/ab12.zip');
  assert.equal(u.searchParams.get('X-Amz-Expires'), '600');
  assert.equal(u.searchParams.get('X-Amz-SignedHeaders'), 'host');
  assert.equal(u.searchParams.get('response-content-disposition'), 'attachment; filename="skill.zip"');
  assert.match(u.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/);
});
