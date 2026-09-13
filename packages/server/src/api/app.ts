import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import { serveStatic } from '@hono/node-server/serve-static';
import type { AppContext } from '../context.js';
import { logger } from '../config/log.js';
import { HttpError } from '../services/errors.js';
import { adminRoutes } from './routes/admin.js';
import { healthRoutes } from './routes/health.js';
import { ingestRoutes } from './routes/ingest.js';
import { intentRoutes } from './routes/intents.js';

const log = logger('http');

export const OPENAPI_INFO = {
  openapi: '3.0.3',
  info: {
    title: 'Tahweel API',
    version: '0.1.0',
    description:
      'Self-hosted mobile-wallet SMS payment confirmation. Three credentials: the listener phone uses `Authorization: Bearer <INGEST_TOKEN>` on `/ingest/*`, integrators use `X-Api-Key: <API_KEY>` on `/api/v1/*`, and the dashboard exchanges `ADMIN_PASSWORD` for a JWT used as `Authorization: Bearer <token>` on `/admin/*`.',
    license: { name: 'MIT' },
  },
  tags: [
    { name: 'Health' },
    { name: 'Ingest (phone)', description: 'Called by the Tahweel Listener Android app' },
    { name: 'Payment intents (integrator API)', description: 'Create intents, poll their status, cancel them' },
    { name: 'Admin (dashboard)', description: 'Used by the bundled admin UI' },
  ],
};

export function createApp(ctx: AppContext) {
  const app = new OpenAPIHono();

  app.openAPIRegistry.registerComponent('securitySchemes', 'IngestToken', {
    type: 'http',
    scheme: 'bearer',
    description: 'INGEST_TOKEN from the server environment',
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'ApiKey', {
    type: 'apiKey',
    in: 'header',
    name: 'X-Api-Key',
    description: 'API_KEY from the server environment',
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'AdminToken', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'JWT returned by POST /admin/login',
  });

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json(error.toBody(), error.status as 400);
    log.error(`${c.req.method} ${c.req.path} failed: ${error.message}`, error.stack);
    return c.json({ error: 'internal_error' }, 500);
  });

  app.route('/', healthRoutes(ctx));
  app.route('/', ingestRoutes(ctx));
  app.route('/', intentRoutes(ctx));
  app.route('/', adminRoutes(ctx));

  app.doc('/docs-json', OPENAPI_INFO);
  app.get('/docs', swaggerUI({ url: '/docs-json' }));

  mountUi(app, ctx);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  return app;
}

function mountUi(app: OpenAPIHono, ctx: AppContext): void {
  const dist = ctx.env.UI_DIST;
  if (!dist) return;
  const index = join(dist, 'index.html');
  if (!existsSync(index)) {
    log.warn(`UI_DIST=${dist} has no index.html; dashboard not served`);
    return;
  }
  app.use('/assets/*', serveStatic({ root: dist }));
  app.get('/favicon.svg', serveStatic({ root: dist, path: 'favicon.svg' }));
  const html = readFileSync(index, 'utf8');
  app.get('/', (c) => c.html(html));
  app.get('/app/*', (c) => c.html(html));
  log.info(`serving dashboard from ${dist}`);
}
