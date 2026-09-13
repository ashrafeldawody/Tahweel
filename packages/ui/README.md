# @tahweel/ui

The Tahweel admin dashboard: a small React single-page app for the people who run a Tahweel server. It shows the listener phones, every forwarded wallet SMS with its parsed receipt fields, payment intents, webhook deliveries and the server settings, and lets an operator match, ignore or reopen receipts by hand.

It talks only to the `/admin/*` JSON endpoints of `@tahweel/server` (see `docs/openapi.json` at the repo root) using the JWT returned by `POST /admin/login`.

## Stack

- Vite 7, React 19, TypeScript 5.9, react-router-dom 7
- Mantine 8 (`core`, `hooks`, `notifications`) with a custom teal palette built around `#0F766E`
- `@tabler/icons-react` for icons, `dayjs` (utc + timezone plugins) for dates
- vitest 4 + Testing Library + jsdom for tests

## Run it in development

Start the server on port 3000 first (from the repo root):

```sh
pnpm dev:server
```

Then start the dashboard:

```sh
pnpm --filter @tahweel/ui dev
```

Vite serves the app on <http://localhost:5173> and proxies `/admin`, `/health`, `/docs`, `/docs-json`, `/api` and `/ingest` to `http://localhost:3000`, so the browser never has to deal with CORS. Log in with the server's `ADMIN_PASSWORD`.

## Test

```sh
pnpm --filter @tahweel/ui test
```

Tests run in jsdom with a hand-written `fetch` mock (`src/test/fetchMock.ts`) and render through `renderWithProviders` (`src/test/render.tsx`), which wraps the page in `MantineProvider` (test env, no transitions or portals), a `MemoryRouter` and the settings context. `src/test/setup.ts` stubs `matchMedia`, `ResizeObserver` and `scrollIntoView`, which Mantine expects in a browser.

`pnpm --filter @tahweel/ui typecheck` runs `tsc --noEmit` on its own.

## Build

```sh
pnpm --filter @tahweel/ui build
```

This typechecks and writes the static bundle to `packages/ui/dist` (`index.html`, `assets/*`, `favicon.svg`). `pnpm --filter @tahweel/ui preview` serves that folder locally for a smoke test, but without the API proxy.

## How the server serves it

`@tahweel/server` looks for a built dashboard at start-up:

1. `UI_DIST`, if set in the server environment, must point at a folder that contains `index.html`.
2. Otherwise it tries `packages/server/public` and then `packages/ui/dist` (the default when you build this package in the monorepo).

When a build is found the server serves `index.html` for `/` and every `/app/*` path, the hashed files under `/assets/*` and `/favicon.svg`. If none is found it logs a warning and only the JSON API and Swagger UI (`/docs`) are available. The app uses `BrowserRouter`, so any reverse proxy in front of the server must forward `/app/*` to it unchanged.

## Routes

| Path | Page |
| --- | --- |
| `/` | redirects to `/app/overview` |
| `/app/login` | password login |
| `/app/overview` | counters, warnings, recent messages, registered parsers (auto-refreshes every 30 s) |
| `/app/devices` | listener phones with online state, battery, network, queue and last-seen times |
| `/app/messages` | forwarded SMS with status filters, search, device filter, pagination and a detail drawer with Match / Ignore / Reopen / Retrust |
| `/app/intents` | payment intents with filters, a "New intent" form and cancel |
| `/app/webhooks` | delivery log with payload viewer, redeliver and "Send test event" |
| `/app/settings` | trusted senders, matching rules, alerts, timezone, re-run matching and server health |

## Configuration notes

- The admin JWT is stored in `localStorage` under `tahweel.admin_token`. Any `401` from the API clears it and sends the browser back to the login page.
- Timestamps are rendered in the `timezone` from the server settings (IANA name, e.g. `Africa/Cairo`); an unknown or missing timezone falls back to the browser's local zone.
- Amounts are shown from `amount_cents` with the `currency` from settings.
- SMS bodies are rendered with `dir="auto"` so Arabic receipts read correctly.
- The dev server port (5173) and the proxy target (`http://localhost:3000`) live in `vite.config.ts`.
- `base` is `/`, so the bundle must be served from the origin root, which is what the Tahweel server does.
