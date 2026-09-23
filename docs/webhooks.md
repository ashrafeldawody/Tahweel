# Webhooks

Tahweel POSTs JSON events to the webhook URL configured on the dashboard's Settings page (falling back to `WEBHOOK_URL` from the environment), or to the `webhook_url` given on an intent. Every delivery is stored in `webhook_deliveries` and visible in the dashboard, where it can be redelivered.

## Events

| Event | When | Payload keys |
|---|---|---|
| `payment.matched` | A receipt was matched to an intent (automatically or by an admin) | `intent`, `message` |
| `payment.unmatched_receipt` | A trusted, fresh receipt matched no intent (only when the `webhook_unmatched_receipts` setting is on) | `message` |
| `device.offline` | No heartbeat from a listener phone for `offline_alert_minutes` | `device` |
| `device.online` | The phone reported again | `device`, `offline_since` |
| `webhook.test` | "Send test event" in the dashboard | `message` |

Every payload also carries `id` (delivery id, use it for idempotency), `event` and `created_at`.

### `payment.matched`

```json
{
  "id": "0b6f5c1e-2f0f-4a67-9f1c-0e1f3a2b4c5d",
  "event": "payment.matched",
  "created_at": "2026-09-13T10:15:31.204Z",
  "intent": {
    "id": "7c1d0f3e-4a7b-4c1e-9c6d-2f5a8b9e0d11",
    "reference": "order-1001",
    "amount": 200,
    "amount_cents": 20000,
    "currency": "EGP",
    "sender_phone": "01061916846",
    "allow_amount_only": false,
    "status": "matched",
    "metadata": { "order_id": 1001 },
    "webhook_url": null,
    "created_at": "2026-09-13T10:10:02.000Z",
    "expires_at": "2026-09-13T12:10:02.000Z",
    "matched_at": "2026-09-13T10:15:31.190Z",
    "matched_message_id": "5d2c...",
    "cancelled_at": null
  },
  "message": {
    "id": "5d2c...",
    "fingerprint": "3b1c9d0f...",
    "device_id": "sm-m526b-1a2b3c",
    "address": "e& money",
    "body": "تم إستلام مبلغ 200.00 ج.م من رقم 01061916846 المسجل باسم ... بنجاح.",
    "received_at": "2026-09-13T10:15:22.000Z",
    "ingested_at": "2026-09-13T10:15:30.900Z",
    "provider": "etisalat_money",
    "parsed": true,
    "amount": 200,
    "amount_cents": 20000,
    "sender_phone": "01061916846",
    "sender_name": "ABANWB N ASRAAEYL",
    "balance_cents": 42990,
    "reference": null,
    "status": "matched",
    "intent_id": "7c1d0f3e-...",
    "matched_at": "2026-09-13T10:15:31.190Z",
    "matched_by": "auto",
    "note": null,
    "verification": "verified",
    "expected_balance_cents": 42990,
    "reviewed_at": null
  }
}
```

`message.amount_cents` can be higher than `intent.amount_cents` (overpayment is accepted). Use `intent.reference` / `intent.metadata` to find your order.

## Headers

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-Tahweel-Event` | the event name |
| `X-Tahweel-Delivery` | delivery id (same as `id` in the body); retries reuse it |
| `X-Tahweel-Signature` | `t=<unix seconds>,v1=<hex>` where `hex = HMAC-SHA256(WEBHOOK_SECRET, "<t>.<raw body>")` |
| `User-Agent` | `tahweel-webhooks/1` |

## Delivery and retries

- The first attempt happens immediately. A `2xx` response marks the delivery `delivered`.
- Anything else (non-2xx, timeout after 10 s, connection error) schedules a retry after 1 min, 5 min, 15 min, 1 h, 3 h, 6 h, 12 h. After 8 attempts the delivery is `failed` and stays in the dashboard for a manual **Redeliver**.
- Respond quickly (enqueue the work, return `200`). Handle duplicates: a retry after a timeout may reach you twice, so key your side effects on `id` or on `intent.id`.

## Verifying the signature

Compute the HMAC over the **raw request body bytes** (not a re-serialised JSON object), compare in constant time, and reject timestamps older than a few minutes.

### Node.js (Express)

```js
import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

const app = express();
const SECRET = process.env.TAHWEEL_WEBHOOK_SECRET;

function verify(header, rawBody) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!parts.t || !parts.v1 || age > 300) return false;
  const expected = createHmac('sha256', SECRET).update(`${parts.t}.${rawBody}`).digest('hex');
  return expected.length === parts.v1.length && timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}

app.post('/webhooks/tahweel', express.raw({ type: 'application/json' }), (req, res) => {
  const raw = req.body.toString('utf8');
  if (!verify(req.get('x-tahweel-signature') ?? '', raw)) return res.status(401).end();
  const event = JSON.parse(raw);
  if (event.event === 'payment.matched') {
    markOrderPaid(event.intent.reference, event.message.amount_cents, event.id);
  }
  res.status(200).end();
});
```

### PHP

```php
<?php
$secret = getenv('TAHWEEL_WEBHOOK_SECRET');
$raw = file_get_contents('php://input');
$header = $_SERVER['HTTP_X_TAHWEEL_SIGNATURE'] ?? '';

parse_str(str_replace(',', '&', $header), $parts);
$t = $parts['t'] ?? '';
$v1 = $parts['v1'] ?? '';
if ($t === '' || $v1 === '' || abs(time() - (int) $t) > 300) {
    http_response_code(401);
    exit;
}
$expected = hash_hmac('sha256', $t . '.' . $raw, $secret);
if (!hash_equals($expected, $v1)) {
    http_response_code(401);
    exit;
}

$event = json_decode($raw, true);
if ($event['event'] === 'payment.matched') {
    markOrderPaid($event['intent']['reference'], $event['message']['amount_cents'], $event['id']);
}
http_response_code(200);
```

## Testing locally

- Dashboard → Webhooks → **Send test event** posts `webhook.test` to the configured URL.
- Point the webhook URL at a request bin or `npx smee-client` during development. A URL always comes with a secret: the Settings page refuses a URL without one, and the server refuses to start with `WEBHOOK_URL` and no `WEBHOOK_SECRET`.
- Settings page values take precedence over the environment variables; clearing a field in the dashboard falls back to the variable. The secret is write-only: the API reports `webhook_secret_set` but never returns it.
