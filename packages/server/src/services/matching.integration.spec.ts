import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HOUR_MS } from '../config/time.js';
import { truncateAll } from '../db/connection.js';
import type { SmsMessageRow } from '../db/schema.js';
import {
  TEST_WEBHOOK_SECRET,
  createTestContext,
  etisalatReceipt,
  fingerprintOf,
  isoAgo,
  randomPhone,
  waitUntil,
  type TestContext,
} from '../test/harness.js';
import { SIGNATURE_HEADER, verifySignatureHeader } from './webhooks.js';

describe('MatchService (database integration)', () => {
  let t: TestContext;

  beforeAll(async () => {
    t = await createTestContext();
  });

  afterAll(async () => {
    await t.cleanup();
  });

  beforeEach(async () => {
    await truncateAll(t.ctx.db);
    t.webhook.requests.length = 0;
    t.webhook.respondWith = 200;
    t.mailer.sent.length = 0;
  });

  async function ingestReceipt(
    senderPhone: string,
    amount: string,
    options: { address?: string; receivedAt?: string; body?: string; fingerprint?: string } = {},
  ): Promise<SmsMessageRow> {
    const address = options.address ?? 'e& money';
    const body = options.body ?? etisalatReceipt(senderPhone, amount);
    const fingerprint = options.fingerprint ?? fingerprintOf(address, body);
    await t.ctx.matcher.ingest('test-device', [
      { fingerprint, address, body, received_at: options.receivedAt ?? new Date().toISOString() },
    ]);
    const row = await t.ctx.db.selectFrom('sms_messages').selectAll().where('fingerprint', '=', fingerprint).executeTakeFirst();
    if (!row) throw new Error('message row missing');
    return row;
  }

  it('matches a receipt to a pending intent created before the SMS (intent-then-sms)', async () => {
    const phone = randomPhone();
    const intent = await t.ctx.intents.create({ reference: 'order-1', amount: 200, sender_phone: phone });
    const message = await ingestReceipt(phone, '200.00');
    expect(message.status).toBe('matched');
    expect(message.intent_id).toBe(intent.id);
    expect(message.matched_by).toBe('auto');

    const fresh = await t.ctx.intents.get(intent.id);
    expect(fresh.status).toBe('matched');
    expect(fresh.matched_message_id).toBe(message.id);

    await waitUntil(async () => t.webhook.requests.some((r) => r.json.event === 'payment.matched'));
    const delivery = t.webhook.requests.find((r) => r.json.event === 'payment.matched')!;
    expect(delivery.json.event).toBe('payment.matched');
    expect((delivery.json.intent as { reference: string }).reference).toBe('order-1');
    expect((delivery.json.message as { sender_phone: string }).sender_phone).toBe(phone);
    expect(verifySignatureHeader(TEST_WEBHOOK_SECRET, String(delivery.headers[SIGNATURE_HEADER.toLowerCase()]), delivery.body)).toBe(true);

    await waitUntil(async () => (await t.ctx.webhooks.list({ limit: 10, offset: 0 })).items[0]?.status === 'delivered');
    const stored = await t.ctx.webhooks.list({ limit: 10, offset: 0 });
    expect(stored.items).toHaveLength(1);
    expect(stored.items[0].status).toBe('delivered');
    expect(stored.items[0].attempts).toBe(1);
  });

  it('matches a receipt that arrived before the intent (sms-then-intent) and accepts overpayment', async () => {
    const phone = randomPhone();
    const message = await ingestReceipt(phone, '250.00');
    expect(message.status).toBe('unmatched');
    expect(t.mailer.sent.map((m) => m.subject)).toContain('Wallet receipt without a matching intent');

    const created = await t.ctx.intents.create({ reference: 'order-2', amount: 200, sender_phone: `+2${phone}` });
    const intent = await t.ctx.matcher.matchForIntent(created);
    expect(intent.status).toBe('matched');
    const after = await t.ctx.matcher.getMessage(message.id);
    expect(after.status).toBe('matched');
    expect(after.intent_id).toBe(intent.id);
  });

  it('leaves an underpayment unmatched', async () => {
    const phone = randomPhone();
    await t.ctx.intents.create({ reference: 'order-3', amount: 200, sender_phone: phone });
    const message = await ingestReceipt(phone, '150.00');
    expect(message.status).toBe('unmatched');
    expect((await t.ctx.intents.getByReference('order-3')).status).toBe('pending');
  });

  it('prefers the oldest pending intent for the same sender', async () => {
    const phone = randomPhone();
    const first = await t.ctx.intents.create({ reference: 'order-4a', amount: 100, sender_phone: phone });
    await t.ctx.intents.create({ reference: 'order-4b', amount: 100, sender_phone: phone });
    const message = await ingestReceipt(phone, '100.00');
    expect(message.intent_id).toBe(first.id);
    expect((await t.ctx.intents.getByReference('order-4b')).status).toBe('pending');
  });

  it('never matches an expired intent', async () => {
    const phone = randomPhone();
    const intent = await t.ctx.intents.create({ reference: 'order-5', amount: 50, sender_phone: phone, expires_in_minutes: 1 });
    await t.ctx.db.updateTable('payment_intents').set({ expires_at: isoAgo(HOUR_MS) }).where('id', '=', intent.id).execute();
    const message = await ingestReceipt(phone, '50.00');
    expect(message.status).toBe('unmatched');
    const summary = await t.ctx.matcher.reconcile();
    expect(summary.expired_intents).toBe(1);
    expect((await t.ctx.intents.get(intent.id)).status).toBe('expired');
  });

  it('requires sender_phone unless allow_amount_only is set, and amount-only needs an exact unique amount', async () => {
    await expect(t.ctx.intents.create({ reference: 'order-6', amount: 75 })).rejects.toMatchObject({ code: 'sender_phone_required' });
    await expect(t.ctx.intents.create({ reference: 'order-6', amount: 75, sender_phone: '123' })).rejects.toMatchObject({ code: 'invalid_sender_phone' });

    const intent = await t.ctx.intents.create({ reference: 'order-6', amount: 75, allow_amount_only: true });
    expect(intent.allow_amount_only).toBe(1);
    const over = await ingestReceipt(randomPhone(), '80.00');
    expect(over.status).toBe('unmatched');
    const exact = await ingestReceipt(randomPhone(), '75.00');
    expect(exact.status).toBe('matched');
    expect(exact.intent_id).toBe(intent.id);

    await t.ctx.intents.create({ reference: 'order-7a', amount: 33, allow_amount_only: true });
    await t.ctx.intents.create({ reference: 'order-7b', amount: 33, allow_amount_only: true });
    const ambiguous = await ingestReceipt(randomPhone(), '33.00');
    expect(ambiguous.status).toBe('unmatched');
    expect(ambiguous.note).toBe('ambiguous_amount_only');
  });

  it('a receipt that names the sender but carries no phone (Orange Cash) matches only an amount-only intent', async () => {
    const body = 'تم إستلام عملية تحويل أموال بمبلغ 150.00 جنيه من RYAN H Ahmed، رصيدك الحالي 366.22 جنيه. رقم المعاملة 1908287136';
    const phoneBound = await t.ctx.intents.create({ reference: 'orange-1', amount: 150, sender_phone: randomPhone() });
    const message = await ingestReceipt('', '150.00', { address: 'Orange Cash', body });
    expect(message).toMatchObject({
      status: 'unmatched',
      parsed: 1,
      provider: 'orange_cash',
      sender_phone: null,
      sender_name: 'RYAN H Ahmed',
      amount_cents: 15000,
      reference: '1908287136',
    });
    expect((await t.ctx.intents.get(phoneBound.id)).status).toBe('pending');

    const amountOnly = await t.ctx.matcher.matchForIntent(
      await t.ctx.intents.create({ reference: 'orange-2', amount: 150, allow_amount_only: true }),
    );
    expect(amountOnly.status).toBe('matched');
    const after = await t.ctx.matcher.getMessage(message.id);
    expect(after.status).toBe('matched');
    expect(after.intent_id).toBe(amountOnly.id);
    expect((await t.ctx.intents.get(phoneBound.id)).status).toBe('pending');
  });

  it('a phoneless receipt can still be matched by hand to a phone-bound intent', async () => {
    const intent = await t.ctx.intents.create({ reference: 'orange-3', amount: 6.43, sender_phone: randomPhone() });
    const message = await ingestReceipt('', '6.43', {
      address: 'اورنج كاش',
      body: 'Successful cash-in with amount EGP 6.43.\nYour current balance is EGP 6.43',
    });
    expect(message).toMatchObject({ status: 'unmatched', provider: 'orange_cash', sender_phone: null, amount_cents: 643 });
    const matched = await t.ctx.matcher.manualMatch(message.id, intent.id);
    expect(matched.status).toBe('matched');
    expect(matched.matched_by).toBe('admin');
  });

  it('stores an old receipt as stale and never auto-matches it, but allows a manual match', async () => {
    const phone = randomPhone();
    const intent = await t.ctx.intents.create({ reference: 'order-8', amount: 200, sender_phone: phone });
    const message = await ingestReceipt(phone, '200.00', { receivedAt: isoAgo(5 * 24 * HOUR_MS) });
    expect(message.status).toBe('stale');
    await t.ctx.matcher.reconcile();
    expect((await t.ctx.intents.get(intent.id)).status).toBe('pending');

    const matched = await t.ctx.matcher.manualMatch(message.id, intent.id);
    expect(matched.status).toBe('matched');
    expect(matched.matched_by).toBe('admin');
    expect((await t.ctx.intents.get(intent.id)).status).toBe('matched');
  });

  it('demotes unmatched receipts that cross the age line during reconcile', async () => {
    const message = await ingestReceipt(randomPhone(), '10.00', { receivedAt: isoAgo(47 * HOUR_MS) });
    expect(message.status).toBe('unmatched');
    await t.ctx.settings.patch({ max_age_hours: 24 });
    const summary = await t.ctx.matcher.reconcile();
    expect(summary.demoted_stale).toBe(1);
    expect((await t.ctx.matcher.getMessage(message.id)).status).toBe('stale');
  });

  it('never matches a receipt-looking SMS sent by an ordinary number, until the sender is trusted', async () => {
    const phone = randomPhone();
    const intent = await t.ctx.intents.create({ reference: 'order-9', amount: 200, sender_phone: phone });
    const message = await ingestReceipt(phone, '200.00', { address: '+201234567890' });
    expect(message.status).toBe('untrusted_sender');
    expect(message.parsed).toBe(1);
    expect(message.amount_cents).toBe(20000);
    expect(t.mailer.sent.map((m) => m.subject)).toContain('Receipt-looking SMS from an untrusted sender id');

    await t.ctx.matcher.reconcile();
    expect((await t.ctx.matcher.getMessage(message.id)).status).toBe('untrusted_sender');
    await expect(t.ctx.matcher.retrust(message.id)).rejects.toMatchObject({ code: 'sender_still_untrusted' });

    const settings = await t.ctx.settings.get();
    await t.ctx.settings.patch({ trusted_senders: [...settings.trusted_senders, '+201234567890'] });
    const summary = await t.ctx.matcher.reconcile();
    expect(summary.retrusted).toBe(1);
    expect(summary.matched).toBe(1);
    expect((await t.ctx.intents.get(intent.id)).status).toBe('matched');
  });

  it('stores non-receipt messages without matching them', async () => {
    const message = await ingestReceipt(randomPhone(), '0', { body: 'كود التفعيل الخاص بك هو 4321' });
    expect(message.status).toBe('not_receipt');
    expect(message.parsed).toBe(0);
    expect(message.amount_cents).toBeNull();
  });

  it('ignores duplicate fingerprints', async () => {
    const body = etisalatReceipt(randomPhone(), '200.00');
    const fingerprint = fingerprintOf('e& money', body);
    const incoming = { fingerprint, address: 'e& money', body, received_at: new Date().toISOString() };
    const first = await t.ctx.matcher.ingest('test-device', [incoming]);
    const second = await t.ctx.matcher.ingest('test-device', [incoming, incoming]);
    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(second.accepted).toEqual([fingerprint, fingerprint]);
    expect(second.results).toHaveLength(2);
    const count = await t.ctx.db.selectFrom('sms_messages').select((eb) => eb.fn.countAll<number>().as('n')).where('fingerprint', '=', fingerprint).executeTakeFirst();
    expect(Number(count?.n)).toBe(1);
  });

  it('locks a message before applying so two concurrent reconcilers cannot double-apply', async () => {
    const phone = randomPhone();
    await t.ctx.settings.patch({ auto_match: false });
    const intent = await t.ctx.intents.create({ reference: 'order-10', amount: 120, sender_phone: phone });
    const message = await ingestReceipt(phone, '120.00');
    expect(message.status).toBe('unmatched');
    await t.ctx.settings.patch({ auto_match: true });

    const outcomes = await Promise.all([t.ctx.matcher.matchOne(message), t.ctx.matcher.matchOne(message), t.ctx.matcher.matchOne(message)]);
    expect(outcomes.filter((o) => o === 'matched')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'skipped' || o === 'unmatched')).toHaveLength(2);

    await waitUntil(async () => (await t.ctx.webhooks.list({ limit: 10, offset: 0 })).items.some((d) => d.status === 'delivered'));
    const deliveries = await t.ctx.db.selectFrom('webhook_deliveries').selectAll().where('intent_id', '=', intent.id).execute();
    expect(deliveries).toHaveLength(1);
    expect((await t.ctx.intents.get(intent.id)).status).toBe('matched');
  });

  it('does not reuse an intent that another message already claimed', async () => {
    const phone = randomPhone();
    await t.ctx.settings.patch({ auto_match: false });
    const intent = await t.ctx.intents.create({ reference: 'order-11', amount: 60, sender_phone: phone });
    const a = await ingestReceipt(phone, '60.00');
    const b = await ingestReceipt(phone, '60.00', { body: etisalatReceipt(phone, '60.00', '1.00') });
    await t.ctx.settings.patch({ auto_match: true });
    const [oa, ob] = await Promise.all([t.ctx.matcher.matchOne(a), t.ctx.matcher.matchOne(b)]);
    expect([oa, ob].filter((o) => o === 'matched')).toHaveLength(1);
    const messages = await t.ctx.db.selectFrom('sms_messages').select(['status', 'intent_id']).execute();
    expect(messages.filter((m) => m.status === 'matched' && m.intent_id === intent.id)).toHaveLength(1);
    expect(messages.filter((m) => m.status === 'unmatched')).toHaveLength(1);
  });

  it('records failed webhook deliveries and retries them on redeliver', async () => {
    t.webhook.respondWith = 500;
    const phone = randomPhone();
    await t.ctx.intents.create({ reference: 'order-12', amount: 20, sender_phone: phone });
    await ingestReceipt(phone, '20.00');
    await waitUntil(async () => (await t.ctx.webhooks.list({ limit: 10, offset: 0 })).items[0]?.attempts === 1);
    const failed = (await t.ctx.webhooks.list({ limit: 10, offset: 0 })).items[0];
    expect(failed.status).toBe('pending');
    expect(failed.attempts).toBe(1);
    expect(failed.last_status_code).toBe(500);
    expect(failed.next_attempt_at).not.toBeNull();

    t.webhook.respondWith = 200;
    const retried = await t.ctx.webhooks.redeliver(failed.id);
    expect(retried.status).toBe('delivered');
    expect(retried.attempts).toBe(2);
  });

  it('honours the per-intent webhook_url override', async () => {
    const phone = randomPhone();
    await t.ctx.intents.create({ reference: 'order-13', amount: 20, sender_phone: phone, webhook_url: `${t.webhook.url}?custom=1` });
    await ingestReceipt(phone, '20.00');
    await waitUntil(async () => (await t.ctx.webhooks.list({ limit: 10, offset: 0 })).items[0]?.status === 'delivered');
    const delivery = (await t.ctx.webhooks.list({ limit: 10, offset: 0 })).items[0];
    expect(delivery.url).toContain('custom=1');
  });

  it('ignore / reopen round-trip', async () => {
    const phone = randomPhone();
    const message = await ingestReceipt(phone, '15.00');
    const ignored = await t.ctx.matcher.ignore(message.id);
    expect(ignored.status).toBe('ignored');
    await expect(t.ctx.matcher.ignore(message.id)).rejects.toMatchObject({ code: 'cannot_ignore' });
    await t.ctx.intents.create({ reference: 'order-14', amount: 15, sender_phone: phone });
    const reopened = await t.ctx.matcher.reopen(message.id);
    expect(reopened.status).toBe('matched');
  });
});
