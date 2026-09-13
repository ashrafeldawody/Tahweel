import { z } from '@hono/zod-openapi';
import { DELIVERY_STATUSES, INTENT_STATUSES, MESSAGE_STATUSES, WEBHOOK_EVENTS } from '../db/schema.js';

const ISO_EXAMPLE = '2026-09-13T10:15:30.000Z';
const FINGERPRINT_EXAMPLE = '3b1c9d0f5e6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c';
const RECEIPT_EXAMPLE =
  'تم إستلام مبلغ 200.00 ج.م من رقم 01061916846 المسجل باسمABANWB N ASRAAEYL بنجاح. رصيد محفظتك الحالى 429.90 ج.م.';

export const IsoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be an ISO 8601 date-time')
  .openapi({ example: ISO_EXAMPLE, format: 'date-time' });

export const ErrorResponse = z
  .object({
    error: z.string().openapi({ example: 'not_found' }),
  })
  .passthrough()
  .openapi('Error');

export const ValidationErrorResponse = z
  .object({
    error: z.literal('invalid_request'),
    issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() })),
  })
  .openapi('ValidationError');

export const MessageStatus = z.enum(MESSAGE_STATUSES).openapi('MessageStatus');
export const IntentStatus = z.enum(INTENT_STATUSES).openapi('IntentStatus');
export const DeliveryStatus = z.enum(DELIVERY_STATUSES).openapi('DeliveryStatus');
export const WebhookEventName = z.enum(WEBHOOK_EVENTS).openapi('WebhookEvent');

export const IncomingSmsSchema = z
  .object({
    fingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .openapi({ example: FINGERPRINT_EXAMPLE, description: 'sha256(address|body|smsc_timestamp_ms) computed on the phone; unique per message' }),
    address: z.string().max(80).openapi({ example: 'e& money', description: 'SMS originating address (sender id)' }),
    body: z.string().min(1).max(4000).openapi({ example: RECEIPT_EXAMPLE }),
    received_at: IsoDateTime.openapi({ example: ISO_EXAMPLE, description: 'Carrier SMSC timestamp, ISO 8601 UTC' }),
    sim_slot: z.number().int().optional().openapi({ example: 0 }),
  })
  .openapi('IncomingSms');

export const IngestSmsRequest = z
  .object({
    device_id: z.string().trim().min(1).max(80).openapi({ example: 'sm-m526b-1a2b3c' }),
    messages: z.array(IncomingSmsSchema).min(1).max(50),
  })
  .openapi('IngestSmsRequest');

export const IngestRowResultSchema = z
  .object({
    fingerprint: z.string().openapi({ example: FINGERPRINT_EXAMPLE }),
    status: MessageStatus,
    parsed: z.boolean(),
    provider: z.string().nullable().openapi({ example: 'etisalat_money' }),
    amount_cents: z.number().int().nullable().openapi({ example: 20000 }),
    sender_phone: z.string().nullable().openapi({ example: '01061916846' }),
    intent_id: z.string().nullable(),
    note: z.string().nullable(),
  })
  .openapi('IngestRowResult');

export const IngestSmsResponse = z
  .object({
    accepted: z.array(z.string()).openapi({ description: 'Fingerprints the phone may drop from its queue (new and duplicates)' }),
    created: z.number().int().openapi({ example: 1 }),
    matched: z.number().int().openapi({ example: 1 }),
    results: z.array(IngestRowResultSchema),
    server_time: IsoDateTime,
  })
  .openapi('IngestSmsResponse');

export const HeartbeatRequest = z
  .object({
    device_id: z.string().trim().min(1).max(80).openapi({ example: 'sm-m526b-1a2b3c' }),
    name: z.string().trim().max(80).optional().openapi({ example: 'Samsung M52 office' }),
    app_version: z.string().max(40).optional().openapi({ example: '1.0.0' }),
    battery: z.number().int().min(0).max(100).nullable().optional().openapi({ example: 87 }),
    network: z.string().max(40).nullable().optional().openapi({ example: 'wifi' }),
    pending_count: z.number().int().min(0).optional().openapi({ example: 0 }),
    last_sms_at: IsoDateTime.nullable().optional(),
  })
  .openapi('HeartbeatRequest');

export const DeviceSchema = z
  .object({
    device_id: z.string(),
    name: z.string(),
    app_version: z.string().nullable(),
    last_seen_at: z.string(),
    battery: z.number().nullable(),
    network: z.string().nullable(),
    pending_count: z.number(),
    last_sms_at: z.string().nullable(),
    offline_alerted_at: z.string().nullable(),
    created_at: z.string(),
    online: z.boolean(),
  })
  .openapi('Device');

export const HeartbeatResponse = z
  .object({ ok: z.literal(true), device: DeviceSchema, server_time: IsoDateTime })
  .openapi('HeartbeatResponse');

export const MetadataSchema = z.record(z.string(), z.unknown()).openapi({ example: { order_id: 'A-1001', customer: 'Ahmed' } });

export const CreateIntentRequest = z
  .object({
    reference: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .openapi({ example: 'order-1001', description: "The integrator's own id for this payment. Unique." }),
    amount: z.number().positive().openapi({ example: 200, description: 'Expected amount in major units (e.g. 200 = 200.00 EGP)' }),
    currency: z.string().trim().length(3).optional().openapi({ example: 'EGP' }),
    sender_phone: z
      .string()
      .trim()
      .min(10)
      .max(20)
      .optional()
      .openapi({ example: '01061916846', description: 'The phone the customer will pay from. Strongly recommended.' }),
    allow_amount_only: z
      .boolean()
      .optional()
      .openapi({
        example: false,
        description: 'RISKY: without sender_phone, match on an exact amount alone (only when exactly one such intent is pending).',
      }),
    expires_in_minutes: z.number().int().min(1).max(60 * 24 * 30).optional().openapi({ example: 120 }),
    metadata: MetadataSchema.nullable().optional(),
    webhook_url: z.string().url().nullable().optional().openapi({ example: 'https://shop.example.com/webhooks/tahweel' }),
  })
  .openapi('CreateIntentRequest');

export const IntentSchema = z
  .object({
    id: z.string().openapi({ example: '7c1d0f3e-4a7b-4c1e-9c6d-2f5a8b9e0d11' }),
    reference: z.string().openapi({ example: 'order-1001' }),
    amount: z.number().openapi({ example: 200 }),
    amount_cents: z.number().int().openapi({ example: 20000 }),
    currency: z.string().openapi({ example: 'EGP' }),
    sender_phone: z.string().nullable().openapi({ example: '01061916846' }),
    allow_amount_only: z.boolean(),
    status: IntentStatus,
    metadata: MetadataSchema.nullable(),
    webhook_url: z.string().nullable(),
    created_at: z.string(),
    expires_at: z.string(),
    matched_at: z.string().nullable(),
    matched_message_id: z.string().nullable(),
    cancelled_at: z.string().nullable(),
  })
  .openapi('PaymentIntent');

export const MessageSchema = z
  .object({
    id: z.string(),
    fingerprint: z.string(),
    device_id: z.string(),
    address: z.string().openapi({ example: 'e& money' }),
    body: z.string().openapi({ example: RECEIPT_EXAMPLE }),
    received_at: z.string(),
    ingested_at: z.string(),
    provider: z.string().nullable().openapi({ example: 'etisalat_money' }),
    parsed: z.boolean(),
    amount: z.number().nullable().openapi({ example: 200 }),
    amount_cents: z.number().int().nullable().openapi({ example: 20000 }),
    sender_phone: z.string().nullable().openapi({ example: '01061916846' }),
    sender_name: z.string().nullable().openapi({ example: 'ABANWB N ASRAAEYL' }),
    balance_cents: z.number().int().nullable().openapi({ example: 42990 }),
    reference: z.string().nullable().openapi({ example: '022108458264' }),
    status: MessageStatus,
    intent_id: z.string().nullable(),
    matched_at: z.string().nullable(),
    matched_by: z.string().nullable().openapi({ example: 'auto' }),
    note: z.string().nullable(),
  })
  .openapi('SmsMessage');

export const IntentWithMessage = IntentSchema.extend({ message: MessageSchema.nullable() }).openapi('PaymentIntentWithMessage');

export const DeliverySchema = z
  .object({
    id: z.string(),
    event: WebhookEventName,
    url: z.string(),
    payload: z.record(z.string(), z.unknown()).nullable(),
    status: DeliveryStatus,
    attempts: z.number().int(),
    next_attempt_at: z.string().nullable(),
    last_status_code: z.number().int().nullable(),
    last_error: z.string().nullable(),
    created_at: z.string(),
    delivered_at: z.string().nullable(),
    intent_id: z.string().nullable(),
    message_id: z.string().nullable(),
  })
  .openapi('WebhookDelivery');

export const SettingsSchema = z
  .object({
    trusted_senders: z.array(z.string()).openapi({ example: ['e& money', 'vf-cash', 'vodafone cash'] }),
    max_age_hours: z.number().int().openapi({ example: 48 }),
    auto_match: z.boolean().openapi({ example: true }),
    currency: z.string().openapi({ example: 'EGP' }),
    timezone: z.string().openapi({ example: 'Africa/Cairo' }),
    intent_ttl_minutes: z.number().int().openapi({ example: 120 }),
    offline_alert_minutes: z.number().int().openapi({ example: 30 }),
    webhook_unmatched_receipts: z.boolean().openapi({ example: false }),
    email_alerts: z.boolean().openapi({ example: true }),
  })
  .openapi('Settings');

export const SettingsPatchRequest = z
  .object({
    trusted_senders: z.array(z.string().trim().min(1).max(40)).min(1).max(60).optional(),
    max_age_hours: z.number().int().min(1).max(24 * 30).optional(),
    auto_match: z.boolean().optional(),
    currency: z.string().trim().length(3).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    intent_ttl_minutes: z.number().int().min(1).max(60 * 24 * 30).optional(),
    offline_alert_minutes: z.number().int().min(5).max(24 * 60).optional(),
    webhook_unmatched_receipts: z.boolean().optional(),
    email_alerts: z.boolean().optional(),
  })
  .openapi('SettingsPatch');

export const PaginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50).openapi({ example: 50 }),
  offset: z.coerce.number().int().min(0).default(0).openapi({ example: 0 }),
});

export const IdParam = z.object({
  id: z.string().min(1).openapi({ param: { name: 'id', in: 'path' }, example: '7c1d0f3e-4a7b-4c1e-9c6d-2f5a8b9e0d11' }),
});

export const LoginRequest = z.object({ password: z.string().min(1).openapi({ example: 'change-me-admin-password' }) }).openapi('LoginRequest');
export const LoginResponse = z.object({ token: z.string(), expires_at: z.string() }).openapi('LoginResponse');

export const OkResponse = z.object({ ok: z.literal(true) }).openapi('Ok');

export const HealthResponse = z
  .object({
    ok: z.boolean(),
    version: z.string().openapi({ example: '0.1.0' }),
    database: z.enum(['sqlite', 'postgres']),
    uptime_seconds: z.number(),
    server_time: IsoDateTime,
  })
  .openapi('Health');

export function jsonBody<T extends z.ZodTypeAny>(schema: T, description = 'Request body') {
  return { content: { 'application/json': { schema } }, description, required: true };
}

export function jsonResponse<T extends z.ZodTypeAny>(schema: T, description: string) {
  return { content: { 'application/json': { schema } }, description };
}

export const ErrorResponses = {
  400: jsonResponse(ErrorResponse, 'Invalid request'),
  401: jsonResponse(ErrorResponse, 'Missing or wrong credential'),
  404: jsonResponse(ErrorResponse, 'Not found'),
  409: jsonResponse(ErrorResponse, 'Conflict'),
};
