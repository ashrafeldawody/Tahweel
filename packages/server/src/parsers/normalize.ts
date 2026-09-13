const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_ARABIC_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ALEF_VARIANTS = /[أإآ]/g;
const ALEF_MAQSURA = /ى/g;
const TEH_MARBUTA = /ة/g;
const BIDI_MARK_RANGES: Array<[number, number]> = [
  [0x200e, 0x200f],
  [0x202a, 0x202e],
];

function isBidiMark(ch: string): boolean {
  const code = ch.codePointAt(0) ?? -1;
  return BIDI_MARK_RANGES.some(([low, high]) => code >= low && code <= high);
}

export function normalizeArabicText(input: string): string {
  let out = '';
  for (const ch of input) {
    const arabicIndic = ARABIC_INDIC_DIGITS.indexOf(ch);
    const easternArabic = EASTERN_ARABIC_DIGITS.indexOf(ch);
    if (arabicIndic >= 0) out += String(arabicIndic);
    else if (easternArabic >= 0) out += String(easternArabic);
    else if (isBidiMark(ch)) continue;
    else out += ch;
  }
  return out
    .replace(ALEF_VARIANTS, 'ا')
    .replace(ALEF_MAQSURA, 'ي')
    .replace(TEH_MARBUTA, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeEgyptPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const match = /^(?:0{0,2}2)?(0?1[0-9]{9})$/.exec(digits);
  if (!match) return null;
  const local = match[1];
  return local.startsWith('0') ? local : `0${local}`;
}

export function toCents(raw: string): number | null {
  const value = Number(raw.replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

export function normalizeSenderAddress(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function firstMatch(text: string, patterns: RegExp[]): RegExpExecArray | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match;
  }
  return null;
}
