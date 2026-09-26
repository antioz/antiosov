// Диплом практикума «Как потратить 100 рублей» — PNG рисуется в браузере, на сервере не хранится.
// Нарочно уродливый, «Word 2003»: кислотная рамка, WordArt, клипарт. Только системные шрифты — чтобы canvas не рисовал до их загрузки.
// Печать — шуточная, не имитирует печать ИП: ни ОГРНИП, ни ИНН, ни герба.
window.drawDiploma = (c, d) => {
  const W = 1600, H = 1130; c.width = W; c.height = H; const x = c.getContext('2d');
  const BLACK = '"Arial Black", "Arial Bold", Impact, "Helvetica Neue", Arial, sans-serif';
  const COMIC = '"Comic Sans MS", "Comic Sans", "Chalkboard SE", "Comic Neue", "Segoe Print", cursive, sans-serif';
  const TIMES = '"Times New Roman", Times, Georgia, serif', GEO = 'Georgia, "Times New Roman", serif', ARIAL = 'Arial, Helvetica, sans-serif';
  const name = String(d.name || '').replace(/\s+/g, ' ').trim() || 'Без Имени';
  const date = (() => { const t = d.date ? new Date(d.date) : new Date(); return isNaN(t) ? '' : t.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' }).replace(/\s*г\.?$/, '') + ' г.'; })();
  // детерминированный «шум» от номера — чтобы один и тот же диплом всегда рисовался одинаково
  let seed = [...String(d.number || name)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) || 1;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) / 16777216; };

  // фон: «градиентная заливка из трёх цветов»
  let g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#fffb8f'); g.addColorStop(.45, '#ffd1f0'); g.addColorStop(1, '#9ff7ff');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // водяные «лучи» от центра
  x.save(); x.translate(W / 2, H / 2); x.globalAlpha = .13;
  for (let i = 0; i < 36; i++) { x.rotate(Math.PI / 18); x.fillStyle = i % 2 ? '#ff00cc' : '#00d0ff'; x.beginPath(); x.moveTo(0, 0); x.lineTo(1200, -70); x.lineTo(1200, 70); x.fill(); }
  x.restore();

  // рамка-орнамент: радужная полоса + бусины + двойная «золотая» линия
  const B = 64;
  g = x.createLinearGradient(0, 0, W, 0); ['#ff0000', '#ff9900', '#ffff00', '#33ff00', '#00ffff', '#3300ff', '#ff00ff'].forEach((col, i, a) => g.addColorStop(i / (a.length - 1), col));
  x.fillStyle = g; x.fillRect(0, 0, W, B); x.fillRect(0, H - B, W, B); x.fillRect(0, 0, B, H); x.fillRect(W - B, 0, B, H);
  const bead = (px, py, i) => { x.save(); x.translate(px, py); x.rotate(Math.PI / 4); x.fillStyle = i % 2 ? '#ff00aa' : '#00ff66'; x.strokeStyle = '#1b0066'; x.lineWidth = 3; x.fillRect(-11, -11, 22, 22); x.strokeRect(-11, -11, 22, 22); x.restore(); };
  let i = 0; for (let px = B / 2; px < W; px += 48) { bead(px, B / 2, i); bead(px, H - B / 2, i + 1); i++; }
  for (let py = B / 2 + 48; py < H - B / 2 - 30; py += 48) { bead(B / 2, py, i); bead(W - B / 2, py, i + 1); i++; }
  x.strokeStyle = '#1b0066'; x.lineWidth = 4; x.strokeRect(B, B, W - 2 * B, H - 2 * B);
  x.strokeStyle = '#d4a017'; x.lineWidth = 8; x.strokeRect(B + 10, B + 10, W - 2 * B - 20, H - 2 * B - 20);
  x.save(); x.strokeStyle = '#ff00cc'; x.lineWidth = 3; x.setLineDash([18, 8, 4, 8]); x.strokeRect(B + 22, B + 22, W - 2 * B - 44, H - 2 * B - 44); x.restore();

  // клипарт-звёзды
  const star = (cx, cy, r, rot, fill) => { x.save(); x.translate(cx, cy); x.rotate(rot); x.beginPath();
    for (let k = 0; k < 10; k++) { const rr = k % 2 ? r * .45 : r, a = k * Math.PI / 5 - Math.PI / 2; x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    x.closePath(); x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowOffsetX = 5; x.shadowOffsetY = 5; x.fillStyle = fill; x.fill(); x.shadowColor = 'transparent'; x.strokeStyle = '#cc0000'; x.lineWidth = 3; x.stroke(); x.restore(); };
  [[150, 150, 44, .2], [W - 150, 150, 44, -.3], [128, H - 330, 30, .5], [W - 128, H - 345, 30, -.1], [230, 200, 20, .9], [W - 230, 205, 22, .4]]
    .forEach(([sx, sy, r, rot], k) => star(sx, sy, r, rot, k % 2 ? '#ffee00' : '#ffcc00'));

  // медали-розетки по бокам заголовка
  const rosette = (cx, cy, r) => { x.save(); x.translate(cx, cy);
    [[-.35, '#0044ff'], [.35, '#ff0033']].forEach(([a, col]) => { x.save(); x.rotate(a); x.fillStyle = col; x.beginPath(); x.moveTo(-r * .35, r * .4); x.lineTo(-r * .45, r * 1.9); x.lineTo(-r * .1, r * 1.6); x.lineTo(r * .2, r * 1.95); x.lineTo(r * .3, r * .4); x.fill(); x.restore(); });
    x.beginPath(); for (let k = 0; k < 48; k++) { const a = k * Math.PI / 24, rr = k % 2 ? r : r * .86; x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } x.closePath();
    const rg = x.createRadialGradient(-r * .3, -r * .3, 4, 0, 0, r); rg.addColorStop(0, '#fff8b0'); rg.addColorStop(.6, '#ffc400'); rg.addColorStop(1, '#b36b00'); x.fillStyle = rg; x.fill(); x.strokeStyle = '#7a4a00'; x.lineWidth = 2; x.stroke();
    x.fillStyle = '#b30000'; x.font = `900 ${r * .62}px ${BLACK}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('№1', 0, 2); x.restore(); };
  rosette(270, 300, 58); rosette(W - 270, 300, 58);

  // WordArt «ДИПЛОМ» по дуге: радуга + синяя обводка + тень
  x.save(); const T = 'ДИПЛОМ', TS = 158; x.font = `900 ${TS}px ${BLACK}`; x.textBaseline = 'alphabetic'; x.textAlign = 'center';
  const ws = [...T].map(ch => x.measureText(ch).width + 10), tw = ws.reduce((a, b) => a + b, 0), R = 1500, cy0 = 255 + R;
  let acc = -tw / 2;
  const tg = x.createLinearGradient(0, -118, 0, 4); tg.addColorStop(0, '#ff0000'); tg.addColorStop(.25, '#ffcc00'); tg.addColorStop(.5, '#33dd00'); tg.addColorStop(.75, '#00aaff'); tg.addColorStop(1, '#cc00ff');
  [...T].forEach((ch, k) => { const mid = acc + ws[k] / 2; acc += ws[k]; const a = mid / R;
    x.save(); x.translate(W / 2 + Math.sin(a) * R, cy0 - Math.cos(a) * R); x.rotate(a);
    x.fillStyle = 'rgba(40,0,60,.55)'; x.fillText(ch, 12, 12);
    x.lineJoin = 'round'; x.strokeStyle = '#0a0a8a'; x.lineWidth = 14; x.strokeText(ch, 0, 0);
    x.strokeStyle = '#ffffff'; x.lineWidth = 5; x.strokeText(ch, 0, 0);
    x.fillStyle = tg; x.fillText(ch, 0, 0); x.restore(); });
  x.restore();

  // подзаголовок
  x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  x.font = `italic bold 40px ${GEO}`; x.fillStyle = '#990033'; x.strokeStyle = '#ffffff'; x.lineWidth = 6; x.lineJoin = 'round';
  [['об успешном прохождении практикума', 364], ['«Как потратить 100 рублей»', 410]].forEach(([s, sy]) => { x.strokeText(s, W / 2, sy); x.fillText(s, W / 2, sy); });

  const TW = 1220; // ширина текстового поля
  const wrap = (s, max) => { const out = []; let cur = ''; for (const w of s.split(' ')) { const tr = cur ? cur + ' ' + w : w; if (x.measureText(tr).width > max && cur) { out.push(cur); cur = w; } else cur = tr; } if (cur) out.push(cur); return out; };

  x.font = `italic 44px ${TIMES}`; x.fillStyle = '#1b0066'; x.fillText('Сим удостоверяется, что', W / 2, 474);

  // имя: крупно, подбираем кегль; не влезает и при 60px — в две строки
  const nameFont = px => `bold ${px}px ${COMIC}`;
  const fit = (s, max, hi, lo) => { let px = hi; x.font = nameFont(px); while (px > lo && x.measureText(s).width > max) { px -= 2; x.font = nameFont(px); } return px; };
  let lines = [name], px = fit(name, TW, 104, 60);
  if (x.measureText(name).width > TW && name.includes(' ')) {
    const words = name.split(' '); let best = null;
    for (let k = 1; k < words.length; k++) { const a = words.slice(0, k).join(' '), b = words.slice(k).join(' '); x.font = nameFont(100); const m = Math.max(x.measureText(a).width, x.measureText(b).width); if (!best || m < best.m) best = { m, l: [a, b] }; }
    lines = best.l; px = Math.min(fit(lines[0], TW, 76, 20), fit(lines[1], TW, 76, 20));
  } else if (x.measureText(name).width > TW) px = fit(name, TW, 60, 16);
  x.font = nameFont(px);
  const lh = px * 1.08; let y = 474 + 24 + px * .95;
  lines.forEach(l => {
    const ng = x.createLinearGradient(0, y - px, 0, y); ng.addColorStop(0, '#ff00cc'); ng.addColorStop(1, '#6600cc');
    x.fillStyle = 'rgba(0,0,0,.35)'; x.fillText(l, W / 2 + 5, y + 5);
    x.strokeStyle = '#ffff00'; x.lineWidth = Math.max(4, px / 9); x.strokeText(l, W / 2, y);
    x.fillStyle = ng; x.fillText(l, W / 2, y); y += lh; });
  y += 44 - lh + 18;

  // основной текст
  x.font = `38px ${TIMES}`; x.fillStyle = '#1b0066';
  const body = 'прошёл(а) практикум «Как потратить 100 рублей», успешно потратил(а) 100 рублей и отныне может считаться квалифицированным(ой) тратильщиком(цей) 100 рублей.';
  for (const l of wrap(body, TW)) { x.fillText(l, W / 2, y); y += 47; }

  // подпись руководителя
  const sx = 360, lineY = 975;
  x.font = `italic 30px ${TIMES}`; x.fillStyle = '#1b0066'; x.fillText('Руководитель практикума', sx, lineY - 100);
  x.strokeStyle = '#1b0066'; x.lineWidth = 2; x.beginPath(); x.moveTo(sx - 190, lineY); x.lineTo(sx + 190, lineY); x.stroke();
  x.font = `28px ${TIMES}`; x.fillText('Д. Антиосов', sx, lineY + 38);
  x.save(); x.translate(sx - 150, lineY - 30); x.rotate(-.08); x.strokeStyle = '#0b1e8f'; x.lineWidth = 3.2; x.lineCap = 'round'; x.lineJoin = 'round';
  x.beginPath(); // «А»
  x.moveTo(0, 30); x.bezierCurveTo(8, 0, 22, -52, 34, -58); x.bezierCurveTo(40, -40, 44, 0, 50, 30); x.moveTo(12, 0); x.bezierCurveTo(26, -6, 44, -6, 64, -10);
  // «нтиосов» — петли и горбы разной высоты
  let cx = 64, cyy = -10; const humps = [[18, -26], [14, -18], [22, -34], [12, -14], [26, -38], [16, -20], [20, -30], [14, -16], [24, -28]];
  humps.forEach(([w, h], k) => { const nx = cx + w + rnd() * 6; if (k % 3 === 1) { x.bezierCurveTo(cx + w * 1.2, cyy + h, cx - w * .3, cyy + h, nx, cyy + 4); } else x.bezierCurveTo(cx + w * .2, cyy + h, cx + w * .8, cyy + h, nx, cyy + 2 + rnd() * 6); cx = nx; cyy = -4 - rnd() * 8; });
  // размашистый росчерк под фамилией, обратно влево и вверх
  x.bezierCurveTo(cx + 60, cyy + 10, cx + 40, 44, cx - 60, 40); x.bezierCurveTo(cx - 160, 36, -40, 50, -20, 20); x.bezierCurveTo(-4, -4, 70, 6, 120, 18);
  x.stroke(); x.restore();

  // дата и номер
  x.font = `26px ${ARIAL}`; x.fillStyle = '#1b0066';
  x.fillText('Дата выдачи: ' + date, W / 2, lineY - 12); x.font = `bold 28px ${ARIAL}`; x.fillStyle = '#b30000'; x.fillText('№ ' + (d.number || '—'), W / 2, lineY + 32);

  // печать — синими чернилами, кривая и полупрозрачная
  const S = 320, pc = document.createElement('canvas'); pc.width = pc.height = S; const p = pc.getContext('2d'), r = 138, INK = '#1d3fc4';
  p.translate(S / 2, S / 2); p.strokeStyle = INK; p.fillStyle = INK;
  p.lineWidth = 6; p.beginPath(); p.arc(0, 0, r, 0, 2 * Math.PI); p.stroke();
  p.lineWidth = 2.5; p.beginPath(); p.arc(0, 0, r - 12, 0, 2 * Math.PI); p.stroke();
  p.lineWidth = 3; p.beginPath(); p.arc(0, 0, r - 50, 0, 2 * Math.PI); p.stroke();
  const ring = 'ПРАКТИКУМ «КАК ПОТРАТИТЬ 100 РУБЛЕЙ» • ДМИТРИЙ АНТИОСОВ • ';
  p.font = `bold 21px ${ARIAL}`; p.textAlign = 'center'; p.textBaseline = 'middle';
  const cw = [...ring].map(ch => p.measureText(ch).width), tot = cw.reduce((a, b) => a + b, 0); let ang = -Math.PI / 2;
  [...ring].forEach((ch, k) => { const da = cw[k] / tot * 2 * Math.PI; p.save(); p.rotate(ang + da / 2 + Math.PI / 2); p.fillText(ch, 0, -(r - 31)); p.restore(); ang += da; });
  p.font = `900 48px ${BLACK}`; p.fillText('100 ₽', 0, -6);
  p.font = `bold 20px ${ARIAL}`; p.fillText('ТРАТИЛЬЩИК', 0, 40);
  p.globalCompositeOperation = 'destination-out'; // непропечатка
  for (let k = 0; k < 260; k++) { p.globalAlpha = .25 + rnd() * .6; p.beginPath(); p.arc((rnd() - .5) * S, (rnd() - .5) * S, rnd() * 5 + 1, 0, 2 * Math.PI); p.fill(); }
  p.globalAlpha = .5; p.beginPath(); p.arc(60, 70, 120, 0, 2 * Math.PI); p.fill();
  x.save(); x.globalAlpha = .82; x.translate(W - 350, 900); x.rotate(-.21); x.drawImage(pc, -S / 2, -S / 2); x.restore();

  return c;
};
