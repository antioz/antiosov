// Реестр внешних вызовов. Домен (orders.js) обращается только через ext.*, тесты подменяют поля.
const tbank = require('./tbank'); const mail = require('./mail'); const yd = require('./yd');
module.exports = {
  tbank: { init: (...a) => tbank.init(...a), getState: (...a) => tbank.getState(...a), cancel: (...a) => tbank.cancel(...a) },
  mail: { send: (...a) => mail.send(...a) },
  yd: { mode: () => yd.mode(), quote: (...a) => yd.quote(...a), createRequest: (...a) => yd.createRequest(...a), requestInfo: (...a) => yd.requestInfo(...a), cities: (...a) => yd.cities(...a), pvz: (...a) => yd.pvz(...a) },
};
