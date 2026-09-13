import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { truncateAll } from '../db/connection.js';
import { SIGNATURE_HEADER, verifySignatureHeader } from '../services/webhooks.js';
import { createTestContext, startWebhookStub, TEST_WEBHOOK_SECRET, type TestContext, type WebhookStub } from '../test/harness.js';

const DASHBOARD_SECRET = 'dashboard-webhook-secret-0123456789';

describe('webhook settings from the dashboard', () => {
  let withEnv: TestContext;
  let withoutEnv: TestContext;
  let target: WebhookStub;

  beforeAll(async () => {
    target = await startWebhookStub();
    withEnv = await createTestContext();
    withoutEnv = await createTestContext({ WEBHOOK_URL: undefined, WEBHOOK_SECRET: undefined });
  });

  afterAll(async () => {
    await withEnv.cleanup();
    await withoutEnv.cleanup();
    await target.close();
  });

  it('starts from the environment values and never returns the secret', async () => {
    const settings = (await (await withEnv.request('/admin/settings', { auth: 'admin' })).json()) as Record<string, unknown>;
    expect(settings.webhook_url).toBe(withEnv.webhook.url);
    expect(settings.webhook_secret_set).toBe(true);
    expect(settings).not.toHaveProperty('webhook_secret');
  });

  it('a URL saved in settings overrides the environment and deliveries are signed with the saved secret', async () => {
    const patched = await withEnv.request('/admin/settings', { method: 'PATCH', auth: 'admin', json: { webhook_url: target.url, webhook_secret: DASHBOARD_SECRET } });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ webhook_url: target.url, webhook_secret_set: true });

    const test = await withEnv.request('/admin/webhooks/test', { method: 'POST', auth: 'admin', json: {} });
    expect(test.status).toBe(200);
    await target.waitFor(1);
    const delivery = target.requests[0];
    expect(delivery.json.event).toBe('webhook.test');
    expect(verifySignatureHeader(DASHBOARD_SECRET, String(delivery.headers[SIGNATURE_HEADER.toLowerCase()]), delivery.body)).toBe(true);
    expect(verifySignatureHeader(TEST_WEBHOOK_SECRET, String(delivery.headers[SIGNATURE_HEADER.toLowerCase()]), delivery.body)).toBe(false);
    expect(withEnv.webhook.requests).toHaveLength(0);
  });

  it('clearing the URL falls back to the environment', async () => {
    const cleared = (await (await withEnv.request('/admin/settings', { method: 'PATCH', auth: 'admin', json: { webhook_url: null, webhook_secret: null } })).json()) as Record<string, unknown>;
    expect(cleared.webhook_url).toBe(withEnv.webhook.url);
    expect(cleared.webhook_secret_set).toBe(true);
  });

  it('without environment values the webhook is unconfigured until both fields are saved', async () => {
    await truncateAll(withoutEnv.ctx.db);
    const initial = (await (await withoutEnv.request('/admin/settings', { auth: 'admin' })).json()) as Record<string, unknown>;
    expect(initial).toMatchObject({ webhook_url: null, webhook_secret_set: false });
    const health = (await (await withoutEnv.request('/admin/health', { auth: 'admin' })).json()) as { webhook_configured: boolean };
    expect(health.webhook_configured).toBe(false);

    const noSecret = await withoutEnv.request('/admin/settings', { method: 'PATCH', auth: 'admin', json: { webhook_url: target.url } });
    expect(noSecret.status).toBe(400);
    expect(await noSecret.json()).toEqual({ error: 'webhook_secret_required' });

    const tooShort = await withoutEnv.request('/admin/settings', { method: 'PATCH', auth: 'admin', json: { webhook_url: target.url, webhook_secret: 'short' } });
    expect(tooShort.status).toBe(400);

    const notAUrl = await withoutEnv.request('/admin/settings', { method: 'PATCH', auth: 'admin', json: { webhook_url: 'not a url', webhook_secret: DASHBOARD_SECRET } });
    expect(notAUrl.status).toBe(400);

    const ok = await withoutEnv.request('/admin/settings', { method: 'PATCH', auth: 'admin', json: { webhook_url: target.url, webhook_secret: DASHBOARD_SECRET } });
    expect(await ok.json()).toMatchObject({ webhook_url: target.url, webhook_secret_set: true });
    const overview = (await (await withoutEnv.request('/admin/overview', { auth: 'admin' })).json()) as { webhook_configured: boolean };
    expect(overview.webhook_configured).toBe(true);
  });
});
