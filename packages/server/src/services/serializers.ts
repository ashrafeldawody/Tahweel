import type { DeviceRow, PaymentIntentRow, SmsMessageRow, WebhookDeliveryRow } from '../db/schema.js';

export function centsToAmount(cents: number | null): number | null {
  if (cents == null) return null;
  return Math.round(cents) / 100;
}

export function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function serializeIntent(row: PaymentIntentRow) {
  return {
    id: row.id,
    reference: row.reference,
    amount: centsToAmount(row.amount_cents) as number,
    amount_cents: row.amount_cents,
    currency: row.currency,
    sender_phone: row.sender_phone,
    allow_amount_only: row.allow_amount_only === 1,
    status: row.status,
    metadata: parseMetadata(row.metadata),
    webhook_url: row.webhook_url,
    created_at: row.created_at,
    expires_at: row.expires_at,
    matched_at: row.matched_at,
    matched_message_id: row.matched_message_id,
    cancelled_at: row.cancelled_at,
  };
}

export function serializeMessage(row: SmsMessageRow) {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    device_id: row.device_id,
    address: row.address,
    body: row.body,
    received_at: row.received_at,
    ingested_at: row.ingested_at,
    provider: row.provider,
    parsed: row.parsed === 1,
    amount: centsToAmount(row.amount_cents),
    amount_cents: row.amount_cents,
    sender_phone: row.sender_phone,
    sender_name: row.sender_name,
    balance_cents: row.balance_cents,
    reference: row.reference,
    status: row.status,
    intent_id: row.intent_id,
    matched_at: row.matched_at,
    matched_by: row.matched_by,
    note: row.note,
  };
}

export function serializeDevice(row: DeviceRow, online: boolean) {
  return {
    device_id: row.device_id,
    name: row.name,
    app_version: row.app_version,
    last_seen_at: row.last_seen_at,
    battery: row.battery,
    network: row.network,
    pending_count: row.pending_count,
    last_sms_at: row.last_sms_at,
    offline_alerted_at: row.offline_alerted_at,
    created_at: row.created_at,
    online,
  };
}

export function serializeDelivery(row: WebhookDeliveryRow) {
  return {
    id: row.id,
    event: row.event,
    url: row.url,
    payload: parseMetadata(row.payload),
    status: row.status,
    attempts: row.attempts,
    next_attempt_at: row.next_attempt_at,
    last_status_code: row.last_status_code,
    last_error: row.last_error,
    created_at: row.created_at,
    delivered_at: row.delivered_at,
    intent_id: row.intent_id,
    message_id: row.message_id,
  };
}

export type IntentView = ReturnType<typeof serializeIntent>;
export type MessageView = ReturnType<typeof serializeMessage>;
export type DeviceView = ReturnType<typeof serializeDevice>;
export type DeliveryView = ReturnType<typeof serializeDelivery>;
