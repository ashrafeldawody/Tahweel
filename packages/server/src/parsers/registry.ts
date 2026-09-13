import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ParsedSms, WalletParser } from './types.js';

export const PARSERS_DIR = dirname(fileURLToPath(import.meta.url));
const PARSER_FILE = /\.parser\.(ts|js)$/;

let loaded: WalletParser[] | null = null;

export function listParserFiles(dir: string = PARSERS_DIR): string[] {
  return readdirSync(dir)
    .filter((file) => PARSER_FILE.test(file))
    .sort();
}

function assertValid(parser: unknown, file: string): WalletParser {
  const p = parser as Partial<WalletParser> | undefined;
  if (
    !p ||
    typeof p.id !== 'string' ||
    typeof p.name !== 'string' ||
    !Array.isArray(p.senderIds) ||
    typeof p.detect !== 'function' ||
    typeof p.parse !== 'function'
  ) {
    throw new Error(`${file} must default-export defineParser({ id, name, senderIds, detect, parse })`);
  }
  return p as WalletParser;
}

export async function loadParsers(dir: string = PARSERS_DIR): Promise<WalletParser[]> {
  if (loaded) return loaded;
  const parsers: WalletParser[] = [];
  for (const file of listParserFiles(dir)) {
    const mod = (await import(pathToFileURL(join(dir, file)).href)) as { default?: unknown };
    const parser = assertValid(mod.default, file);
    if (parsers.some((existing) => existing.id === parser.id)) {
      throw new Error(`duplicate parser id "${parser.id}" in ${file}`);
    }
    parsers.push(parser);
  }
  loaded = parsers;
  return parsers;
}

export function getParsers(): WalletParser[] {
  if (!loaded) throw new Error('parsers not loaded; call loadParsers() at startup');
  return loaded;
}

export function getParser(id: string): WalletParser | undefined {
  return getParsers().find((parser) => parser.id === id);
}

export function defaultTrustedSenders(): string[] {
  return [...new Set(getParsers().flatMap((parser) => parser.senderIds))];
}

export function parseSms(address: string, body: string): ParsedSms | null {
  const parsers = getParsers();
  const claimant = parsers.find((parser) => parser.detect(address, body));
  if (claimant) {
    const parsed = claimant.parse(address, body);
    return parsed ? { provider: claimant.id, ...parsed } : null;
  }
  for (const parser of parsers) {
    const parsed = parser.parse(address, body);
    if (parsed) return { provider: 'unknown', ...parsed };
  }
  return null;
}
