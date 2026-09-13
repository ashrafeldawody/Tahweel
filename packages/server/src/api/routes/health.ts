import { createRoute } from '@hono/zod-openapi';
import { nowIso, parseIso } from '../../config/time.js';
import type { AppContext } from '../../context.js';
import { pingDatabase } from '../../db/connection.js';
import { createRouter } from '../hono.js';
import { HealthResponse, jsonResponse } from '../schemas.js';

const health = createRoute({
  method: 'get',
  path: '/health',
  tags: ['Health'],
  summary: 'Liveness and database check',
  responses: { 200: jsonResponse(HealthResponse, 'Healthy'), 503: jsonResponse(HealthResponse, 'Database unreachable') },
});

export function healthRoutes(ctx: AppContext) {
  const router = createRouter();
  router.openapi(health, async (c) => {
    const ok = await pingDatabase(ctx.db);
    const body = {
      ok,
      version: ctx.version,
      database: ctx.dialect,
      uptime_seconds: Math.round((Date.now() - parseIso(ctx.startedAt)) / 1000),
      server_time: nowIso(),
    };
    return ok ? c.json(body, 200) : c.json(body, 503);
  });
  return router;
}
