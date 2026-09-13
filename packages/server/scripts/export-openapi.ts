import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, OPENAPI_INFO } from '../src/api/app.js';
import { loadEnv } from '../src/config/env.js';
import { buildContext } from '../src/context.js';
import { migrateToLatest, openDatabase } from '../src/db/connection.js';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '..', '..', '..', 'docs', 'openapi.json');

const env = loadEnv({
  INGEST_TOKEN: 'openapi-export-ingest-token',
  API_KEY: 'openapi-export-api-key-value',
  ADMIN_PASSWORD: 'openapi-export',
  DATABASE_URL: 'sqlite::memory:',
});
const handle = openDatabase(env.DATABASE_URL);
await migrateToLatest(handle.db);
const ctx = await buildContext(env, handle);
const app = createApp(ctx);
const document = app.getOpenAPIDocument(OPENAPI_INFO);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
await handle.close();
console.log(`wrote ${target} (${Object.keys(document.paths ?? {}).length} paths)`);
