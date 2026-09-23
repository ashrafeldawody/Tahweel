# Security model

## Your data stays with you

Tahweel has no cloud component, no account, no telemetry and no third-party SDK in the app or the server; the code is MIT-licensed and small enough to audit. The complete list of network traffic is:

| From | To | What |
|---|---|---|
| The listener phone | **your** server URL, nothing else | Sender id, text and timestamp of SMS from trusted senders or that mention money (every SMS when **Filter SMS on the phone** is off), plus a heartbeat (battery, network, queue size) |
| Your server | the webhook URL **you** configure | Signed `payment.matched` and device events |
| Your server | your own SMTP server, only if `SMTP_URL` is set | Operator alerts |

Receipts, intents, deliveries and settings live in a SQLite file or a PostgreSQL database on your machine; back them up, export them or delete them as you please. Nobody else — not the wallet operator, not a payment provider, not the authors of this project — can see who paid you what. OTPs and personal texts stay on the phone while the filter is on, but a bank alert that mentions an amount is still forwarded, so dedicate a phone to the wallet SIM and keep the server URL on HTTPS.

## Fake SMS

Anyone can buy SMS through a bulk gateway and set the sender name to `vf-cash`, `e& money` or `Orange Cash`. On the phone such a message looks exactly like a real receipt. The trusted-sender list therefore only blocks texts from ordinary phone numbers, and binding an intent to `sender_phone` does not help either: the attacker writes their own number into the fake text.

The only proof that money arrived is the wallet itself. What Tahweel gives you:

- **Balance check** (off by default, **Verify the wallet balance** in Settings). Real receipts carry the wallet balance (`رصيدك الحالي`), which an outsider does not know. With the check on, a receipt matches automatically only when that balance equals the last confirmed balance plus the amount, within the **balance margin** (default 0.02, for operator rounding). Confirmed balances come only from receipts that passed the check or that an operator approved or matched by hand, so a first fake SMS cannot plant a starting balance. Everything else is `held`.
- **Review limit** (`review_above_amount`, **Review receipts above** in Settings). Receipts above the limit are `held` and never match on their own. Open the wallet app: if the transfer is there, **Approve** it (it then matches straight away); if it is not, **Ignore** it. Set the limit to the largest amount you are willing to lose to a fake. A very low limit (for example 1) means a human checks every payment.
- **Auto-match off** (`auto_match`). Every receipt waits for a manual match.
- **Sender phone on every intent.** It does not stop a fake, but it limits a fake to an order the attacker created with their own number.

Correcting drift: the check compares each receipt with the balance written in the last confirmed receipt, not with a running total, so small differences never add up. When the balance moves for another reason (a withdrawal, a transfer out, a fee, an SMS the phone missed), the next receipt is held with `balance_mismatch` and shows the balance Tahweel expected. Check the wallet app and **Approve** it: its balance becomes the new confirmed balance and the following receipts are checked against it.

What it costs and what it does not cover:

- With the balance check on, the first receipt after turning it on is held once (there is no confirmed balance yet), and so is the first receipt after money leaves the wallet.
- Receipts without a balance cannot be checked and are always held while the check is on. That includes some e& money and Orange Cash templates.
- The check makes a fake very unlikely to pass, because the attacker would have to guess your balance within the margin. It is not proof.
- **With the balance check off, a fake receipt below the review limit that names the right amount and the attacker's own number matches automatically** and fires `payment.matched`. Keep the limit at a level where that risk is acceptable, and reconcile the dashboard against the wallet app regularly.
- A held receipt keeps its intent `pending`; the customer waits until someone approves it. Held receipts trigger an e-mail alert when SMTP is configured.

## Credentials and gates

- Three independent credentials: `INGEST_TOKEN` (phone → `/ingest/*`, bearer), `API_KEY` (your backend → `/api/v1/*`, `X-Api-Key`), `ADMIN_PASSWORD` (dashboard → JWT for `/admin/*`). All compared timing-safe. Rotate by changing the env value and restarting (then update the phone / your backend); set `JWT_SECRET` explicitly if you want admin sessions to survive a password change.
- A receipt-looking SMS proves nothing by itself: anyone can text the phone "تم استلام مبلغ …". Only messages whose **originating address** is on the trusted sender allowlist can auto-match, and sender ids can be faked (see above). Numeric short codes must be listed exactly.
- The age gate stops replayed history from crediting twice.
- The fingerprint makes ingest idempotent.
- Webhooks carry `X-Tahweel-Signature: t=<unix>,v1=<hmac-sha256(secret, "<t>.<body>")>`; verify it and reject stale timestamps (see [webhooks.md](webhooks.md)).
- Run behind HTTPS (reverse proxy, see [deploy.md](deploy.md#reverse-proxy-and-tls)); the listener refuses nothing, so a plain-HTTP server URL means the token travels in clear.
