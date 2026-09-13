import type { Kysely } from 'kysely';
import { newId } from '../config/ids.js';
import { logger } from '../config/log.js';
import { HOUR_MS, nowIso, parseIso, toIso } from '../config/time.js';
import type { Database, MatchedBy, MessageStatus, PaymentIntentRow, SmsMessageRow } from '../db/schema.js';
import { parseSms } from '../parsers/registry.js';
import type { AlertService } from './alerts.js';
import type { DevicesService } from './devices.js';
import { badRequest, conflict, notFound } from './errors.js';
import type { IntentsService } from './intents.js';
import type { SettingsService } from './settings.js';
import { isTrustedSender } from './trusted-senders.js';

const log = logger('matching');

export interface IncomingSms {
  fingerprint: string;
  address: string;
  body: string;
  received_at: string;
  sim_slot?: number;
}

export interface IngestRowResult {
  fingerprint: string;
  status: MessageStatus;
  parsed: boolean;
  provider: string | null;
  amount_cents: number | null;
  sender_phone: string | null;
  intent_id: string | null;
  note: string | null;
}

export interface IngestResult {
  accepted: string[];
  created: number;
  matched: number;
  results: IngestRowResult[];
}

export type MatchOutcome = 'matched' | 'unmatched' | 'skipped';
type ApplyOutcome = 'matched' | 'message_locked' | 'intent_taken';

export interface ReconcileSummary {
  retrusted: number;
  expired_intents: number;
  demoted_stale: number;
  matched: number;
}

export function isStale(receivedAt: string, maxAgeHours: number, now = Date.now()): boolean {
  const ms = parseIso(receivedAt);
  if (Number.isNaN(ms)) return true;
  return now - ms > maxAgeHours * HOUR_MS;
}

export class MatchService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly settings: SettingsService,
    private readonly intents: IntentsService,
    private readonly alerts: AlertService,
    private readonly devices: DevicesService,
  ) {}

  async ingest(deviceId: string, messages: IncomingSms[]): Promise<IngestResult> {
    const settings = await this.settings.get();
    const accepted: string[] = [];
    const fresh: SmsMessageRow[] = [];
    const untrusted: SmsMessageRow[] = [];
    let created = 0;
    let newestReceivedAt: string | null = null;

    for (const incoming of messages) {
      accepted.push(incoming.fingerprint);
      const receivedAt = toIso(incoming.received_at) ?? nowIso();
      const parsed = parseSms(incoming.address, incoming.body);
      const trusted = isTrustedSender(incoming.address, settings.trusted_senders);
      const stale = isStale(receivedAt, settings.max_age_hours);
      const status = !parsed ? 'not_receipt' : !trusted ? 'untrusted_sender' : stale ? 'stale' : 'unmatched';
      const row: SmsMessageRow = {
        id: newId(),
        fingerprint: incoming.fingerprint,
        device_id: deviceId,
        address: incoming.address.slice(0, 80),
        body: incoming.body.slice(0, 4000),
        received_at: receivedAt,
        ingested_at: nowIso(),
        provider: parsed?.provider ?? null,
        parsed: parsed ? 1 : 0,
        amount_cents: parsed?.amountCents ?? null,
        sender_phone: parsed?.senderPhone ?? null,
        sender_name: parsed?.senderName ?? null,
        balance_cents: parsed?.balanceCents ?? null,
        reference: parsed?.reference ?? null,
        status,
        intent_id: null,
        matched_at: null,
        matched_by: null,
        note: null,
      };
      const inserted = await this.db
        .insertInto('sms_messages')
        .values(row)
        .onConflict((oc) => oc.column('fingerprint').doNothing())
        .executeTakeFirst();
      if (Number(inserted.numInsertedOrUpdatedRows ?? 0) === 0) continue;
      created += 1;
      if (!newestReceivedAt || receivedAt > newestReceivedAt) newestReceivedAt = receivedAt;
      if (status === 'unmatched') fresh.push(row);
      else if (status === 'untrusted_sender') untrusted.push(row);
    }

    if (newestReceivedAt) await this.devices.recordLastSms(deviceId, newestReceivedAt);

    let matched = 0;
    for (const row of fresh) {
      const outcome = await this.matchOne(row);
      if (outcome === 'matched') matched += 1;
      else if (outcome === 'unmatched') await this.alerts.unmatchedReceipt(row);
    }
    for (const row of untrusted) await this.alerts.untrustedSender(row);

    const rows = await this.db
      .selectFrom('sms_messages')
      .select(['fingerprint', 'status', 'parsed', 'provider', 'amount_cents', 'sender_phone', 'intent_id', 'note'])
      .where('fingerprint', 'in', accepted)
      .execute();
    const byFingerprint = new Map(rows.map((r) => [r.fingerprint, r]));
    const results = accepted.flatMap((fingerprint) => {
      const r = byFingerprint.get(fingerprint);
      if (!r) return [];
      return [
        {
          fingerprint,
          status: r.status,
          parsed: r.parsed === 1,
          provider: r.provider,
          amount_cents: r.amount_cents,
          sender_phone: r.sender_phone,
          intent_id: r.intent_id,
          note: r.note,
        },
      ];
    });
    return { accepted, created, matched, results };
  }

  async reconcile(): Promise<ReconcileSummary> {
    const retrusted = await this.retrustAll();
    const expiredIntents = await this.intents.expirePending();
    const demoted = await this.demoteStale();
    const rows = await this.db
      .selectFrom('sms_messages')
      .selectAll()
      .where('status', '=', 'unmatched')
      .where('parsed', '=', 1)
      .orderBy('received_at', 'asc')
      .limit(200)
      .execute();
    let matched = 0;
    for (const row of rows) {
      if ((await this.matchOne(row)) === 'matched') matched += 1;
    }
    return { retrusted, expired_intents: expiredIntents, demoted_stale: demoted, matched };
  }

  async matchForIntent(intent: PaymentIntentRow): Promise<PaymentIntentRow> {
    const settings = await this.settings.get();
    if (!settings.auto_match) return intent;
    let query = this.db
      .selectFrom('sms_messages')
      .selectAll()
      .where('status', '=', 'unmatched')
      .where('parsed', '=', 1)
      .where('amount_cents', '>=', intent.amount_cents);
    query = intent.sender_phone
      ? query.where('sender_phone', '=', intent.sender_phone)
      : query.where('amount_cents', '=', intent.amount_cents);
    const candidates = await query.orderBy('received_at', 'asc').execute();
    for (const row of candidates) {
      if ((await this.matchOne(row)) === 'matched') break;
    }
    return await this.intents.get(intent.id);
  }

  async matchOne(message: SmsMessageRow): Promise<MatchOutcome> {
    if (message.status !== 'unmatched') return 'skipped';
    if (!message.amount_cents) return 'unmatched';
    const settings = await this.settings.get();
    if (!settings.auto_match) return 'skipped';
    if (isStale(message.received_at, settings.max_age_hours)) {
      await this.setStatus(message.id, 'unmatched', 'stale');
      return 'skipped';
    }
    const candidates = await this.candidateIntents(message);
    if (candidates.kind === 'ambiguous') {
      await this.note(message.id, 'ambiguous_amount_only');
      return 'unmatched';
    }
    for (const intent of candidates.intents) {
      const outcome = await this.apply(message, intent, 'auto');
      if (outcome === 'matched') return 'matched';
      if (outcome === 'message_locked') return 'skipped';
    }
    return 'unmatched';
  }

  private async candidateIntents(
    message: SmsMessageRow,
  ): Promise<{ kind: 'ok'; intents: PaymentIntentRow[] } | { kind: 'ambiguous' }> {
    const now = nowIso();
    if (message.sender_phone) {
      const byPhone = await this.db
        .selectFrom('payment_intents')
        .selectAll()
        .where('status', '=', 'pending')
        .where('expires_at', '>', now)
        .where('sender_phone', '=', message.sender_phone)
        .where('amount_cents', '<=', message.amount_cents as number)
        .orderBy('created_at', 'asc')
        .execute();
      if (byPhone.length > 0) return { kind: 'ok', intents: byPhone };
    }
    const amountOnly = await this.db
      .selectFrom('payment_intents')
      .selectAll()
      .where('status', '=', 'pending')
      .where('expires_at', '>', now)
      .where('sender_phone', 'is', null)
      .where('allow_amount_only', '=', 1)
      .where('amount_cents', '=', message.amount_cents as number)
      .orderBy('created_at', 'asc')
      .execute();
    if (amountOnly.length > 1) return { kind: 'ambiguous' };
    return { kind: 'ok', intents: amountOnly };
  }

  async manualMatch(messageId: string, intentId: string): Promise<SmsMessageRow> {
    const message = await this.getMessage(messageId);
    if (message.status === 'matched') throw conflict('already_matched');
    if (!message.amount_cents) throw badRequest('amount_unknown');
    const intent = await this.intents.get(intentId);
    if (intent.status !== 'pending') throw conflict('intent_not_pending', { status: intent.status });
    if (message.status !== 'unmatched') {
      await this.db.updateTable('sms_messages').set({ status: 'unmatched' }).where('id', '=', messageId).execute();
      message.status = 'unmatched';
    }
    const outcome = await this.apply(message, intent, 'admin');
    if (outcome !== 'matched') throw conflict('match_failed', { outcome });
    return await this.getMessage(messageId);
  }

  async ignore(messageId: string): Promise<SmsMessageRow> {
    const result = await this.db
      .updateTable('sms_messages')
      .set({ status: 'ignored' })
      .where('id', '=', messageId)
      .where('status', 'in', ['unmatched', 'not_receipt', 'untrusted_sender', 'stale'])
      .executeTakeFirst();
    if (Number(result.numUpdatedRows ?? 0) === 0) {
      const row = await this.getMessage(messageId);
      throw conflict('cannot_ignore', { status: row.status });
    }
    return await this.getMessage(messageId);
  }

  async reopen(messageId: string): Promise<SmsMessageRow> {
    const message = await this.getMessage(messageId);
    if (!['ignored', 'stale', 'untrusted_sender'].includes(message.status)) {
      throw conflict('cannot_reopen', { status: message.status });
    }
    if (!message.parsed) throw badRequest('not_a_receipt');
    await this.db.updateTable('sms_messages').set({ status: 'unmatched', note: null }).where('id', '=', messageId).execute();
    await this.matchOne(await this.getMessage(messageId));
    return await this.getMessage(messageId);
  }

  async retrust(messageId: string): Promise<SmsMessageRow> {
    const message = await this.getMessage(messageId);
    if (message.status !== 'untrusted_sender') throw conflict('not_untrusted', { status: message.status });
    const settings = await this.settings.get();
    if (!isTrustedSender(message.address, settings.trusted_senders)) {
      throw conflict('sender_still_untrusted', { address: message.address });
    }
    return await this.reopen(messageId);
  }

  async retrustAll(): Promise<number> {
    const settings = await this.settings.get();
    const rows = await this.db
      .selectFrom('sms_messages')
      .select(['id', 'address'])
      .where('status', '=', 'untrusted_sender')
      .limit(500)
      .execute();
    const nowTrusted = rows.filter((r) => isTrustedSender(r.address, settings.trusted_senders)).map((r) => r.id);
    if (nowTrusted.length === 0) return 0;
    await this.db
      .updateTable('sms_messages')
      .set({ status: 'unmatched' })
      .where('id', 'in', nowTrusted)
      .where('status', '=', 'untrusted_sender')
      .execute();
    return nowTrusted.length;
  }

  async demoteStale(): Promise<number> {
    const settings = await this.settings.get();
    const cutoff = new Date(Date.now() - settings.max_age_hours * HOUR_MS).toISOString();
    const result = await this.db
      .updateTable('sms_messages')
      .set({ status: 'stale' })
      .where('status', '=', 'unmatched')
      .where('received_at', '<', cutoff)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  }

  async getMessage(id: string): Promise<SmsMessageRow> {
    const row = await this.db.selectFrom('sms_messages').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) throw notFound('message_not_found');
    return row;
  }

  private async apply(message: SmsMessageRow, intent: PaymentIntentRow, matchedBy: MatchedBy): Promise<ApplyOutcome> {
    const lock = await this.db
      .updateTable('sms_messages')
      .set({ status: 'matching' })
      .where('id', '=', message.id)
      .where('status', '=', 'unmatched')
      .executeTakeFirst();
    if (Number(lock.numUpdatedRows ?? 0) === 0) return 'message_locked';

    const now = nowIso();
    const claimed = await this.db
      .updateTable('payment_intents')
      .set({ status: 'matched', matched_at: now, matched_message_id: message.id })
      .where('id', '=', intent.id)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    if (Number(claimed.numUpdatedRows ?? 0) === 0) {
      await this.setStatus(message.id, 'matching', 'unmatched');
      return 'intent_taken';
    }

    await this.db
      .updateTable('sms_messages')
      .set({ status: 'matched', intent_id: intent.id, matched_at: now, matched_by: matchedBy, note: null })
      .where('id', '=', message.id)
      .execute();
    const freshIntent = await this.intents.get(intent.id);
    const freshMessage = await this.getMessage(message.id);
    log.info(`matched message ${message.id} to intent ${intent.id} (${intent.reference}) by ${matchedBy}`);
    await this.alerts.paymentMatched(freshIntent, freshMessage);
    return 'matched';
  }

  private async setStatus(id: string, from: MessageStatus, to: MessageStatus): Promise<void> {
    await this.db.updateTable('sms_messages').set({ status: to }).where('id', '=', id).where('status', '=', from).execute();
  }

  private async note(id: string, note: string): Promise<void> {
    await this.db.updateTable('sms_messages').set({ note }).where('id', '=', id).execute();
  }
}
