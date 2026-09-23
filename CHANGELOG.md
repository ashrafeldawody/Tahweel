# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Protection against faked operator SMS. Anyone can send an SMS that shows `vf-cash` or `e& money` as the sender, so the trusted-sender list alone never proved a payment. Two opt-in settings put suspicious receipts in the new `held` status (reason in `note`):
  - `verify_balance` (default off): a receipt matches automatically only when its wallet balance equals the last confirmed balance of the same phone and wallet plus the amount, within `balance_margin` (default 0.02). Confirmed balances come only from verified receipts and operator-approved ones. Reasons: `balance_mismatch`, `no_balance`, `no_balance_history`.
  - `review_above_amount` (default off): receipts above the amount are held with `above_review_limit`.
- `POST /admin/messages/{id}/approve` and an **Approve** button on held messages. Approving (or matching by hand) makes the receipt's balance the new confirmed balance, which corrects drift after withdrawals.
- Messages carry `verification`, `expected_balance_cents` and `reviewed_at` (API, webhooks, dashboard). Held receipts send an e-mail alert and are released automatically once they pass; `POST /admin/reconcile` reports `released`.
- Listener: forwards only SMS from trusted sender ids or that mention money; OTPs and personal texts stay on the phone. The rules arrive in the heartbeat response (`forwarding`); `phone_filter` turns the filter off. The main screen shows the rules and how many SMS were kept on the phone.

### Upgrading

- Nothing changes until you turn on the balance check or set a review limit in Settings. After turning the balance check on, approve the first receipt once to set the starting balance.
- Older listener apps ignore the forwarding rules and keep forwarding everything; install the new APK to filter on the phone.

## [0.2.0] - 2026-09-13

### Changed

- Listener: `READ_SMS` is no longer requested. The inbox import and the debug inbox list are gone; the debug screen keeps the "send a test message" box. The app holds `RECEIVE_SMS` only, the smallest permission footprint that can still receive wallet receipts. Play Protect still blocks sideloaded installs on that permission alone; see [docs/listener.md](docs/listener.md#installing-and-configuring) for the ADB route.
- Dashboard: the Messages table shows the sender name as the primary "From" value when the receipt has no phone number.

### Added

- Orange Cash (Egypt) parser: transfers received (current and older Arabic templates, Arabic-Indic digits) and agent cash-ins. These receipts name the sender without a phone number, so `senderPhone` is now nullable; such receipts auto-match only `allow_amount_only` intents and can be matched by hand otherwise.
- Webhook URL and secret are editable on the dashboard's Settings page (`webhook_url` / write-only `webhook_secret` on `PATCH /admin/settings`); `WEBHOOK_URL` / `WEBHOOK_SECRET` remain as environment defaults.
- Release workflow: pushing a `v*` tag publishes `ghcr.io/ashrafeldawody/tahweel` and attaches the listener APK to a GitHub Release; the tag sets the APK `versionName` and derives `versionCode`.
- `docker-compose.yml` uses the published image (`TAHWEEL_VERSION` selects the tag); `--build` still builds from source.

## [0.1.0] - 2026-09-13

### Added

- Server (Hono + Zod OpenAPI, Kysely): SQLite by default, PostgreSQL through `DATABASE_URL`, shared migrations.
- Wallet SMS parsers as drop-in files with sample-driven tests: e& money and Vodafone Cash (Egypt), Arabic-Indic digit and phone normalisation.
- Payment intents API (`/api/v1/intents`) with reference, amount, sender phone, TTL, metadata and per-intent webhook URL; amount-only matching behind an explicit `allow_amount_only` flag.
- Matching engine: trusted-sender gate, age gate, fingerprint dedupe, lock-before-apply, reconcile on ingest / intent creation / interval.
- Signed webhooks (`X-Tahweel-Signature`, HMAC-SHA256) with stored deliveries, retries with backoff and manual redelivery; events `payment.matched`, `payment.unmatched_receipt`, `device.offline`, `device.online`, `webhook.test`.
- Ingest endpoints for the listener phone with per-message verdicts and heartbeats; device offline detection.
- Admin API and dashboard (React + Mantine): overview, devices, messages with manual match / ignore / reopen / retrust, intents, webhook deliveries, settings.
- Optional SMTP operator alerts.
- Android listener app (`com.tahweel.listener`): SMS receiver, durable queue, foreground service, WorkManager keepalive, boot receiver, inbox import, debug inbox and logs screens; build scripts for PowerShell and bash.
- Swagger UI at `/docs`, exported `docs/openapi.json`, generated Postman collection and environment.
- Docker image, docker compose (SQLite volume, optional PostgreSQL profile), GitHub Actions CI (SQLite + PostgreSQL test runs, UI tests, builds, Docker build, best-effort Android build).
