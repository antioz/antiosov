// Т-Банк EACQ v2. Т-Банк подписан УЦ Минцифры — ru-ca.pem добавляется к системным корням.
const https = require('https'); const crypto = require('crypto'); const fs = require('fs'); const path = require('path');
const ENV = process.env;
const RU_CA = fs.readFileSync(path.join(__dirname, '..', 'ru-ca.pem'));
const agent = new https.Agent({ ca: [...require('tls').rootCertificates, RU_CA.toString()] });

function tbToken(params) {
  const flat = { ...params, Password: ENV.TB_PASSWORD };
  const str = Object.keys(flat).filter(k => typeof flat[k] !== 'object').sort().map(k => String(flat[k])).join('');
  return crypto.createHash('sha256').update(str).digest('hex');
}

function tbCall(method, params, timeoutMs = 8000) {
  const body = JSON.stringify({ ...params, Token: tbToken(params) });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'securepay.tinkoff.ru', path: '/v2/' + method, method: 'POST', agent, timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('tbank bad json: ' + data.slice(0, 200))); } });
    });
    req.on('timeout', () => req.destroy(new Error('tbank timeout ' + method)));
    req.on('error', reject); req.write(body); req.end();
  });
}

// Чек 54-ФЗ. items: [{name, price_rub, qty, object, method}]
function receipt(email, items) {
  return {
    Email: email,
    Taxation: ENV.TAXATION || 'usn_income',
    Items: items.map(it => ({
      Name: it.name.slice(0, 128), Price: it.price_rub * 100, Quantity: it.qty, Amount: it.price_rub * it.qty * 100,
      Tax: ENV.VAT || 'none', PaymentMethod: it.method || 'full_payment', PaymentObject: it.object || 'commodity',
    })),
  };
}

// dueDate: Date → "YYYY-MM-DDTHH:MM:SS+03:00" (Т-Банк требует смещение)
function tbDate(d) {
  const msk = new Date(d.getTime() + 3 * 3600 * 1000);
  return msk.toISOString().slice(0, 19) + '+03:00';
}

async function init({ orderId, amountRub, description, email, receiptItems, successUrl, failUrl, notifyUrl, dueDate }) {
  const res = await tbCall('Init', {
    TerminalKey: ENV.TB_TERMINAL, Amount: amountRub * 100, OrderId: orderId, Description: description.slice(0, 140),
    SuccessURL: successUrl, FailURL: failUrl, NotificationURL: notifyUrl, RedirectDueDate: tbDate(dueDate),
    DATA: { Email: email }, Receipt: receipt(email, receiptItems),
  });
  if (!res.Success || !res.PaymentURL) throw new Error('tbank init failed: ' + JSON.stringify(res));
  return { paymentId: String(res.PaymentId), paymentUrl: res.PaymentURL };
}
const getState = paymentId => tbCall('GetState', { TerminalKey: ENV.TB_TERMINAL, PaymentId: paymentId });
// Полный возврат: чек не передаётся (Т-Банк формирует чек возврата сам по исходному).
const cancel = paymentId => tbCall('Cancel', { TerminalKey: ENV.TB_TERMINAL, PaymentId: paymentId });

module.exports = { tbToken, tbCall, receipt, init, getState, cancel, tbDate };
