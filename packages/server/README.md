# @tahweel/server

The Tahweel server: ingests SMS from the listener phone, parses wallet receipts, gates them, matches them to payment intents and fires signed webhooks. Also serves the Swagger UI (`/docs`) and the built admin dashboard.

## Stack

- Node 24, TypeScript, ES modules. No framework magic: [Hono](https://hono.dev) with `@hono/zod-openapi` (every route is a Zod schema, the OpenAPI document is generated from them), Zod 4 for validation, [Kysely](https://kysely.dev) as the typed query builder.
- Database: SQLite through `better-sqlite3` (default, single file, WAL) or PostgreSQL through `pg`, selected by `DATABASE_URL`. Migrations are written once with Kysely's schema builder and run on both dialects at boot (`src/db/migrations/`).
- Background jobs are plain `setInterval`s (`src/jobs/scheduler.ts`): reconcile every `RECONCILE_INTERVAL_MINUTES`, webhook retries every 30 s, device offline sweep every minute.
- Tests: Vitest against a temporary SQLite file, or against PostgreSQL when `DATABASE_URL` points at one.

## Layout

```
src/
  main.ts                 boot: env → db + migrations → parsers → context → app → jobs
  context.ts              builds the service graph (no DI container, plain constructors)
  config/                 env (Zod-validated), logger, time and id helpers
  db/                     Kysely schema types, connection (dialect switch), migrations
  parsers/                one file per wallet operator + samples (see docs/parsers.md)
  services/               settings, trusted senders, intents, matching, webhooks, devices, alerts, mail, admin queries
  auth/                   timing-safe token compare, admin JWT (jose), Hono middlewares
  api/                    schemas.ts (Zod + OpenAPI), routes/{health,ingest,intents,admin}.ts, app.ts
  jobs/scheduler.ts
  test/harness.ts         temp database + local webhook stub + request helper
scripts/export-openapi.ts writes ../../docs/openapi.json
```

## Run

```bash
cp .env.example .env            # set INGEST_TOKEN, API_KEY, ADMIN_PASSWORD (+ WEBHOOK_URL/WEBHOOK_SECRET)
pnpm dev                        # tsx watch src/main.ts on :3000
pnpm build && pnpm start        # compiled dist/
pnpm migrate                    # apply migrations only
pnpm openapi:export             # regenerate docs/openapi.json
```

The dashboard is served when `UI_DIST` points at a built `packages/ui/dist` (auto-detected at `../ui/dist` or `./public` next to `dist/`).

## Test

```bash
pnpm test                                  # SQLite temp file per test file, parallel
DATABASE_URL=postgres://user:pass@localhost:5432/tahweel_test pnpm exec vitest run --no-file-parallelism
```

What is covered: every parser sample file (real e& money and Vodafone Cash messages, Arabic-Indic digits, `+20` prefixes, outgoing / OTP / marketing rejection), phone normalisation, the trusted-sender gate, matching integration (intent-then-sms, sms-then-intent, overpayment, underpayment, oldest-intent-first, expiry, amount-only rules, stale gate and manual override, stale demotion, untrusted sender and re-trust, duplicate fingerprints, concurrent lock, intent claimed once, webhook delivery + signature + retry + redeliver, per-intent webhook URL, ignore/reopen), authentication of every endpoint group, and the admin/ingest/integrator HTTP flows.

## Configuration

See [../../docs/deploy.md](../../docs/deploy.md) for every environment variable. Runtime settings (trusted senders, max age, auto-match, currency, timezone, intent TTL, offline threshold, notification switches) live in the `settings` table and are edited from the dashboard or `PATCH /admin/settings`.

## Adding a parser

Drop `src/parsers/<provider>.parser.ts` and `<provider>.samples.json`; nothing else. [../../docs/parsers.md](../../docs/parsers.md) walks through it.
