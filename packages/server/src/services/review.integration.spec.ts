import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { truncateAll } from '../db/connection.js';
import type { SmsMessageRow } from '../db/schema.js';
import { createTestContext, etisalatReceipt, fingerprintOf, randomPhone, type TestContext } from '../test/harness.js';

describe('review holds and phone forwarding rules', () => {
  let t: TestContext;

  beforeAll(async () => {
    t = await createTestContext();
  });

  afterAll(async () => {
    await t.cleanup();
  });

  beforeEach(async () => {
    await truncateAll(t.ctx.db);
    t.mailer.sent.length = 0;
  });

  async function receive(senderPhone: string, amount: string): Promise<SmsMessageRow> {
    const body = etisalatReceipt(senderPhone, amount);
    const fingerprint = fingerprintOf('e& money', body);
    await t.ctx.matcher.ingest('wallet-phone', [{ fingerprint, address: 'e& money', body, received_at: new Date().toISOString() }]);
    const row = await t.ctx.db.selectFrom('sms_messages').selectAll().where('fingerprint', '=', fingerprint).executeTakeFirst();
    if (!row) throw new Error('message row missing');
    return row;
  }

  it('matches every amount when no review limit is set', async () => {
    const phone = randomPhone();
    const intent = await t.ctx.intents.create({ reference: 'no-limit', amount: 50000, sender_phone: phone });
    const row = await receive(phone, '50000.00');
    expect(row.status).toBe('matched');
    expect(row.intent_id).toBe(intent.id);
  });

  it('holds receipts above the review limit until approved', async () => {
    await t.ctx.settings.patch({ review_above_amount: 1000 });
    const phone = randomPhone();
    const intent = await t.ctx.intents.create({ reference: 'big', amount: 1500, sender_phone: phone });
    const row = await receive(phone, '1500.00');
    expect(row.status).toBe('held');
    expect(row.note).toBe('above_review_limit');
    expect((await t.ctx.intents.get(intent.id)).status).toBe('pending');
    expect(t.mailer.sent.some((m) => m.subject === 'Wallet receipt held for review')).toBe(true);

    const atLimit = await receive(randomPhone(), '1000.00');
    expect(atLimit.status).toBe('unmatched');

    const approved = await t.ctx.matcher.approve(row.id);
    expect(approved.status).toBe('matched');
    expect(approved.reviewed_at).not.toBeNull();
    expect((await t.ctx.intents.get(intent.id)).status).toBe('matched');
  });

  it('does not match a held receipt when its intent is created later', async () => {
    await t.ctx.settings.patch({ review_above_amount: 100 });
    const phone = randomPhone();
    const row = await receive(phone, '500.00');
    expect(row.status).toBe('held');
    const intent = await t.ctx.intents.create({ reference: 'after', amount: 500, sender_phone: phone });
    const created = await t.ctx.matcher.matchForIntent(intent);
    expect(created.status).toBe('pending');
  });

  it('releases held receipts when the limit is raised or removed', async () => {
    await t.ctx.settings.patch({ review_above_amount: 100 });
    const phone = randomPhone();
    const intent = await t.ctx.intents.create({ reference: 'raise', amount: 300, sender_phone: phone });
    const row = await receive(phone, '300.00');
    expect(row.status).toBe('held');

    await t.ctx.settings.patch({ review_above_amount: null });
    const summary = await t.ctx.matcher.reconcile();
    expect(summary.released).toBe(1);
    expect((await t.ctx.intents.get(intent.id)).status).toBe('matched');
  });

  it('lets an operator ignore a held receipt or match it by hand', async () => {
    await t.ctx.settings.patch({ review_above_amount: 100 });
    const fake = await receive(randomPhone(), '900.00');
    expect((await t.ctx.matcher.ignore(fake.id)).status).toBe('ignored');

    const phone = randomPhone();
    const intent = await t.ctx.intents.create({ reference: 'by-hand', amount: 400, sender_phone: phone });
    const row = await receive(phone, '400.00');
    const matched = await t.ctx.matcher.manualMatch(row.id, intent.id);
    expect(matched.status).toBe('matched');
    expect(matched.reviewed_at).not.toBeNull();
  });

  it('exposes approve over HTTP and refuses messages that are not held', async () => {
    await t.ctx.settings.patch({ review_above_amount: 5 });
    const row = await receive(randomPhone(), '10.00');
    const res = await t.request(`/admin/messages/${row.id}/approve`, { method: 'POST', auth: 'admin' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('unmatched');

    const again = await t.request(`/admin/messages/${row.id}/approve`, { method: 'POST', auth: 'admin' });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: 'not_held' });
  });

  it('sends the forwarding rules in the heartbeat response', async () => {
    const res = await t.request('/ingest/heartbeat', { method: 'POST', auth: 'ingest', json: { device_id: 'wallet-phone' } });
    const body = (await res.json()) as { forwarding: { filter: boolean; senders: string[]; keywords: string[] } };
    expect(body.forwarding.filter).toBe(true);
    expect(body.forwarding.senders).toContain('e& money');
    expect(body.forwarding.keywords).toContain('مبلغ');

    await t.ctx.settings.patch({ phone_filter: false, trusted_senders: ['VF-Cash '] });
    const off = (await (await t.request('/ingest/heartbeat', { method: 'POST', auth: 'ingest', json: { device_id: 'wallet-phone' } })).json()) as {
      forwarding: { filter: boolean; senders: string[] };
    };
    expect(off.forwarding).toMatchObject({ filter: false, senders: ['vf-cash'] });
  });
});
