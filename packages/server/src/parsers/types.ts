export interface ParsedReceipt {
  amountCents: number;
  senderPhone: string | null;
  senderName: string | null;
  balanceCents: number | null;
  reference: string | null;
}

export interface WalletParser {
  id: string;
  name: string;
  senderIds: string[];
  detect(address: string, body: string): boolean;
  parse(address: string, body: string): ParsedReceipt | null;
}

export interface ParsedSms extends ParsedReceipt {
  provider: string;
}

export function defineParser(parser: WalletParser): WalletParser {
  return parser;
}

export interface ParserSample {
  name: string;
  address: string;
  body: string;
  expected: ParsedReceipt | null;
}

export interface ParserSamplesFile {
  provider: string;
  samples: ParserSample[];
}
