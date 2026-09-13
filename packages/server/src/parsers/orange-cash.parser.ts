import { parseEgyptianWalletReceipt } from './egyptian-wallet-grammar.js';
import { normalizeArabicText } from './normalize.js';
import { defineParser } from './types.js';

export default defineParser({
  id: 'orange_cash',
  name: 'Orange Cash (Egypt)',
  senderIds: ['orange cash', 'orangecash', 'orange', 'اورنج كاش', 'أورنج كاش'],
  detect(address, body) {
    const a = normalizeArabicText(address).toLowerCase();
    const b = normalizeArabicText(body).toLowerCase();
    return (
      a.includes('orange') ||
      a.includes('اورنج') ||
      b.includes('orange cash') ||
      b.includes('orange.eg') ||
      b.includes('اورنج كاش') ||
      b.includes('اورنچ كاش')
    );
  },
  parse(_address, body) {
    return parseEgyptianWalletReceipt(body, { requireSenderPhone: false });
  },
});
