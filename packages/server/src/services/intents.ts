import { sql, type Kysely } from 'kysely';
import { newId } from '../config/ids.js';
import { MINUTE_MS, isoAfterMs, nowIso } from '../config/time.js';
import type { Database, IntentStatus, PaymentIntentRow } from '../db/schema.js';
import { normalizeEgyptPhone } from '../parsers/normalize.js';
import { badRequest, conflict, notFound } from './errors.js';
import type { SettingsService } from './settings.js';

export interface CreateIntentInput {
  reference: string;
  amount: number;
  currency?: string;
  sender_phone?: string | null;
  allow_amount_only?: boolean;
  expires_in_minutes?: number;
  metadata?: Record<string, unknown> | null;
  webhook_url?: string | null;
}

export interface IntentListFilter {
  status?: IntentStatus;
  q?: string;
  limit: number;
  offset: number;
}

export class IntentsService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly settings: SettingsService,
  ) {}

  async create(input: CreateIntentInput): Promise<PaymentIntentRow> {
    const settings = await this.settings.get();
    const amountCents = Math.round(input.amount * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) throw badRequest('invalid_amount');

    let senderPhone: string | null = null;
    if (input.sender_phone) {
      senderPhone = normalizeEgyptPhone(input.sender_phone);
      if (!senderPhone) throw badRequest('invalid_sender_phone');
    }
    if (!senderPhone && !input.allow_amount_only) throw badRequest('sender_phone_required');

    const existing = await this.db
      .selectFrom('payment_intents')
      .selectAll()
      .where('reference', '=', input.reference)
      .executeTakeFirst();
    if (existing) throw conflict('reference_exists', { intent_id: existing.id, status: existing.status });

    const ttlMinutes = input.expires_in_minutes ?? settings.intent_ttl_minutes;
    const row: PaymentIntentRow = {
      id: newId(),
      reference: input.reference,
      amount_cents: amountCents,
      currency: (input.currency ?? settings.currency).toUpperCase(),
      sender_phone: senderPhone,
      allow_amount_only: !senderPhone && input.allow_amount_only ? 1 : 0,
      status: 'pending',
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      webhook_url: input.webhook_url ?? null,
      created_at: nowIso(),
      expires_at: isoAfterMs(ttlMinutes * MINUTE_MS),
      matched_at: null,
      matched_message_id: null,
      cancelled_at: null,
    };
    await this.db.insertInto('payment_intents').values(row).execute();
    return row;
  }

  async get(id: string): Promise<PaymentIntentRow> {
    const row = await this.db.selectFrom('payment_intents').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) throw notFound('intent_not_found');
    return row;
  }

  async getByReference(reference: string): Promise<PaymentIntentRow> {
    const row = await this.db
      .selectFrom('payment_intents')
      .selectAll()
      .where('reference', '=', reference)
      .executeTakeFirst();
    if (!row) throw notFound('intent_not_found');
    return row;
  }

  async list(filter: IntentListFilter): Promise<{ items: PaymentIntentRow[]; total: number }> {
    const applyWhere = <Q extends { where: (...args: any[]) => Q }>(query: Q): Q => {
      let q = query;
      if (filter.status) q = q.where('status', '=', filter.status);
      if (filter.q) {
        const term = `%${filter.q.trim().toLowerCase()}%`;
        q = q.where((eb: any) =>
          eb.or([
            eb(sql`lower(reference)`, 'like', term),
            eb('sender_phone', 'like', `%${filter.q!.trim()}%`),
            eb(sql`lower(coalesce(metadata, ''))`, 'like', term),
          ]),
        );
      }
      return q;
    };
    const items = await applyWhere(this.db.selectFrom('payment_intents').selectAll())
      .orderBy('created_at', 'desc')
      .limit(filter.limit)
      .offset(filter.offset)
      .execute();
    const count = await applyWhere(
      this.db.selectFrom('payment_intents').select((eb) => eb.fn.countAll<number>().as('total')),
    ).executeTakeFirst();
    return { items, total: Number(count?.total ?? 0) };
  }

  async cancel(id: string): Promise<PaymentIntentRow> {
    const row = await this.get(id);
    if (row.status !== 'pending') throw conflict('intent_not_pending', { status: row.status });
    await this.db
      .updateTable('payment_intents')
      .set({ status: 'cancelled', cancelled_at: nowIso() })
      .where('id', '=', id)
      .where('status', '=', 'pending')
      .execute();
    return await this.get(id);
  }

  async expirePending(): Promise<number> {
    const result = await this.db
      .updateTable('payment_intents')
      .set({ status: 'expired' })
      .where('status', '=', 'pending')
      .where('expires_at', '<', nowIso())
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  }

  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.db
      .selectFrom('payment_intents')
      .select(['status', (eb) => eb.fn.countAll<number>().as('count')])
      .groupBy('status')
      .execute();
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
  }
}
