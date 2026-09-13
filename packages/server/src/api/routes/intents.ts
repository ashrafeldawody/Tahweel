import { createRoute, z } from '@hono/zod-openapi';
import { apiKeyAuth } from '../../auth/middleware.js';
import type { AppContext } from '../../context.js';
import { serializeIntent, serializeMessage } from '../../services/serializers.js';
import { createRouter } from '../hono.js';
import {
  CreateIntentRequest,
  ErrorResponses,
  IdParam,
  IntentSchema,
  IntentStatus,
  IntentWithMessage,
  PaginationQuery,
  jsonBody,
  jsonResponse,
} from '../schemas.js';

const TAG = 'Payment intents (integrator API)';
const SECURITY = [{ ApiKey: [] }];

const create = createRoute({
  method: 'post',
  path: '/api/v1/intents',
  tags: [TAG],
  summary: 'Create a payment intent',
  description:
    'Tell Tahweel that you expect a wallet transfer. Matching requires sender_phone (recommended) or allow_amount_only=true (risky). If a matching receipt already arrived it is matched immediately and the response carries status=matched.',
  security: SECURITY,
  request: { body: jsonBody(CreateIntentRequest) },
  responses: {
    201: jsonResponse(IntentWithMessage, 'Intent created (possibly already matched)'),
    400: ErrorResponses[400],
    401: ErrorResponses[401],
    409: jsonResponse(z.object({ error: z.literal('reference_exists'), intent_id: z.string(), status: IntentStatus }), 'Reference already used'),
  },
});

const list = createRoute({
  method: 'get',
  path: '/api/v1/intents',
  tags: [TAG],
  summary: 'List payment intents',
  security: SECURITY,
  request: { query: PaginationQuery.extend({ status: IntentStatus.optional(), q: z.string().optional().openapi({ example: 'order-10' }) }) },
  responses: {
    200: jsonResponse(z.object({ items: z.array(IntentSchema), total: z.number().int(), limit: z.number().int(), offset: z.number().int() }), 'Page of intents'),
    401: ErrorResponses[401],
  },
});

const getOne = createRoute({
  method: 'get',
  path: '/api/v1/intents/{id}',
  tags: [TAG],
  summary: 'Get a payment intent (with the matched message, if any)',
  security: SECURITY,
  request: { params: IdParam },
  responses: { 200: jsonResponse(IntentWithMessage, 'Intent'), 401: ErrorResponses[401], 404: ErrorResponses[404] },
});

const getByReference = createRoute({
  method: 'get',
  path: '/api/v1/intents/by-reference/{reference}',
  tags: [TAG],
  summary: 'Get a payment intent by your own reference',
  security: SECURITY,
  request: { params: z.object({ reference: z.string().min(1).openapi({ param: { name: 'reference', in: 'path' }, example: 'order-1001' }) }) },
  responses: { 200: jsonResponse(IntentWithMessage, 'Intent'), 401: ErrorResponses[401], 404: ErrorResponses[404] },
});

const cancel = createRoute({
  method: 'delete',
  path: '/api/v1/intents/{id}',
  tags: [TAG],
  summary: 'Cancel a pending payment intent',
  security: SECURITY,
  request: { params: IdParam },
  responses: { 200: jsonResponse(IntentSchema, 'Cancelled intent'), 401: ErrorResponses[401], 404: ErrorResponses[404], 409: ErrorResponses[409] },
});

export async function intentWithMessage(ctx: AppContext, id: string) {
  const intent = await ctx.intents.get(id);
  const message = intent.matched_message_id ? await ctx.matcher.getMessage(intent.matched_message_id).catch(() => null) : null;
  return { ...serializeIntent(intent), message: message ? serializeMessage(message) : null };
}

export function intentRoutes(ctx: AppContext) {
  const router = createRouter();
  router.use('/api/v1/*', apiKeyAuth(ctx.env));

  router.openapi(create, async (c) => {
    const body = c.req.valid('json');
    const created = await ctx.intents.create(body);
    await ctx.matcher.matchForIntent(created);
    return c.json(await intentWithMessage(ctx, created.id), 201);
  });

  router.openapi(list, async (c) => {
    const query = c.req.valid('query');
    const { items, total } = await ctx.intents.list(query);
    return c.json({ items: items.map(serializeIntent), total, limit: query.limit, offset: query.offset }, 200);
  });

  router.openapi(getByReference, async (c) => {
    const { reference } = c.req.valid('param');
    const intent = await ctx.intents.getByReference(reference);
    return c.json(await intentWithMessage(ctx, intent.id), 200);
  });

  router.openapi(getOne, async (c) => {
    const { id } = c.req.valid('param');
    return c.json(await intentWithMessage(ctx, id), 200);
  });

  router.openapi(cancel, async (c) => {
    const { id } = c.req.valid('param');
    const intent = await ctx.intents.cancel(id);
    return c.json(serializeIntent(intent), 200);
  });

  return router;
}
