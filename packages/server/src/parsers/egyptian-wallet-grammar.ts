import { firstMatch, normalizeArabicText, normalizeEgyptPhone, toCents } from './normalize.js';
import type { ParsedReceipt } from './types.js';

const RECEIVE_WORDS = ['استلام', 'استلمت', 'اضافة مبلغ', 'ايداع', 'وصلك', 'received', 'credited', 'successful cash-in'];

const OUTGOING_WORDS = [
  'تم تحويل',
  'تم ارسال',
  'ارسلت',
  'تم سحب',
  'تم دفع',
  'تم خصم',
  'تم شراء',
  'you sent',
  'you paid',
  'transferred to',
];

const CURRENCY = '(?:ج\\.?\\s?م\\.?|جنيها?|جم|egp|le)';
const AMOUNT = '([0-9]+(?:[.,][0-9]{1,2})?)';

export interface GrammarOptions {
  requireSenderPhone?: boolean;
}

export function looksLikeIncomingTransfer(body: string): boolean {
  const lower = normalizeArabicText(body).toLowerCase();
  const received = RECEIVE_WORDS.some((word) => lower.includes(word));
  const outgoing = OUTGOING_WORDS.some((word) => lower.includes(word));
  return received && !outgoing;
}

export function parseEgyptianWalletReceipt(rawBody: string, options: GrammarOptions = {}): ParsedReceipt | null {
  const body = normalizeArabicText(rawBody);
  if (!looksLikeIncomingTransfer(body)) return null;
  const requireSenderPhone = options.requireSenderPhone ?? true;

  const amountMatch = firstMatch(body, [
    new RegExp(`مبلغ\\s*${AMOUNT}\\s*${CURRENCY}`, 'i'),
    new RegExp(`${AMOUNT}\\s*${CURRENCY}`, 'i'),
    new RegExp(`${CURRENCY}\\s*${AMOUNT}`, 'i'),
    new RegExp(`مبلغ\\s*${AMOUNT}(?=\\s)`),
  ]);
  if (!amountMatch) return null;
  const amountCents = toCents(amountMatch[1]);
  if (amountCents == null) return null;

  const referenceMatch = firstMatch(body, [
    /رقم (?:العمليه|المعامله|المرجع)\s*[:：]?\s*([0-9]{6,})/,
    /(?:transaction|trx|ref)(?:\s*(?:id|no|number))?\s*[:：#]?\s*([0-9]{6,})/i,
  ]);
  const bodyWithoutReference = referenceMatch ? body.replace(referenceMatch[1], ' ') : body;

  const senderMatch = firstMatch(bodyWithoutReference, [
    /من\s*(?:رقم|الرقم)?\s*(?:حساب|محفظه|محفظة)?\s*((?:\+?2|002)?0?1[0-9]{9})/,
    /from\s*(?:number|wallet)?\s*((?:\+?2|002)?0?1[0-9]{9})/i,
    /((?:\+2|002)?01[0-9]{9})/,
  ]);
  const senderPhone = senderMatch ? normalizeEgyptPhone(senderMatch[1]) : null;
  if (!senderPhone && requireSenderPhone) return null;

  const nameMatch = firstMatch(body, [
    /باسم\s*(.+?)\s*(?:بنجاح|\.|رصيد|علي رقم|علي محفظ|استخدم|تابع|http)/,
    /name\s*[:：]?\s*(.+?)\s*(?:successfully|\.|balance|to wallet)/i,
    /من\s+(?!رقم|الرقم|حساب|محفظ|[0-9+])(.+?)\s*(?=،|,|\.|رصيد|رقم (?:العمليه|المعامله|المرجع)|$)/,
  ]);
  const senderName = nameMatch ? nameMatch[1].trim().slice(0, 120) : null;

  const balanceMatch = firstMatch(body, [
    new RegExp(`رصيد[^0-9]{0,40}${AMOUNT}`),
    new RegExp(`balance[^0-9]{0,40}${AMOUNT}`, 'i'),
  ]);
  const balanceCents = balanceMatch ? toCents(balanceMatch[1]) : null;

  return {
    amountCents,
    senderPhone,
    senderName: senderName || null,
    balanceCents,
    reference: referenceMatch ? referenceMatch[1] : null,
  };
}
