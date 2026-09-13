import { parseEgyptianWalletReceipt } from './egyptian-wallet-grammar.js';
import { defineParser } from './types.js';

export default defineParser({
  id: 'etisalat_money',
  name: 'e& money (Etisalat Egypt)',
  senderIds: ['e& money', 'e&money', 'etisalat'],
  detect(address, body) {
    const a = address.toLowerCase();
    const b = body.toLowerCase();
    return a.includes('e&') || a.includes('etisalat') || b.includes('e& money');
  },
  parse(_address, body) {
    return parseEgyptianWalletReceipt(body);
  },
});
