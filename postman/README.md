# Postman collection

`Tahweel.postman_collection.json` covers every endpoint of the server with example bodies; `Tahweel.postman_environment.json` holds the variables.

Both files are generated from [../docs/openapi.json](../docs/openapi.json) by `scripts/generate-postman.mjs` (`pnpm postman` from the repository root). Do not edit them by hand; change the Zod schemas or the generator and regenerate.

## Using it

1. Import both files into Postman and select the **Tahweel local** environment.
2. Fill `baseUrl` (default `http://localhost:3000`), `apiKey` (`API_KEY`), `ingestToken` (`INGEST_TOKEN`) and `adminPassword` (`ADMIN_PASSWORD`).
3. Run **Admin → Exchange the admin password for a JWT**: its test script stores the token in `adminToken`, which every `/admin/*` request uses.
4. **Payment intents → Create a payment intent** stores the returned id in `intentId` for the follow-up requests (edit the `:id` path variable or reuse `{{intentId}}`).
5. **Ingest → Forward a batch of SMS** carries a real e& money receipt body; change `sender_phone` in the intent to `01061916846` and send both to watch a match happen end to end.

Folders mirror the OpenAPI tags: Health, Ingest (phone), Payment intents (integrator API), Admin (dashboard). Query parameters are present but disabled by default; enable the ones you need.
