import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { normalizeSenderAddress } from '../parsers/normalize.js';
import { defaultTrustedSenders } from '../parsers/registry.js';

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

export const SETTINGS_DEFAULTS: Omit<Settings, 'trusted_senders'> = {
  max_age_hours: 48,
  auto_match: true,
  currency: 'EGP',
  timezone: 'Africa/Cairo',
  intent_ttl_minutes: 120,
  offline_alert_minutes: 30,
  webhook_unmatched_receipts: false,
  email_alerts: true,
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
] as const satisfies readonly (keyof Settings)[];

export class SettingsService {
  constructor(private readonly db: Kysely<Database>) {}

  async get(): Promise<Settings> {
    const rows = await this.db.selectFrom('settings').selectAll().execute();
    const stored = new Map(rows.map((r) => [r.key, r.value]));
    const read = <T>(key: keyof Settings, fallback: T): T => {
      const raw = stored.get(key);
      if (raw === undefined) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    };
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
    };
  }

  async patch(patch: SettingsPatch): Promise<Settings> {
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

  private async set(key: string, value: string): Promise<void> {
    await this.db
      .insertInto('settings')
      .values({ key, value })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value }))
      .execute();
  }
}
