# FAQ

- [Which wallets are supported?](#which-wallets-are-supported)
- [Play Protect blocked the app. How do I install it?](#play-protect-blocked-the-app-how-do-i-install-it)
- [Do I have to register a payment intent?](#do-i-have-to-register-a-payment-intent)
- [What if the customer pays before the order is created?](#what-if-the-customer-pays-before-the-order-is-created)
- [How does my system check that someone paid?](#how-does-my-system-check-that-someone-paid)
- [How does my system authenticate?](#how-does-my-system-authenticate)
- [Can I call the API from the browser?](#can-i-call-the-api-from-the-browser)
- [What if the customer pays more or less than the amount?](#what-if-the-customer-pays-more-or-less-than-the-amount)
- [Does it read the transaction number (رقم العملية)?](#does-it-read-the-transaction-number-رقم-العملية)
- [Does a payment have a time?](#does-a-payment-have-a-time)
- [Can someone fake a payment by texting the phone?](#can-someone-fake-a-payment-by-texting-the-phone)
- [Why is a payment held for review?](#why-is-a-payment-held-for-review)
- [Can I correct the balance if it drifts?](#can-i-correct-the-balance-if-it-drifts)
- [Does the phone send all my SMS to the server?](#does-the-phone-send-all-my-sms-to-the-server)
- [What happens when the phone is off or offline?](#what-happens-when-the-phone-is-off-or-offline)
- [Who can see my payments?](#who-can-see-my-payments)
- [What is the license?](#what-is-the-license)

## Which wallets are supported?

Vodafone Cash, e& money (Etisalat Cash) and Orange Cash. Any other operator whose receipts arrive by SMS can be added with one parser file and a few real sample messages; see [parsers.md](parsers.md).

## Play Protect blocked the app. How do I install it?

The app needs the `RECEIVE_SMS` permission, so Google Play Protect often blocks it with "App blocked to protect your device". Install it over USB with ADB, which Play Protect does not scan:

1. Settings → About phone (→ Software information on Samsung) → tap **Build number** 7 times to enable Developer options.
2. Settings → Developer options → **USB debugging** on. On Samsung One UI 6+ also turn off Settings → Security and privacy → **Auto Blocker**.
3. Install ADB on your computer: `winget install Google.PlatformTools` (Windows), `brew install android-platform-tools` (macOS) or `sudo apt install adb` (Linux).
4. Connect the phone, run `adb devices` and tap **Allow** on the phone.
5. `adb install -r tahweel-listener-<version>-release.apk`

Wireless debugging and troubleshooting are in [listener.md](listener.md#installing-with-adb).

## Do I have to register a payment intent?

Yes. The intent is what tells Tahweel which order a transfer belongs to. A receipt with no intent waits as `unmatched` on the dashboard, where an operator can match it by hand.

```http
POST /api/v1/intents
X-Api-Key: <API_KEY>
Content-Type: application/json

{ "reference": "order-1001", "amount": 150, "sender_phone": "01120993505", "expires_in_minutes": 30 }
```

## What if the customer pays before the order is created?

It still matches. The receipt waits as `unmatched`, and when you create the intent Tahweel looks for a waiting receipt from the same `sender_phone` for at least the amount. If it finds one, the `POST /api/v1/intents` response already has `"status": "matched"` with the receipt embedded, and the `payment.matched` webhook fires. Check the status in the create response before you start polling.

Things to know:

- The receipt must be younger than `max_age_hours` (48 by default, editable in Settings). Older receipts become `stale` and are only matched by hand.
- The intent claims the **oldest** waiting receipt from that phone whose amount is **at least** the intent amount. If a customer sent 500 yesterday that was never matched and orders something for 100 today, that 500 receipt pays the 100 order.
- Intents without a phone (`allow_amount_only`) only claim a receipt of the exact amount.
- A receipt pays one intent only; two orders can never claim the same transfer.

## How does my system check that someone paid?

Either receive the `payment.matched` webhook ([webhooks.md](webhooks.md)) or poll:

```http
GET /api/v1/intents/by-reference/order-1001
X-Api-Key: <API_KEY>
```

`GET /api/v1/intents/{id}` works too. The response, trimmed:

```json
{
  "reference": "order-1001",
  "amount": 150,
  "amount_cents": 15000,
  "status": "matched",
  "created_at": "2026-09-23T01:26:31.251Z",
  "expires_at": "2026-09-23T01:56:31.251Z",
  "matched_at": "2026-09-23T01:26:31.264Z",
  "message": {
    "provider": "vodafone_cash",
    "amount": 150,
    "sender_phone": "01120993505",
    "sender_name": "Ahmed Ali",
    "reference": "022108458264",
    "received_at": "2026-09-23T01:26:31.259Z",
    "matched_by": "auto"
  }
}
```

| `status` | Meaning | What to do |
|---|---|---|
| `pending` | Not paid yet | Keep polling (every 10–15 s is enough) |
| `matched` | Paid | Fulfil the order; `message` holds the receipt |
| `expired` | Time ran out without a payment | Stop polling; a late payment shows on the dashboard for a human decision |
| `cancelled` | You cancelled it (`DELETE /api/v1/intents/{id}`) | Stop polling |

An unknown reference returns `404 {"error":"intent_not_found"}`. To list many at once: `GET /api/v1/intents?status=matched&limit=&offset=`. Full reference in [api.md](api.md).

## How does my system authenticate?

With the `API_KEY` from the server's environment, sent as `X-Api-Key: <key>` or `Authorization: Bearer <key>`. A missing or wrong key gets `401`. The phone uses its own `INGEST_TOKEN` and the dashboard its own `ADMIN_PASSWORD`, so one leaked credential does not open the others. Rotate a key by changing it in the environment and restarting. Run the server behind HTTPS, because the key travels in a header.

There is one API key per server today; per-integrator keys are on the roadmap.

## Can I call the API from the browser?

No. The API key can create, read and cancel every intent. Let your checkout page poll **your** backend, and let your backend poll Tahweel or receive the webhook.

## What if the customer pays more or less than the amount?

More is accepted: the intent matches and `message.amount_cents` shows what was actually paid. Less never matches automatically; the receipt waits as `unmatched` for a human decision.

## Does it read the transaction number (رقم العملية)?

Yes. `رقم العملية`, `رقم المعاملة`, `رقم المرجع` and English forms such as `Transaction ID` are extracted into `message.reference`. It appears in the webhook, the polling response and the dashboard, and is searchable with `GET /admin/messages?q=<number>`. Current e& money receipts do not carry one, so it is `null` for them. Matching uses the sender phone and amount, not this number.

## Does a payment have a time?

Yes, three UTC timestamps on the message: `received_at` (when the SMS reached the phone), `ingested_at` (when the server got it) and `matched_at`. The intent has `created_at`, `expires_at` and `matched_at`. The date the operator writes inside the SMS (`تاريخ العملية`) is not extracted, but it stays in the stored `body`.

## Can someone fake a payment by texting the phone?

They can send one: SMS gateways let anyone show `vf-cash` or `e& money` as the sender, and the text can name any amount and phone number. Two settings stop it from being matched:

- **Verify the wallet balance** (off by default): a receipt only matches when the wallet balance written in it equals the last confirmed balance plus the amount, within a small margin (0.02 by default). An outsider does not know your balance.
- **Review receipts above**: receipts above that amount always wait until someone checks the wallet app and approves them.

Details and limits in [security.md](security.md#fake-sms).

## Why is a payment held for review?

The dashboard shows the reason on the message:

| Reason | Meaning | What to do |
|---|---|---|
| `balance_mismatch` | The balance in the SMS is not the last confirmed balance plus the amount | Usual after you withdrew or sent money. Check the wallet app; approve if the transfer is there, ignore if not |
| `no_balance_history` | No confirmed balance yet (first receipt after turning the check on) | Check the wallet app and approve once; later receipts are checked against it |
| `no_balance` | The SMS carries no balance, so it cannot be checked | Check the wallet app and approve, or turn the balance check off if most of your receipts look like this |
| `above_review_limit` | The amount is above your review limit | Check the wallet app and approve |

While a receipt is held, its intent stays `pending`. Approving it matches it straight away.

## Can I correct the balance if it drifts?

Yes. Tahweel compares each receipt with the balance written in the last confirmed receipt, not with a running total, so small rounding differences never accumulate. When the balance really moves (a withdrawal, a transfer out, a fee, an SMS the phone missed), the next receipt is held with `balance_mismatch` and shows the balance Tahweel expected next to the one in the SMS. Check the wallet app and press **Approve**: that receipt's balance becomes the new confirmed balance and everything after it is checked against it. Matching a held receipt by hand does the same. If your operator rounds balances, raise **Balance margin** in Settings.

## Does the phone send all my SMS to the server?

No, not by default. The phone forwards SMS from the trusted wallet senders and any SMS that mentions money (`مبلغ`, `جنيه`, `EGP`, …), and keeps OTPs and personal texts on the phone. The rules come from your server with every heartbeat. **Filter SMS on the phone** in Settings turns it off if you want everything forwarded. See [listener.md](listener.md#what-the-phone-forwards).

## What happens when the phone is off or offline?

Forwarded messages that arrive while the phone has no network are queued on the phone and sent when it reconnects. The dashboard marks the device offline after missed heartbeats and fires a `device.offline` webhook. SMS that arrive while the app is not installed or the phone is switched off completely are only delivered once the phone is back on; paste any missed receipt into the app's debug screen or match it by hand. Keep the phone on a charger and go through the [phone checklist](listener.md#installing-and-configuring).

## Who can see my payments?

Only you. Tahweel is self-hosted with no cloud component and no telemetry: the phone talks only to your server, and your server talks only to your webhook URL (and your SMTP server if you configure one). See [security.md](security.md).

## What is the license?

MIT. See [LICENSE](../LICENSE).
