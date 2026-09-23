import type { Insertable, Selectable, Updateable } from 'kysely';

export interface DevicesTable {
  device_id: string;
  name: string;
  app_version: string | null;
  last_seen_at: string;
  battery: number | null;
  network: string | null;
  pending_count: number;
  last_sms_at: string | null;
  offline_alerted_at: string | null;
  created_at: string;
}

export interface SmsMessagesTable {
  id: string;
  fingerprint: string;
  device_id: string;
  address: string;
  body: string;
  received_at: string;
  ingested_at: string;
  provider: string | null;
  parsed: number;
  amount_cents: number | null;
  sender_phone: string | null;
  sender_name: string | null;
  balance_cents: number | null;
  reference: string | null;
  status: MessageStatus;
  intent_id: string | null;
  matched_at: string | null;
  matched_by: MatchedBy | null;
  note: string | null;
  verification: Verification | null;
  expected_balance_cents: number | null;
  reviewed_at: string | null;
}

export interface PaymentIntentsTable {
  id: string;
  reference: string;
  amount_cents: number;
  currency: string;
  sender_phone: string | null;
  allow_amount_only: number;
  status: IntentStatus;
  metadata: string | null;
  webhook_url: string | null;
  created_at: string;
  expires_at: string;
  matched_at: string | null;
  matched_message_id: string | null;
  cancelled_at: string | null;
}

export interface WebhookDeliveriesTable {
  id: string;
  event: WebhookEvent;
  url: string;
  payload: string;
  status: DeliveryStatus;
  attempts: number;
  next_attempt_at: string | null;
  last_status_code: number | null;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
  intent_id: string | null;
  message_id: string | null;
}

export interface SettingsTable {
  key: string;
  value: string;
}

export interface Database {
  devices: DevicesTable;
  sms_messages: SmsMessagesTable;
  payment_intents: PaymentIntentsTable;
  webhook_deliveries: WebhookDeliveriesTable;
  settings: SettingsTable;
}

export type DeviceRow = Selectable<DevicesTable>;
export type SmsMessageRow = Selectable<SmsMessagesTable>;
export type NewSmsMessage = Insertable<SmsMessagesTable>;
export type SmsMessagePatch = Updateable<SmsMessagesTable>;
export type PaymentIntentRow = Selectable<PaymentIntentsTable>;
export type NewPaymentIntent = Insertable<PaymentIntentsTable>;
export type WebhookDeliveryRow = Selectable<WebhookDeliveriesTable>;
export type NewWebhookDelivery = Insertable<WebhookDeliveriesTable>;

export const MESSAGE_STATUSES = [
  'unmatched',
  'matching',
  'matched',
  'ignored',
  'not_receipt',
  'untrusted_sender',
  'stale',
  'held',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const INTENT_STATUSES = ['pending', 'matched', 'expired', 'cancelled'] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

export const DELIVERY_STATUSES = ['pending', 'delivered', 'failed'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const WEBHOOK_EVENTS = [
  'payment.matched',
  'payment.unmatched_receipt',
  'device.offline',
  'device.online',
  'webhook.test',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export type MatchedBy = 'auto' | 'admin';

export const VERIFICATIONS = ['verified', 'mismatch', 'no_balance', 'no_history'] as const;
export type Verification = (typeof VERIFICATIONS)[number];

export const HOLD_REASONS = ['balance_mismatch', 'no_balance', 'no_balance_history', 'above_review_limit'] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];
