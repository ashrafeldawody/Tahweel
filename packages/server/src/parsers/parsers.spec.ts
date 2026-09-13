import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { normalizeArabicText, normalizeEgyptPhone } from './normalize.js';
import { PARSERS_DIR, getParser, listParserFiles, loadParsers, parseSms } from './registry.js';
import type { ParserSamplesFile } from './types.js';

function loadSampleFiles(): ParserSamplesFile[] {
  return readdirSync(PARSERS_DIR)
    .filter((file) => file.endsWith('.samples.json'))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(PARSERS_DIR, file), 'utf8')) as ParserSamplesFile);
}

const sampleFiles = loadSampleFiles();

beforeAll(async () => {
  await loadParsers();
});

describe('parser registry', () => {
  it('discovers every *.parser file in the folder', () => {
    const files = listParserFiles();
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files).toContain('etisalat-money.parser.ts');
    expect(files).toContain('vodafone-cash.parser.ts');
  });

  it('has a samples file for every parser and a parser for every samples file', () => {
    const parserIds = listParserFiles().map((file) => file.replace(/\.parser\.(ts|js)$/, ''));
    const sampleIds = readdirSync(PARSERS_DIR)
      .filter((file) => file.endsWith('.samples.json'))
      .map((file) => file.replace(/\.samples\.json$/, ''));
    expect([...sampleIds].sort()).toEqual([...parserIds].sort());
    for (const file of sampleFiles) expect(getParser(file.provider)).toBeDefined();
  });
});

for (const file of sampleFiles) {
  describe(`parser ${file.provider}`, () => {
    for (const sample of file.samples) {
      it(sample.name, () => {
        const parser = getParser(file.provider);
        expect(parser).toBeDefined();
        expect(parser!.parse(sample.address, sample.body)).toEqual(sample.expected);
        if (sample.expected) {
          expect(parser!.detect(sample.address, sample.body)).toBe(true);
          expect(parseSms(sample.address, sample.body)).toEqual({ provider: file.provider, ...sample.expected });
        } else {
          expect(parseSms(sample.address, sample.body)).toBeNull();
        }
      });
    }
  });
}

describe('parseSms fallback', () => {
  it('parses a receipt-shaped body from an unknown sender id as provider "unknown"', () => {
    const parsed = parseSms('+201234567890', 'تم استلام مبلغ 200.00 ج.م من رقم 01061916846 بنجاح');
    expect(parsed?.provider).toBe('unknown');
    expect(parsed?.amountCents).toBe(20000);
  });
});

describe('normalizeArabicText', () => {
  it('converts digits, unifies letters and strips bidi marks', () => {
    expect(normalizeArabicText('‏مبلغ ١٢٣ جنيه إلى محفظة‎')).toBe('مبلغ 123 جنيه الي محفظه');
    expect(normalizeArabicText('۴۵')).toBe('45');
  });
});

describe('normalizeEgyptPhone', () => {
  it.each([
    ['01061916846', '01061916846'],
    ['+201061916846', '01061916846'],
    ['00201061916846', '01061916846'],
    ['201061916846', '01061916846'],
    ['1061916846', '01061916846'],
    ['0106191684', null],
    ['02012345678', null],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeEgyptPhone(input)).toBe(expected);
  });
});
