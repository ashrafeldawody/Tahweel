import { createHmac } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Env } from '../config/env.js';
import { newId } from '../config/ids.js';
import { logger } from '../config/log.js';
import { MINUTE_MS, HOUR_MS, isoAfterMs, nowIso } from '../config/time.js';
import type { Database, DeliveryStatus, WebhookDeliveryRow, WebhookEvent } from '../db/schema.js';
import { conflict, notFound } from './errors.js';

const log = logger('webhooks');

export const RETRY_DELAYS_MS = [
  MINUTE_MS,
  5 * MINUTE_MS,
  15 * MINUTE_MS,
  HOUR_MS,
  3 * HOUR_MS,
  6 * HOUR_MS,
  12 * HOUR_MS,
];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
export const SIGNATURE_HEADER = 'X-Tahweel-Signature';
export const EVENT_HEADER = 'X-Tahweel-Event';
export const DELIVERY_HEADER = 'X-Tahweel-Delivery';
const REQUEST_TIMEOUT_MS = 10_000;

export interface EnqueueOptions {
  url?: string | null;
  intentId?: string | null;
  messageId?: string | null;
}

export type Fetcher = typeof fetch;

export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function buildSignatureHeader(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${signPayload(secret, timestamp, body)}`;
}

export function verifySignatureHeader(secret: string, header: string, body: string, toleranceSeconds = 300): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = signPayload(secret, timestamp, body);
  return expected.length === parts.v1.length && timingSafeEqualHex(expected, parts.v1);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class WebhookService {
  private readonly inflight = new Set<string>();

  constructor(
    private readonly db: Kysely<Database>,
    private readonly env: Pick<Env, 'WEBHOOK_URL' | 'WEBHOOK_SECRET'>,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  get configured(): boolean {
    return Boolean(this.env.WEBHOOK_URL && this.env.WEBHOOK_SECRET);
  }

  resolveUrl(override?: string | null): string | null {
    return override || this.env.WEBHOOK_URL || null;
  }

  async enqueue(event: WebhookEvent, data: Record<string, unknown>, options: EnqueueOptions = {}): Promise<WebhookDeliveryRow | null> {
    const url = this.resolveUrl(options.url);
    if (!url) return null;
    const id = newId();
    const createdAt = nowIso();
    const payload = JSON.stringify({ id, event, created_at: createdAt, ...data });
    await this.db
      .insertInto('webhook_deliveries')
      .values({
        id,
        event,
        url,
        payload,
        status: 'pending',
        attempts: 0,
        next_attempt_at: createdAt,
        last_status_code: null,
        last_error: null,
        created_at: createdAt,
        delivered_at: null,
        intent_id: options.intentId ?? null,
        message_id: options.messageId ?? null,
      })
      .execute();
    const row = await this.get(id);
    void this.deliver(id).catch((error: Error) => log.error(`deliver ${id} crashed: ${error.message}`));
    return row;
  }

  async get(id: string): Promise<WebhookDeliveryRow> {
    const row = await this.db.selectFrom('webhook_deliveries').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) throw notFound();
    return row;
  }

  async list(filter: { status?: DeliveryStatus; limit: number; offset: number }) {
    let query = this.db.selectFrom('webhook_deliveries').selectAll();
    let countQuery = this.db.selectFrom('webhook_deliveries').select((eb) => eb.fn.countAll<number>().as('total'));
    if (filter.status) {
      query = query.where('status', '=', filter.status);
      countQuery = countQuery.where('status', '=', filter.status);
    }
    const [items, count] = await Promise.all([
      query.orderBy('created_at', 'desc').limit(filter.limit).offset(filter.offset).execute(),
      countQuery.executeTakeFirst(),
    ]);
    return { items, total: Number(count?.total ?? 0) };
  }

  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.db
      .selectFrom('webhook_deliveries')
      .select(['status', (eb) => eb.fn.countAll<number>().as('count')])
      .groupBy('status')
      .execute();
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
  }

  async redeliver(id: string): Promise<WebhookDeliveryRow> {
    const row = await this.get(id);
    if (row.status === 'delivered') throw conflict('already_delivered');
    await this.db
      .updateTable('webhook_deliveries')
      .set({ status: 'pending', next_attempt_at: nowIso(), last_error: null })
      .where('id', '=', id)
      .execute();
    await this.deliver(id);
    return await this.get(id);
  }

  async processDue(limit = 20): Promise<number> {
    const due = await this.db
      .selectFrom('webhook_deliveries')
      .select('id')
      .where('status', '=', 'pending')
      .where('next_attempt_at', '<=', nowIso())
      .orderBy('next_attempt_at', 'asc')
      .limit(limit)
      .execute();
    let processed = 0;
    for (const { id } of due) {
      if (await this.deliver(id)) processed += 1;
    }
    return processed;
  }

  async deliver(id: string): Promise<boolean> {
    if (this.inflight.has(id)) return false;
    this.inflight.add(id);
    try {
      const row = await this.get(id);
      if (row.status !== 'pending') return false;
      const attempt = row.attempts + 1;
      const outcome = await this.post(row);
      if (outcome.ok) {
        await this.db
          .updateTable('webhook_deliveries')
          .set({
            status: 'delivered',
            attempts: attempt,
            last_status_code: outcome.status,
            last_error: null,
            delivered_at: nowIso(),
            next_attempt_at: null,
          })
          .where('id', '=', id)
          .execute();
        log.info(`delivered ${row.event} ${id} to ${row.url} (attempt ${attempt})`);
        return true;
      }
      const exhausted = attempt >= MAX_ATTEMPTS;
      const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
      await this.db
        .updateTable('webhook_deliveries')
        .set({
          status: exhausted ? 'failed' : 'pending',
          attempts: attempt,
          last_status_code: outcome.status,
          last_error: outcome.error.slice(0, 500),
          next_attempt_at: exhausted ? null : isoAfterMs(delay),
        })
        .where('id', '=', id)
        .execute();
      log.warn(`delivery ${id} attempt ${attempt} failed (${outcome.error})${exhausted ? '; giving up' : ''}`);
      return true;
    } finally {
      this.inflight.delete(id);
    }
  }

  private async post(row: WebhookDeliveryRow): Promise<{ ok: true; status: number } | { ok: false; status: number | null; error: string }> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': 'tahweel-webhooks/1',
      [EVENT_HEADER]: row.event,
      [DELIVERY_HEADER]: row.id,
    };
    if (this.env.WEBHOOK_SECRET) headers[SIGNATURE_HEADER] = buildSignatureHeader(this.env.WEBHOOK_SECRET, row.payload);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetcher(row.url, { method: 'POST', headers, body: row.payload, signal: controller.signal });
      if (response.ok) return { ok: true, status: response.status };
      return { ok: false, status: response.status, error: `http_${response.status}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, status: null, error: message };
    } finally {
      clearTimeout(timer);
    }
  }
}
