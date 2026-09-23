# Tahweel documentation

| Document | Read it when |
|---|---|
| [../README.md](../README.md) | You want the overview and the quickstart |
| [how-it-works.md](how-it-works.md) | You want the architecture, the matching rules, the limits and the roadmap |
| [security.md](security.md) | You want to know where your data goes and how credentials and gates protect it |
| [api.md](api.md) | You integrate your backend (intents, polling, ingest protocol, admin API) |
| [webhooks.md](webhooks.md) | You receive `payment.matched` and friends; includes Node and PHP signature verification |
| [parsers.md](parsers.md) | You add a wallet operator's SMS template |
| [listener.md](listener.md) | You build, install and operate the Android phone |
| [deploy.md](deploy.md) | You host it (env vars, docker compose, reverse proxy, backups, Postgres) |
| [development.md](development.md) | You work on the code (repository layout, tests, CI) |
| [openapi.json](openapi.json) | Machine-readable API; regenerate with `pnpm openapi` (served live at `/docs-json`) |

## Keeping `openapi.json` fresh

The OpenAPI document is generated from the Zod schemas in `packages/server/src/api/`. After changing a route or a schema run:

```bash
pnpm openapi      # writes docs/openapi.json
pnpm postman      # regenerates postman/ from it
```

CI fails when the committed files differ from the generated ones.
