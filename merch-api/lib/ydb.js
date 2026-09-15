// YDB: драйвер кэшируется на уровне модуля (переживает вызовы функции в одном инстансе).
// query()  — один YQL в авто-транзакции (serializable RW, commit).
// tx(fn)   — интерактивная транзакция; fn(run) выполняет несколько YQL; конфликт
//            (ABORTED / locks invalidated) → повтор всей fn до 5 раз. Так реализуется
//            оптимистичная блокировка: «прочитал остаток → проверил → записал».
const { Driver, getCredentialsFromEnv, TypedValues, TypedData, AUTO_TX } = require('ydb-sdk');

// ydb-sdk 5.x берёт pathname ('/') раньше ?database=, поэтому форма из `yc ydb database get`
// (grpcs://host:2135/?database=/ru-central1/…) даёт «Database not found». Переводим в grpcs://host/<database>.
function connectionString() {
  const cs = new URL(process.env.YDB_CONNECTION);
  const database = cs.searchParams.get('database');
  return database ? `${cs.protocol}//${cs.host}${database}` : process.env.YDB_CONNECTION;
}

let driver = null;
async function getDriver() {
  if (driver) return driver;
  const d = new Driver({ connectionString: connectionString(), authService: getCredentialsFromEnv() });
  if (!(await d.ready(10000))) throw new Error('YDB not ready');
  driver = d;
  return d;
}

const rows = r => r.resultSets.map(rs => TypedData.createNativeObjects(rs).map(o => ({ ...o })));

async function query(yql, params = {}) {
  const d = await getDriver();
  return d.tableClient.withSessionRetry(s => s.executeQuery(yql, params, AUTO_TX).then(rows));
}

// Serverless YDB при конфликте блокировок отвечает на commit не ABORTED, а NotFound «Transaction not found»
// (транзакция уже отменена сервером) — это тоже повод повторить fn целиком.
const isRetryable = e => /ABORTED|locks invalidated|Transaction locks|Transaction not found/i.test(String(e && (e.message || e)));

async function tx(fn, retries = 5) {
  const d = await getDriver();
  for (let attempt = 0; ; attempt++) {
    try {
      return await d.tableClient.withSession(async s => {
        const { id } = await s.beginTransaction({ serializableReadWrite: {} });
        const run = (yql, params = {}) => s.executeQuery(yql, params, { txId: id }).then(rows);
        try {
          const out = await fn(run);
          // Коммит через executeQuery(commitTx), а не s.commitTransaction(): у последнего в SDK зашит
          // @retryable с 10 повторами NotFound (~5 с), а конфликт блокировок как раз даёт NotFound.
          await s.executeQuery('SELECT 1;', {}, { txId: id, commitTx: true });
          return out;
        } catch (e) {
          // После ABORTED/NotFound транзакции на сервере уже нет — rollback только зря ждёт ретраи SDK (~4 с).
          if (!isRetryable(e)) { try { await s.rollbackTransaction({ txId: id }); } catch (_) { /* уже отменена */ } }
          throw e;
        }
      });
    } catch (e) {
      if (attempt < retries && isRetryable(e)) {
        await new Promise(r => setTimeout(r, 20 * attempt + Math.random() * 30));
        continue;
      }
      throw e;
    }
  }
}

const V = {
  s: v => TypedValues.utf8(String(v)),
  i: v => TypedValues.int32(Number(v)),
  b: v => TypedValues.bool(!!v),
  ts: v => TypedValues.timestamp(v instanceof Date ? v : new Date(v)),
  j: v => TypedValues.json(JSON.stringify(v)),
};

module.exports = { query, tx, V, TypedValues, getDriver };
