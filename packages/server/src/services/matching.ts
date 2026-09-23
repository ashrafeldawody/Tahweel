import type { Kysely } from 'kysely';
import { newId } from '../config/ids.js';
import { logger } from '../config/log.js';
import { HOUR_MS, nowIso, parseIso, toIso } from '../config/time.js';
import type {
  Database,
  HoldReason,
  MatchedBy,
  MessageStatus,
  PaymentIntentRow,
  SmsMessageRow,
  Verification,
} from '../db/schema.js';
import { parseSms } from '../parsers/registry.js';
import type { AlertService } from './alerts.js';
import type { DevicesService } from './devices.js';
import { badRequest, conflict, notFound } from './errors.js';
import type { IntentsService } from './intents.js';
import type { Settings, SettingsService } from './settings.js';
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

export type MatchOutcome = 'matched' | 'unmatched' | 'held' | 'skipped';
type ApplyOutcome = 'matched' | 'message_locked' | 'intent_taken';

export interface ReconcileSummary {
  retrusted: number;
  expired_intents: number;
  demoted_stale: number;
  released: number;
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
        verification: null,
        expected_balance_cents: null,
        reviewed_at: null,
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
    fresh.sort((a, b) => a.received_at.localeCompare(b.received_at));
    for (const row of fresh) {
      const outcome = await this.matchOne(row);
      if (outcome === 'matched') matched += 1;
      else if (outcome === 'unmatched') await this.alerts.unmatchedReceipt(row);
    }
    if (fresh.length > 0) matched += (await this.releaseHeld()).matched;
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
    const released = await this.releaseHeld();
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
    return {
      retrusted,
      expired_intents: expiredIntents,
      demoted_stale: demoted,
      released: released.released,
      matched: matched + released.matched,
    };
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
    if (isStale(message.received_at, settings.max_age_hours)) {
      await this.setStatus(message.id, 'unmatched', 'stale');
      return 'skipped';
    }
    const holdReason = await this.holdReason(message, settings);
    if (holdReason) {
      const held = await this.db
        .updateTable('sms_messages')
        .set({ status: 'held', note: holdReason })
        .where('id', '=', message.id)
        .where('status', '=', 'unmatched')
        .executeTakeFirst();
      if (Number(held.numUpdatedRows ?? 0) === 0) return 'skipped';
      log.info(`held message ${message.id} for review (${holdReason})`);
      await this.alerts.heldReceipt(await this.getMessage(message.id), holdReason);
      return 'held';
    }
    if (!settings.auto_match) return 'skipped';
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

  async approve(messageId: string): Promise<SmsMessageRow> {
    const reviewed = await this.db
      .updateTable('sms_messages')
      .set({ status: 'unmatched', note: null, reviewed_at: nowIso() })
      .where('id', '=', messageId)
      .where('status', '=', 'held')
      .executeTakeFirst();
    if (Number(reviewed.numUpdatedRows ?? 0) === 0) {
      const row = await this.getMessage(messageId);
      throw conflict('not_held', { status: row.status });
    }
    log.info(`message ${messageId} approved after review`);
    await this.matchOne(await this.getMessage(messageId));
    await this.releaseHeld();
    return await this.getMessage(messageId);
  }

  async releaseHeld(): Promise<{ released: number; matched: number }> {
    const settings = await this.settings.get();
    const rows = await this.db
      .selectFrom('sms_messages')
      .selectAll()
      .where('status', '=', 'held')
      .orderBy('received_at', 'asc')
      .limit(200)
      .execute();
    let released = 0;
    let matched = 0;
    for (const row of rows) {
      const reason = await this.holdReason(row, settings);
      if (reason) {
        if (reason !== row.note) await this.note(row.id, reason);
        continue;
      }
      const unlocked = await this.db
        .updateTable('sms_messages')
        .set({ status: 'unmatched', note: null })
        .where('id', '=', row.id)
        .where('status', '=', 'held')
        .executeTakeFirst();
      if (Number(unlocked.numUpdatedRows ?? 0) === 0) continue;
      released += 1;
      log.info(`released held message ${row.id}`);
      if ((await this.matchOne(await this.getMessage(row.id))) === 'matched') matched += 1;
    }
    return { released, matched };
  }

  private async holdReason(message: SmsMessageRow, settings: Settings): Promise<HoldReason | null> {
    if (message.reviewed_at) return null;
    const verification = await this.refreshVerification(message, Math.round(settings.balance_margin * 100));
    if (settings.verify_balance) {
      if (verification === 'mismatch') return 'balance_mismatch';
      if (verification === 'no_balance') return 'no_balance';
      if (verification === 'no_history') return 'no_balance_history';
    }
    const limit = settings.review_above_amount;
    if (limit != null && (message.amount_cents ?? 0) > Math.round(limit * 100)) return 'above_review_limit';
    return null;
  }

  private async refreshVerification(message: SmsMessageRow, marginCents: number): Promise<Verification> {
    if (message.verification === 'verified') return 'verified';
    const { verification, expected } = await this.checkBalance(message, marginCents);
    if (verification !== message.verification || expected !== message.expected_balance_cents) {
      await this.db
        .updateTable('sms_messages')
        .set({ verification, expected_balance_cents: expected })
        .where('id', '=', message.id)
        .execute();
    }
    return verification;
  }

  private async checkBalance(
    message: SmsMessageRow,
    marginCents: number,
  ): Promise<{ verification: Verification; expected: number | null }> {
    if (message.balance_cents == null || message.amount_cents == null) return { verification: 'no_balance', expected: null };
    let query = this.db
      .selectFrom('sms_messages')
      .select(['balance_cents'])
      .where('device_id', '=', message.device_id)
      .where('id', '!=', message.id)
      .where('received_at', '<', message.received_at)
      .where('balance_cents', 'is not', null)
      .where((eb) => eb.or([eb('verification', '=', 'verified'), eb('reviewed_at', 'is not', null)]));
    query = message.provider ? query.where('provider', '=', message.provider) : query.where('provider', 'is', null);
    const anchor = await query.orderBy('received_at', 'desc').limit(1).executeTakeFirst();
    if (!anchor || anchor.balance_cents == null) return { verification: 'no_history', expected: null };
    const expected = anchor.balance_cents + message.amount_cents;
    const withinMargin = Math.abs(expected - message.balance_cents) <= marginCents;
    return { verification: withinMargin ? 'verified' : 'mismatch', expected };
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
    const reviewedAt = message.reviewed_at ?? nowIso();
    await this.db
      .updateTable('sms_messages')
      .set({ status: 'unmatched', reviewed_at: reviewedAt })
      .where('id', '=', messageId)
      .execute();
    message.status = 'unmatched';
    message.reviewed_at = reviewedAt;
    const outcome = await this.apply(message, intent, 'admin');
    if (outcome !== 'matched') throw conflict('match_failed', { outcome });
    return await this.getMessage(messageId);
  }

  async ignore(messageId: string): Promise<SmsMessageRow> {
    const result = await this.db
      .updateTable('sms_messages')
      .set({ status: 'ignored' })
      .where('id', '=', messageId)
      .where('status', 'in', ['unmatched', 'not_receipt', 'untrusted_sender', 'stale', 'held'])
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
