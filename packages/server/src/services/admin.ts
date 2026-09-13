import { sql, type Kysely } from 'kysely';
import type { Database, MessageStatus, SmsMessageRow } from '../db/schema.js';
import { MESSAGE_STATUSES } from '../db/schema.js';

export interface MessageListFilter {
  status?: MessageStatus;
  q?: string;
  device_id?: string;
  limit: number;
  offset: number;
}

export class AdminQueries {
  constructor(private readonly db: Kysely<Database>) {}

  async listMessages(filter: MessageListFilter): Promise<{ items: SmsMessageRow[]; total: number; counters: Record<string, number> }> {
    const applyWhere = <Q extends { where: (...args: any[]) => Q }>(query: Q): Q => {
      let q = query;
      if (filter.status) q = q.where('status', '=', filter.status);
      if (filter.device_id) q = q.where('device_id', '=', filter.device_id);
      if (filter.q) {
        const raw = filter.q.trim();
        const term = `%${raw.toLowerCase()}%`;
        q = q.where((eb: any) =>
          eb.or([
            eb('sender_phone', 'like', `%${raw}%`),
            eb(sql`lower(coalesce(sender_name, ''))`, 'like', term),
            eb(sql`lower(body)`, 'like', term),
            eb(sql`lower(address)`, 'like', term),
            eb('reference', 'like', `%${raw}%`),
          ]),
        );
      }
      return q;
    };
    const [items, count, counters] = await Promise.all([
      applyWhere(this.db.selectFrom('sms_messages').selectAll())
        .orderBy('received_at', 'desc')
        .limit(filter.limit)
        .offset(filter.offset)
        .execute(),
      applyWhere(this.db.selectFrom('sms_messages').select((eb) => eb.fn.countAll<number>().as('total'))).executeTakeFirst(),
      this.countMessagesByStatus(),
    ]);
    return { items, total: Number(count?.total ?? 0), counters };
  }

  async countMessagesByStatus(): Promise<Record<string, number>> {
    const rows = await this.db
      .selectFrom('sms_messages')
      .select(['status', (eb) => eb.fn.countAll<number>().as('count')])
      .groupBy('status')
      .execute();
    const counters: Record<string, number> = Object.fromEntries(MESSAGE_STATUSES.map((s) => [s, 0]));
    for (const row of rows) counters[row.status] = Number(row.count);
    return counters;
  }

  async recentMessages(limit: number): Promise<SmsMessageRow[]> {
    return await this.db.selectFrom('sms_messages').selectAll().orderBy('received_at', 'desc').limit(limit).execute();
  }

  async matchedSince(iso: string): Promise<{ count: number; amount_cents: number }> {
    const row = await this.db
      .selectFrom('sms_messages')
      .select([(eb) => eb.fn.countAll<number>().as('count'), (eb) => eb.fn.sum<number>('amount_cents').as('amount')])
      .where('status', '=', 'matched')
      .where('matched_at', '>=', iso)
      .executeTakeFirst();
    return { count: Number(row?.count ?? 0), amount_cents: Number(row?.amount ?? 0) };
  }
}
