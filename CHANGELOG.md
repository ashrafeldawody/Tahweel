# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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
