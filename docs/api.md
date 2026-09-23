# API

The authoritative reference is the OpenAPI document served at `/docs-json` (Swagger UI at `/docs`) and committed as [openapi.json](openapi.json). This page explains the flows and the conventions behind it.

## Conventions

- JSON in, JSON out. Timestamps are ISO 8601 UTC strings (`2026-09-13T10:15:30.000Z`).
- Money appears twice: `amount_cents` (integer, the value used for matching) and `amount` (major units, for display). Requests take `amount` in major units.
- Errors: `{ "error": "<code>" }` plus optional details. Validation failures are `400 { "error": "invalid_request", "issues": [{ "path": [...], "message": "..." }] }`. Wrong credentials are `401`.
- Lists are paginated with `limit` (default 50, max 500) and `offset`, and return `{ items, total, limit, offset }`; admin lists also carry `counters` (rows per status, unfiltered).

## Credentials

| Header | Value | Scope |
|---|---|---|
| `Authorization: Bearer <INGEST_TOKEN>` | env `INGEST_TOKEN` | `/ingest/*` (the phone) |
| `X-Api-Key: <API_KEY>` (or `Authorization: Bearer <API_KEY>`) | env `API_KEY` | `/api/v1/*` (your backend) |
| `Authorization: Bearer <jwt>` | from `POST /admin/login { password }` | `/admin/*` (dashboard) |

Rotating: change the env value, restart the server, update the phone (Settings screen) or your backend. Admin JWTs are signed with `JWT_SECRET` when set, otherwise with a key derived from `ADMIN_PASSWORD` (so changing the password logs every dashboard out).

## Integrator API (`/api/v1`)

### Create an intent

`POST /api/v1/intents`

```json
{
  "reference": "order-1001",
  "amount": 200,
  "currency": "EGP",
  "sender_phone": "01061916846",
  "expires_in_minutes": 120,
  "metadata": { "order_id": 1001, "customer": "Ahmed" },
  "webhook_url": "https://shop.example.com/webhooks/tahweel"
}
```

- `reference` is your id and must be unique. Reusing it returns `409 { error: "reference_exists", intent_id, status }`.
- `sender_phone` is the number the customer will pay from (any of `0106…`, `+20106…`, `0020106…` are accepted and normalised). Ask the customer for it on your checkout page: it is the one fact that stops a stranger's transfer of the same amount from being credited to the wrong order.
- Without `sender_phone` you must set `allow_amount_only: true`. The intent then only matches a receipt whose amount is **exactly** equal and only when no other amount-only intent with the same amount is pending. This is documented as risky on purpose.
- `expires_in_minutes` defaults to the `intent_ttl_minutes` setting (120). Expired intents never match; a late receipt shows as `unmatched` in the dashboard for a human decision.
- `webhook_url` overrides the server-wide webhook URL (Settings page or `WEBHOOK_URL`) for this intent's `payment.matched` event.
- The response is `201` with the intent and `message: null`, or, if a matching receipt had already arrived, `status: "matched"` with the message embedded.

### Read

- `GET /api/v1/intents/{id}` and `GET /api/v1/intents/by-reference/{reference}` return the intent plus `message` (the matched SMS: amount, sender phone, sender name, provider, reference, received_at) once matched.
- `GET /api/v1/intents?status=pending|matched|expired|cancelled&q=&limit=&offset=`.

### Cancel

`DELETE /api/v1/intents/{id}` cancels a pending intent (`409 intent_not_pending` otherwise).

### Typical checkout flow

1. Show the wallet number and the exact amount. Ask for the customer's wallet number (prefill from their profile).
2. `POST /api/v1/intents` when they press "I have sent the transfer".
3. Poll `GET /api/v1/intents/by-reference/...` every 10-15 s from your backend (never from the browser: the API key must stay server-side), or wait for the webhook on the server. The browser polls your backend. Show a progress state and, after ~10 minutes, a fallback (WhatsApp / support link) while keeping the intent open until it expires.

## Ingest API (`/ingest`)

Used by the listener app. Documented for people writing their own forwarder.

`POST /ingest/sms`

```json
{
  "device_id": "sm-m526b-1a2b3c",
  "messages": [
    { "fingerprint": "<sha256 hex>", "address": "e& money", "body": "تم إستلام مبلغ 200.00 ج.م من رقم 01061916846 ...", "received_at": "2026-09-13T10:15:30.123Z", "sim_slot": 0 }
  ]
}
```

Returns `accepted` (fingerprints the phone may drop, including duplicates), `created`, `matched`, and `results[]` with the per-message `status` (`unmatched | matched | ignored | not_receipt | untrusted_sender | stale`), `parsed`, `provider`, `amount_cents`, `sender_phone`, `intent_id`, `note`. Batches are 1..50 messages.

`POST /ingest/heartbeat` `{ device_id, name?, app_version?, battery?, network?, pending_count?, last_sms_at? }` every 60 s. A device with no heartbeat for `offline_alert_minutes` triggers `device.offline` (and `device.online` when it returns).

## Admin API (`/admin`)

Everything the dashboard does. Highlights:

- `GET /admin/overview`: counters per status for messages, intents, webhooks; devices with online flags; matched in the last 24 h; recent messages; registered parsers; whether webhooks/mail are configured; current settings.
- `GET /admin/messages?status=&q=&device_id=`: `q` searches sender phone, sender name, body, address and transaction reference.
- `POST /admin/messages/{id}/match { intent_id }`: manual match, overriding the stale/untrusted gates (check the wallet balance first). `POST .../ignore`, `POST .../reopen` (ignored/stale/untrusted back to `unmatched` and re-matched), `POST .../retrust` (re-evaluate an `untrusted_sender` row against the current allowlist).
- `POST /admin/intents` creates an intent from the dashboard (same body as the integrator API), `POST /admin/intents/{id}/cancel`.
- `POST /admin/reconcile`: re-trust, expire, demote stale, match; returns the counts.
- `GET|PATCH /admin/settings`: `trusted_senders[]`, `max_age_hours`, `auto_match`, `currency`, `timezone`, `intent_ttl_minutes`, `offline_alert_minutes`, `webhook_unmatched_receipts`, `email_alerts`, `webhook_url` (null falls back to `WEBHOOK_URL`), `webhook_secret` (write-only, ≥ 16 chars; responses carry `webhook_secret_set` instead). A URL without any secret is rejected with `webhook_secret_required`.
- `GET /admin/webhooks?status=`, `POST /admin/webhooks/{id}/redeliver`, `POST /admin/webhooks/test { url? }`.
- `GET /admin/health`: version, database dialect and location, parser ids, configuration flags.

## Health

`GET /health` → `{ ok, version, database, uptime_seconds, server_time }`, `503` when the database does not answer.
