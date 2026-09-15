// Cookie-баннер + Яндекс Метрика по согласию (152-ФЗ). Метрика грузится только после «ок».
// Выбор хранится в localStorage под ключом cookieConsent: 'yes' | 'no'.
(function () {
  var KEY = 'cookieConsent', ID = 112564032;
  function metrika() {
    (function (m, e, t, r, i, k, a) {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); }; m[i].l = 1 * new Date();
      for (var j = 0; j < document.scripts.length; j++) { if (document.scripts[j].src === r) { return; } }
      k = e.createElement(t), a = e.getElementsByTagName(t)[0], k.async = 1, k.src = r, a.parentNode.insertBefore(k, a);
    })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js?id=' + ID, 'ym');
    ym(ID, 'init', { ssr: true, webvisor: true, clickmap: true, ecommerce: 'dataLayer', referrer: document.referrer, url: location.href, accurateTrackBounce: true, trackLinks: true });
  }
  var choice = null; try { choice = localStorage.getItem(KEY); } catch (e) {}
  if (choice === 'yes') { metrika(); return; }
  if (choice === 'no') return;
  function show() {
    var css = '#ck{position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:560px;margin:0 auto;background:#fff;color:#0a0a0a;border:1px solid #0a0a0a;padding:16px 18px;font:14px/1.5 Inter,system-ui,-apple-system,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.08)}' +
      '#ck p{margin:0 0 12px}#ck a{color:inherit}#ck .b{display:flex;gap:10px;flex-wrap:wrap}#ck button{font:inherit;font-size:12px;letter-spacing:.2em;text-transform:uppercase;padding:10px 16px;border:1px solid #0a0a0a;background:#0a0a0a;color:#fff;cursor:pointer}#ck button.no{background:#fff;color:#0a0a0a}' +
      '@media(prefers-reduced-motion:no-preference){#ck{animation:ckin .4s ease}}@keyframes ckin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}';
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var el = document.createElement('div'); el.id = 'ck';
    el.innerHTML = '<p>Корпорации заставляют собирать куки, я ни при чём, простите. Отдайте данные, пожалуйста. <a href="/merch/privacy/">Что и зачем</a>.</p>' +
      '<div class="b"><button type="button" id="ckyes">Ладно, забирайте</button><button type="button" class="no" id="ckno">Нет</button></div>';
    document.body.appendChild(el);
    document.getElementById('ckyes').onclick = function () { try { localStorage.setItem(KEY, 'yes'); } catch (e) {} el.remove(); metrika(); };
    document.getElementById('ckno').onclick = function () { try { localStorage.setItem(KEY, 'no'); } catch (e) {} el.remove(); };
  }
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
})();
