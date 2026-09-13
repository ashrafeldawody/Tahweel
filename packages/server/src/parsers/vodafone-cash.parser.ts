import { parseEgyptianWalletReceipt } from './egyptian-wallet-grammar.js';
import { defineParser } from './types.js';

export default defineParser({
  id: 'vodafone_cash',
  name: 'Vodafone Cash (Egypt)',
  senderIds: ['vodafone cash', 'vodafonecash', 'vf-cash', 'vf cash', 'vfcash', 'vodafone'],
  detect(address, body) {
    const a = address.toLowerCase();
    const b = body.toLowerCase();
    return (
      a.includes('vodafone') ||
      a.includes('vf') ||
      b.includes('vodafone cash') ||
      b.includes('vf.eg') ||
      b.includes('vfcash') ||
      b.includes('فودافون')
    );
  },
  parse(_address, body) {
    return parseEgyptianWalletReceipt(body);
  },
});
