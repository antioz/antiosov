// node migrate.js — применяет schema.yql к БД из YDB_CONNECTION (.env локально). Идемпотентно: повторный запуск
// на новой БД видит «already exists» у таблиц, на старой — у уже добавленных колонок (ALTER ... ADD COLUMN).
require('./test/_env');
const fs = require('fs'); const path = require('path');
const { getDriver } = require('./lib/ydb');
const label = stmt => stmt.split('(')[0].replace(/\s+/g, ' ').trim();
(async () => {
  const d = await getDriver();
  const ddl = fs.readFileSync(path.join(__dirname, 'schema.yql'), 'utf8').split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  for (const stmt of ddl.split(';').map(s => s.trim()).filter(Boolean)) {
    try { await d.queryClient.do({ fn: async s => { await s.execute({ text: stmt + ';' }); } }); console.log('ok:', label(stmt)); }
    catch (e) { if (/already exists/i.test(String(e.message))) console.log('exists:', label(stmt)); else throw e; }
  }
  await d.destroy(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
