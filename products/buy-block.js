// Блок покупки цифрового товара для вставки в любую страницу (эссе и т.п.).
// Разметка: <section class="buyblk" data-slug="na-pero" data-lead="..." data-more="/products/na-pero/" hidden></section>
// Показывается только когда товар активен, архив загружен и бесплатный период закончился.
// ?preview_buy=1 — показать принудительно (для проверки вида; заказ всё равно создаёт сервер по своим правилам).
// Если API недоступен — блок остаётся скрытым, страница не ломается.
(function () {
  var API = 'https://functions.yandexcloud.net/d4eh4qtc4a7fria6mgmt';
  var CSS = '.buyblk{max-width:640px;margin:40px auto 0;padding:0 24px;font-family:"PT Serif",Georgia,serif;color:var(--ink,#0a0a0a)}' +
    '.buyblk .bb-in::before{content:"";display:block;width:48px;border-top:1px solid var(--ink,#0a0a0a);margin:0 0 28px}' +
    '.buyblk .bb-lead{margin:0 0 24px;font-family:"Cormorant Garamond","Times New Roman",Georgia,serif;font-style:italic;font-weight:500;font-size:26px;line-height:1.25}' +
    '.buyblk .bb-card{display:flex;gap:20px;align-items:flex-start;margin:0 0 22px}' +
    '.buyblk .bb-card img{width:120px;height:120px;object-fit:cover;flex:0 0 auto;border:1px solid var(--line,#e6e6e6);display:block}' +
    '.buyblk .bb-t{margin:0 0 6px;font-size:18px;line-height:1.35}' +
    '.buyblk .bb-meta{font-family:Inter,system-ui,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--dim,#888)}' +
    '.buyblk .bb-meta a{color:var(--dim,#888);text-decoration:none;border-bottom:1px solid var(--line,#e6e6e6);transition:color .2s ease}' +
    '.buyblk .bb-meta a:hover{color:var(--ink,#0a0a0a)}' +
    '.buyblk form{font-family:Inter,system-ui,sans-serif}' +
    '.buyblk .bb-f{display:block;margin:0 0 14px}' +
    '.buyblk .bb-f span{display:block;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--dim,#888);margin-bottom:6px}' +
    '.buyblk .bb-f input{width:100%;height:44px;padding:0 12px;border:1px solid var(--line,#e6e6e6);border-radius:0;font:inherit;font-size:15px;background:#fff;color:var(--ink,#0a0a0a);outline:none;box-sizing:border-box}' +
    '.buyblk .bb-f input:focus{border-color:var(--ink,#0a0a0a)}' +
    '.buyblk .bb-f.err input{border-color:#c33}' +
    '.buyblk .bb-c{display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.4;color:#444;margin:8px 0 14px;cursor:pointer}' +
    '.buyblk .bb-c input{margin-top:2px;flex:0 0 auto}.buyblk .bb-c a{color:inherit}' +
    '.buyblk .bb-c.err{color:#c33}.buyblk .bb-c.err input{outline:1px solid #c33;outline-offset:1px}' +
    '.buyblk .bb-err{font-size:13px;padding:12px 14px;margin:12px 0;background:#fdecec;color:#7a1c1c}' +
    '.buyblk .bb-btn{display:block;width:100%;height:52px;margin-top:8px;background:var(--ink,#0a0a0a);color:#fff;border:0;border-radius:0;font:inherit;font-size:13px;letter-spacing:.25em;text-transform:uppercase;cursor:pointer}' +
    '.buyblk .bb-btn[disabled]{background:#bbb;cursor:not-allowed}' +
    '.buyblk .bb-fine{margin:12px 0 0;font-size:12px;line-height:1.5;color:var(--dim,#888)}.buyblk .bb-fine a{color:inherit}' +
    '@media(max-width:600px){.buyblk{padding:0 20px}.buyblk .bb-lead{font-size:23px}.buyblk .bb-card img{width:88px;height:88px}}';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var rub = function (n) { return Number(n).toLocaleString('ru-RU') + ' ₽'; };
  var preview = /[?&]preview_buy=1\b/.test(location.search);

  function mount(root) {
    var slug = root.getAttribute('data-slug'); if (!slug) return;
    var u = new URL(API); u.searchParams.set('a', 'product'); u.searchParams.set('s', slug);
    fetch(u).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var P = j && j.product;
      if (!P || P.kind !== 'digital') return;
      if (!preview && (P.free_active !== false || !P.active || !P.has_file)) return;
      render(root, P);
    }).catch(function () {});
  }

  function render(root, P) {
    if (!document.getElementById('buyblk-css')) { var st = document.createElement('style'); st.id = 'buyblk-css'; st.textContent = CSS; document.head.appendChild(st); }
    var lead = root.getAttribute('data-lead') || '';
    var more = root.getAttribute('data-more') || ('/products/' + encodeURIComponent(P.id) + '/');
    var img = (P.image_urls || [])[0];
    var label = 'Купить за ' + rub(P.price);
    root.innerHTML = '<div class="bb-in">' +
      (lead ? '<p class="bb-lead">' + esc(lead) + '</p>' : '') +
      '<div class="bb-card">' + (img ? '<a href="' + esc(more) + '"><img src="' + esc(img) + '" alt="' + esc(P.title) + '" loading="lazy"></a>' : '') +
      '<div><p class="bb-t">' + esc(P.title) + '</p><div class="bb-meta"><a href="' + esc(more) + '">подробнее</a></div></div></div>' +
      '<form novalidate>' +
      '<label class="bb-f" data-f="email"><span>E-mail — пришлю туда ссылку на скачивание</span><input name="email" type="email" autocomplete="email" required></label>' +
      '<label class="bb-c" data-f="offer"><input type="checkbox" name="offer" required> <span>Принимаю условия <a href="/offer/" target="_blank">оферты</a></span></label>' +
      '<label class="bb-c" data-f="consent"><input type="checkbox" name="consent" required> <span>Даю <a href="/consent/" target="_blank">согласие на обработку персональных данных</a></span></label>' +
      '<div class="bb-err" style="display:none"></div>' +
      '<button class="bb-btn" type="submit">' + esc(label) + '</button>' +
      '<p class="bb-fine">Это цифровой товар: после оплаты архив можно скачивать сколько угодно раз. Вернуть деньги можно, пока архив ни разу не скачан — подробно в <a href="/offer/" target="_blank">оферте</a>. <a href="/merch/privacy/" target="_blank">Политика обработки персональных данных</a>.</p>' +
      '</form></div>';
    root.hidden = false;

    var $ = function (s) { return root.querySelector(s); };
    var form = $('form'), btn = $('.bb-btn'), errEl = $('.bb-err'), busy = false;
    var FIELD_RU = { email: 'e-mail', consent: 'согласие', offer: 'оферта', product_id: 'товар' };
    var mark = function (f) { var el = root.querySelector('[data-f="' + f + '"]'); if (el) el.classList.add('err'); };
    var showErr = function (m) { errEl.textContent = m; errEl.style.display = ''; };
    form.onsubmit = function (e) {
      e.preventDefault(); if (busy) return;
      var f = new FormData(form);
      root.querySelectorAll('.err').forEach(function (x) { x.classList.remove('err'); }); errEl.style.display = 'none';
      var body = { product_id: P.id, email: String(f.get('email') || '').trim(), offer: f.get('offer') === 'on', consent: f.get('consent') === 'on' };
      var bad = [];
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) bad.push(['email', 'Проверьте e-mail — на него придёт ссылка.']);
      if (!body.offer) bad.push(['offer', 'Нужно принять условия оферты.']);
      if (!body.consent) bad.push(['consent', 'Нужно согласие на обработку данных.']);
      if (bad.length) { bad.forEach(function (b) { mark(b[0]); }); showErr(bad[0][1]); return; }
      busy = true; btn.disabled = true; btn.textContent = 'Секунду…';
      var u = new URL(API); u.searchParams.set('a', 'order');
      fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return { error: 'bad_json' }; }).then(function (j) { if (!r.ok) { var er = new Error(j.error || 'error'); er.data = j; throw er; } return j; }); })
        .then(function (r) { if (!r.paymentUrl) throw new Error('error'); location.href = r.paymentUrl; })
        .catch(function (err) {
          busy = false; btn.disabled = false; btn.textContent = label;
          var field = err.data && err.data.field;
          var m = {
            no_file: 'Товар временно недоступен — архив ещё не загружен. Загляните чуть позже.',
            validation: 'Проверьте поле: ' + (FIELD_RU[field] || 'данные формы') + '.',
            payment_init: 'Платёжная система не отвечает, попробуйте через минуту.',
            no_product: 'Этого продукта больше нет.',
            bad_json: 'Магазин временно недоступен, попробуйте через минуту.'
          }[err.message] || 'Что-то пошло не так, попробуйте ещё раз.';
          if (field) mark(field);
          showErr(m);
        });
    };
  }

  function init() { document.querySelectorAll('.buyblk[data-slug]').forEach(mount); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
