import { normalizeSenderAddress } from '../parsers/normalize.js';
import type { Settings } from './settings.js';

export const FORWARD_KEYWORDS = ['مبلغ', 'جنيه', 'جنية', 'ج.م', 'رصيد', 'egp', 'balance', 'amount'];

export function forwardingRules(settings: Pick<Settings, 'phone_filter' | 'trusted_senders'>) {
  return {
    filter: settings.phone_filter,
    senders: settings.trusted_senders.map(normalizeSenderAddress).filter(Boolean),
    keywords: FORWARD_KEYWORDS,
  };
}
