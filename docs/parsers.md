# Parsers: adding a wallet SMS format

Every wallet operator has its own SMS template. Tahweel keeps one file per provider in `packages/server/src/parsers/` and discovers them at boot, so supporting a new operator is a drop-in change with no registry edit.

## Folder layout

```
packages/server/src/parsers/
  types.ts                      defineParser(), ParsedReceipt, WalletParser
  normalize.ts                  shared normaliser (Arabic-Indic digits, alef/yeh/teh-marbuta, bidi marks, Egyptian phones, cents)
  egyptian-wallet-grammar.ts    shared regex grammar used by the Egyptian wallets
  registry.ts                   loads *.parser.ts, parseSms(), defaultTrustedSenders()
  etisalat-money.parser.ts      one provider
  etisalat-money.samples.json   its real messages + expected output
  vodafone-cash.parser.ts
  vodafone-cash.samples.json
  parsers.spec.ts               the single generic test that runs every samples file
```

Rules the registry enforces at boot: the file name ends with `.parser.ts`, it default-exports `defineParser({...})`, ids are unique. The test suite additionally requires a `<name>.samples.json` next to every `<name>.parser.ts`.

## The contract

```ts
export interface WalletParser {
  id: string;
  name: string;
  senderIds: string[];
  detect(address: string, body: string): boolean;
  parse(address: string, body: string): ParsedReceipt | null;
}

export interface ParsedReceipt {
  amountCents: number;
  senderPhone: string;
  senderName: string | null;
  balanceCents: number | null;
  reference: string | null;
}
```

- `senderIds`: the alphanumeric sender ids the operator uses. They become part of the default trusted-senders list (the anti-spoof gate). Lower-case, spaces normalised.
- `detect(address, body)`: does this message belong to this provider? Match on the sender id and on body hints (brand names, short links) so that a message that arrives through a generic short code is still attributed.
- `parse(address, body)`: return the receipt fields, or `null` for anything that is not an **incoming** transfer (OTP, marketing, outgoing transfer, balance enquiry).

How the registry uses it: the first parser whose `detect()` returns true parses the message. If no parser claims it, every parser's `parse()` is tried in order and a hit is stored with `provider: "unknown"` (it will typically be gated as `untrusted_sender` anyway).

## Worked example: Orange Cash

1. Collect real messages from the phone (Debug inbox screen → copy) and their meaning. Never invent samples: the test is only as good as the messages are real.

2. Create `packages/server/src/parsers/orange-cash.parser.ts`:

```ts
import { parseEgyptianWalletReceipt } from './egyptian-wallet-grammar.js';
import { defineParser } from './types.js';

export default defineParser({
  id: 'orange_cash',
  name: 'Orange Cash (Egypt)',
  senderIds: ['orange cash', 'orangecash', 'orange money', 'orange'],
  detect(address, body) {
    const a = address.toLowerCase();
    const b = body.toLowerCase();
    return a.includes('orange') || b.includes('orange cash') || b.includes('اورنج');
  },
  parse(_address, body) {
    return parseEgyptianWalletReceipt(body);
  },
});
```

If the operator's wording does not fit the shared grammar, write the regexes in the file itself; reuse `normalizeArabicText`, `normalizeEgyptPhone`, `toCents` and `firstMatch` from `normalize.ts`.

3. Create `packages/server/src/parsers/orange-cash.samples.json`:

```json
{
  "provider": "orange_cash",
  "samples": [
    {
      "name": "receipt",
      "address": "Orange Cash",
      "body": "<paste the real SMS here>",
      "expected": {
        "amountCents": 15000,
        "senderPhone": "01234567890",
        "senderName": "SOME NAME",
        "balanceCents": 20000,
        "reference": "123456789"
      }
    },
    {
      "name": "OTP is rejected",
      "address": "Orange Cash",
      "body": "<a real OTP message>",
      "expected": null
    }
  ]
}
```

Samples with `expected: null` assert that the parser rejects the message; samples with an object assert `detect()` is true, `parse()` returns exactly that object, and `parseSms()` attributes it to this provider.

4. Run `pnpm --filter @tahweel/server test`. The generic test picks up the new file automatically. Restart the server; the new sender ids join the default trusted list (unless you already saved a custom list in Settings, in which case add them there).

## Debugging a template change

When an operator changes its wording, the receipt lands as `not_receipt` in the dashboard with the full body. Copy the body into a new sample, adjust the regexes until the test passes, deploy. Nothing was lost in the meantime: after the deploy, press **Reopen** on the row or **Re-run matching**; rows stored as `not_receipt` are not re-parsed, so paste the body into the listener's debug screen to re-send it (the fingerprint differs, so it is stored as a new row) or match it by hand.

## The shared normaliser

`normalizeArabicText` converts Arabic-Indic (٠١٢) and Eastern Arabic (۰۱۲) digits to ASCII, unifies أ/إ/آ → ا, ى → ي, ة → ه, strips bidi control marks and collapses whitespace. `normalizeEgyptPhone` accepts `01xxxxxxxxx`, `1xxxxxxxxx`, `201…`, `+201…`, `00201…` and returns the 11-digit local form or `null`. Both have unit tests in `parsers.spec.ts`. For a non-Egyptian deployment, replace `normalizeEgyptPhone` (it is the single place phones are normalised, including the `sender_phone` of intents).
