# Development

## Repository layout

| Path | What | Docs |
|---|---|---|
| `packages/server` | Node 24 + TypeScript server: Hono + Zod (OpenAPI generated from the schemas), Kysely over SQLite (default) or PostgreSQL, signed webhooks with retries, admin API, Swagger UI at `/docs` | [packages/server/README.md](../packages/server/README.md) |
| `packages/ui` | Admin dashboard (React + Vite + Mantine) served by the server: Overview, Devices, Messages, Intents, Webhook deliveries, Settings | [packages/ui/README.md](../packages/ui/README.md) |
| `apps/listener` | Android app (Kotlin) that forwards SMS with a queue, retries, heartbeat, debug and log screens; holds only `RECEIVE_SMS` | [apps/listener/README.md](../apps/listener/README.md), [listener.md](listener.md) |
| `docs/` | API, webhooks, parsers, listener, deployment guides and the exported `openapi.json` | [README.md](README.md) |
| `postman/` | Postman collection + environment generated from the OpenAPI document | [postman/README.md](../postman/README.md) |
| `scripts/` | `build-listener.ps1` / `.sh`, `generate-postman.mjs`, `lint-no-comments.mjs` | |

## Commands

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

Run the server locally without Docker: `pnpm install`, `pnpm --filter @tahweel/ui build`, then `pnpm --filter @tahweel/server dev` with a `packages/server/.env` (see `packages/server/.env.example`).

## CI and releases

CI (`.github/workflows/ci.yml`) runs the server suite on SQLite and on a PostgreSQL service container, the UI suite, the builds, the OpenAPI/Postman freshness check, a Docker build and a best-effort Android `assembleDebug`. Pushing a `v*` tag runs the same suite and then publishes the Docker image to GHCR and the listener APK to a GitHub Release (see [deploy.md](deploy.md#cutting-a-release)).
