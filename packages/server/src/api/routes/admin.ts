import { createRoute, z } from '@hono/zod-openapi';
import { adminAuth, type AdminVariables } from '../../auth/middleware.js';
import { secretsMatch } from '../../auth/tokens.js';
import { nowIso } from '../../config/time.js';
import type { AppContext } from '../../context.js';
import { HOUR_MS } from '../../config/time.js';
import { getParsers } from '../../parsers/registry.js';
import { serializeDelivery, serializeIntent, serializeMessage } from '../../services/serializers.js';
import { createRouter } from '../hono.js';
import {
  CreateIntentRequest,
  DeliverySchema,
  DeliveryStatus,
  DeviceSchema,
  ErrorResponses,
  IdParam,
  IntentSchema,
  IntentStatus,
  IntentWithMessage,
  LoginRequest,
  LoginResponse,
  MessageSchema,
  MessageStatus,
  OkResponse,
  PaginationQuery,
  SettingsPatchRequest,
  SettingsSchema,
  jsonBody,
  jsonResponse,
} from '../schemas.js';
import { intentWithMessage } from './intents.js';

const TAG = 'Admin (dashboard)';
const SECURITY = [{ AdminToken: [] }];

const login = createRoute({
  method: 'post',
  path: '/admin/login',
  tags: [TAG],
  summary: 'Exchange the admin password for a JWT',
  request: { body: jsonBody(LoginRequest) },
  responses: { 200: jsonResponse(LoginResponse, 'Bearer token for /admin/*'), 400: ErrorResponses[400], 401: ErrorResponses[401] },
});

const me = createRoute({
  method: 'get',
  path: '/admin/me',
  tags: [TAG],
  summary: 'Validate the current admin token',
  security: SECURITY,
  responses: { 200: jsonResponse(z.object({ sub: z.string(), role: z.literal('admin'), issued_at: z.string(), expires_at: z.string() }), 'Session'), 401: ErrorResponses[401] },
});

const OverviewSchema = z
  .object({
    messages: z.record(z.string(), z.number()),
    intents: z.record(z.string(), z.number()),
    webhooks: z.record(z.string(), z.number()),
    devices: z.object({ total: z.number(), online: z.number(), offline: z.number(), items: z.array(DeviceSchema) }),
    matched_last_24h: z.object({ count: z.number(), amount_cents: z.number() }),
    recent_messages: z.array(MessageSchema),
    parsers: z.array(z.object({ id: z.string(), name: z.string(), sender_ids: z.array(z.string()) })),
    webhook_configured: z.boolean(),
    mail_configured: z.boolean(),
    settings: SettingsSchema,
    server_time: z.string(),
  })
  .openapi('Overview');

const overview = createRoute({
  method: 'get',
  path: '/admin/overview',
  tags: [TAG],
  summary: 'Dashboard overview counters',
  security: SECURITY,
  responses: { 200: jsonResponse(OverviewSchema, 'Overview'), 401: ErrorResponses[401] },
});

const listMessages = createRoute({
  method: 'get',
  path: '/admin/messages',
  tags: [TAG],
  summary: 'List SMS messages with parse results',
  security: SECURITY,
  request: {
    query: PaginationQuery.extend({
      status: MessageStatus.optional(),
      q: z.string().optional().openapi({ example: '0106', description: 'Searches sender phone, name, body, address and reference' }),
      device_id: z.string().optional(),
    }),
  },
  responses: {
    200: jsonResponse(
      z.object({ items: z.array(MessageSchema), total: z.number().int(), limit: z.number().int(), offset: z.number().int(), counters: z.record(z.string(), z.number()) }),
      'Page of messages',
    ),
    401: ErrorResponses[401],
  },
});

const getMessage = createRoute({
  method: 'get',
  path: '/admin/messages/{id}',
  tags: [TAG],
  summary: 'Get one SMS message',
  security: SECURITY,
  request: { params: IdParam },
  responses: { 200: jsonResponse(MessageSchema.extend({ intent: IntentSchema.nullable() }), 'Message'), 401: ErrorResponses[401], 404: ErrorResponses[404] },
});

const matchMessage = createRoute({
  method: 'post',
  path: '/admin/messages/{id}/match',
  tags: [TAG],
  summary: 'Manually match a message to a pending intent',
  description: 'Overrides the stale / untrusted gates. Check the real wallet balance first.',
  security: SECURITY,
  request: { params: IdParam, body: jsonBody(z.object({ intent_id: z.string().min(1).openapi({ example: '7c1d0f3e-4a7b-4c1e-9c6d-2f5a8b9e0d11' }) })) },
  responses: { 200: jsonResponse(MessageSchema, 'Matched message'), 400: ErrorResponses[400], 401: ErrorResponses[401], 404: ErrorResponses[404], 409: ErrorResponses[409] },
});

const ignoreMessage = createRoute({
  method: 'post',
  path: '/admin/messages/{id}/ignore',
  tags: [TAG],
  summary: 'Ignore a message so it never matches',
  security: SECURITY,
  request: { params: IdParam },
  responses: { 200: jsonResponse(MessageSchema, 'Ignored message'), 401: ErrorResponses[401], 404: ErrorResponses[404], 409: ErrorResponses[409] },
});

const reopenMessage = createRoute({
  method: 'post',
  path: '/admin/messages/{id}/reopen',
  tags: [TAG],
  summary: 'Put an ignored, stale or untrusted receipt back into the matching queue',
  security: SECURITY,
  request: { params: IdParam },
  responses: { 200: jsonResponse(MessageSchema, 'Reopened message'), 400: ErrorResponses[400], 401: ErrorResponses[401], 404: ErrorResponses[404], 409: ErrorResponses[409] },
});

const retrustMessage = createRoute({
  method: 'post',
  path: '/admin/messages/{id}/retrust',
  tags: [TAG],
  summary: 'Re-evaluate an untrusted_sender message against the current trusted list',
  security: SECURITY,
  request: { params: IdParam },
  responses: { 200: jsonResponse(MessageSchema, 'Re-evaluated message'), 401: ErrorResponses[401], 404: ErrorResponses[404], 409: ErrorResponses[409] },
});

const listIntents = createRoute({
  method: 'get',
  path: '/admin/intents',
  tags: [TAG],
  summary: 'List payment intents',
  security: SECURITY,
  request: { query: PaginationQuery.extend({ status: IntentStatus.optional(), q: z.string().optional() }) },
  responses: {
    200: jsonResponse(z.object({ items: z.array(IntentSchema), total: z.number().int(), limit: z.number().int(), offset: z.number().int(), counters: z.record(z.string(), z.number()) }), 'Page of intents'),
    401: ErrorResponses[401],
  },
});

const createIntent = createRoute({
  method: 'post',
  path: '/admin/intents',
  tags: [TAG],
  summary: 'Create a payment intent from the dashboard',
  security: SECURITY,
  request: { body: jsonBody(CreateIntentRequest) },
  responses: { 201: jsonResponse(IntentWithMessage, 'Created'), 400: ErrorResponses[400], 401: ErrorResponses[401], 409: ErrorResponses[409] },
});

const cancelIntent = createRoute({
  method: 'post',
  path: '/admin/intents/{id}/cancel',
  tags: [TAG],
  summary: 'Cancel a pending intent',
  security: SECURITY,
  request: { params: IdParam },
  responses: { 200: jsonResponse(IntentSchema, 'Cancelled'), 401: ErrorResponses[401], 404: ErrorResponses[404], 409: ErrorResponses[409] },
});

const listDevices = createRoute({
  method: 'get',
  path: '/admin/devices',
  tags: [TAG],
  summary: 'List listener phones',
  security: SECURITY,
  responses: { 200: jsonResponse(z.object({ items: z.array(DeviceSchema) }), 'Devices'), 401: ErrorResponses[401] },
});

const reconcile = createRoute({
  method: 'post',
  path: '/admin/reconcile',
  tags: [TAG],
  summary: 'Re-run matching now',
  description: 'Re-trusts messages whose sender id is now allowed, expires old intents, demotes stale receipts and matches everything unmatched.',
  security: SECURITY,
  responses: {
    200: jsonResponse(z.object({ retrusted: z.number(), expired_intents: z.number(), demoted_stale: z.number(), matched: z.number() }), 'Summary'),
    401: ErrorResponses[401],
  },
});

const getSettings = createRoute({
  method: 'get',
  path: '/admin/settings',
  tags: [TAG],
  summary: 'Read settings',
  security: SECURITY,
  responses: { 200: jsonResponse(SettingsSchema, 'Settings'), 401: ErrorResponses[401] },
});

const patchSettings = createRoute({
  method: 'patch',
  path: '/admin/settings',
  tags: [TAG],
  summary: 'Update settings',
  security: SECURITY,
  request: { body: jsonBody(SettingsPatchRequest) },
  responses: { 200: jsonResponse(SettingsSchema, 'Updated settings'), 400: ErrorResponses[400], 401: ErrorResponses[401] },
});

const listWebhooks = createRoute({
  method: 'get',
  path: '/admin/webhooks',
  tags: [TAG],
  summary: 'List webhook deliveries',
  security: SECURITY,
  request: { query: PaginationQuery.extend({ status: DeliveryStatus.optional() }) },
  responses: {
    200: jsonResponse(z.object({ items: z.array(DeliverySchema), total: z.number().int(), limit: z.number().int(), offset: z.number().int(), counters: z.record(z.string(), z.number()) }), 'Page of deliveries'),
    401: ErrorResponses[401],
  },
});

const redeliverWebhook = createRoute({
  method: 'post',
  path: '/admin/webhooks/{id}/redeliver',
  tags: [TAG],
  summary: 'Retry a webhook delivery now',
  security: SECURITY,
  request: { params: IdParam },
  responses: { 200: jsonResponse(DeliverySchema, 'Delivery after the retry'), 401: ErrorResponses[401], 404: ErrorResponses[404], 409: ErrorResponses[409] },
});

const testWebhook = createRoute({
  method: 'post',
  path: '/admin/webhooks/test',
  tags: [TAG],
  summary: 'Send a webhook.test event to the configured URL',
  security: SECURITY,
  request: { body: { content: { 'application/json': { schema: z.object({ url: z.string().url().optional() }) } }, required: false } },
  responses: { 200: jsonResponse(DeliverySchema, 'Delivery'), 401: ErrorResponses[401], 409: ErrorResponses[409] },
});

const adminHealth = createRoute({
  method: 'get',
  path: '/admin/health',
  tags: [TAG],
  summary: 'Detailed health',
  security: SECURITY,
  responses: {
    200: jsonResponse(
      z.object({
        ok: z.boolean(),
        version: z.string(),
        database: z.object({ dialect: z.enum(['sqlite', 'postgres']), location: z.string() }),
        parsers: z.array(z.string()),
        webhook_configured: z.boolean(),
        mail_configured: z.boolean(),
        started_at: z.string(),
        server_time: z.string(),
      }),
      'Health',
    ),
    401: ErrorResponses[401],
  },
});

export function adminRoutes(ctx: AppContext) {
  const router = createRouter<{ Variables: AdminVariables }>();

  router.openapi(login, async (c) => {
    const { password } = c.req.valid('json');
    if (!secretsMatch(password, ctx.env.ADMIN_PASSWORD)) return c.json({ error: 'invalid_password' }, 401);
    return c.json(await ctx.adminJwt.issue(), 200);
  });

  router.use('/admin/*', async (c, next) => {
    if (c.req.path === '/admin/login') return await next();
    return await adminAuth(ctx.adminJwt)(c, next);
  });

  router.openapi(me, (c) => c.json(c.get('admin'), 200));

  router.openapi(overview, async (c) => {
    const [messages, intents, webhooks, devices, settings, recent, matched, webhookConfigured] = await Promise.all([
      ctx.admin.countMessagesByStatus(),
      ctx.intents.countByStatus(),
      ctx.webhooks.countByStatus(),
      ctx.devices.list(),
      ctx.settings.get(),
      ctx.admin.recentMessages(10),
      ctx.admin.matchedSince(new Date(Date.now() - 24 * HOUR_MS).toISOString()),
      ctx.webhooks.isConfigured(),
    ]);
    const online = devices.filter((d) => d.online).length;
    return c.json(
      {
        messages,
        intents,
        webhooks,
        devices: { total: devices.length, online, offline: devices.length - online, items: devices },
        matched_last_24h: matched,
        recent_messages: recent.map(serializeMessage),
        parsers: getParsers().map((p) => ({ id: p.id, name: p.name, sender_ids: p.senderIds })),
        webhook_configured: webhookConfigured,
        mail_configured: ctx.mail.configured,
        settings,
        server_time: nowIso(),
      },
      200,
    );
  });

  router.openapi(listMessages, async (c) => {
    const query = c.req.valid('query');
    const { items, total, counters } = await ctx.admin.listMessages(query);
    return c.json({ items: items.map(serializeMessage), total, limit: query.limit, offset: query.offset, counters }, 200);
  });

  router.openapi(getMessage, async (c) => {
    const { id } = c.req.valid('param');
    const message = await ctx.matcher.getMessage(id);
    const intent = message.intent_id ? await ctx.intents.get(message.intent_id).catch(() => null) : null;
    return c.json({ ...serializeMessage(message), intent: intent ? serializeIntent(intent) : null }, 200);
  });

  router.openapi(matchMessage, async (c) => {
    const { id } = c.req.valid('param');
    const { intent_id } = c.req.valid('json');
    return c.json(serializeMessage(await ctx.matcher.manualMatch(id, intent_id)), 200);
  });

  router.openapi(ignoreMessage, async (c) => {
    const { id } = c.req.valid('param');
    return c.json(serializeMessage(await ctx.matcher.ignore(id)), 200);
  });

  router.openapi(reopenMessage, async (c) => {
    const { id } = c.req.valid('param');
    return c.json(serializeMessage(await ctx.matcher.reopen(id)), 200);
  });

  router.openapi(retrustMessage, async (c) => {
    const { id } = c.req.valid('param');
    return c.json(serializeMessage(await ctx.matcher.retrust(id)), 200);
  });

  router.openapi(listIntents, async (c) => {
    const query = c.req.valid('query');
    const [{ items, total }, counters] = await Promise.all([ctx.intents.list(query), ctx.intents.countByStatus()]);
    return c.json({ items: items.map(serializeIntent), total, limit: query.limit, offset: query.offset, counters }, 200);
  });

  router.openapi(createIntent, async (c) => {
    const created = await ctx.intents.create(c.req.valid('json'));
    await ctx.matcher.matchForIntent(created);
    return c.json(await intentWithMessage(ctx, created.id), 201);
  });

  router.openapi(cancelIntent, async (c) => {
    const { id } = c.req.valid('param');
    return c.json(serializeIntent(await ctx.intents.cancel(id)), 200);
  });

  router.openapi(listDevices, async (c) => c.json({ items: await ctx.devices.list() }, 200));

  router.openapi(reconcile, async (c) => c.json(await ctx.matcher.reconcile(), 200));

  router.openapi(getSettings, async (c) => c.json(await ctx.settings.get(), 200));

  router.openapi(patchSettings, async (c) => c.json(await ctx.settings.patch(c.req.valid('json')), 200));

  router.openapi(listWebhooks, async (c) => {
    const query = c.req.valid('query');
    const [{ items, total }, counters] = await Promise.all([ctx.webhooks.list(query), ctx.webhooks.countByStatus()]);
    return c.json({ items: items.map(serializeDelivery), total, limit: query.limit, offset: query.offset, counters }, 200);
  });

  router.openapi(redeliverWebhook, async (c) => {
    const { id } = c.req.valid('param');
    return c.json(serializeDelivery(await ctx.webhooks.redeliver(id)), 200);
  });

  router.openapi(testWebhook, async (c) => {
    const body = c.req.valid('json');
    const delivery = await ctx.webhooks.enqueue('webhook.test', { message: 'Hello from Tahweel' }, { url: body?.url });
    if (!delivery) return c.json({ error: 'webhook_not_configured' }, 409);
    return c.json(serializeDelivery(await ctx.webhooks.get(delivery.id)), 200);
  });

  router.openapi(adminHealth, async (c) =>
    c.json(
      {
        ok: true,
        version: ctx.version,
        database: { dialect: ctx.dialect, location: ctx.databaseLocation },
        parsers: getParsers().map((p) => p.id),
        webhook_configured: await ctx.webhooks.isConfigured(),
        mail_configured: ctx.mail.configured,
        started_at: ctx.startedAt,
        server_time: nowIso(),
      },
      200,
    ),
  );

  return router;
}
