require('./_env');
const test = require('node:test'); const assert = require('node:assert');
const db = require('../lib/ydb');

// Драйвер держит gRPC-соединения — без destroy() процесс node --test не завершится.
test.after(async () => (await db.getDriver()).destroy());

test('query: SELECT 1', async () => {
  const [[row]] = await db.query('SELECT 1 AS one;');
  assert.equal(row.one, 1);
});

test('tx: два параллельных инкремента одного счётчика дают +2', async () => {
  await db.query(`UPSERT INTO counters (name, value) VALUES ('t_inc'u, 0);`);
  const inc = () => db.tx(async run => {
    const [[c]] = await run(`SELECT value FROM counters WHERE name = 't_inc'u;`);
    await run(`DECLARE $v AS Int32; UPSERT INTO counters (name, value) VALUES ('t_inc'u, $v);`, { $v: db.V.i(c.value + 1) });
  });
  await Promise.all([inc(), inc()]);
  const [[c]] = await db.query(`SELECT value FROM counters WHERE name = 't_inc'u;`);
  assert.equal(c.value, 2);
});
