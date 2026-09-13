# Deployment

Tahweel is one Node process plus a database file (SQLite) or a PostgreSQL connection. It serves the API, the Swagger UI and the admin dashboard on a single port.

## Environment

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `PORT` / `HOST` | no | `3000` / `0.0.0.0` | Listen address |
| `DATABASE_URL` | no | `sqlite:./data/tahweel.sqlite` | `sqlite:<path>` or `postgres://user:pass@host:5432/db` |
| `INGEST_TOKEN` | yes | | ≥ 16 chars; the listener phone's bearer token |
| `API_KEY` | yes | | ≥ 16 chars; your backend's `X-Api-Key` |
| `ADMIN_PASSWORD` | yes | | ≥ 8 chars; dashboard login |
| `JWT_SECRET` | no | derived from the password | Set it so admin sessions survive password rotation |
| `JWT_TTL_HOURS` | no | `24` | Admin session length |
| `WEBHOOK_URL` | no | | Default webhook target; intents can override it |
| `WEBHOOK_SECRET` | with `WEBHOOK_URL` | | ≥ 16 chars; HMAC key for `X-Tahweel-Signature` |
| `RECONCILE_INTERVAL_MINUTES` | no | `5` | Periodic re-matching / expiry / stale sweep |
| `UI_DIST` | no | auto | Folder with the built dashboard (`packages/ui/dist` or `public/` next to `dist/`) |
| `SMTP_URL`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM` | no | | Operator e-mail alerts (`smtps://user:pass@smtp.example.com:465`) |
| `LOG_LEVEL` | no | `info` | `debug` / `info` / `warn` / `error` |

Generate secrets: `openssl rand -hex 32`.

## Docker compose (recommended)

```bash
cp .env.example .env    # fill the secrets
docker compose up -d --build
docker compose logs -f tahweel
```

- Data lives in `./data` (SQLite + WAL files). Back it up by copying the folder while the container runs (SQLite WAL is safe to copy after `sqlite3 data/tahweel.sqlite ".backup backup.sqlite"`, or just stop the container first).
- PostgreSQL instead: `docker compose --profile postgres up -d` and set `DATABASE_URL=postgres://tahweel:tahweel@postgres:5432/tahweel` in `.env`. Migrations run automatically on boot for both dialects.
- Upgrade: `git pull && docker compose up -d --build`.

## Bare Node

```bash
pnpm install
pnpm --filter @tahweel/ui build
pnpm --filter @tahweel/server build
cd packages/server && cp .env.example .env   # edit
node dist/main.js
```

Run it under systemd or pm2; the process handles `SIGTERM` gracefully. `pnpm --filter @tahweel/server migrate` applies migrations without starting the server.

## Reverse proxy and TLS

Put Caddy, nginx or Traefik in front and terminate TLS there; the phone sends the ingest token as a bearer header, so plain HTTP over the internet is not acceptable.

Caddy:

```
tahweel.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

nginx:

```
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 60s;
}
```

Restrict `/admin` and `/docs` to your office IP or a VPN if you like; `/ingest/*` and `/api/v1/*` must stay reachable from the phone and from your backend respectively.

## Operations checklist

- **Health**: `GET /health` (used by the Docker healthcheck), `GET /admin/health` for details.
- **Alerts**: set `WEBHOOK_URL` for `device.offline` / `device.online` and optionally SMTP for e-mail. Watch the Devices page after any phone reboot.
- **Backups**: the database is the only state. SQLite: copy `data/`. PostgreSQL: `pg_dump`.
- **Rotation**: change `INGEST_TOKEN` / `API_KEY` / `ADMIN_PASSWORD` in `.env`, restart, update the phone and your backend.
- **Scaling**: one process is enough for one wallet phone (a busy wallet receives a few hundred SMS a day). Multiple phones can report to the same server. Running two server processes on one PostgreSQL is safe (conditional updates lock every message and intent), but pointless.
- **Time**: all timestamps are UTC. The dashboard renders them in the `timezone` setting.

## Running the test suite against PostgreSQL

```bash
createdb tahweel_test
DATABASE_URL=postgres://user:pass@localhost:5432/tahweel_test pnpm --filter @tahweel/server exec vitest run --no-file-parallelism
```

Tests truncate every table of that database, so never point them at production.
