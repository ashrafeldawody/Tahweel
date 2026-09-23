import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { truncateAll } from '../db/connection.js';
import type { SmsMessageRow } from '../db/schema.js';
import { createTestContext, etisalatReceipt, fingerprintOf, isoAgo, randomPhone, type TestContext } from '../test/harness.js';

const MINUTE = 60_000;

describe('balance verification', () => {
  let t: TestContext;

  beforeAll(async () => {
    t = await createTestContext();
  });

  afterAll(async () => {
    await t.cleanup();
  });

  beforeEach(async () => {
    await truncateAll(t.ctx.db);
    await t.ctx.settings.patch({ verify_balance: true });
    t.mailer.sent.length = 0;
  });

  async function receive(
    senderPhone: string,
    amount: string,
    balance: string | null,
    minutesAgo: number,
    device = 'wallet-phone',
  ): Promise<SmsMessageRow> {
    const body =
      balance === null
        ? `تم إستلام مبلغ ${amount} ج.م من رقم ${senderPhone} المسجل باسمTEST NAME بنجاح.`
        : etisalatReceipt(senderPhone, amount, balance);
    const receivedAt = isoAgo(minutesAgo * MINUTE);
    const fingerprint = fingerprintOf('e& money', `${body}|${receivedAt}`);
    await t.ctx.matcher.ingest(device, [{ fingerprint, address: 'e& money', body, received_at: receivedAt }]);
    return await message(fingerprint);
  }

  async function message(fingerprint: string): Promise<SmsMessageRow> {
    const row = await t.ctx.db.selectFrom('sms_messages').selectAll().where('fingerprint', '=', fingerprint).executeTakeFirst();
    if (!row) throw new Error('message row missing');
    return row;
  }

  async function reload(row: SmsMessageRow): Promise<SmsMessageRow> {
    return await message(row.fingerprint);
  }

  async function anchor(balance: string, minutesAgo = 60): Promise<SmsMessageRow> {
    const first = await receive(randomPhone(), '1.00', balance, minutesAgo);
    expect(first.status).toBe('held');
    expect(first.note).toBe('no_balance_history');
    return await t.ctx.matcher.approve(first.id);
  }

  it('is off by default', async () => {
    await truncateAll(t.ctx.db);
    const settings = await t.ctx.settings.get();
    expect(settings.verify_balance).toBe(false);
    expect(settings.balance_margin).toBe(0.02);

    const phone = randomPhone();
    const intent = await t.ctx.intents.create({ reference: 'default-off', amount: 90, sender_phone: phone });
    const row = await receive(phone, '90.00', null, 5);
    expect(row.status).toBe('matched');
    expect(row.verification).toBe('no_balance');
    expect((await t.ctx.intents.get(intent.id)).status).toBe('matched');
  });

  it('holds the first receipt until an operator approves it, then trusts its balance', async () => {
    const phone = randomPhone();
    const intent = await t.ctx.intents.create({ reference: 'first', amount: 100, sender_phone: phone });
    const first = await receive(phone, '100.00', '600.00', 30);
    expect(first.status).toBe('held');
    expect(first.note).toBe('no_balance_history');
    expect(first.verification).toBe('no_history');
    expect((await t.ctx.intents.get(intent.id)).status).toBe('pending');
    expect(t.mailer.sent.some((m) => m.subject === 'Wallet receipt held for review')).toBe(true);

    const approved = await t.ctx.matcher.approve(first.id);
    expect(approved.status).toBe('matched');
    expect((await t.ctx.intents.get(intent.id)).status).toBe('matched');

    const next = await receive(randomPhone(), '50.00', '650.00', 10);
    expect(next.verification).toBe('verified');
    expect(next.status).toBe('unmatched');
  });

  it('auto-matches a receipt whose balance continues the confirmed balance', async () => {
    await anchor('500.00');
    const phone = randomPhone();
    const intent = await t.ctx.intents.create({ reference: 'chain', amount: 200, sender_phone: phone });
    const row = await receive(phone, '200.00', '700.00', 5);
    expect(row.verification).toBe('verified');
    expect(row.expected_balance_cents).toBe(70000);
    expect(row.status).toBe('matched');
    expect(row.intent_id).toBe(intent.id);
  });

  it('accepts a balance within the margin and holds one outside it', async () => {
    await anchor('500.00', 90);
    const within = await receive(randomPhone(), '100.00', '599.98', 30);
    expect(within.verification).toBe('verified');
    expect(within.expected_balance_cents).toBe(60000);

    const outside = await receive(randomPhone(), '10.00', '610.01', 20);
    expect(outside.verification).toBe('mismatch');
    expect(outside.expected_balance_cents).toBe(60998);
    expect(outside.status).toBe('held');
  });

  it('uses the margin from Settings', async () => {
    await t.ctx.settings.patch({ balance_margin: 0 });
    await anchor('500.00');
    const off = await receive(randomPhone(), '100.00', '600.01', 10);
    expect(off.verification).toBe('mismatch');

    await t.ctx.settings.patch({ balance_margin: 0.05 });
    await t.ctx.matcher.reconcile();
    expect((await reload(off)).verification).toBe('verified');
  });

  it('holds a faked receipt whose balance does not add up, and never trusts its balance', async () => {
    await anchor('500.00');
    const attacker = randomPhone();
    const intent = await t.ctx.intents.create({ reference: 'target', amount: 300, sender_phone: attacker });

    const fake = await receive(attacker, '300.00', '12345.00', 20);
    expect(fake.status).toBe('held');
    expect(fake.note).toBe('balance_mismatch');
    expect(fake.expected_balance_cents).toBe(80000);
    expect((await t.ctx.intents.get(intent.id)).status).toBe('pending');

    const followUp = await receive(attacker, '300.00', '12645.00', 15);
    expect(followUp.note).toBe('balance_mismatch');

    const real = await receive(randomPhone(), '40.00', '540.00', 10);
    expect(real.verification).toBe('verified');

    expect((await t.ctx.matcher.ignore(fake.id)).status).toBe('ignored');
  });

  it('holds a receipt that carries no balance', async () => {
    await anchor('500.00');
    const row = await receive(randomPhone(), '80.00', null, 5);
    expect(row.status).toBe('held');
    expect(row.note).toBe('no_balance');
  });

  it('releases a receipt held because an earlier one had not arrived yet', async () => {
    await anchor('500.00', 90);
    const phone = randomPhone();
    const intent = await t.ctx.intents.create({ reference: 'late', amount: 70, sender_phone: phone });
    const later = await receive(phone, '70.00', '670.00', 10);
    expect(later.status).toBe('held');

    const earlier = await receive(randomPhone(), '100.00', '600.00', 20);
    expect(earlier.verification).toBe('verified');

    const released = await reload(later);
    expect(released.verification).toBe('verified');
    expect(released.status).toBe('matched');
    expect((await t.ctx.intents.get(intent.id)).status).toBe('matched');
  });

  it('still holds verified receipts above the review limit', async () => {
    await anchor('500.00');
    await t.ctx.settings.patch({ review_above_amount: 1000 });
    const row = await receive(randomPhone(), '1500.00', '2000.00', 5);
    expect(row.verification).toBe('verified');
    expect(row.note).toBe('above_review_limit');
  });

  it('releases held receipts once verification is turned off', async () => {
    const phone = randomPhone();
    const intent = await t.ctx.intents.create({ reference: 'toggle', amount: 60, sender_phone: phone });
    const row = await receive(phone, '60.00', null, 5);
    expect(row.status).toBe('held');

    await t.ctx.settings.patch({ verify_balance: false });
    const summary = await t.ctx.matcher.reconcile();
    expect(summary.released).toBe(1);
    expect((await t.ctx.intents.get(intent.id)).status).toBe('matched');
  });

  it('keeps the balance chain per phone', async () => {
    await anchor('500.00');
    const other = await receive(randomPhone(), '100.00', '600.00', 5, 'second-phone');
    expect(other.note).toBe('no_balance_history');
  });

  it('manual match counts as a review and anchors the balance', async () => {
    const phone = randomPhone();
    const intent = await t.ctx.intents.create({ reference: 'manual', amount: 100, sender_phone: phone });
    const row = await receive(phone, '100.00', '400.00', 30);
    expect(row.status).toBe('held');
    await t.ctx.matcher.manualMatch(row.id, intent.id);

    const next = await receive(randomPhone(), '25.00', '425.00', 5);
    expect(next.verification).toBe('verified');
  });
});
