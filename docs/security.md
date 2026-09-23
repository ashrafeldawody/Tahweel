# Security model

## Your data stays with you

Tahweel has no cloud component, no account, no telemetry and no third-party SDK in the app or the server; the code is MIT-licensed and small enough to audit. The complete list of network traffic is:

| From | To | What |
|---|---|---|
| The listener phone | **your** server URL, nothing else | Sender id, text and timestamp of the SMS the phone receives, plus a heartbeat (battery, network, queue size) |
| Your server | the webhook URL **you** configure | Signed `payment.matched` and device events |
| Your server | your own SMTP server, only if `SMTP_URL` is set | Operator alerts |

Receipts, intents, deliveries and settings live in a SQLite file or a PostgreSQL database on your machine; back them up, export them or delete them as you please. Nobody else — not the wallet operator, not a payment provider, not the authors of this project — can see who paid you what. Because the phone forwards every SMS it receives, dedicate a phone to the wallet SIM and keep the server URL on HTTPS.

## Credentials and gates

- Three independent credentials: `INGEST_TOKEN` (phone → `/ingest/*`, bearer), `API_KEY` (your backend → `/api/v1/*`, `X-Api-Key`), `ADMIN_PASSWORD` (dashboard → JWT for `/admin/*`). All compared timing-safe. Rotate by changing the env value and restarting (then update the phone / your backend); set `JWT_SECRET` explicitly if you want admin sessions to survive a password change.
- A receipt-looking SMS proves nothing by itself: anyone can text the phone "تم استلام مبلغ …". Only messages whose **originating address** is on the trusted sender allowlist can auto-match. Numeric short codes must be listed exactly.
- The age gate stops replayed history from crediting twice.
- The fingerprint makes ingest idempotent.
- Webhooks carry `X-Tahweel-Signature: t=<unix>,v1=<hmac-sha256(secret, "<t>.<body>")>`; verify it and reject stale timestamps (see [webhooks.md](webhooks.md)).
- Run behind HTTPS (reverse proxy, see [deploy.md](deploy.md#reverse-proxy-and-tls)); the listener refuses nothing, so a plain-HTTP server URL means the token travels in clear.
