import type { Device, Intent, Message, Overview, Settings } from '../api/types';

export const RECEIPT_BODY = 'تم إستلام مبلغ 200.00 ج.م من رقم 01061916846 المسجل باسم ABANWB N ASRAAEYL بنجاح. رصيد محفظتك الحالى 429.90 ج.م.';

export const settingsFixture: Settings = {
  trusted_senders: ['e& money', 'vf-cash'],
  max_age_hours: 48,
  auto_match: true,
  currency: 'EGP',
  timezone: 'Africa/Cairo',
  intent_ttl_minutes: 120,
  offline_alert_minutes: 30,
  webhook_unmatched_receipts: false,
  email_alerts: true,
};

export const deviceFixture: Device = {
  device_id: 'sm-m526b-1a2b3c',
  name: 'Samsung M52 office',
  app_version: '1.0.0',
  last_seen_at: '2026-09-13T10:15:30.000Z',
  battery: 87,
  network: 'wifi',
  pending_count: 0,
  last_sms_at: '2026-09-13T10:10:00.000Z',
  offline_alerted_at: null,
  created_at: '2026-09-01T08:00:00.000Z',
  online: true,
};

export function messageFixture(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    fingerprint: '3b1c9d0f5e6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c',
    device_id: deviceFixture.device_id,
    address: 'e& money',
    body: RECEIPT_BODY,
    received_at: '2026-09-13T10:12:00.000Z',
    ingested_at: '2026-09-13T10:12:05.000Z',
    provider: 'etisalat_money',
    parsed: true,
    amount: 200,
    amount_cents: 20000,
    sender_phone: '01061916846',
    sender_name: 'ABANWB N ASRAAEYL',
    balance_cents: 42990,
    reference: '022108458264',
    status: 'unmatched',
    intent_id: null,
    matched_at: null,
    matched_by: null,
    note: null,
    ...overrides,
  };
}

export function intentFixture(overrides: Partial<Intent> = {}): Intent {
  return {
    id: 'intent-1',
    reference: 'order-1001',
    amount: 200,
    amount_cents: 20000,
    currency: 'EGP',
    sender_phone: '01061916846',
    allow_amount_only: false,
    status: 'pending',
    metadata: { order_id: 'A-1001' },
    webhook_url: null,
    created_at: '2026-09-13T09:00:00.000Z',
    expires_at: '2026-09-13T11:00:00.000Z',
    matched_at: null,
    matched_message_id: null,
    cancelled_at: null,
    ...overrides,
  };
}

export function overviewFixture(overrides: Partial<Overview> = {}): Overview {
  return {
    messages: { unmatched: 3, matched: 12, ignored: 1 },
    intents: { pending: 7, matched: 12 },
    webhooks: { pending: 1, delivered: 20, failed: 4 },
    devices: { total: 2, online: 1, offline: 1, items: [deviceFixture, { ...deviceFixture, device_id: 'pixel-2', name: 'Pixel spare', online: false }] },
    matched_last_24h: { count: 5, amount_cents: 123450 },
    recent_messages: [messageFixture()],
    parsers: [{ id: 'etisalat_money', name: 'Etisalat Cash', sender_ids: ['e& money', 'etisalat cash'] }],
    webhook_configured: true,
    mail_configured: false,
    settings: settingsFixture,
    server_time: '2026-09-13T10:20:00.000Z',
    ...overrides,
  };
}
