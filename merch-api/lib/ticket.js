// Электронный билет (мероприятие) в PDF для письма покупателю. Дублирует браузерный билет
// (products/products.js drawTicket): афиша сверху, № заказа, название, дата/место/возраст, суммы, QR, реквизиты ИП.
// Шрифты — вариативные TTF (OFL), в статичные инстансы их «запекает» fontkit через сабсет
// (pdfkit не принимает VariationFont напрямую). Афиша — products/<id>/ticket.jpg с сайта (тот же домен не нужен: pdfkit ест JPEG из буфера).
// Размеры JPEG из SOF-маркера (без сторонних зависимостей).
function jpegSize(buf) { let p = 2;
  while (p + 9 < buf.length) { if (buf[p] !== 0xff) { p++; continue; } const m = buf[p + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(p + 5), w: buf.readUInt16BE(p + 7) };
    p += 2 + buf.readUInt16BE(p + 2); }
  return null; }

const path = require('path'); const https = require('https');
const PDFDocument = require('pdfkit'); const QRCode = require('qrcode');
const ENV = process.env;

const FONTS = path.join(__dirname, '..', 'fonts');
// Статичные сабсеты TTF (OFL): Cormorant Garamond Italic запечён из вариативного fonttools
// (wght 300/400), Lato Regular — статик; обрезаны pyftsubset до кириллицы/латиницы/№/₽.
const SERIF_L = path.join(FONTS, 'CormorantGaramond-LightItalic.ttf'); // № и крупные значения
const SERIF_R = path.join(FONTS, 'CormorantGaramond-Italic.ttf'); // название, итоги
const SANS = path.join(FONTS, 'Lato-Regular.ttf'); // подписи и мелкий текст
const SITE = () => ENV.SITE || 'https://antiosov.ru';
const qrUrl = pid => `${SITE()}/products/${encodeURIComponent(pid)}/`;

const rub = n => `${Number(n).toLocaleString('ru-RU')} ₽`;
// Дата и время начала по Москве, как в evWhen на клиенте: «27 ноября 2026 г., 20:00».
const when = iso => {
  if (!iso) return '';
  const d = new Date(iso), o = { timeZone: 'Europe/Moscow' };
  const date = new Intl.DateTimeFormat('ru-RU', { ...o, day: 'numeric', month: 'long', year: 'numeric' }).format(d).replace(/\s*г\.$/, '');
  const time = new Intl.DateTimeFormat('ru-RU', { ...o, hour: '2-digit', minute: '2-digit' }).format(d);
  return `${date}, ${time}`;
};
const fetchBuf = url => new Promise((ok, no) => { const t = setTimeout(() => no(new Error('timeout')), 8000);
  https.get(url, { headers: { 'user-agent': 'merch-api/ticket' } }, r => { if (r.statusCode !== 200) { clearTimeout(t); r.resume(); return ok(null); } const b = [];
    r.on('data', c => b.push(c)); r.on('end', () => { clearTimeout(t); ok(Buffer.concat(b)); }); }).on('error', e => { clearTimeout(t); no(e); }); });

// Перенос строк по ширине (как wrap на клиенте), max — в пунктах.
function wrap(doc, s, max, lines) { const out = []; let cur = '';
  for (const w of String(s || '').split(/\s+/).filter(Boolean)) { const tr = cur ? cur + ' ' + w : w;
    if (doc.widthOfString(tr) > max && cur) { out.push(cur); cur = w; } else cur = tr; }
  if (cur) out.push(cur);
  if (out.length > lines) { out.length = lines; let l = out[lines - 1]; while (l && doc.widthOfString(l + '…') > max) l = l.slice(0, -1); out[lines - 1] = l.trim() + '…'; }
  return out; }
// Подпись с разрядкой по центру (как spaced на клиенте).
const centered = (doc, s, y, size, spacing) => doc.fontSize(size).text(s, 0, y, { align: 'center', width: doc.page.width, characterSpacing: spacing, lineBreak: false });

// t — тот же объект, что в status.ticket: {number, product, title, event_at, venue, age_mark, qty, price_item, total}.
async function build(t) {
  const serifL = SERIF_L, serifR = SERIF_R, sans = SANS;
  // Афиша (обычно вертикальная): во всю ширину 500 pt, высота по пропорции — как на клиенте.
  const art = await fetchBuf(`${SITE()}/products/${encodeURIComponent(t.product)}/ticket.jpg`).catch(() => null);
  const AW = 500;
  const size = art && jpegSize(art); // реальные пропорции афиши — как naturalHeight/naturalWidth на клиенте
  const off = size ? Math.round(AW * size.h / size.w) : 0;
  const W = 540, H = 825 + off, P = 48;
  const doc = new PDFDocument({ size: [W, H], margin: 0, info: { Title: `Электронный билет № ${t.number}` } });
  const chunks = []; doc.on('data', c => chunks.push(c));
  const done = new Promise(ok => doc.on('end', () => ok(Buffer.concat(chunks))));
  doc.rect(0, 0, W, H).fill('#ffffff');
  if (art) { doc.image(art, 20, 20, { width: AW, height: off }); doc.moveTo(20, 20 + off).lineTo(W - 20, 20 + off).lineWidth(1).stroke('#0a0a0a'); }
  doc.rect(20, 20, W - 40, H - 40).lineWidth(1).stroke('#0a0a0a');
  const dy = off; // всё ниже афиши сдвинуто на её высоту — как translate на клиенте
  doc.fill('#0a0a0a');
  centered(doc.font(sans), 'ЭЛЕКТРОННЫЙ БИЛЕТ', dy + 62, 12, 5.5);
  centered(doc.font(serifL), `№ ${t.number}`, dy + 85, 56);
  doc.moveTo(P, dy + 167).lineTo(W - P, dy + 167).lineWidth(1).stroke('#e6e6e6');
  let y = dy + 215;
  doc.font(serifR);
  for (const l of wrap(doc, t.title, W - 2 * P, 3)) { centered(doc, l, y, 33); y += 35; }
  y += 10;
  centered(doc.font(sans), 'ДАТА И ВРЕМЯ (МСК)', y, 10, 3); centered(doc.font(sans), when(t.event_at), y + 24, 18); y += 60;
  if (t.venue) { centered(doc, 'МЕСТО', y, 10, 3); y += 22; doc.font(sans); for (const l of wrap(doc, t.venue, W - 2 * P, 3)) { centered(doc, l, y, 15); y += 21; } y += 14; }
  if (t.age_mark) { centered(doc, 'ВОЗРАСТ', y, 10, 3); centered(doc.font(serifR), t.age_mark, y + 26, 26); y += 55; }
  const by = Math.max(y + 5, 500);
  doc.moveTo(P, by).lineTo(W - P, by).dash(5, { space: 5 }).lineWidth(1).stroke('#bbbbbb').undash();
  [['БИЛЕТОВ', String(t.qty)], ['ЦЕНА БИЛЕТА', rub(t.price_item)], ['ИТОГО', rub(t.total)]].forEach(([k, v], i) => {
    const cx = P + (W - 2 * P) * (i + .5) / 3, bw = (W - 2 * P) / 3;
    doc.font(sans).fontSize(9).text(k, cx - bw / 2, by + 30, { align: 'center', width: bw, characterSpacing: 2.5, lineBreak: false });
    doc.font(serifR).fontSize(27).text(v, cx - bw / 2, by + 46, { align: 'center', width: bw, lineBreak: false }); });
  const qr = await QRCode.create(qrUrl(t.product), { errorCorrectionLevel: 'M' });
  const n = qr.modules.size, m = Math.floor(130 / n), qs = m * n, qx = (W - qs) / 2, qy = by + 90;
  doc.save().fill('#0a0a0a');
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.modules.data[r * n + c]) doc.rect(qx + c * m, qy + r * m, m, m).fill();
  doc.restore();
  centered(doc.font(sans), 'НАВЕДИТЕ КАМЕРУ', qy + qs + 18, 10, 3);
  centered(doc.font(sans), 'ИП Антиосов Д. А., ИНН 771402577192 · antiosov.ru', H - 42, 10);
  doc.end();
  return done;
}
module.exports = { build, qrUrl };
