import type { Kysely } from 'kysely';
import { logger } from '../config/log.js';
import { MINUTE_MS, nowIso, parseIso } from '../config/time.js';
import type { Database, DeviceRow } from '../db/schema.js';
import type { AlertService } from './alerts.js';
import { serializeDevice, type DeviceView } from './serializers.js';
import type { SettingsService } from './settings.js';

const log = logger('devices');

export interface HeartbeatInput {
  device_id: string;
  name?: string;
  app_version?: string;
  battery?: number | null;
  network?: string | null;
  pending_count?: number;
  last_sms_at?: string | null;
}

export class DevicesService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly settings: SettingsService,
    private readonly alerts: AlertService,
  ) {}

  async heartbeat(input: HeartbeatInput): Promise<DeviceView> {
    const existing = await this.db
      .selectFrom('devices')
      .selectAll()
      .where('device_id', '=', input.device_id)
      .executeTakeFirst();
    const now = nowIso();
    const values = {
      name: input.name ?? existing?.name ?? input.device_id,
      app_version: input.app_version ?? existing?.app_version ?? null,
      last_seen_at: now,
      battery: input.battery ?? null,
      network: input.network ?? null,
      pending_count: input.pending_count ?? 0,
      last_sms_at: input.last_sms_at ?? existing?.last_sms_at ?? null,
      offline_alerted_at: null,
    };
    if (existing) {
      await this.db.updateTable('devices').set(values).where('device_id', '=', input.device_id).execute();
    } else {
      await this.db
        .insertInto('devices')
        .values({ device_id: input.device_id, created_at: now, ...values })
        .execute();
    }
    const row = await this.get(input.device_id);
    if (existing?.offline_alerted_at) {
      log.info(`device ${row.device_id} back online (offline since ${existing.offline_alerted_at})`);
      void this.alerts.deviceOnline(row, existing.offline_alerted_at).catch(() => undefined);
    }
    return serializeDevice(row, true);
  }

  async get(deviceId: string): Promise<DeviceRow> {
    const row = await this.db.selectFrom('devices').selectAll().where('device_id', '=', deviceId).executeTakeFirst();
    if (!row) throw new Error(`device ${deviceId} missing after upsert`);
    return row;
  }

  async list(): Promise<DeviceView[]> {
    const settings = await this.settings.get();
    const threshold = Date.now() - settings.offline_alert_minutes * MINUTE_MS;
    const rows = await this.db.selectFrom('devices').selectAll().orderBy('last_seen_at', 'desc').execute();
    return rows.map((row) => serializeDevice(row, parseIso(row.last_seen_at) >= threshold));
  }

  async recordLastSms(deviceId: string, receivedAt: string): Promise<void> {
    await this.db
      .updateTable('devices')
      .set({ last_sms_at: receivedAt })
      .where('device_id', '=', deviceId)
      .where((eb) => eb.or([eb('last_sms_at', 'is', null), eb('last_sms_at', '<', receivedAt)]))
      .execute();
  }

  async sweepOffline(): Promise<number> {
    const settings = await this.settings.get();
    const threshold = Date.now() - settings.offline_alert_minutes * MINUTE_MS;
    const rows = await this.db.selectFrom('devices').selectAll().where('offline_alerted_at', 'is', null).execute();
    let alerted = 0;
    for (const row of rows) {
      const seen = parseIso(row.last_seen_at);
      if (!Number.isNaN(seen) && seen >= threshold) continue;
      await this.db
        .updateTable('devices')
        .set({ offline_alerted_at: nowIso() })
        .where('device_id', '=', row.device_id)
        .execute();
      log.warn(`device ${row.device_id} offline since ${row.last_seen_at}`);
      await this.alerts.deviceOffline(row);
      alerted += 1;
    }
    return alerted;
  }
}
