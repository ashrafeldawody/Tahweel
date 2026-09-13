import { createRoute } from '@hono/zod-openapi';
import { ingestAuth } from '../../auth/middleware.js';
import { nowIso } from '../../config/time.js';
import type { AppContext } from '../../context.js';
import { createRouter } from '../hono.js';
import {
  ErrorResponses,
  HeartbeatRequest,
  HeartbeatResponse,
  IngestSmsRequest,
  IngestSmsResponse,
  jsonBody,
  jsonResponse,
} from '../schemas.js';

const TAG = 'Ingest (phone)';
const SECURITY = [{ IngestToken: [] }];

const ingestSms = createRoute({
  method: 'post',
  path: '/ingest/sms',
  tags: [TAG],
  summary: 'Forward a batch of SMS from the listener phone',
  description:
    'Idempotent. The phone forwards every SMS; the server classifies each one (receipt or not, trusted sender, age) and tries to match receipts to pending payment intents. Duplicate fingerprints are accepted but not re-inserted.',
  security: SECURITY,
  request: { body: jsonBody(IngestSmsRequest) },
  responses: { 200: jsonResponse(IngestSmsResponse, 'Per-message verdicts'), 400: ErrorResponses[400], 401: ErrorResponses[401] },
});

const heartbeat = createRoute({
  method: 'post',
  path: '/ingest/heartbeat',
  tags: [TAG],
  summary: 'Device heartbeat',
  description: 'Sent every 60 s by the listener. Missing heartbeats past the offline threshold raise a device.offline event.',
  security: SECURITY,
  request: { body: jsonBody(HeartbeatRequest) },
  responses: { 200: jsonResponse(HeartbeatResponse, 'Acknowledged'), 400: ErrorResponses[400], 401: ErrorResponses[401] },
});

export function ingestRoutes(ctx: AppContext) {
  const router = createRouter();
  router.use('/ingest/*', ingestAuth(ctx.env));

  router.openapi(ingestSms, async (c) => {
    const body = c.req.valid('json');
    const result = await ctx.matcher.ingest(body.device_id, body.messages);
    return c.json({ ...result, server_time: nowIso() }, 200);
  });

  router.openapi(heartbeat, async (c) => {
    const body = c.req.valid('json');
    const device = await ctx.devices.heartbeat(body);
    return c.json({ ok: true as const, device, server_time: nowIso() }, 200);
  });

  return router;
}
