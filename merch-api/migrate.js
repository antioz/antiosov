// node migrate.js — применяет schema.yql к БД из YDB_CONNECTION (.env локально).
require('./test/_env');
const fs = require('fs'); const path = require('path');
const { getDriver } = require('./lib/ydb');
(async () => {
  const d = await getDriver();
  const ddl = fs.readFileSync(path.join(__dirname, 'schema.yql'), 'utf8');
  for (const stmt of ddl.split(';').map(s => s.trim()).filter(Boolean)) {
    try { await d.queryClient.do({ fn: async s => { await s.execute({ text: stmt + ';' }); } }); console.log('ok:', stmt.split('(')[0].trim()); }
    catch (e) { if (/already exists/i.test(String(e.message))) console.log('exists:', stmt.split('(')[0].trim()); else throw e; }
  }
  await d.destroy(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
