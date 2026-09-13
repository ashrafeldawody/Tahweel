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
  orange-cash.parser.ts
  orange-cash.samples.json
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
  senderPhone: string | null;
  senderName: string | null;
  balanceCents: number | null;
  reference: string | null;
}
```

- `senderIds`: the alphanumeric sender ids the operator uses. They become part of the default trusted-senders list (the anti-spoof gate). Lower-case, spaces normalised.
- `detect(address, body)`: does this message belong to this provider? Match on the sender id and on body hints (brand names, short links) so that a message that arrives through a generic short code is still attributed.
- `parse(address, body)`: return the receipt fields, or `null` for anything that is not an **incoming** transfer (OTP, marketing, outgoing transfer, balance enquiry).
- `senderPhone` is `null` when the operator does not put the sender's number in the SMS (Orange Cash names the sender instead, and a cash-in at an agent has no sender at all). Such receipts can only auto-match an intent created with `allow_amount_only`; otherwise they wait as `unmatched` for a manual match in the dashboard. The shared grammar rejects phoneless messages unless the parser passes `{ requireSenderPhone: false }`, so promotional texts from providers that always include a number cannot masquerade as receipts.

How the registry uses it: the first parser whose `detect()` returns true parses the message. If no parser claims it, every parser's `parse()` is tried in order and a hit is stored with `provider: "unknown"` (it will typically be gated as `untrusted_sender` anyway).

## Worked example: adding a provider

Orange Cash was added this way; [orange-cash.parser.ts](../packages/server/src/parsers/orange-cash.parser.ts) and [orange-cash.samples.json](../packages/server/src/parsers/orange-cash.samples.json) are the finished result.

1. Collect real messages from the phone (the wallet SIM's messaging app, or the body stored under **Messages** in the dashboard) and their meaning. Never invent samples: the test is only as good as the messages are real.

2. Create `packages/server/src/parsers/<provider>.parser.ts`:

```ts
import { parseEgyptianWalletReceipt } from './egyptian-wallet-grammar.js';
import { normalizeArabicText } from './normalize.js';
import { defineParser } from './types.js';

export default defineParser({
  id: 'orange_cash',
  name: 'Orange Cash (Egypt)',
  senderIds: ['orange cash', 'orangecash', 'orange', 'اورنج كاش', 'أورنج كاش'],
  detect(address, body) {
    const a = normalizeArabicText(address).toLowerCase();
    const b = normalizeArabicText(body).toLowerCase();
    return a.includes('orange') || a.includes('اورنج') || b.includes('orange cash') || b.includes('orange.eg') || b.includes('اورنج كاش');
  },
  parse(_address, body) {
    return parseEgyptianWalletReceipt(body, { requireSenderPhone: false });
  },
});
```

If the operator's wording does not fit the shared grammar, write the regexes in the file itself; reuse `normalizeArabicText`, `normalizeEgyptPhone`, `toCents` and `firstMatch` from `normalize.ts`. List every spelling of the sender id you have seen, including Arabic ones: the trusted-senders gate compares sender ids, not parser output.

3. Create `packages/server/src/parsers/<provider>.samples.json`:

```json
{
  "provider": "orange_cash",
  "samples": [
    {
      "name": "transfer received with balance and transaction number, sender given by name only",
      "address": "Orange Cash",
      "body": "تم إستلام عملية تحويل أموال بمبلغ 150.00 جنيه من RYAN H Ahmed، رصيدك الحالي 366.22 جنيه. رقم المعاملة 1908287136",
      "expected": {
        "amountCents": 15000,
        "senderPhone": null,
        "senderName": "RYAN H Ahmed",
        "balanceCents": 36622,
        "reference": "1908287136"
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

When an operator changes its wording, the receipt lands as `not_receipt` in the dashboard with the full body. Copy the body into a new sample, adjust the regexes until the test passes, deploy. Nothing was lost in the meantime: after the deploy, press **Reopen** on the row or **Re-run matching**; rows stored as `not_receipt` are not re-parsed, so paste the body into the listener's **Debug: test message** screen to re-send it (the fingerprint differs, so it is stored as a new row) or match it by hand.

## The shared normaliser

`normalizeArabicText` converts Arabic-Indic (٠١٢) and Eastern Arabic (۰۱۲) digits to ASCII, turns the Arabic decimal separator (٫) into a dot, unifies أ/إ/آ → ا, ى → ي, ة → ه, strips bidi control marks and collapses whitespace. Sender names pass through the same normalisation, so `شوقى` is stored as `شوقي`. `normalizeEgyptPhone` accepts `01xxxxxxxxx`, `1xxxxxxxxx`, `201…`, `+201…`, `00201…` and returns the 11-digit local form or `null`. Both have unit tests in `parsers.spec.ts`. For a non-Egyptian deployment, replace `normalizeEgyptPhone` (it is the single place phones are normalised, including the `sender_phone` of intents).
