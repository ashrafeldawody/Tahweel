import { normalizeSenderAddress } from '../parsers/normalize.js';

const NUMERIC_ADDRESS = /^\+?[0-9]{5,}$/;

export function isTrustedSender(address: string, trusted: string[]): boolean {
  const normalized = normalizeSenderAddress(address);
  if (!normalized) return false;
  const allowlist = trusted.map(normalizeSenderAddress).filter(Boolean);
  if (NUMERIC_ADDRESS.test(normalized)) return allowlist.includes(normalized);
  return allowlist.some((entry) => normalized === entry || normalized.includes(entry));
}
