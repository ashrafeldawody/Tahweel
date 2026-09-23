import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { normalizeSenderAddress } from '../parsers/normalize.js';
import { defaultTrustedSenders } from '../parsers/registry.js';
import { badRequest } from './errors.js';

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
  verify_balance: boolean;
  balance_margin: number;
  review_above_amount: number | null;
  phone_filter: boolean;
  webhook_url: string | null;
  webhook_secret_set: boolean;
}

export interface SettingsPatch extends Partial<Omit<Settings, 'webhook_secret_set'>> {
  webhook_secret?: string | null;
}

export interface WebhookConfig {
  url: string | null;
  secret: string | null;
}

export type WebhookDefaults = Partial<WebhookConfig>;

export const SETTINGS_DEFAULTS: Omit<Settings, 'trusted_senders' | 'webhook_url' | 'webhook_secret_set'> = {
  max_age_hours: 48,
  auto_match: true,
  currency: 'EGP',
  timezone: 'Africa/Cairo',
  intent_ttl_minutes: 120,
  offline_alert_minutes: 30,
  webhook_unmatched_receipts: false,
  email_alerts: true,
  verify_balance: false,
  balance_margin: 0.02,
  review_above_amount: null,
  phone_filter: true,
};

const KEYS = [
  'trusted_senders',
  'max_age_hours',
  'auto_match',
  'currency',
  'timezone',
  'intent_ttl_minutes',
  'offline_alert_minutes',
  'webhook_unmatched_receipts',
  'email_alerts',
  'verify_balance',
  'balance_margin',
  'review_above_amount',
  'phone_filter',
] as const satisfies readonly (keyof Settings)[];

type Reader = <T>(key: string, fallback: T) => T;

export class SettingsService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly webhookDefaults: WebhookDefaults = {},
  ) {}

  async get(): Promise<Settings> {
    const read = await this.reader();
    const webhook = this.webhookFrom(read);
    return {
      trusted_senders: read<string[]>('trusted_senders', defaultTrustedSenders()),
      max_age_hours: read('max_age_hours', SETTINGS_DEFAULTS.max_age_hours),
      auto_match: read('auto_match', SETTINGS_DEFAULTS.auto_match),
      currency: read('currency', SETTINGS_DEFAULTS.currency),
      timezone: read('timezone', SETTINGS_DEFAULTS.timezone),
      intent_ttl_minutes: read('intent_ttl_minutes', SETTINGS_DEFAULTS.intent_ttl_minutes),
      offline_alert_minutes: read('offline_alert_minutes', SETTINGS_DEFAULTS.offline_alert_minutes),
      webhook_unmatched_receipts: read(
        'webhook_unmatched_receipts',
        SETTINGS_DEFAULTS.webhook_unmatched_receipts,
      ),
      email_alerts: read('email_alerts', SETTINGS_DEFAULTS.email_alerts),
      verify_balance: read('verify_balance', SETTINGS_DEFAULTS.verify_balance),
      balance_margin: read('balance_margin', SETTINGS_DEFAULTS.balance_margin),
      review_above_amount: read<number | null>('review_above_amount', SETTINGS_DEFAULTS.review_above_amount),
      phone_filter: read('phone_filter', SETTINGS_DEFAULTS.phone_filter),
      webhook_url: webhook.url,
      webhook_secret_set: webhook.secret !== null,
    };
  }

  async webhook(): Promise<WebhookConfig> {
    return this.webhookFrom(await this.reader());
  }

  async patch(patch: SettingsPatch): Promise<Settings> {
    await this.patchWebhook(patch);
    for (const key of KEYS) {
      const value = patch[key];
      if (value === undefined) continue;
      const stored =
        key === 'trusted_senders'
          ? (value as string[]).map(normalizeSenderAddress).filter(Boolean)
          : value;
      await this.set(key, JSON.stringify(stored));
    }
    return await this.get();
  }

  async resetTrustedSenders(): Promise<Settings> {
    await this.db.deleteFrom('settings').where('key', '=', 'trusted_senders').execute();
    return await this.get();
  }

  private async patchWebhook(patch: SettingsPatch): Promise<void> {
    if (patch.webhook_url === undefined && patch.webhook_secret === undefined) return;
    const current = await this.webhook();
    const url = patch.webhook_url === undefined ? current.url : patch.webhook_url || this.webhookDefaults.url || null;
    const secret = patch.webhook_secret === undefined ? current.secret : patch.webhook_secret || this.webhookDefaults.secret || null;
    if (url && !secret) throw badRequest('webhook_secret_required');
    if (patch.webhook_url !== undefined) await this.setOrClear('webhook_url', patch.webhook_url || null);
    if (patch.webhook_secret !== undefined) await this.setOrClear('webhook_secret', patch.webhook_secret || null);
  }

  private webhookFrom(read: Reader): WebhookConfig {
    return {
      url: read<string | null>('webhook_url', this.webhookDefaults.url ?? null),
      secret: read<string | null>('webhook_secret', this.webhookDefaults.secret ?? null),
    };
  }

  private async reader(): Promise<Reader> {
    const rows = await this.db.selectFrom('settings').selectAll().execute();
    const stored = new Map(rows.map((r) => [r.key, r.value]));
    return (key, fallback) => {
      const raw = stored.get(key);
      if (raw === undefined) return fallback;
      try {
        return JSON.parse(raw) as typeof fallback;
      } catch {
        return fallback;
      }
    };
  }

  private async setOrClear(key: string, value: string | null): Promise<void> {
    if (value === null) await this.db.deleteFrom('settings').where('key', '=', key).execute();
    else await this.set(key, JSON.stringify(value));
  }

  private async set(key: string, value: string): Promise<void> {
    await this.db
      .insertInto('settings')
      .values({ key, value })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value }))
      .execute();
  }
}
