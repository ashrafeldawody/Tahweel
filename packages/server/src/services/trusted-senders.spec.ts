import { beforeAll, describe, expect, it } from 'vitest';
import { defaultTrustedSenders, loadParsers } from '../parsers/registry.js';
import { isTrustedSender } from './trusted-senders.js';

beforeAll(async () => {
  await loadParsers();
});

describe('isTrustedSender', () => {
  it.each([
    ['e& money', true],
    ['E& Money', true],
    ['VodafoneCash', true],
    ['vf-cash', true],
    ['VF-Cash', true],
    ['Vodafone Cash', true],
    ['Etisalat', true],
    ['+201061916846', false],
    ['01061916846', false],
    ['1234', false],
    ['', false],
    ['MyShop', false],
    ['Orange Cash', true],
    ['OrangeCash', true],
    ['اورنج كاش', true],
    ['أورنج كاش', true],
    ['InstaPay', false],
  ])('%s -> %s', (address, expected) => {
    expect(isTrustedSender(address, defaultTrustedSenders())).toBe(expected);
  });

  it('accepts a numeric short code only when listed exactly', () => {
    expect(isTrustedSender('7000', ['7000'])).toBe(true);
    expect(isTrustedSender('70001', ['7000'])).toBe(false);
    expect(isTrustedSender('+201000000000', ['e& money'])).toBe(false);
  });

  it('accepts a newly listed alphanumeric sender id', () => {
    expect(isTrustedSender('InstaPay', [...defaultTrustedSenders(), 'instapay'])).toBe(true);
  });

  it('derives the default allowlist from the registered parsers', () => {
    expect(defaultTrustedSenders()).toEqual(expect.arrayContaining(['e& money', 'vf-cash', 'vodafone cash']));
  });
});
