import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './api/app.js';
import { loadEnv } from './config/env.js';
import { logger, setLogLevel } from './config/log.js';
import { buildContext } from './context.js';
import { migrateToLatest, openDatabase } from './db/connection.js';
import { startJobs } from './jobs/scheduler.js';

const log = logger('main');

function defaultUiDist(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, '..', 'public'), resolve(here, '..', '..', 'ui', 'dist')];
  return candidates.find((dir) => existsSync(resolve(dir, 'index.html')));
}

async function main(): Promise<void> {
  const env = loadEnv();
  setLogLevel(env.LOG_LEVEL);
  if (!env.UI_DIST) env.UI_DIST = defaultUiDist();

  const handle = openDatabase(env.DATABASE_URL);
  const applied = await migrateToLatest(handle.db);
  log.info(`database ${handle.dialect} at ${handle.location}${applied.length ? ` (applied ${applied.join(', ')})` : ''}`);

  const ctx = await buildContext(env, handle);
  const app = createApp(ctx);
  const stopJobs = startJobs(ctx);
  const webhookConfigured = await ctx.webhooks.isConfigured();

  const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
    log.info(`Tahweel ${ctx.version} listening on http://${info.address}:${info.port} (docs at /docs)`);
    if (!webhookConfigured) log.warn('no webhook URL configured (Settings page or WEBHOOK_URL): matches are recorded but no webhook is sent');
  });

  const shutdown = async (signal: string) => {
    log.info(`${signal} received, shutting down`);
    stopJobs();
    server.close();
    await handle.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: Error) => {
  log.error(error.message);
  process.exit(1);
});
