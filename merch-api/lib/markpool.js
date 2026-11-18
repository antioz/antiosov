// Пул кодов «Честного знака» на товар. Кладёшь коды сюда один раз (из УПД), при отправке
// маркированного заказа sendClosing сам берёт qty кодов из пула. Взятые коды удаляются
// (сериализуемая транзакция: при конфликте двух отправок одного товара db.tx повторит tx).
const db = require('./ydb');
const { HttpError } = require('./util');

// Валидация — как в orders.parseMarkCodes (require внутри функции: orders требует markpool, цикл иначе).
function check(raw) {
  const { parseMarkCodes } = require('./orders');
  return parseMarkCodes(raw);
}

async function add(pid, raw) {
  const codes = check(raw);
  if (!codes.length) throw new HttpError(400, 'validation', { field: 'codes' });
  const [[p]] = await db.query(`DECLARE $id AS Utf8; SELECT id, marked FROM products WHERE id = $id;`, { $id: db.V.s(pid) });
  if (!p) throw new HttpError(404, 'no_product');
  if (!p.marked) throw new HttpError(409, 'not_marked'); // пул имеет смысл только у маркированного товара
  const [have] = await db.query(`DECLARE $p AS Utf8; SELECT code FROM mark_pool WHERE product_id = $p;`, { $p: db.V.s(pid) });
  const dup = codes.find(c => have.some(h => h.code === c));
  if (dup) throw new HttpError(400, 'validation', { field: 'codes', reason: 'duplicate', code: dup.slice(0, 40) });
  await db.tx(async run => {
    for (const c of codes) await run(`DECLARE $p AS Utf8; DECLARE $c AS Utf8; UPSERT INTO mark_pool (product_id, code, added_at) VALUES ($p, $c, CurrentUtcTimestamp());`, { $p: db.V.s(pid), $c: db.V.s(c) });
  });
  return { added: codes.length, left: have.length + codes.length };
}

const list = async pid => (await db.query(`DECLARE $p AS Utf8; SELECT code, added_at FROM mark_pool WHERE product_id = $p ORDER BY added_at;`, { $p: db.V.s(String(pid || '')) }))[0];
const count = async pid => (await db.query(`DECLARE $p AS Utf8; SELECT COUNT(*) AS n FROM mark_pool WHERE product_id = $p;`, { $p: db.V.s(pid) }))[0][0].n;

// Взять n кодов из пула: транзакция читает (блокируя) и удаляет. Возвращает массив кодов.
async function take(pid, n) {
  if (!(n > 0)) return [];
  return db.tx(async run => {
    const [rows] = await run(`DECLARE $p AS Utf8; DECLARE $n AS Int32; SELECT code FROM mark_pool WHERE product_id = $p ORDER BY added_at LIMIT $n;`, { $p: db.V.s(pid), $n: db.V.i(n) });
    for (const r of rows) await run(`DECLARE $p AS Utf8; DECLARE $c AS Utf8; DELETE FROM mark_pool WHERE product_id = $p AND code = $c;`, { $p: db.V.s(pid), $c: db.V.s(r.code) });
    return rows.map(r => r.code);
  });
}

const remove = (pid, code) => db.query(`DECLARE $p AS Utf8; DECLARE $c AS Utf8; DELETE FROM mark_pool WHERE product_id = $p AND code = $c;`, { $p: db.V.s(String(pid || '')), $c: db.V.s(String(code || '')) });

module.exports = { add, list, count, take, remove };
