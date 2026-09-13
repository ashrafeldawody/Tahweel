export const MESSAGE_STATUSES = ['unmatched', 'matching', 'matched', 'ignored', 'not_receipt', 'untrusted_sender', 'stale'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const INTENT_STATUSES = ['pending', 'matched', 'expired', 'cancelled'] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

export const DELIVERY_STATUSES = ['pending', 'delivered', 'failed'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export type WebhookEvent = 'payment.matched' | 'payment.unmatched_receipt' | 'device.offline' | 'device.online' | 'webhook.test';

export type Counters = Record<string, number>;

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  counters: Counters;
}

export interface Message {
  id: string;
  fingerprint: string;
  device_id: string;
  address: string;
  body: string;
  received_at: string;
  ingested_at: string;
  provider: string | null;
  parsed: boolean;
  amount: number | null;
  amount_cents: number | null;
  sender_phone: string | null;
  sender_name: string | null;
  balance_cents: number | null;
  reference: string | null;
  status: MessageStatus;
  intent_id: string | null;
  matched_at: string | null;
  matched_by: string | null;
  note: string | null;
}

export interface Intent {
  id: string;
  reference: string;
  amount: number;
  amount_cents: number;
  currency: string;
  sender_phone: string | null;
  allow_amount_only: boolean;
  status: IntentStatus;
  metadata: Record<string, unknown> | null;
  webhook_url: string | null;
  created_at: string;
  expires_at: string;
  matched_at: string | null;
  matched_message_id: string | null;
  cancelled_at: string | null;
}

export interface MessageWithIntent extends Message {
  intent: Intent | null;
}

export interface IntentWithMessage extends Intent {
  message: Message | null;
}

export interface Device {
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
  online: boolean;
}

export interface Delivery {
  id: string;
  event: WebhookEvent;
  url: string;
  payload: Record<string, unknown> | null;
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

export interface Settings {
  trusted_senders: string[];
  max_age_hours: number;
  auto_match: boolean;
  currency: string;
  timezone: string;
  intent_ttl_minutes: number;
  offline_alert_minutes: number;
  webhook_unmatched_receipts: boolean;
  email_alerts: boolean;
}

export type SettingsPatch = Partial<Settings>;

export interface Parser {
  id: string;
  name: string;
  sender_ids: string[];
}

export interface Overview {
  messages: Counters;
  intents: Counters;
  webhooks: Counters;
  devices: { total: number; online: number; offline: number; items: Device[] };
  matched_last_24h: { count: number; amount_cents: number };
  recent_messages: Message[];
  parsers: Parser[];
  webhook_configured: boolean;
  mail_configured: boolean;
  settings: Settings;
  server_time: string;
}

export interface Health {
  ok: boolean;
  version: string;
  database: { dialect: 'sqlite' | 'postgres'; location: string };
  parsers: string[];
  webhook_configured: boolean;
  mail_configured: boolean;
  started_at: string;
  server_time: string;
}

export interface LoginResponse {
  token: string;
  expires_at: string;
}

export interface Session {
  sub: string;
  role: 'admin';
  issued_at: string;
  expires_at: string;
}

export interface ReconcileSummary {
  retrusted: number;
  expired_intents: number;
  demoted_stale: number;
  matched: number;
}

export interface CreateIntentInput {
  reference: string;
  amount: number;
  currency?: string;
  sender_phone?: string;
  allow_amount_only?: boolean;
  expires_in_minutes?: number;
  metadata?: Record<string, unknown> | null;
  webhook_url?: string | null;
}

export interface MessageListParams {
  status?: MessageStatus;
  q?: string;
  device_id?: string;
  limit?: number;
  offset?: number;
}

export interface IntentListParams {
  status?: IntentStatus;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface DeliveryListParams {
  status?: DeliveryStatus;
  limit?: number;
  offset?: number;
}
