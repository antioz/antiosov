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
window.seats = n => `${n} ${plural(n, 'место', 'места', 'мест')}`;

// Электронный билет (реквизиты по приказу Минкультуры № 702) — PNG рисуется в браузере, на сервере не хранится.
window.drawTicket = async t => {
  const W = 1080, H = 1350, P = 96, serif = '"Cormorant Garamond", Georgia, serif', sans = 'Inter, system-ui, sans-serif';
  const when = evWhen(t.event_at, true), all = [t.number, t.title, when, t.venue, t.age_mark, 'ЭЛЕКТРОННЫЙ БИЛЕТ Билетов Цена Итого ИП Антиосов ₽ №'].join(' ');
  try { await Promise.all([document.fonts.load(`italic 300 100px ${serif}`, all), document.fonts.load(`italic 400 60px ${serif}`, all), document.fonts.load(`400 30px ${sans}`, all)]); } catch (e) {}
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.strokeStyle = '#0a0a0a'; x.lineWidth = 2; x.strokeRect(40, 40, W - 80, H - 80);
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
  x.font = `400 20px ${sans}`; x.fillStyle = '#888'; x.textAlign = 'center'; x.fillText('ИП Антиосов Д. А., ИНН 771402577192 · antiosov.ru', W / 2, H - 82);
  return c;
};
