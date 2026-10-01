// Общее для страниц «Продуктов». Текст «Как установить» утверждён владельцем — менять только по его слову.
window.HOWTO = `<div class="howto"><h3>Как установить</h3><ol>
  <li>Скачайте архив.</li>
  <li>Откройте чат со своим ИИ: Claude, ChatGPT, Codex или любым другим.</li>
  <li>Приложите архив и напишите: «Установи этот скилл».</li></ol>
  <p>ИИ установит его сам или подскажет, куда нажать. Если скиллы он не поддерживает, напишите: «Прочитай SKILL.md и работай по нему».</p></div>`;

// Обратный отсчёт до iso с поправкой на часы сервера (skew = серверное время − локальное). Время решает сервер, таймер только показывает.
window.countdown = (iso, skew) => { const ms = Math.max(0, Date.parse(iso) - (Date.now() + skew)), z = n => String(n).padStart(2, '0');
  const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4), sec = Math.floor(ms % 6e4 / 1e3);
  return { ms, text: (d ? d + ' д ' : '') + z(h) + ':' + z(m) + ':' + z(sec), short: d ? `${d} д ${h} ч` : h ? `${h} ч ${m} мин` : `${m} мин` }; };

// Мероприятия: время хранится в UTC, показывается по Москве.
window.evWhen = (iso, year) => { if (!iso) return ''; const d = new Date(iso), o = { timeZone: 'Europe/Moscow' };
  return d.toLocaleDateString('ru-RU', { ...o, day: 'numeric', month: 'long', ...(year ? { year: 'numeric' } : {}) }).replace(/\s*г\.$/, '') + ', ' + d.toLocaleTimeString('ru-RU', { ...o, hour: '2-digit', minute: '2-digit' }); };
window.plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };
// Потолок счётчика мест по просьбе владельца: показываем не больше N, пока реально свободно больше; дальше — настоящий остаток. Продажу не ограничивает.
window.SEATS_CAP = { otdokhni: 41 };
window.shownLeft = p => { const l = Math.max(0, p.left | 0), c = SEATS_CAP[p.id]; return c ? Math.min(l, c) : l; };
window.seats = n => `${n} ${plural(n, 'место', 'места', 'мест')}`;

// QR на билете ведёт на спрятанную страницу-открытку (одна на всех, noindex, ссылок на неё нет).
window.TICKET_QR_URL = 'https://antiosov.ru/products/obnimemsya-6be75605/';

// Электронный билет (реквизиты по приказу Минкультуры № 702) — рисуется в браузере, на сервере не хранится; PDF — ticketPdf ниже.
window.drawTicket = async t => {
  // Картинка билета (обычно афиша) — products/<id>/ticket.jpg на том же домене, иначе canvas «испачкается» и PDF не выгрузится. Нет файла — билет без картинки.
  const art = t.product ? await new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = `/products/${encodeURIComponent(t.product)}/ticket.jpg`; }) : null;
  const AW = 1000, off = art ? Math.round(AW * art.naturalHeight / art.naturalWidth) : 0;
  const W = 1080, H = 1650 + off, P = 96, serif = '"Cormorant Garamond", Georgia, serif', sans = 'Inter, system-ui, sans-serif';
  const when = evWhen(t.event_at, true), all = [t.number, t.title, when, t.venue, t.age_mark, 'ЭЛЕКТРОННЫЙ БИЛЕТ Билетов Цена Итого ИП Антиосов ₽ №'].join(' ');
  try { await Promise.all([document.fonts.load(`italic 300 100px ${serif}`, all), document.fonts.load(`italic 400 60px ${serif}`, all), document.fonts.load(`400 30px ${sans}`, all)]); } catch (e) {}
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); if (art) x.drawImage(art, 40, 40, AW, off); x.strokeStyle = '#0a0a0a'; x.lineWidth = 2; x.strokeRect(40, 40, W - 80, H - 80);
  if (art) { x.beginPath(); x.moveTo(40, 40 + off); x.lineTo(W - 40, 40 + off); x.stroke(); x.translate(0, off); } // дальше — прежняя вёрстка билета под картинкой
  x.textBaseline = 'alphabetic'; x.fillStyle = '#0a0a0a';
  const spaced = (s, cx, y, sp) => { const w = [...s].reduce((a, ch) => a + x.measureText(ch).width + sp, -sp); let px = cx - w / 2; x.textAlign = 'left'; for (const ch of s) { x.fillText(ch, px, y); px += x.measureText(ch).width + sp; } };
  const wrap = (s, max, lines) => { const out = []; let cur = ''; for (const w of String(s || '').split(/\s+/).filter(Boolean)) { const tr = cur ? cur + ' ' + w : w; if (x.measureText(tr).width > max && cur) { out.push(cur); cur = w; } else cur = tr; } if (cur) out.push(cur);
    if (out.length > lines) { out.length = lines; let l = out[lines - 1]; while (l && x.measureText(l + '…').width > max) l = l.slice(0, -1); out[lines - 1] = l.trim() + '…'; } return out; };
  const label = (s, y) => { x.font = `400 20px ${sans}`; x.fillStyle = '#888'; spaced(s, W / 2, y, 6); x.fillStyle = '#0a0a0a'; };
  const line = (y, dash) => { x.save(); x.strokeStyle = dash ? '#bbb' : '#e6e6e6'; x.lineWidth = 2; if (dash) x.setLineDash([10, 10]); x.beginPath(); x.moveTo(P, y); x.lineTo(W - P, y); x.stroke(); x.restore(); };
  x.font = `400 24px ${sans}`; spaced('ЭЛЕКТРОННЫЙ БИЛЕТ', W / 2, 150, 11);
  x.font = `italic 300 112px ${serif}`; x.textAlign = 'center'; x.fillText('№ ' + t.number, W / 2, 275);
  line(335);
  x.font = `italic 400 66px ${serif}`; let y = 420; for (const l of wrap(t.title, W - 2 * P, 3)) { x.textAlign = 'center'; x.fillText(l, W / 2, y); y += 70; }
  y += 30; label('ДАТА И ВРЕМЯ (МСК)', y); x.font = `400 36px ${sans}`; x.textAlign = 'center'; x.fillText(when, W / 2, y + 52); y += 120;
  if (t.venue) { label('МЕСТО', y); x.font = `400 30px ${sans}`; y += 48; for (const l of wrap(t.venue, W - 2 * P, 3)) { x.textAlign = 'center'; x.fillText(l, W / 2, y); y += 42; } y += 36; }
  if (t.age_mark) { label('ВОЗРАСТ', y); x.font = `italic 400 52px ${serif}`; x.textAlign = 'center'; x.fillText(t.age_mark, W / 2, y + 56); y += 110; }
  const by = Math.max(y + 10, 1000); line(by, true);
  const cols = [['БИЛЕТОВ', String(t.qty)], ['ЦЕНА БИЛЕТА', rub(t.price_item)], ['ИТОГО', rub(t.total)]];
  cols.forEach(([k, v], i) => { const cx = P + (W - 2 * P) * (i + .5) / 3; x.font = `400 18px ${sans}`; x.fillStyle = '#888'; spaced(k, cx, by + 70, 5); x.fillStyle = '#0a0a0a'; x.font = `italic 400 54px ${serif}`; x.textAlign = 'center'; x.fillText(v, cx, by + 135); });
  if (window.qrcode) { const q = qrcode(0, 'M'); q.addData(TICKET_QR_URL); q.make(); const n = q.getModuleCount(), m = Math.floor(260 / n), qs = m * n, qx = (W - qs) / 2, qy = by + 200;
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) x.fillRect(qx + k * m, qy + r * m, m, m);
    label('НАВЕДИТЕ КАМЕРУ', qy + qs + 50); }
  x.font = `400 20px ${sans}`; x.fillStyle = '#888'; x.textAlign = 'center'; x.fillText('ИП Антиосов Д. А., ИНН 771402577192 · antiosov.ru', W / 2, H - off - 82);
  return c;
};

// Билет в PDF: ширина 180 мм, высота по пропорции картинки, картинка во всю страницу.
window.ticketPdf = (c, number) => { const { jsPDF } = window.jspdf, w = 180, h = w * c.height / c.width;
  const d = new jsPDF({ unit: 'mm', format: [w, h], orientation: 'portrait' }); d.setProperties({ title: 'Электронный билет № ' + number });
  d.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, w, h); return d; };

// Галерея карточки: лента со свайпом (scroll-snap), стрелки и счётчик, миниатюры под ней, по клику — фото на весь экран.
// Фото разных пропорций (обложка, скриншоты, наброски) показываются целиком, без обрезки.
window.galleryHtml = (urls, title) => !urls.length ? '<div class="gallery"><img alt=""></div>' : `<div class="gal">
  <div class="gallery fit" tabindex="0">${urls.map((u, i) => `<img src="${esc(u)}" alt="${esc(title)}, фото ${i + 1}" data-i="${i}"${i ? ' loading="lazy"' : ''}>`).join('')}</div>
  ${urls.length > 1 ? `<button type="button" class="gnav prev" aria-label="предыдущее фото">‹</button><button type="button" class="gnav next" aria-label="следующее фото">›</button>
  <div class="gcount"><span class="gi">1</span> / ${urls.length}</div>
  <div class="thumbs">${urls.map((u, i) => `<button type="button" data-i="${i}" class="${i ? '' : 'on'}" aria-label="фото ${i + 1}"><img src="${esc(u)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}</div>`;
window.bindGallery = (root, urls) => {
  const g = root.querySelector('.gallery.fit'); if (!g) return;
  // Позиции кадров берём из вёрстки (между фото есть зазор), а не как i × ширина.
  const n = urls.length, ims = [...g.querySelectorAll('img')], x = k => ims[k].offsetLeft - ims[0].offsetLeft;
  const cur = () => ims.reduce((best, _, k) => Math.abs(x(k) - g.scrollLeft) < Math.abs(x(best) - g.scrollLeft) ? k : best, 0);
  const go = i => g.scrollTo({ left: x(Math.max(0, Math.min(n - 1, i))), behavior: 'smooth' });
  const mark = () => { const i = cur(); const gi = root.querySelector('.gi'); if (gi) gi.textContent = i + 1;
    root.querySelectorAll('.thumbs button').forEach((b, k) => b.classList.toggle('on', k === i)); };
  let t; g.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(mark, 60); }, { passive: true });
  root.querySelectorAll('.thumbs button').forEach(b => b.onclick = () => go(+b.dataset.i));
  const pv = root.querySelector('.gnav.prev'), nx = root.querySelector('.gnav.next');
  if (pv) pv.onclick = () => go(cur() - 1); if (nx) nx.onclick = () => go(cur() + 1);
  g.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') go(cur() - 1); if (e.key === 'ArrowRight') go(cur() + 1); });
  // Полноэкранный просмотр
  g.querySelectorAll('img').forEach(im => im.onclick = () => open(+im.dataset.i));
  function open(i) {
    const lb = document.createElement('div'); lb.className = 'lb';
    lb.innerHTML = `<img alt=""><button type="button" class="x" aria-label="закрыть">×</button>${n > 1 ? '<button type="button" class="gnav prev" aria-label="предыдущее">‹</button><button type="button" class="gnav next" aria-label="следующее">›</button>' : ''}`;
    const im = lb.querySelector('img'), show = k => { i = (k + n) % n; im.src = urls[i]; };
    const close = () => { lb.remove(); document.removeEventListener('keydown', key); document.body.style.overflow = ''; go(i); };
    const key = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') show(i - 1); if (e.key === 'ArrowRight') show(i + 1); };
    lb.onclick = e => { if (e.target === lb || e.target.classList.contains('x')) close(); };
    if (n > 1) { lb.querySelector('.prev').onclick = () => show(i - 1); lb.querySelector('.next').onclick = () => show(i + 1); }
    let x0 = null; lb.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) show(i + (dx < 0 ? 1 : -1)); x0 = null; });
    document.addEventListener('keydown', key); document.body.style.overflow = 'hidden'; show(i); document.body.appendChild(lb);
  }
};
