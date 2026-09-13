import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HOUR_MS } from '../config/time.js';
import { truncateAll } from '../db/connection.js';
import { createTestContext, etisalatReceipt, fingerprintOf, isoAgo, randomPhone, waitUntil, type TestContext } from '../test/harness.js';

describe('admin and ingest HTTP flows', () => {
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
  });

  async function postSms(address: string, body: string, receivedAt = new Date().toISOString()) {
    const res = await t.request('/ingest/sms', {
      method: 'POST',
      auth: 'ingest',
      json: { device_id: 'phone-1', messages: [{ fingerprint: fingerprintOf(address, body), address, body, received_at: receivedAt }] },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as { created: number; matched: number; results: Array<{ status: string; amount_cents: number | null; intent_id: string | null }> };
  }

  it('ingest returns per-message verdicts and the dashboard lists them', async () => {
    const phone = randomPhone();
    const receipt = await postSms('e& money', etisalatReceipt(phone, '200.00'));
    expect(receipt.results[0]).toMatchObject({ status: 'unmatched', amount_cents: 20000 });
    const otp = await postSms('e& money', 'كود التفعيل الخاص بك هو 123456');
    expect(otp.results[0].status).toBe('not_receipt');
    const spoof = await postSms('+201000000000', etisalatReceipt(phone, '200.00', '5.00'));
    expect(spoof.results[0].status).toBe('untrusted_sender');
    const old = await postSms('vf-cash', etisalatReceipt(phone, '200.00', '6.00'), isoAgo(72 * HOUR_MS));
    expect(old.results[0].status).toBe('stale');

    const list = await t.request('/admin/messages?status=unmatched', { auth: 'admin' });
    const body = (await list.json()) as { total: number; counters: Record<string, number>; items: Array<{ status: string }> };
    expect(body.total).toBe(1);
    expect(body.counters).toMatchObject({ unmatched: 1, not_receipt: 1, untrusted_sender: 1, stale: 1 });

    const search = await t.request(`/admin/messages?q=${phone.slice(0, 6)}`, { auth: 'admin' });
    expect(((await search.json()) as { total: number }).total).toBe(3);

    const bad = await t.request('/ingest/sms', { method: 'POST', auth: 'ingest', json: { device_id: 'phone-1', messages: [] } });
    expect(bad.status).toBe(400);
  });

  it('manual match, ignore, reopen and retrust endpoints', async () => {
    const phone = randomPhone();
    const stale = await postSms('e& money', etisalatReceipt(phone, '300.00'), isoAgo(72 * HOUR_MS));
    const messageId = ((await (await t.request('/admin/messages?status=stale', { auth: 'admin' })).json()) as { items: Array<{ id: string }> }).items[0].id;
    expect(stale.results[0].status).toBe('stale');

    const intentRes = await t.request('/admin/intents', { method: 'POST', auth: 'admin', json: { reference: 'manual-1', amount: 300, sender_phone: phone } });
    expect(intentRes.status).toBe(201);
    const intent = (await intentRes.json()) as { id: string; status: string };
    expect(intent.status).toBe('pending');

    const matched = await t.request(`/admin/messages/${messageId}/match`, { method: 'POST', auth: 'admin', json: { intent_id: intent.id } });
    expect(matched.status).toBe(200);
    expect(((await matched.json()) as { status: string; matched_by: string }).matched_by).toBe('admin');
    const again = await t.request(`/admin/messages/${messageId}/match`, { method: 'POST', auth: 'admin', json: { intent_id: intent.id } });
    expect(again.status).toBe(409);

    await postSms('e& money', etisalatReceipt(phone, '5.00'));
    const other = ((await (await t.request('/admin/messages?status=unmatched', { auth: 'admin' })).json()) as { items: Array<{ id: string }> }).items[0].id;
    expect((await t.request(`/admin/messages/${other}/ignore`, { method: 'POST', auth: 'admin' })).status).toBe(200);
    expect((await t.request(`/admin/messages/${other}/reopen`, { method: 'POST', auth: 'admin' })).status).toBe(200);
    expect(((await (await t.request(`/admin/messages/${other}`, { auth: 'admin' })).json()) as { status: string }).status).toBe('unmatched');

    await postSms('MyShop', etisalatReceipt(phone, '7.00'));
    const untrusted = ((await (await t.request('/admin/messages?status=untrusted_sender', { auth: 'admin' })).json()) as { items: Array<{ id: string }> }).items[0].id;
    expect((await t.request(`/admin/messages/${untrusted}/retrust`, { method: 'POST', auth: 'admin' })).status).toBe(409);
    const settings = (await (await t.request('/admin/settings', { auth: 'admin' })).json()) as { trusted_senders: string[] };
    const patched = await t.request('/admin/settings', { method: 'PATCH', auth: 'admin', json: { trusted_senders: [...settings.trusted_senders, 'MyShop'] } });
    expect(patched.status).toBe(200);
    expect((await t.request(`/admin/messages/${untrusted}/retrust`, { method: 'POST', auth: 'admin' })).status).toBe(200);
    expect((await t.request('/admin/messages/nope/ignore', { method: 'POST', auth: 'admin' })).status).toBe(404);
  });

  it('devices, reconcile, webhooks and settings endpoints', async () => {
    await t.request('/ingest/heartbeat', { method: 'POST', auth: 'ingest', json: { device_id: 'phone-1', name: 'Office phone', battery: 80, network: 'wifi', pending_count: 0 } });
    const devices = (await (await t.request('/admin/devices', { auth: 'admin' })).json()) as { items: Array<{ device_id: string; online: boolean; name: string }> };
    expect(devices.items).toEqual([expect.objectContaining({ device_id: 'phone-1', online: true, name: 'Office phone' })]);

    await t.ctx.db.updateTable('devices').set({ last_seen_at: isoAgo(2 * HOUR_MS) }).execute();
    expect(await t.ctx.devices.sweepOffline()).toBe(1);
    await waitUntil(async () => t.webhook.requests.some((r) => r.json.event === 'device.offline'));
    await t.request('/ingest/heartbeat', { method: 'POST', auth: 'ingest', json: { device_id: 'phone-1' } });
    await waitUntil(async () => t.webhook.requests.some((r) => r.json.event === 'device.online'));

    const reconcile = await t.request('/admin/reconcile', { method: 'POST', auth: 'admin' });
    expect(reconcile.status).toBe(200);
    expect(await reconcile.json()).toEqual({ retrusted: 0, expired_intents: 0, demoted_stale: 0, matched: 0 });

    const test = await t.request('/admin/webhooks/test', { method: 'POST', auth: 'admin', json: {} });
    expect(test.status).toBe(200);
    await waitUntil(async () => (await t.ctx.webhooks.countByStatus()).delivered === 3);
    const deliveries = (await (await t.request('/admin/webhooks', { auth: 'admin' })).json()) as { total: number; items: Array<{ id: string; status: string }> };
    expect(deliveries.total).toBe(3);
    const redeliver = await t.request(`/admin/webhooks/${deliveries.items[0].id}/redeliver`, { method: 'POST', auth: 'admin' });
    expect(redeliver.status).toBe(409);

    const invalid = await t.request('/admin/settings', { method: 'PATCH', auth: 'admin', json: { max_age_hours: 0 } });
    expect(invalid.status).toBe(400);
    const ok = await t.request('/admin/settings', { method: 'PATCH', auth: 'admin', json: { max_age_hours: 12, auto_match: false, currency: 'egp' } });
    expect(await ok.json()).toMatchObject({ max_age_hours: 12, auto_match: false, currency: 'egp' });

    const health = (await (await t.request('/admin/health', { auth: 'admin' })).json()) as { parsers: string[]; webhook_configured: boolean };
    expect(health.parsers).toEqual(expect.arrayContaining(['etisalat_money', 'vodafone_cash']));
    expect(health.webhook_configured).toBe(true);
  });

  it('integrator API: get by id / reference, cancel, and matched message embedded', async () => {
    const phone = randomPhone();
    const created = (await (await t.request('/api/v1/intents', { method: 'POST', auth: 'api', json: { reference: 'api-1', amount: 40, sender_phone: phone, metadata: { order: 7 } } })).json()) as { id: string };
    await postSms('vf-cash', etisalatReceipt(phone, '40.00'));
    const byRef = (await (await t.request('/api/v1/intents/by-reference/api-1', { auth: 'api' })).json()) as { status: string; message: { amount_cents: number } | null; metadata: { order: number } };
    expect(byRef.status).toBe('matched');
    expect(byRef.message?.amount_cents).toBe(4000);
    expect(byRef.metadata).toEqual({ order: 7 });
    expect((await t.request(`/api/v1/intents/${created.id}`, { method: 'DELETE', auth: 'api' })).status).toBe(409);

    const pending = (await (await t.request('/api/v1/intents', { method: 'POST', auth: 'api', json: { reference: 'api-2', amount: 40, sender_phone: phone } })).json()) as { id: string };
    const cancelled = await t.request(`/api/v1/intents/${pending.id}`, { method: 'DELETE', auth: 'api' });
    expect(cancelled.status).toBe(200);
    expect(((await cancelled.json()) as { status: string }).status).toBe('cancelled');
    expect((await t.request('/api/v1/intents/missing', { auth: 'api' })).status).toBe(404);
  });
});
