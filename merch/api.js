// Адрес функции merch-api (без секретов) и общие хелперы страниц магазина.
window.MERCH_API = 'https://functions.yandexcloud.net/d4eh4qtc4a7fria6mgmt';
window.api = async function (a, { method = 'GET', body, q = {}, token } = {}) {
  const u = new URL(window.MERCH_API); u.searchParams.set('a', a); for (const k in q) if (q[k] != null) u.searchParams.set(k, q[k]);
  const headers = {}; if (body) headers['Content-Type'] = 'application/json'; if (token) headers['X-Admin-Token'] = token; // не Authorization: его перехватывает платформа Cloud Functions
  const r = await fetch(u, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({ error: 'bad_json' }));
  if (!r.ok) { const e = new Error(j.error || 'error'); e.code = r.status; e.data = j; throw e; }
  return j;
};
// reveal.js наблюдает только элементы, существующие при загрузке; для динамики — показать всё.
window.showAll = function () { document.querySelectorAll('.r:not(.in)').forEach(el => el.classList.add('in')); };
window.rub = n => Number(n).toLocaleString('ru-RU') + ' ₽';
window.esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
