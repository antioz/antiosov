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
  const isDigital = o => o.kind === 'digital' || o.delivery_mode === 'none';
  const dlMark = o => isDigital(o) ? `<br><small class="meta">${o.downloaded_at ? 'скачан ' + dd(o.downloaded_at) : 'не скачан'}</small>` : '';
  const item = o => `${esc(o.product_title)}${o.size && o.size !== '-' ? ' ' + esc(o.size) : ''} × ${o.qty}`;
  const fail = e => { if (e.code === 401) { token = null; try { localStorage.removeItem(tokKey); } catch (_) {} route(); } else alert('Ошибка: ' + (e.data && e.data.error || e.message)); };

  function login() {
    app.innerHTML = `<form id="lf" class="center" style="max-width:320px"><label class="field"><span>Пароль</span><input type="password" name="p" autofocus></label><button class="btn">Войти</button></form>`;
    app.querySelector('#lf').onsubmit = async e => { e.preventDefault(); try { const r = await api('admin/login', { method: 'POST', body: { password: e.target.p.value } }); token = r.token; try { localStorage.setItem(tokKey, token); } catch (_) {} location.hash = '#orders'; route(); } catch (err) { alert(err.message === 'too_many' ? 'Слишком много попыток, подожди 10 минут' : 'Неверный пароль'); } };
  }
  const tabs = cur => `<div class="tabs"><a href="#orders" class="${cur === 'orders' ? 'on' : ''}">Заказы</a><a href="#products" class="${cur === 'products' ? 'on' : ''}">Товары</a><a href="#" id="logout">Выйти</a></div>`;
  const bindLogout = () => { const l = document.getElementById('logout'); if (l) l.onclick = e => { e.preventDefault(); token = null; try { localStorage.removeItem(tokKey); } catch (_) {} route(); }; };

  async function orders(status) {
    const [{ orders }, s] = await Promise.all([A('admin/orders', { q: { status } }), A('admin/summary')]);
    const filters = ['', 'paid', 'packed', 'shipped', 'done', 'new', 'cancelled', 'expired'];
    app.innerHTML = tabs('orders') + `<div class="summary"><span>К отправке: <b>${s.to_ship}</b></span><span>Предзаказов: <b>${s.preorders}</b></span><span class="meta">доставка: ${s.yd_mode}</span>${s.yd_env_mismatch ? `<span style="color:#7a1c1c">⚠ ${s.yd_env_mismatch} заказ(ов) создано в другом режиме Яндекс Доставки</span>` : ''}</div>
      <div class="tabs">${filters.map(f => `<a href="#orders${f ? '/' + f : ''}" class="${(status || '') === f ? 'on' : ''}">${f ? ST[f] : 'все'}</a>`).join('')}</div>
      <table><tr><th>№</th><th>Дата</th><th>Что</th><th>Кто</th><th>Сумма</th><th>Статус</th></tr>
      ${orders.map(o => `<tr class="row" data-id="${o.id}"><td>${o.id}</td><td>${d(o.created_at)}</td><td>${item(o)}${dlMark(o)}</td><td>${esc(o.customer_name || (isDigital(o) ? o.customer_email : ''))}</td><td>${rub(o.total)}</td><td>${badge(o)}</td></tr>`).join('') || '<tr><td colspan="6" class="meta">пусто</td></tr>'}</table>`;
    app.querySelectorAll('tr.row').forEach(r => r.onclick = () => location.hash = '#order/' + r.dataset.id); bindLogout();
  }

  async function order(id) {
    const { order: o } = await A('admin/order', { q: { id } });
    const dig = isDigital(o);
    app.innerHTML = tabs('orders') + `<p class="meta"><a href="#orders" style="color:inherit;text-decoration:none">← заказы</a></p><h2>${o.id} ${badge(o)}</h2>
      <div class="kv"><b>Создан</b><span>${d(o.created_at)}</span><b>Товар</b><span>${item(o)} — ${rub(o.price_item)} × ${o.qty}</span>${dig ? `<b>Тип</b><span>цифровой</span><b>Скачивание</b><span>${o.downloaded_at ? `скачан ${d(o.downloaded_at)}${o.download_count ? ' · раз: ' + o.download_count : ''}` : 'не скачан'}</span>` : `<b>Доставка</b><span>${rub(o.price_delivery)} (${o.delivery_mode}${o.delivery_days ? ', ~' + o.delivery_days + ' дн.' : ''})</span>`}<b>Итого</b><span>${rub(o.total)}</span>
      <b>Покупатель</b><span>${dig ? '' : `${esc(o.customer_name)}<br><a href="tel:${esc(o.customer_phone)}">${esc(o.customer_phone)}</a> · `}<a href="mailto:${esc(o.customer_email)}">${esc(o.customer_email)}</a></span>
      ${dig ? '' : `<b>Куда</b><span>${esc(o.pvz_address || o.address_text)}</span>
      <b>Яндекс</b><span>${o.yd_request_id ? `заявка ${esc(o.yd_request_id)} ${o.yd_track_url ? `· <a href="${esc(o.yd_track_url)}" target="_blank">трек</a>` : ''}` : (o.delivery_mode === 'yandex' ? '<span class="badge">заявка не создана</span>' : 'вручную')}${o.yd_error ? `<br><small style="color:#7a1c1c">${esc(o.yd_error)}</small>` : ''}</span>`}
      <b>Платёж</b><span>${esc(o.tb_payment_id || '—')}${o.tb_refund_id ? ' · возврат ' + esc(o.tb_refund_id) : ''}${o.mail_error ? `<br><small style="color:#7a1c1c">почта: ${esc(o.mail_error)}</small>` : ''}</span></div>
      <div class="row-actions">${NEXT[o.status] && !dig ? `<button class="btn" data-act="next">→ ${NEXT[o.status]}</button>` : ''}
        ${['new', 'paid', 'packed'].includes(o.status) ? `<button class="btn ghost" data-act="cancel">Отменить${o.status !== 'new' ? ' и вернуть деньги' : ''}</button>` : ''}
        ${o.delivery_mode === 'yandex' && !o.yd_request_id && ['paid', 'packed'].includes(o.status) ? `<button class="btn ghost" data-act="retry_yd">Создать заявку Яндекс</button>` : ''}</div>
      <label class="field"><span>Заметка (при статусе «отправлен» без заявки Яндекса уходит покупателю как трек)</span><textarea id="note">${esc(o.admin_note)}</textarea></label><button class="btn ghost" id="saveNote" style="width:auto;padding:0 20px">Сохранить заметку</button>`;
    app.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
      if (b.dataset.act === 'cancel' && dig && o.status !== 'new' && o.downloaded_at && !confirm('Архив уже скачан — по оферте возврат не положен. Всё равно вернуть деньги?')) return;
      if (b.dataset.act === 'cancel' && !confirm(o.status === 'new' ? 'Отменить заказ?' : `Отменить и вернуть ${rub(o.total)} покупателю?`)) return;
      b.disabled = true; try { await A('admin/order', { method: 'POST', body: { id, action: b.dataset.act } }); order(id); } catch (e) { fail(e); b.disabled = false; } });
    app.querySelector('#saveNote').onclick = async () => { try { await A('admin/order', { method: 'POST', body: { id, action: 'note', note: app.querySelector('#note').value } }); order(id); } catch (e) { fail(e); } };
    bindLogout();
  }

  async function products() {
    const { products } = await A('admin/products');
    app.innerHTML = tabs('products') + `<p style="text-align:center"><a class="btn" href="#product/new" style="width:auto;padding:0 24px">+ Добавить товар</a></p>
      <table><tr><th>Товар</th><th>Цена</th><th>Остатки (доступно / резерв / предзаказ)</th><th>Показ</th></tr>
      ${products.map(p => `<tr class="row" data-id="${p.id}"><td>${esc(p.title)}<br><small class="meta">${p.id}</small></td><td>${rub(p.price)}</td><td>${p.kind === 'digital' ? `цифровой · ${p.file_key ? 'архив загружен' : 'архива нет'}${p.free_until && p.free_file_key && Date.parse(p.free_until) > Date.now() ? ' · бесплатно до ' + new Date(p.free_until).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : ''}` : (p.variants || []).map(v => `${v.size !== '-' ? v.size + ': ' : ''}${v.stock - v.reserved}/${v.reserved}/${v.preorder_count}`).join(' · ')}</td><td>${p.active ? 'да' : 'нет'}</td></tr>`).join('')}</table>`;
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
      <label class="field"><span>Тип</span><select name="kind"><option value="physical" ${p.kind !== 'digital' ? 'selected' : ''}>вещь</option><option value="digital" ${p.kind === 'digital' ? 'selected' : ''}>цифровой</option></select></label>
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
      <label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> <span>Показывать на сайте</span></label>${f('sort', 'Порядок (меньше — выше)', p.sort, 'number')}
      <div class="meta">Фото (первое — главное; ⇠ ⇢ порядок, × удалить)</div><div class="thumbs" id="thumbs"></div>
      <input type="file" id="file" accept="image/*" multiple ${isNew ? 'disabled title="сначала сохраните товар"' : ''}><p class="meta" id="upl"></p>
      <button class="btn" style="margin-top:20px">Сохранить</button></form>`;
    const form = app.querySelector('#pf'); const F = n => form.elements.namedItem(n); // form.id/form.title — свойства элемента, не поля
    const sizesOf = () => F('sizes').value.split(',').map(s => s.trim()).filter(Boolean);
    const renderStock = () => { const want = sizesOf().length ? sizesOf() : ['-']; const cur = Object.fromEntries([...app.querySelectorAll('#stock input')].map(i => [i.dataset.s, i.value]));
      app.querySelector('#stock').innerHTML = want.map(s => { const v = p.variants.find(x => x.size === s); return `<label><span>${s === '-' ? 'штук' : s}</span><input type="number" min="0" data-s="${esc(s)}" value="${cur[s] != null ? cur[s] : (v ? v.stock : 0)}"></label>`; }).join(''); };
    F('sizes').oninput = renderStock; renderStock();
    const renderKind = () => { const dig = F('kind').value === 'digital'; app.querySelector('#phys').style.display = dig ? 'none' : ''; app.querySelector('#dig').style.display = dig ? '' : 'none';
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
    const bodyOf = () => ({ id: F('id').value.trim(), title: F('title').value, description_md: F('description_md').value, price: +F('price').value, images: p.images, weight_g: +F('weight_g').value,
        dims_cm: { x: +F('dx').value, y: +F('dy').value, z: +F('dz').value }, sizes: sizesOf(), preorder_allowed: F('preorder_allowed').checked, preorder_ship_by: F('preorder_ship_by').value, active: F('active').checked, sort: +F('sort').value,
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
    try { if (page === 'orders') await orders(arg); else if (page === 'order') await order(arg); else if (page === 'products') await products(); else if (page === 'product') await product(arg); else location.hash = '#orders'; }
    catch (e) { fail(e); }
  }
  window.addEventListener('hashchange', route); route();
})();
