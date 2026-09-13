# Tahweel (تحويل)

**Turn a spare Android phone into a payment gateway for your mobile wallet.**

Personal wallets such as Vodafone Cash, e& money or Orange Cash have no merchant API, but every transfer you receive arrives as an SMS from the operator. Tahweel is a self-hosted, open-source pipeline that makes that SMS usable by software: a dedicated Android phone holding the wallet SIM forwards every incoming message to a server you run; the server parses wallet receipts, checks that they really came from the operator, matches them against **payment intents** your own system registered through the API, and fires a **signed webhook** so you can grant whatever was paid for — the same integration shape as a card gateway, without the gateway. Nobody reads screenshots on WhatsApp any more.

- **Self-hosted, no cloud, no account.** One container or one Node process; your data never leaves it (see [Your data stays with you](#your-data-stays-with-you)).
- **Gateway-style API.** `POST /api/v1/intents`, receive `payment.matched`, or poll by reference. Signed webhooks with retries, Swagger UI, Postman collection.
- **Operator dashboard.** Devices, every SMS with its verdict, intents, webhook deliveries, settings, with manual match / ignore / re-trust for the edge cases.
- **Wallet templates as drop-in files.** Supporting a new operator's SMS format is one parser file plus real sample messages.

```
customer pays 200 EGP to your wallet number
        │
        ▼ (carrier SMS: "تم استلام مبلغ 200.00 ج.م من رقم 0106… ")
┌────────────────┐   POST /ingest/sms   ┌────────────────────┐  payment.matched  ┌─────────────┐
│ Tahweel        │ ───────────────────▶ │ Tahweel server     │ ────────────────▶ │ your system │
│ Listener phone │   (bearer token)     │ parse · gate ·     │  signed webhook   │ grants the  │
│ (Android)      │ ◀─────────────────── │ match · webhook    │ ◀──────────────── │ order       │
└────────────────┘   per-message verdict└────────────────────┘  POST /api/v1/    └─────────────┘
                                                 ▲              intents (API key)
                                                 │ admin dashboard (password → JWT)
```

## Why

In Egypt and similar markets, small businesses get paid through mobile wallets. There is no merchant API for a personal wallet: the only trustworthy record of a transfer is the SMS the operator sends to the wallet phone. Today the customer transfers, screenshots the wallet app, sends the screenshot on WhatsApp, and a human compares it with the phone. Tahweel turns that phone into a payment gateway: the phone becomes a durable SMS pipe and every rule (parsing, trust, matching, notifications) moves to a server you control, so a rule change is a deploy and never an APK reinstall.

## What is in this repository

| Path | What | Docs |
|---|---|---|
| `packages/server` | Node 24 + TypeScript server: Hono + Zod (OpenAPI generated from the schemas), Kysely over SQLite (default) or PostgreSQL, signed webhooks with retries, admin API, Swagger UI at `/docs` | [packages/server/README.md](packages/server/README.md) |
| `packages/ui` | Admin dashboard (React + Vite + Mantine) served by the server: Overview, Devices, Messages, Intents, Webhook deliveries, Settings | [packages/ui/README.md](packages/ui/README.md) |
| `apps/listener` | Android app (Kotlin) that forwards SMS with a queue, retries, heartbeat, debug and log screens; holds only `RECEIVE_SMS` | [apps/listener/README.md](apps/listener/README.md), [docs/listener.md](docs/listener.md) |
| `docs/` | API, webhooks, parsers, listener, deployment guides and the exported `openapi.json` | [docs/README.md](docs/README.md) |
| `postman/` | Postman collection + environment generated from the OpenAPI document | [postman/README.md](postman/README.md) |
| `scripts/` | `build-listener.ps1` / `.sh`, `generate-postman.mjs`, `lint-no-comments.mjs` | |

## Architecture

```mermaid
flowchart LR
  subgraph phone[Tahweel Listener - Android]
    R[SmsReceiver] --> Q[(SQLite queue)]
    Q --> S[ForwarderService<br/>batches of 50, backoff]
    W[KeepAliveWorker<br/>every 15 min] --> S
  end
  subgraph server[Tahweel server]
    I[POST /ingest/sms] --> P[parsers/*.parser.ts]
    P --> G{gates}
    G -- sender id not on allowlist --> U[untrusted_sender]
    G -- older than max_age_hours --> ST[stale]
    G -- not a receipt --> N[not_receipt]
    G -- ok --> M[matcher<br/>lock message, claim intent]
    M -- no pending intent --> X[unmatched]
    M -- matched --> WH[webhook deliveries<br/>HMAC-SHA256, retries]
    H[POST /ingest/heartbeat] --> D[(devices)]
    J[jobs: reconcile, webhook retries,<br/>offline sweep] --> M
    J --> WH
    A[admin API, JWT] --> DB[(sqlite or postgres)]
    API[POST /api/v1/intents, X-Api-Key] --> M
  end
  S --> I
  S -- heartbeat 60 s --> H
  WH --> YOU[your backend]
  YOU --> API
  UI[Admin dashboard] --> A
```

## 10-minute quickstart

Prebuilt images are published to GitHub Container Registry for every release: `ghcr.io/ashrafeldawody/tahweel` with the tags `latest`, `<major.minor>` and `<major.minor.patch>`. The image contains the server and the dashboard; its only state is the `/app/data` volume (SQLite) unless `DATABASE_URL` points at PostgreSQL. The listener APK for the phone is attached to the same [release](https://github.com/ashrafeldawody/tahweel/releases/latest).

### Option A: run the image, nothing to clone

```bash
export INGEST_TOKEN=$(openssl rand -hex 32) API_KEY=$(openssl rand -hex 32) ADMIN_PASSWORD='choose-a-long-password'
docker run -d --name tahweel --restart unless-stopped \
  -p 3000:3000 -v tahweel-data:/app/data \
  -e INGEST_TOKEN -e API_KEY -e ADMIN_PASSWORD \
  ghcr.io/ashrafeldawody/tahweel:latest
echo "phone token: $INGEST_TOKEN"
```

Or as a compose file next to your other services:

```yaml
services:
  tahweel:
    image: ghcr.io/ashrafeldawody/tahweel:0.1
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      INGEST_TOKEN: change-me-32-chars-minimum-for-the-phone
      API_KEY: change-me-32-chars-minimum-for-your-backend
      ADMIN_PASSWORD: change-me-dashboard-password
    volumes:
      - ./tahweel-data:/app/data
```

Pin a version tag in production and upgrade with `docker compose pull && docker compose up -d`; migrations run on boot. Every variable is listed in [docs/deploy.md](docs/deploy.md). The webhook URL and secret can be set here (`WEBHOOK_URL` + `WEBHOOK_SECRET`) or later on the dashboard's Settings page.

### Option B: clone the repository

Use this for the bundled compose file with its PostgreSQL profile, or to build from source.

1. Clone and create the environment file:
   ```bash
   git clone https://github.com/ashrafeldawody/tahweel.git && cd tahweel
   cp .env.example .env
   ```
2. Edit `.env`: set three secrets (`INGEST_TOKEN`, `API_KEY`, `ADMIN_PASSWORD`). Generate secrets with `openssl rand -hex 32`.
3. Start:
   ```bash
   docker compose pull && docker compose up -d
   ```
   The server listens on `http://localhost:3000`, keeps its SQLite file in `./data/`, and applies migrations on boot. Prefer PostgreSQL? `docker compose --profile postgres up -d` and set `DATABASE_URL=postgres://tahweel:tahweel@postgres:5432/tahweel`. To build from source instead of pulling: `docker compose up -d --build`.

### Then, with either option

4. Open the dashboard at `http://localhost:3000/` and log in with `ADMIN_PASSWORD`. Swagger is at `/docs`, the OpenAPI JSON at `/docs-json`, health at `/health`.
5. Install the listener APK from the [latest release](https://github.com/ashrafeldawody/tahweel/releases/latest) (or build it yourself, see [docs/listener.md](docs/listener.md)), open it on the phone, enter your server URL and `INGEST_TOKEN`, grant everything, press **Test connection**. The phone appears under **Devices**.
6. Send yourself a 1 EGP transfer from another wallet: it shows under **Messages** as `unmatched` within a minute. Ignore it.
7. Register a payment intent from your backend and let the customer pay:
   ```bash
   curl -X POST http://localhost:3000/api/v1/intents \
     -H "X-Api-Key: $API_KEY" -H "content-type: application/json" \
     -d '{"reference":"order-1001","amount":200,"sender_phone":"01061916846","expires_in_minutes":120,"metadata":{"order_id":1001}}'
   ```
   When the matching receipt arrives, Tahweel POSTs `payment.matched` to your webhook. Poll `GET /api/v1/intents/by-reference/order-1001` if you prefer.

Without Docker: `pnpm install`, `pnpm --filter @tahweel/ui build`, then `pnpm --filter @tahweel/server dev` with a `packages/server/.env` (see `packages/server/.env.example`).

## Phone setup checklist

A Samsung with One UI is the reference device; other vendors have equivalent switches.

- Install the APK over ADB (`adb install -r …`) or with Play Protect scanning paused for a minute: the app needs `RECEIVE_SMS`, which the Play Store does not allow for this use and which makes Play Protect block a sideloaded install ("App blocked to protect your device"). Details in [docs/listener.md](docs/listener.md#installing-and-configuring).
- In the app: server URL, `INGEST_TOKEN`, a device name → **Save** → **Test connection** → **Grant everything** (SMS, notifications, battery optimisation exemption).
- Settings → Battery → Background usage limits: add Tahweel Listener to **Never sleeping apps**, turn **Adaptive battery** off; lock the app in Recents.
- **No screen lock** (after a reboot the SMS receiver only runs before first unlock when the phone has no lock), **SIM PIN off**, auto-restart schedule off.
- Keep it on the charger with Wi-Fi and mobile data on. Reboot once and confirm the heartbeat resumes on the Devices page.
- Wallet apps must stay logged in and the wallet SIM must be the one receiving the operator SMS.

## How matching works

1. The phone forwards **every** SMS with a `fingerprint = sha256(address|body|smsc_timestamp)`. Duplicates are accepted and dropped.
2. The parser registry (`packages/server/src/parsers/`) picks the provider whose `detect()` claims the message and extracts amount, sender phone (normalised to 11 local digits), sender name, balance and reference. Anything that is not an incoming transfer is stored as `not_receipt` (OTPs, marketing, outgoing transfers).
3. **Sender gate**: the originating address must be an alphanumeric operator sender id on the trusted list (defaults come from the parsers; editable in Settings). Ordinary phone numbers never pass. Otherwise the row is `untrusted_sender`.
4. **Age gate**: receipts older than `max_age_hours` (default 48) are stored as `stale` and never auto-matched (the inbox import after downtime must not re-credit old payments).
5. **Matching**: the oldest pending, unexpired intent with the same `sender_phone` and `amount <= paid amount` wins (overpayment is fine, underpayment never matches). Intents without a sender phone must opt in with `allow_amount_only` and only match an **exact** amount when exactly one such intent is pending.
6. **Lock before apply**: the message flips `unmatched → matching` and the intent `pending → matched` with conditional updates, so two reconcilers (or two processes) cannot apply the same receipt twice. Runs on every ingest, on every intent creation, and every `RECONCILE_INTERVAL_MINUTES`.
7. **Webhook**: `payment.matched` with the intent and the message, signed with the webhook secret, retried with backoff for up to 8 attempts. Everything else is visible in the dashboard where an operator can match by hand, ignore, reopen or re-trust.

## Security model

### Your data stays with you

Tahweel has no cloud component, no account, no telemetry and no third-party SDK in the app or the server; the code is MIT-licensed and small enough to audit. The complete list of network traffic is:

| From | To | What |
|---|---|---|
| The listener phone | **your** server URL, nothing else | Sender id, text and timestamp of the SMS the phone receives, plus a heartbeat (battery, network, queue size) |
| Your server | the webhook URL **you** configure | Signed `payment.matched` and device events |
| Your server | your own SMTP server, only if `SMTP_URL` is set | Operator alerts |

Receipts, intents, deliveries and settings live in a SQLite file or a PostgreSQL database on your machine; back them up, export them or delete them as you please. Nobody else — not the wallet operator, not a payment provider, not the authors of this project — can see who paid you what. Because the phone forwards every SMS it receives, dedicate a phone to the wallet SIM and keep the server URL on HTTPS.

### Credentials and gates

- Three independent credentials: `INGEST_TOKEN` (phone → `/ingest/*`, bearer), `API_KEY` (your backend → `/api/v1/*`, `X-Api-Key`), `ADMIN_PASSWORD` (dashboard → JWT for `/admin/*`). All compared timing-safe. Rotate by changing the env value and restarting (then update the phone / your backend); set `JWT_SECRET` explicitly if you want admin sessions to survive a password change.
- A receipt-looking SMS proves nothing by itself: anyone can text the phone "تم استلام مبلغ …". Only messages whose **originating address** is on the trusted sender allowlist can auto-match. Numeric short codes must be listed exactly.
- The age gate stops replayed history from crediting twice.
- The fingerprint makes ingest idempotent.
- Webhooks carry `X-Tahweel-Signature: t=<unix>,v1=<hmac-sha256(secret, "<t>.<body>")>`; verify it and reject stale timestamps (see [docs/webhooks.md](docs/webhooks.md)).
- Run behind HTTPS (reverse proxy); the listener refuses nothing, so a plain-HTTP server URL means the token travels in clear.

## API overview

Swagger UI at `/docs`, OpenAPI JSON at `/docs-json` (also committed as [docs/openapi.json](docs/openapi.json)), a Postman collection in [postman/](postman/). Details in [docs/api.md](docs/api.md).

| Group | Auth | Endpoints |
|---|---|---|
| Health | none | `GET /health` |
| Ingest | `Authorization: Bearer INGEST_TOKEN` | `POST /ingest/sms` (batch ≤ 50, per-message verdicts), `POST /ingest/heartbeat` |
| Integrator | `X-Api-Key` | `POST /api/v1/intents`, `GET /api/v1/intents?status=`, `GET /api/v1/intents/:id`, `GET /api/v1/intents/by-reference/:reference`, `DELETE /api/v1/intents/:id` |
| Admin | JWT from `POST /admin/login` | overview, messages (list/search, match, ignore, reopen, retrust), intents (list/create/cancel), devices, reconcile, settings, webhook deliveries (list/redeliver/test), health |

## Adding a new wallet SMS template

Drop `packages/server/src/parsers/<provider>.parser.ts` (exporting `defineParser({ id, name, senderIds, detect, parse })`) and `<provider>.samples.json` with real messages and their expected output. The registry discovers the file at boot, its sender ids join the default trusted list, and the generic test asserts every sample. No other edit needed. Worked example in [docs/parsers.md](docs/parsers.md).

## Limits (deliberate)

- **No USSD polling** and no reading of wallet-app notifications: the operator SMS is the only source.
- **Sender ids are spoofable on some networks**, which is why the allowlist plus the age gate plus a per-intent sender phone are all on by default. Keep `allow_amount_only` off unless you accept that risk.
- **One phone = one wallet number.** Several phones can report to one server (each is a device), but a message is matched by amount and sender phone only, never by the receiving wallet.
- **Orange Cash receipts carry the sender's name but not their number** (and an agent cash-in carries neither), so they cannot satisfy an intent bound to a `sender_phone`. They auto-match intents created with `allow_amount_only` and otherwise wait under **Messages** for a manual match.
- Egyptian phone numbers (`01xxxxxxxxx`) are assumed by the bundled parsers; the normaliser lives in one file and is easy to extend.
- When a carrier changes its template, receipts land as `not_receipt`: nothing is lost, you add a sample and a parser tweak.

## Roadmap

- Parsers for InstaPay and bank transfer SMS with community samples; matching Orange Cash receipts by sender name.
- Multi-country phone normalisation.
- Per-integrator API keys and webhook secrets.
- Dashboard charts and CSV export.
- Push notification channel for operator alerts (Telegram / ntfy).

## Development

```bash
pnpm install
pnpm --filter @tahweel/server test          # SQLite temp file
DATABASE_URL=postgres://... pnpm --filter @tahweel/server exec vitest run --no-file-parallelism
pnpm --filter @tahweel/ui test
pnpm build                                  # server + ui
pnpm openapi && pnpm postman                # regenerate docs/openapi.json and postman/
node scripts/lint-no-comments.mjs           # the codebase carries no comments by design
scripts/build-listener.ps1 [-Debug] [-Install]   # or scripts/build-listener.sh
```

CI (`.github/workflows/ci.yml`) runs the server suite on SQLite and on a PostgreSQL service container, the UI suite, the builds, the OpenAPI/Postman freshness check, a Docker build and a best-effort Android `assembleDebug`. Pushing a `v*` tag runs the same suite and then publishes the Docker image to GHCR and the listener APK to a GitHub Release (see [docs/deploy.md](docs/deploy.md#cutting-a-release)).

## License

MIT, © Ashraf Eldawody. See [LICENSE](LICENSE).
