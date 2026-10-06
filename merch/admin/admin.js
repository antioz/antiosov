(() => {
  const app = document.getElementById('app');
  const tokKey = 'merchAdminToken';
  let token = null; try { token = localStorage.getItem(tokKey); } catch (e) {}
  const A = (a, o = {}) => api(a, { ...o, token });
  const ST = { new: 'новый', paid: 'оплачен', packed: 'собран', shipped: 'отправлен', done: 'выполнен', cancelled: 'отменён', expired: 'просрочен' };
  const NEXT = { paid: 'Собран', packed: 'Отправлен', shipped: 'Выполнен' };
  const d = s => new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const badge = o => `<span class="badge ${o.status}">${ST[o.status] || o.status}</span>${o.is_preorder ? ' <span class="badge pre">предзаказ</span>' : ''}`;
  const dd = s => new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const localDT = iso => { const d = new Date(iso), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };
  const isDiploma = o => o.kind === 'diploma' || o.product_kind === 'diploma' || o.delivery_mode === 'diploma';
  const isDigital = o => !isDiploma(o) && (o.kind === 'digital' || o.delivery_mode === 'none');
  const isEvent = o => o.kind === 'event' || o.delivery_mode === 'event';
  const dlMark = o => isDigital(o) ? `<br><small class="meta">${o.downloaded_at ? 'скачан ' + dd(o.downloaded_at) : 'не скачан'}</small>` : '';
  const item = o => `${esc(o.product_title)}${o.size && o.size !== '-' ? ' ' + esc(o.size) : ''} × ${o.qty}`;
  const fail = e => { if (e.code === 401) { token = null; try { localStorage.removeItem(tokKey); } catch (_) {} route(); } else alert('Ошибка: ' + (e.data && e.data.error || e.message)); };

  function login() {
    app.innerHTML = `<form id="lf" class="center" style="max-width:320px"><label class="field"><span>Пароль</span><input type="password" name="p" autofocus></label><button class="btn">Войти</button></form>`;
    app.querySelector('#lf').onsubmit = async e => { e.preventDefault(); try { const r = await api('admin/login', { method: 'POST', body: { password: e.target.p.value } }); token = r.token; try { localStorage.setItem(tokKey, token); } catch (_) {} location.hash = '#orders'; route(); } catch (err) { alert(err.message === 'too_many' ? 'Слишком много попыток, подожди 10 минут' : 'Неверный пароль'); } };
  }
  const tabs = cur => `<div class="tabs"><a href="#orders" class="${cur === 'orders' ? 'on' : ''}">Заказы</a><a href="#products" class="${cur === 'products' ? 'on' : ''}">Товары</a><a href="#book" class="${cur === 'book' ? 'on' : ''}">Книга</a><a href="#mail" class="${cur === 'mail' ? 'on' : ''}">Рассылка</a><a href="#clients" class="${cur === 'clients' ? 'on' : ''}">Клиенты</a><a href="#inbox" class="${cur === 'inbox' || cur === 'letter' ? 'on' : ''}">Письма</a><a href="#" id="logout">Выйти</a></div>`;
  const bindLogout = () => { const l = document.getElementById('logout'); if (l) l.onclick = e => { e.preventDefault(); token = null; try { localStorage.removeItem(tokKey); } catch (_) {} route(); }; };

  // Сводка по товарам (книга — на своей вкладке). Пустые ячейки — показатель к товару не относится.
  const UNIT = { event: 'билетов', book: 'экземпляров', diploma: 'участников', digital: 'покупок', physical: 'штук' };
  const statsTable = st => { const rows = Object.entries(st).filter(([, v]) => v.kind !== 'book' && (v.paid_orders || v.free_downloads || v.to_ship));
    if (!rows.length) return '';
    const c = (v, show) => show ? `<b>${v}</b>` : '<span class="meta">—</span>';
    return `<table style="margin:0 0 28px"><tr><th>Товар</th><th>Оплачено заказов</th><th>Штук</th><th>К отправке</th><th>Бесплатно скачали</th><th>Скачиваний по оплате</th></tr>
      ${rows.map(([, v]) => `<tr><td>${esc(v.title)}</td><td>${c(v.paid_orders, true)}</td><td>${c(v.paid_qty, true)} <span class="meta">${UNIT[v.kind] || ''}</span></td><td>${c(v.to_ship, v.kind === 'physical')}</td><td>${c(v.free_downloads, v.kind === 'digital')}</td><td>${c(v.paid_downloads, v.kind === 'digital')}</td></tr>`).join('')}</table>`; };

  let OF = ''; // фильтр заказов по товару; '' — все, кроме книги (у книги своя вкладка)
  async function orders(status) {
    const inboxP = A('admin/inbox').then(r => r, e => ({ error: e })); // письма грузятся параллельно и не мешают заказам
    const [{ orders }, s] = await Promise.all([A('admin/orders', { q: { status } }), A('admin/summary')]);
    const filters = ['', 'paid', 'packed', 'shipped', 'done', 'new', 'cancelled', 'expired'];
    app.innerHTML = tabs('orders') + `<div class="summary"><span id="inboxLine" class="meta">письма…</span>${s.yd_mode !== 'prod' ? `<span style="color:#7a1c1c">⚠ Яндекс Доставка не в боевом режиме (${esc(s.yd_mode)})</span>` : ''}${s.yd_env_mismatch ? `<span style="color:#7a1c1c">⚠ ${s.yd_env_mismatch} заказ(ов) создано в другом режиме Яндекс Доставки</span>` : ''}</div>
      ${statsTable(s.stats || {})}
      <div class="tabs">${filters.map(f => `<a href="#orders${f ? '/' + f : ''}" class="${(status || '') === f ? 'on' : ''}">${f ? ST[f] : 'все'}</a>`).join('')}</div>
      <div style="text-align:center;margin:0 0 16px"><select id="oProd" style="height:40px;border:1px solid var(--line);font:inherit;font-size:14px;padding:0 8px;background:#fff">
        <option value="">все товары, кроме книги</option>${Object.entries(s.stats || {}).filter(([, v]) => v.kind !== 'book').map(([id, v]) => `<option value="${esc(id)}" ${OF === id ? 'selected' : ''}>${esc(v.title)}</option>`).join('')}</select></div>
      <table><tr><th>№</th><th>Дата</th><th>Что</th><th>Кто</th><th>Сумма</th><th>Статус</th></tr>
      ${orders.filter(o => OF ? o.product_id === OF : !(s.stats[o.product_id] && s.stats[o.product_id].kind === 'book')).map(o => `<tr class="row" data-id="${o.id}"><td>${o.id}</td><td>${d(o.created_at)}</td><td>${item(o)}${dlMark(o)}</td><td>${esc(o.customer_name || (isDigital(o) || isEvent(o) || isDiploma(o) ? o.customer_email : ''))}</td><td>${rub(o.total)}</td><td>${badge(o)}</td></tr>`).join('') || '<tr><td colspan="6" class="meta">пусто</td></tr>'}</table>`;
    app.querySelector('#oProd').onchange = e => { OF = e.target.value; orders(status); };
    app.querySelectorAll('tr.row').forEach(r => r.onclick = () => location.hash = '#order/' + r.dataset.id); bindLogout();
    inboxP.then(r => { const el = document.getElementById('inboxLine'); if (!el) return;
      if (r.error || typeof r.unread !== 'number') { el.className = 'meta'; el.textContent = 'письма: нет связи с почтой'; return; }
      el.className = ''; el.innerHTML = `<a href="#inbox" style="color:inherit">Новых писем от клиентов: ${r.unread > 0 ? `<b>${r.unread}</b>` : r.unread}</a>`; });
  }

  async function order(id) {
    const { order: o } = await A('admin/order', { q: { id } });
    const ev = isEvent(o), dip = isDiploma(o), dig = isDigital(o) && !ev, noShip = dig || ev || dip;
    app.innerHTML = tabs('orders') + `<p class="meta"><a href="#orders" style="color:inherit;text-decoration:none">← заказы</a></p><h2>${o.id} ${badge(o)}</h2>
      <div class="kv"><b>Создан</b><span>${d(o.created_at)}</span><b>Товар</b><span>${item(o)} — ${rub(o.price_item)} × ${o.qty}</span>${dip ? `<b>Тип</b><span>практикум (диплом)</span><b>Имя в дипломе</b><span>${esc(o.customer_name)}</span>` : ev ? `<b>Тип</b><span>мероприятие</span><b>Билетов</b><span>${o.qty}</span>` : dig ? `<b>Тип</b><span>цифровой</span><b>Скачивание</b><span>${o.downloaded_at ? `скачан ${d(o.downloaded_at)}${o.download_count ? ' · раз: ' + o.download_count : ''}` : 'не скачан'}</span>` : `<b>Доставка</b><span>${rub(o.price_delivery)} (${o.delivery_mode}${o.delivery_days ? ', ~' + o.delivery_days + ' дн.' : ''})</span>`}<b>Итого</b><span>${rub(o.total)}</span>
      <b>Покупатель</b><span>${noShip ? '' : `${esc(o.customer_name)}<br><a href="tel:${esc(o.customer_phone)}">${esc(o.customer_phone)}</a> · `}<a href="mailto:${esc(o.customer_email)}">${esc(o.customer_email)}</a></span>
      ${o.inscription ? `<b>На форзаце</b><span>${esc(o.inscription).replace(/\n/g, '<br>')}</span>` : ''}
      ${noShip ? '' : `<b>Куда</b><span>${esc(o.pvz_address || o.address_text)}</span>
      <b>Яндекс</b><span>${o.yd_request_id ? `заявка ${esc(o.yd_request_id)} ${o.yd_track_url ? `· <a href="${esc(o.yd_track_url)}" target="_blank">трек</a>` : ''}` : (o.delivery_mode === 'yandex' ? '<span class="badge">заявка не создана</span>' : 'вручную')}${o.yd_error ? `<br><small style="color:#7a1c1c">${esc(o.yd_error)}</small>` : ''}</span>`}
      <b>Платёж</b><span>${esc(o.tb_payment_id || '—')}${o.tb_refund_id ? ' · возврат ' + esc(o.tb_refund_id) : ''}${o.mail_error ? `<br><small style="color:#7a1c1c">почта: ${esc(o.mail_error)}</small>` : ''}</span></div>
      <div class="row-actions">${NEXT[o.status] && !noShip ? `<button class="btn" data-act="next">→ ${NEXT[o.status]}</button>` : ''}
        ${['new', 'paid', 'packed'].includes(o.status) ? `<button class="btn ghost" data-act="cancel">Отменить${o.status !== 'new' ? ' и вернуть деньги' : ''}</button>` : ''}
        ${o.delivery_mode === 'yandex' && !o.yd_request_id && ['paid', 'packed'].includes(o.status) ? `<button class="btn ghost" data-act="retry_yd">Создать заявку Яндекс</button>` : ''}</div>
      <label class="field"><span>Заметка (при статусе «отправлен» без заявки Яндекса уходит покупателю как трек)</span><textarea id="note">${esc(o.admin_note)}</textarea></label><button class="btn ghost" id="saveNote" style="width:auto;padding:0 20px">Сохранить заметку</button>`;
    app.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
      if (b.dataset.act === 'cancel' && dig && o.status !== 'new' && o.downloaded_at && !confirm('Архив уже скачан — по оферте возврат не положен. Всё равно вернуть деньги?')) return;
      if (b.dataset.act === 'cancel' && !confirm(o.status === 'new' ? 'Отменить заказ?' : ev ? `Отменить и вернуть ${rub(o.total)}? Места вернутся в продажу.` : `Отменить и вернуть ${rub(o.total)} покупателю?`)) return;
      b.disabled = true; try { await A('admin/order', { method: 'POST', body: { id, action: b.dataset.act } }); order(id); } catch (e) { fail(e); b.disabled = false; } });
    app.querySelector('#saveNote').onclick = async () => { try { await A('admin/order', { method: 'POST', body: { id, action: 'note', note: app.querySelector('#note').value } }); order(id); } catch (e) { fail(e); } };
    bindLogout();
  }

  // Предзаказы книги: все оплаченные и дальше (отменённые — серым), адрес по частям под Яндекс Доставку, надпись на форзаце.
  // CSV — к отправке (оплачен/собран), столбцы по полям API Яндекса (шаблон массовой загрузки виден только в кабинете — сверить при первой отправке).
  // JSON — полная копия всего списка. Резервная копия каждого оплаченного заказа лежит ещё и в бакете: preorders/<номер>.json.
  async function book() {
    const { orders: os } = await A('admin/book_orders');
    const live = os.filter(o => o.status !== 'cancelled'), toShip = os.filter(o => ['paid', 'packed'].includes(o.status));
    const pref = o => o.pvz_id ? 'ПВЗ выбран' : o.addr.pref === 'pvz' ? 'ПВЗ рядом' : 'до двери';
    const fio = o => [o.addr.last_name, o.addr.first_name, o.addr.middle_name].filter(Boolean).join(' ') || o.name;
    app.innerHTML = tabs('book') + `<div class="summary"><span>Заказов: <b>${live.length}</b></span><span>Экземпляров: <b>${live.reduce((a, o) => a + o.qty, 0)}</b></span><span>К отправке: <b>${toShip.length}</b></span><span>С пожеланием: <b>${live.filter(o => o.inscription).length}</b></span></div>
      <p style="text-align:center"><button class="btn" id="csv" style="width:auto;padding:0 22px">CSV для Яндекс Доставки</button> <button class="btn ghost" id="js" style="width:auto;padding:0 22px">Всё в JSON</button></p>
      <table><tr><th>Заказ</th><th>Кому</th><th>Куда</th><th>На форзаце</th></tr>
      ${os.map(o => `<tr class="row" data-id="${o.id}" style="${o.status === 'cancelled' ? 'opacity:.45' : ''}"><td>${o.id}<br>${badge(o)}<br><small class="meta">${d(o.created_at)} · ${o.qty} шт · ${rub(o.total)}</small></td>
        <td>${esc(fio(o))}<br><small>${esc(o.phone)}<br>${esc(o.email)}</small></td><td><small class="meta">${pref(o)}</small><br>${esc(o.address_text)}</td><td>${esc(o.inscription).replace(/\n/g, '<br>') || '<span class="meta">—</span>'}</td></tr>`).join('') || '<tr><td colspan="4" class="meta">пока пусто</td></tr>'}</table>`;
    app.querySelectorAll('tr.row').forEach(r => r.onclick = () => location.hash = '#order/' + r.dataset.id);
    const save = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
    const stamp = new Date().toISOString().slice(0, 10);
    app.querySelector('#csv').onclick = () => {
      const cell = v => { const t = String(v == null ? '' : v); return /[";\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
      const head = ['Номер заказа', 'Статус', 'Дата', 'Экземпляров', 'Фамилия', 'Имя', 'Отчество', 'Телефон', 'E-mail', 'Способ получения', 'Адрес (город, улица, дом) или ПВЗ', 'ID пункта выдачи', 'Квартира', 'Индекс', 'Подъезд, этаж, домофон', 'Надпись на форзаце', 'Оплачено, ₽', 'Заявка Яндекса'];
      const rows = toShip.map(o => [o.id, ST[o.status], dd(o.created_at), o.qty, o.addr.last_name || o.name, o.addr.first_name || '', o.addr.middle_name || '', o.addr.phone_yd || String(o.phone).replace(/^\+/, ''), o.email,
        pref(o), o.pvz_address || o.addr.full_address || o.address_text, o.pvz_id, o.addr.flat || '', o.addr.zip || '', o.addr.comment || '', o.inscription, o.total, o.yd_request_id]);
      save(`kniga-predzakazy-${stamp}.csv`, '﻿' + [head, ...rows].map(r => r.map(cell).join(';')).join('\r\n'), 'text/csv;charset=utf-8'); };
    app.querySelector('#js').onclick = () => save(`kniga-predzakazy-${stamp}.json`, JSON.stringify(os, null, 2), 'application/json');
    bindLogout();
  }

  // Рассылка: подписчики (согласие отдельной галочкой в заказе), письмо себе на пробу, отправка всем порциями по 25
  // (функция живёт 30 с — сервер шлёт порцию и отдаёт next_offset, админка зовёт снова, пока не done).
  async function mail() {
    const [{ count, subscribers: subs, by_product: bp = {} }, { mailings }, { products: prods }] = await Promise.all([A('admin/subscribers'), A('admin/mailings'), A('admin/products')]);
    const ptitle = Object.fromEntries(prods.map(p => [p.id, p.title])); let aud = ''; const audN = () => aud ? (bp[aud] || 0) : count;
    app.innerHTML = tabs('mail') + `<div class="summary"><a href="#" id="subsT" style="color:inherit">Подписчиков: <b>${count}</b></a></div>
      <div id="subs" style="display:none;margin:0 0 28px"><table><tr><th>E-mail</th><th>Согласие</th><th>Заказ</th></tr>
      ${subs.map(x => `<tr><td>${esc(x.email)}</td><td>${d(x.consent_at)}</td><td>${x.source ? `<a href="#order/${esc(x.source)}" style="color:inherit">${esc(x.source)}</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="3" class="meta">пока никого</td></tr>'}</table></div>
      <form id="mf" style="max-width:640px;margin:0 auto"><label class="field"><span>Кому</span><select id="mAud" style="height:44px;border:1px solid var(--line);font:inherit;font-size:14px;padding:0 8px;background:#fff">
        <option value="">все подписчики (${count})</option>${prods.filter(p => bp[p.id]).map(p => `<option value="${esc(p.id)}">купили «${esc(p.title)}» (${bp[p.id]})</option>`).join('')}</select>
        <small class="meta">только подписчики; купившие — с оплаченным заказом товара</small></label>
      <label class="field"><span>Тема</span><input name="subject" maxlength="200"></label>
      <label class="field"><span>Текст (как есть; ссылки станут кликабельными, подвал с отпиской добавится сам)</span><textarea name="body" maxlength="20000" style="min-height:240px"></textarea></label>
      <div class="row-actions"><button type="button" class="btn ghost" id="mTest">Отправить себе</button><button type="button" class="btn" id="mAll" ${count ? '' : 'disabled'}>Отправить (${count})</button></div>
      <p class="meta" id="mSt"></p></form>
      <h2 style="margin-top:36px;text-align:center">Журнал</h2>
      <table><tr><th>Дата</th><th>Тема</th><th>Кому</th><th>Ушло</th><th>Ошибок</th></tr>
      ${mailings.map(m => `<tr><td>${d(m.created_at)}</td><td>${esc(m.subject)}</td><td>${m.audience ? 'купили «' + esc(ptitle[m.audience] || m.audience) + '»' : 'все подписчики'}</td><td>${m.sent}</td><td>${m.failed}</td></tr>`).join('') || '<tr><td colspan="5" class="meta">рассылок ещё не было</td></tr>'}</table>`;
    app.querySelector('#subsT').onclick = e => { e.preventDefault(); const b = app.querySelector('#subs'); b.style.display = b.style.display === 'none' ? '' : 'none'; };
    const form = app.querySelector('#mf'), st = app.querySelector('#mSt'), btns = [app.querySelector('#mTest'), app.querySelector('#mAll')];
    const val = () => { const subject = form.elements.namedItem('subject').value.trim(), body = form.elements.namedItem('body').value; if (!subject || !body.trim()) { alert('Нужны тема и текст'); return null; } return { subject, body }; };
    const lock = on => btns.forEach(b => { b.disabled = on || (b.id === 'mAll' && !audN()); });
    app.querySelector('#mAud').onchange = e => { aud = e.target.value; const b = app.querySelector('#mAll'); b.textContent = `Отправить (${audN()})`; lock(false); };
    const err = e => { if (e.code === 401) return fail(e); st.textContent = 'Ошибка: ' + (e.message === 'no_mailing' ? 'рассылка не найдена на сервере' : e.data && (e.data.field ? 'поле ' + e.data.field : e.data.error) || e.message); };
    app.querySelector('#mTest').onclick = async () => { const m = val(); if (!m) return; lock(true); st.textContent = 'отправляю себе…';
      try { const r = await A('admin/mailing', { method: 'POST', body: { ...m, test: true } }); st.textContent = r.sent ? 'пробное письмо ушло на адрес владельца' : 'не ушло — ошибка отправки'; } catch (e) { err(e); } lock(false); };
    app.querySelector('#mAll').onclick = async () => { const m = val(); if (!m || !confirm(`Отправить ${audN()} подписчикам${aud ? ', купившим «' + (ptitle[aud] || aud) + '»' : ''}?`)) return; lock(true);
      let mailing_id, offset = 0, sent = 0, failed = 0, total = audN(); const product_id = aud;
      try {
        for (;;) {
          st.textContent = `ушло ${sent} из ${total}, ошибок ${failed}…`;
          const r = await A('admin/mailing', { method: 'POST', body: { ...m, offset, product_id, ...(mailing_id ? { mailing_id } : {}) } });
          mailing_id = r.mailing_id; sent += r.sent; failed += r.failed; total = r.total;
          if (r.done) break;
          if (!(r.next_offset > offset)) throw Object.assign(new Error('stuck'), { data: { error: 'сервер не продвинулся (next_offset ' + r.next_offset + ')' } }); // защита от зацикливания
          offset = r.next_offset;
        }
        st.textContent = `готово: ушло ${sent} из ${total}, ошибок ${failed}`; alert(st.textContent); mail(); return;
      } catch (e) { err(e); st.textContent += ` (остановлено: ушло ${sent} из ${total}, ошибок ${failed})`; }
      lock(false); };
    bindLogout();
  }

  // Клиенты: представление над заказами (ключ — e-mail), без своей таблицы. Фильтры работают локально, без перезапроса.
  const CL = { onlyMail: false, q: '', sort: 'last', open: new Set() };
  async function clients() {
    const { clients: all } = await A('admin/clients');
    const canMail = all.filter(c => c.subscribed).length;
    app.innerHTML = tabs('clients') + `<div class="summary"><span>Клиентов: <b>${all.length}</b>, можно писать: <b>${canMail}</b></span></div>
      <div style="display:flex;flex-wrap:wrap;gap:12px 24px;align-items:center;justify-content:center;margin:0 0 20px">
        <label class="check" style="margin:0"><input type="checkbox" id="cOnly" ${CL.onlyMail ? 'checked' : ''}> <span>только кому можно писать</span></label>
        <label class="field" style="margin:0;min-width:260px"><input id="cQ" placeholder="поиск: e-mail или телефон" value="${esc(CL.q)}"></label>
        <label class="field" style="margin:0"><select id="cSort" style="height:44px;border:1px solid var(--line);font:inherit;font-size:14px;padding:0 8px;background:#fff"><option value="last" ${CL.sort === 'last' ? 'selected' : ''}>по дате последнего заказа</option><option value="sum" ${CL.sort === 'sum' ? 'selected' : ''}>по сумме</option></select></label>
      </div><div id="cList"></div>`;
    const digits = s => String(s || '').replace(/\D/g, '');
    const paint = () => {
      const q = CL.q.trim().toLowerCase(), qd = digits(q);
      let list = all.filter(c => (!CL.onlyMail || c.subscribed) && (!q || c.email.toLowerCase().includes(q) || (qd.length >= 3 && (c.phones || []).some(p => digits(p).includes(qd)))));
      list = list.slice().sort(CL.sort === 'sum' ? (a, b) => b.sum_paid - a.sum_paid || Date.parse(b.last_at) - Date.parse(a.last_at) : (a, b) => Date.parse(b.last_at) - Date.parse(a.last_at));
      app.querySelector('#cList').innerHTML = `<table><tr><th>E-mail</th><th>Телефон</th><th>Заказов · оплачено</th><th>Сумма оплаченных</th><th>Последний заказ</th><th title="можно писать">✉</th></tr>
        ${list.map(c => `<tr class="row" data-e="${esc(c.email)}"><td>${esc(c.email)}${(c.names || []).length ? `<br><small class="meta">${esc(c.names.join(', '))}</small>` : ''}</td><td>${(c.phones || []).map(esc).join('<br>') || '<span class="meta">—</span>'}</td><td>${c.orders_total} · ${c.orders_paid}</td><td>${rub(c.sum_paid)}</td><td>${dd(c.last_at)}</td><td>${c.subscribed ? `<span title="согласие ${c.subscribed_at ? dd(c.subscribed_at) : ''}">✉</span>` : ''}</td></tr>
          ${CL.open.has(c.email) ? `<tr><td colspan="6" style="background:#fafafa;padding:4px 8px 12px"><table>${(c.orders || []).map(o => `<tr class="row" data-o="${esc(o.id)}"><td>${esc(o.id)}</td><td>${d(o.created_at)}</td><td>${esc(o.product_title || o.product_id)}</td><td>${badge(o)}</td><td>${rub(o.total)}</td></tr>`).join('')}</table></td></tr>` : ''}`).join('') || '<tr><td colspan="6" class="meta">никого не нашлось</td></tr>'}</table>`;
      app.querySelectorAll('#cList tr[data-e]').forEach(r => r.onclick = () => { const e = r.dataset.e; CL.open.has(e) ? CL.open.delete(e) : CL.open.add(e); paint(); });
      app.querySelectorAll('#cList tr[data-o]').forEach(r => r.onclick = ev => { ev.stopPropagation(); location.hash = '#order/' + r.dataset.o; });
    };
    app.querySelector('#cOnly').onchange = e => { CL.onlyMail = e.target.checked; paint(); };
    app.querySelector('#cQ').oninput = e => { CL.q = e.target.value; paint(); };
    app.querySelector('#cSort').onchange = e => { CL.sort = e.target.value; paint(); };
    paint(); bindLogout();
  }

  // Письма от клиентов: ящик REPLY_TO по IMAP (сервер отбирает письма покупателей/подписчиков и ответы на наши).
  const clientLine = c => c ? `клиент: ${c.orders_total} ${c.orders_total % 10 === 1 && c.orders_total % 100 !== 11 ? 'заказ' : [2, 3, 4].includes(c.orders_total % 10) && ![12, 13, 14].includes(c.orders_total % 100) ? 'заказа' : 'заказов'} · ${rub(c.sum_paid)}` : '';
  const fromHtml = l => `${l.from_name ? esc(l.from_name) + ' ' : ''}<span class="meta" style="letter-spacing:0;text-transform:none">&lt;${esc(l.from)}&gt;</span>`;
  async function inbox() {
    let r;
    try { r = await A('admin/inbox'); }
    catch (e) { if (e.code === 401) throw e; app.innerHTML = tabs('inbox') + `<p class="meta" style="text-align:center">письма: нет связи с почтой${e.message ? ' (' + esc(e.message) + ')' : ''}</p>`; bindLogout(); return; }
    const ls = r.letters || [];
    app.innerHTML = tabs('inbox') + `<div class="summary"><span>Новых: <b>${r.unread}</b></span><span>Всего за 90 дней: <b>${ls.length}</b></span></div>
      <table><tr><th>Дата</th><th>От кого</th><th>Тема</th></tr>
      ${ls.map(l => `<tr class="row" data-uid="${esc(l.uid)}" style="${l.unread ? 'font-weight:600' : ''}"><td>${d(l.date)}</td><td>${fromHtml(l)}${l.client ? `<br><small class="meta">${clientLine(l.client)}</small>` : ''}</td>
        <td>${esc(l.subject || '(без темы)')}<br><small style="font-weight:400;color:var(--dim)">${esc(l.snippet)}</small></td></tr>`).join('') || '<tr><td colspan="3" class="meta">писем нет</td></tr>'}</table>`;
    app.querySelectorAll('tr.row').forEach(t => t.onclick = () => location.hash = '#letter/' + t.dataset.uid); bindLogout();
  }

  async function letter(uid) {
    const l = await A('admin/letter', { q: { uid } }), c = l.client;
    app.innerHTML = tabs('letter') + `<p class="meta"><a href="#inbox" style="color:inherit;text-decoration:none">← ко всем письмам</a></p>
      <h2>${esc(l.subject || '(без темы)')}</h2>
      <div class="kv"><b>От кого</b><span>${fromHtml(l)}</span><b>Дата</b><span>${d(l.date)}</span>${(l.attachments || []).length ? `<b>Вложения</b><span>${l.attachments.map(a => esc(a.filename || a.name || a)).join(', ')} <small class="meta">(не показываются)</small></span>` : ''}</div>
      <div style="white-space:pre-wrap;word-break:break-word;font-size:15px;line-height:1.55;border-left:2px solid var(--line);padding:4px 0 4px 16px;margin:0 0 28px">${esc(l.text)}</div>
      ${c ? `<div style="background:#fafafa;padding:14px 16px;margin:0 0 28px"><div class="meta" style="margin-bottom:8px">Клиент</div>
        <div style="font-size:14px;margin-bottom:8px">${esc(c.email)}${(c.names || []).length ? ' · ' + esc(c.names.join(', ')) : ''}${(c.phones || []).length ? ' · ' + c.phones.map(esc).join(', ') : ''}<br>заказов ${c.orders_total} · оплачено ${c.orders_paid} · ${rub(c.sum_paid)}${c.subscribed ? ' · ✉ можно писать' : ''}</div>
        <table>${(c.orders || []).map(o => `<tr class="row" data-o="${esc(o.id)}"><td>${esc(o.id)}</td><td>${d(o.created_at)}</td><td>${esc(o.product_title || o.product_id)}</td><td>${badge(o)}</td><td>${rub(o.total)}</td></tr>`).join('')}</table></div>`
        : '<p class="meta" style="margin:0 0 28px">отправителя нет среди покупателей и подписчиков</p>'}
      <label class="field"><span>Ответ</span><textarea id="rText" style="min-height:160px"></textarea></label>
      <button class="btn" id="rSend" style="width:auto;padding:0 28px">Ответить</button> <span class="meta" id="rSt" style="margin-left:12px"></span>`;
    app.querySelectorAll('tr[data-o]').forEach(t => t.onclick = () => location.hash = '#order/' + t.dataset.o);
    const btn = app.querySelector('#rSend'), ta = app.querySelector('#rText'), st = app.querySelector('#rSt');
    btn.onclick = async () => { const text = ta.value; if (!text.trim()) { st.textContent = 'пустой ответ'; return; }
      btn.disabled = true; st.textContent = 'отправляю…';
      try { const r = await A('admin/reply', { method: 'POST', body: { uid: l.uid != null ? l.uid : uid, text } }); if (!r.ok) throw Object.assign(new Error('not_ok'), { data: r }); st.textContent = 'ответ ушёл'; ta.value = ''; }
      catch (e) { if (e.code === 401) return fail(e); st.textContent = 'ошибка: ' + (e.data && e.data.error || e.message); }
      btn.disabled = false; };
    bindLogout();
  }

  const evRow = p => { const v = (p.variants || [])[0] || { stock: 0, reserved: 0 }; return `мероприятие · ${p.event_at ? d(p.event_at) : 'дата не задана'} · свободно ${v.stock - v.reserved} / резерв ${v.reserved}`; };
  async function products() {
    const { products } = await A('admin/products');
    app.innerHTML = tabs('products') + `<p style="text-align:center"><a class="btn" href="#product/new" style="width:auto;padding:0 24px">+ Добавить товар</a></p>
      <table><tr><th>Товар</th><th>Цена</th><th>Остатки (доступно / резерв / предзаказ)</th><th>Показ</th></tr>
      ${products.map(p => `<tr class="row" data-id="${p.id}"><td>${esc(p.title)}<br><small class="meta">${p.id}</small></td><td>${rub(p.price)}</td><td>${p.kind === 'event' ? evRow(p) : p.kind === 'diploma' ? 'практикум (диплом)' : p.kind === 'book' ? `книга · предзаказов ${(p.variants || []).reduce((a, v) => a + v.preorder_count, 0)} · в наличии ${(p.variants || []).reduce((a, v) => a + v.stock - v.reserved, 0)}` : p.kind === 'digital' ? `цифровой · ${p.file_key ? 'архив загружен' : 'архива нет'}${p.free_until && p.free_file_key && Date.parse(p.free_until) > Date.now() ? ' · бесплатно до ' + new Date(p.free_until).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : ''}` : (p.variants || []).map(v => `${v.size !== '-' ? v.size + ': ' : ''}${v.stock - v.reserved}/${v.reserved}/${v.preorder_count}`).join(' · ')}</td><td>${p.active ? 'да' : 'нет'}</td></tr>`).join('')}</table>`;
    app.querySelectorAll('tr.row').forEach(r => r.onclick = () => location.hash = '#product/' + r.dataset.id); bindLogout();
  }

  async function product(id) {
    const isNew = id === 'new';
    const p = isNew ? { id: '', title: '', description_md: '', price: '', images: [], weight_g: 300, dims_cm: { x: 30, y: 20, z: 3 }, sizes: [], preorder_allowed: false, preorder_ship_by: '', active: false, sort: 0, variants: [], kind: 'physical', file_key: '', free_file_key: '', free_until: '' }
      : (await A('admin/product', { q: { id } })).product;
    if (!p.dims_cm) p.dims_cm = { x: 30, y: 20, z: 3 }; if (!p.sizes) p.sizes = []; if (!p.variants) p.variants = []; if (!p.images) p.images = [];
    const f = (n, label, v, type = 'text', extra = '') => `<label class="field"><span>${label}</span><input name="${n}" type="${type}" value="${esc(v)}" ${extra}></label>`;
    app.innerHTML = tabs('products') + `<p class="meta"><a href="#products" style="color:inherit;text-decoration:none">← товары</a></p><form id="pf">
      ${f('id', 'Slug (латиница, для адреса страницы)', p.id, 'text', isNew ? '' : 'readonly')}${f('title', 'Название', p.title)}
      <label class="field"><span>Описание (абзацы — пустой строкой)</span><textarea name="description_md" style="min-height:140px">${esc(p.description_md)}</textarea></label>
      ${f('price', 'Цена, ₽', p.price, 'number', 'min="1"')}
      <label class="field"><span>Тип</span><select name="kind"><option value="physical" ${!['digital', 'event', 'diploma', 'book'].includes(p.kind) ? 'selected' : ''}>вещь (мерч)</option><option value="book" ${p.kind === 'book' ? 'selected' : ''}>книга (в «Продуктах», с доставкой)</option><option value="digital" ${p.kind === 'digital' ? 'selected' : ''}>цифровой</option><option value="event" ${p.kind === 'event' ? 'selected' : ''}>мероприятие</option><option value="diploma" ${p.kind === 'diploma' ? 'selected' : ''}>практикум (диплом)</option></select></label>
      <div id="ev"><label class="field"><span>Дата и время начала (ваше местное время)</span><input type="datetime-local" name="event_at" value="${p.event_at ? localDT(p.event_at) : ''}"></label>
        ${f('venue', 'Место (адрес)', p.venue || '')}
        <label class="field"><span>Возрастной знак</span><select name="age_mark"><option value="">—</option>${['0+', '6+', '12+', '16+', '18+'].map(a => `<option ${p.age_mark === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
        ${f('seats', 'Свободных мест', (p.variants.find(v => v.size === '-') || { stock: 60 }).stock, 'number', 'min="0"')}</div>
      <div id="dig"><div class="meta" style="margin-bottom:6px">Архив (zip)</div><p id="arch" style="font-size:14px;margin:0 0 8px"></p>
        <input type="file" id="zip" accept=".zip,application/zip" ${isNew ? 'disabled title="сначала сохраните товар"' : ''}><p class="meta" id="zupl"></p>
        <div class="meta" style="margin:18px 0 6px">Бесплатная версия (zip, с объявлением)</div><p id="farch" style="font-size:14px;margin:0 0 8px"></p>
        <input type="file" id="fzip" accept=".zip,application/zip" ${isNew ? 'disabled title="сначала сохраните товар"' : ''}><p class="meta" id="fzupl"></p>
        <label class="field" style="margin-top:12px"><span>Бесплатно до (ваше местное время; пусто — акции нет)</span><input type="datetime-local" name="free_until" value="${p.free_until ? localDT(p.free_until) : ''}"></label>
        <p style="margin:0 0 8px"><button type="button" class="btn ghost" id="free48" style="width:auto;padding:0 18px;height:40px;line-height:40px">+48 часов от сейчас</button> <button type="button" class="btn ghost" id="freeoff" style="width:auto;padding:0 18px;height:40px;line-height:40px">без акции</button></p>
        <p class="meta" id="freest"></p></div>
      <div id="phys">${f('sizes', 'Размеры через запятую (пусто — без размера)', p.sizes.join(', '))}
      <div class="meta" style="margin-bottom:6px">Остатки по размерам</div><div class="stock" id="stock"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-top:14px">${f('weight_g', 'Вес, г', p.weight_g, 'number')}${f('dx', 'Длина, см', p.dims_cm.x, 'number')}${f('dy', 'Ширина, см', p.dims_cm.y, 'number')}${f('dz', 'Высота, см', p.dims_cm.z, 'number')}</div>
      <label class="check"><input type="checkbox" name="preorder_allowed" ${p.preorder_allowed ? 'checked' : ''}> <span>Разрешить предзаказ, когда размера нет</span></label>${f('preorder_ship_by', 'Предзаказ: отправка до (текст, напр. «15 октября»)', p.preorder_ship_by)}</div>
      <label class="field"><span>Текст в письме после оплаты (первой строкой вместо срока отправки; пусто — обычное письмо)</span><textarea name="mail_note" rows="3">${esc(p.mail_note || '')}</textarea></label>
      <label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> <span>Показывать на сайте</span></label>${f('sort', 'Порядок (меньше — выше)', p.sort, 'number')}
      <div class="meta">Фото (первое — главное; ⇠ ⇢ порядок, × удалить)</div><div class="thumbs" id="thumbs"></div>
      <input type="file" id="file" accept="image/*" multiple ${isNew ? 'disabled title="сначала сохраните товар"' : ''}><p class="meta" id="upl"></p>
      <button class="btn" style="margin-top:20px">Сохранить</button></form>`;
    const form = app.querySelector('#pf'); const F = n => form.elements.namedItem(n); // form.id/form.title — свойства элемента, не поля
    const sizesOf = () => F('sizes').value.split(',').map(s => s.trim()).filter(Boolean);
    const renderStock = () => { const want = sizesOf().length ? sizesOf() : ['-']; const cur = Object.fromEntries([...app.querySelectorAll('#stock input')].map(i => [i.dataset.s, i.value]));
      app.querySelector('#stock').innerHTML = want.map(s => { const v = p.variants.find(x => x.size === s); return `<label><span>${s === '-' ? 'штук' : s}</span><input type="number" min="0" data-s="${esc(s)}" value="${cur[s] != null ? cur[s] : (v ? v.stock : 0)}"></label>`; }).join(''); };
    F('sizes').oninput = renderStock; renderStock();
    const renderKind = () => { const k = F('kind').value, dig = k === 'digital'; app.querySelector('#phys').style.display = k === 'physical' || k === 'book' ? '' : 'none'; app.querySelector('#dig').style.display = dig ? '' : 'none'; app.querySelector('#ev').style.display = k === 'event' ? '' : 'none';
      app.querySelector('#arch').innerHTML = p.file_key ? `загружен <small class="meta">${esc(p.file_key)}</small>` : (isNew ? 'не загружен — сначала сохраните товар' : 'не загружен');
      app.querySelector('#farch').innerHTML = p.free_file_key ? `загружен <small class="meta">${esc(p.free_file_key)}</small>` : 'не загружен';
      const fu = F('free_until').value, left = fu ? new Date(fu) - Date.now() : 0;
      app.querySelector('#freest').textContent = !fu ? 'акции нет — продаётся платная версия' : left <= 0 ? 'акция закончилась — продаётся платная версия' : !p.free_file_key ? 'время задано, но бесплатного архива нет — акция не начнётся' : `акция идёт: бесплатно ещё ${Math.floor(left / 3600000)} ч ${Math.floor(left % 3600000 / 60000)} мин (после сохранения)`; };
    F('kind').onchange = renderKind; renderKind();
    F('free_until').oninput = renderKind;
    app.querySelector('#free48').onclick = () => { F('free_until').value = localDT(new Date(Date.now() + 48 * 3600000).toISOString()); renderKind(); };
    app.querySelector('#freeoff').onclick = () => { F('free_until').value = ''; renderKind(); };
    // Архив: admin/file → presigned PUT (application/zip) → ключ в file_key (или free_file_key) и сразу сохранить товар
    const uploadZip = (inputId, statusId, field) => app.querySelector(inputId).onchange = async e => {
      const file = e.target.files[0]; if (!file) return; const st = app.querySelector(statusId);
      if (!/\.zip$/i.test(file.name)) { alert('Нужен .zip'); e.target.value = ''; return; }
      st.textContent = 'загружаю ' + file.name + '…';
      try {
        const { key, put_url } = await A('admin/file', { method: 'POST', body: { product_id: p.id } });
        const r = await fetch(put_url, { method: 'PUT', headers: { 'Content-Type': 'application/zip' }, body: file }); if (!r.ok) throw new Error('upload ' + r.status);
        p[field] = key; renderKind(); st.textContent = 'загружено, сохраняю…';
        await save(); st.textContent = 'архив загружен и сохранён';
      } catch (err) { st.textContent = ''; if (err.code === 401) fail(err); else alert('Не загрузилось: ' + (err.data && err.data.error || err.message)); }
      e.target.value = '';
    };
    uploadZip('#zip', '#zupl', 'file_key'); uploadZip('#fzip', '#fzupl', 'free_file_key');
    const renderThumbs = () => { app.querySelector('#thumbs').innerHTML = p.images.map((k, i) => `<div><img src="https://storage.yandexcloud.net/antiosov-merch/${esc(k)}"><button type="button" data-i="${i}" data-m="l">⇠</button><button type="button" data-i="${i}" data-m="r" style="right:28px">⇢</button><button type="button" data-i="${i}" data-m="x" style="top:auto;bottom:2px">×</button></div>`).join('');
      app.querySelectorAll('#thumbs button').forEach(b => b.onclick = async () => { const i = +b.dataset.i; if (b.dataset.m === 'x') { if (!confirm('Удалить фото?')) return; try { await A('admin/photo', { method: 'DELETE', body: { key: p.images[i] } }); } catch (e) { fail(e); return; } p.images.splice(i, 1); }
        if (b.dataset.m === 'l' && i > 0) [p.images[i - 1], p.images[i]] = [p.images[i], p.images[i - 1]]; if (b.dataset.m === 'r' && i < p.images.length - 1) [p.images[i + 1], p.images[i]] = [p.images[i], p.images[i + 1]]; renderThumbs(); }); };
    renderThumbs();
    // Загрузка: сжать до 1600px JPEG через canvas → presigned PUT → ключ в images (сохранится с формой)
    app.querySelector('#file').onchange = async e => {
      for (const file of e.target.files) {
        app.querySelector('#upl').textContent = 'загружаю ' + file.name + '…';
        try {
          const blob = await shrink(file); const { key, put_url, content_type } = await A('admin/photo', { method: 'POST', body: { product_id: p.id, content_type: 'image/jpeg' } });
          const r = await fetch(put_url, { method: 'PUT', headers: { 'Content-Type': content_type }, body: blob }); if (!r.ok) throw new Error('upload ' + r.status);
          p.images.push(key); renderThumbs();
        } catch (err) { alert('Не загрузилось: ' + err.message); }
      }
      app.querySelector('#upl').textContent = 'готово — не забудь «Сохранить»'; e.target.value = '';
    };
    const bodyOf = () => { const b = baseOf(); return b.kind !== 'event' ? b : { ...b, event_at: F('event_at').value ? new Date(F('event_at').value).toISOString() : '', venue: F('venue').value.trim(), age_mark: F('age_mark').value, variants: [{ size: '-', stock: Math.max(0, +F('seats').value | 0) }], sizes: [] }; };
    const baseOf = () => ({ id: F('id').value.trim(), title: F('title').value, description_md: F('description_md').value, price: +F('price').value, images: p.images, weight_g: +F('weight_g').value,
        dims_cm: { x: +F('dx').value, y: +F('dy').value, z: +F('dz').value }, sizes: sizesOf(), preorder_allowed: F('preorder_allowed').checked, preorder_ship_by: F('preorder_ship_by').value, mail_note: F('mail_note') ? F('mail_note').value : undefined, active: F('active').checked, sort: +F('sort').value,
        variants: [...app.querySelectorAll('#stock input')].map(i => ({ size: i.dataset.s, stock: +i.value })), kind: F('kind').value, file_key: p.file_key || '',
        free_file_key: p.free_file_key || '', free_until: F('free_until').value ? new Date(F('free_until').value).toISOString() : '' });
    const save = () => A('admin/product', { method: 'POST', body: bodyOf() });
    form.onsubmit = async ev => { ev.preventDefault(); const body = bodyOf();
      try { await save(); location.hash = '#product/' + body.id; if (!isNew) product(body.id); } catch (err) { fail(err); } };
    bindLogout();
  }
  function shrink(file) { return new Promise((res, rej) => { const img = new Image(); img.onload = () => { const k = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); c.toBlob(b => b ? res(b) : rej(new Error('canvas')), 'image/jpeg', 0.86); URL.revokeObjectURL(img.src); }; img.onerror = () => rej(new Error('not an image')); img.src = URL.createObjectURL(file); }); }

  async function route() {
    if (!token) return login();
    const h = location.hash.replace(/^#/, '') || 'orders'; const [page, arg] = h.split('/');
    try { if (page === 'orders') await orders(arg); else if (page === 'order') await order(arg); else if (page === 'products') await products(); else if (page === 'product') await product(arg); else if (page === 'book') await book(); else if (page === 'mail') await mail(); else if (page === 'clients') await clients(); else if (page === 'inbox') await inbox(); else if (page === 'letter') await letter(arg); else location.hash = '#orders'; }
    catch (e) { fail(e); }
  }
  window.addEventListener('hashchange', route); route();
})();
