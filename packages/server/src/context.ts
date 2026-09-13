import type { Kysely } from 'kysely';
import { AdminJwt } from './auth/admin-jwt.js';
import type { Env } from './config/env.js';
import { nowIso } from './config/time.js';
import type { DatabaseHandle, Dialect } from './db/connection.js';
import type { Database } from './db/schema.js';
import { loadParsers } from './parsers/registry.js';
import { AdminQueries } from './services/admin.js';
import { AlertService } from './services/alerts.js';
import { DevicesService } from './services/devices.js';
import { IntentsService } from './services/intents.js';
import { SmtpMailer, type Mailer } from './services/mail.js';
import { MatchService } from './services/matching.js';
import { SettingsService } from './services/settings.js';
import { WebhookService, type Fetcher } from './services/webhooks.js';

export interface AppContext {
  env: Env;
  db: Kysely<Database>;
  dialect: Dialect;
  databaseLocation: string;
  settings: SettingsService;
  mail: Mailer;
  webhooks: WebhookService;
  alerts: AlertService;
  devices: DevicesService;
  intents: IntentsService;
  matcher: MatchService;
  admin: AdminQueries;
  adminJwt: AdminJwt;
  startedAt: string;
  version: string;
}

export interface ContextOverrides {
  mailer?: Mailer;
  fetcher?: Fetcher;
}

export const SERVER_VERSION = '0.1.0';

export async function buildContext(env: Env, handle: DatabaseHandle, overrides: ContextOverrides = {}): Promise<AppContext> {
  await loadParsers();
  const settings = new SettingsService(handle.db, { url: env.WEBHOOK_URL, secret: env.WEBHOOK_SECRET });
  const mail = overrides.mailer ?? new SmtpMailer(env);
  const webhooks = new WebhookService(handle.db, settings, overrides.fetcher);
  const alerts = new AlertService(webhooks, mail, settings);
  const devices = new DevicesService(handle.db, settings, alerts);
  const intents = new IntentsService(handle.db, settings);
  const matcher = new MatchService(handle.db, settings, intents, alerts, devices);
  const admin = new AdminQueries(handle.db);
  const adminJwt = new AdminJwt(env.jwtSecret, env.JWT_TTL_HOURS);
  return {
    env,
    db: handle.db,
    dialect: handle.dialect,
    databaseLocation: handle.location,
    settings,
    mail,
    webhooks,
    alerts,
    devices,
    intents,
    matcher,
    admin,
    adminJwt,
    startedAt: nowIso(),
    version: SERVER_VERSION,
  };
}
