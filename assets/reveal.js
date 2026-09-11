// Мягкое проявление: элементы с классом .r получают .in при попадании в вьюпорт.
// Порядок каскада задаётся через style="--i: N" (задержка N*70ms).
(function () {
  var els = document.querySelectorAll('.r');
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    els.forEach(function (el) { el.classList.add('in'); }); return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.08, rootMargin: '0px 0px -5% 0px' });
  els.forEach(function (el) { io.observe(el); });
})();
