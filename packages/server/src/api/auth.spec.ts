import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_ADMIN_PASSWORD, TEST_API_KEY, TEST_INGEST_TOKEN, createTestContext, type TestContext } from '../test/harness.js';

describe('authentication', () => {
  let t: TestContext;

  beforeAll(async () => {
    t = await createTestContext();
  });

  afterAll(async () => {
    await t.cleanup();
  });

  const heartbeat = { device_id: 'dev-1', name: 'Test phone' };
  const intent = { reference: 'auth-1', amount: 10, sender_phone: '01061916846' };

  describe('/ingest/* wants the ingest bearer token', () => {
    it('rejects no credential', async () => {
      const res = await t.request('/ingest/heartbeat', { method: 'POST', json: heartbeat });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'invalid_ingest_token' });
    });

    it('rejects the api key and the admin token', async () => {
      expect((await t.request('/ingest/heartbeat', { method: 'POST', json: heartbeat, auth: `Bearer ${TEST_API_KEY}` })).status).toBe(401);
      expect((await t.request('/ingest/heartbeat', { method: 'POST', json: heartbeat, auth: 'admin' })).status).toBe(401);
      expect((await t.request('/ingest/sms', { method: 'POST', json: {}, auth: 'admin' })).status).toBe(401);
    });

    it('rejects a token that differs by one character', async () => {
      const res = await t.request('/ingest/heartbeat', { method: 'POST', json: heartbeat, auth: `Bearer ${TEST_INGEST_TOKEN}x` });
      expect(res.status).toBe(401);
    });

    it('accepts the ingest token', async () => {
      const res = await t.request('/ingest/heartbeat', { method: 'POST', json: heartbeat, auth: 'ingest' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; device: { online: boolean } };
      expect(body.ok).toBe(true);
      expect(body.device.online).toBe(true);
    });
  });

  describe('/api/v1/* wants X-Api-Key', () => {
    it('rejects no credential, the ingest token and the admin token', async () => {
      expect((await t.request('/api/v1/intents', { method: 'POST', json: intent })).status).toBe(401);
      expect((await t.request('/api/v1/intents', { method: 'POST', json: intent, auth: `Bearer ${TEST_INGEST_TOKEN}` })).status).toBe(401);
      expect((await t.request('/api/v1/intents', { method: 'GET', auth: 'admin' })).status).toBe(401);
      expect((await t.request('/api/v1/intents', { method: 'GET', headers: { 'x-api-key': 'nope' } })).status).toBe(401);
    });

    it('accepts the api key in X-Api-Key and as a bearer', async () => {
      const created = await t.request('/api/v1/intents', { method: 'POST', json: intent, auth: 'api' });
      expect(created.status).toBe(201);
      const body = (await created.json()) as { id: string; status: string; sender_phone: string };
      expect(body.status).toBe('pending');
      expect(body.sender_phone).toBe('01061916846');
      const listed = await t.request('/api/v1/intents?status=pending', { auth: `Bearer ${TEST_API_KEY}` });
      expect(listed.status).toBe(200);
      const duplicate = await t.request('/api/v1/intents', { method: 'POST', json: intent, auth: 'api' });
      expect(duplicate.status).toBe(409);
      expect(await duplicate.json()).toMatchObject({ error: 'reference_exists', intent_id: body.id });
    });

    it('validates the body', async () => {
      const res = await t.request('/api/v1/intents', { method: 'POST', json: { reference: 'x' }, auth: 'api' });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid_request' });
    });
  });

  describe('/admin/* wants a JWT from /admin/login', () => {
    it('rejects a wrong password', async () => {
      const res = await t.request('/admin/login', { method: 'POST', json: { password: 'wrong' } });
      expect(res.status).toBe(401);
    });

    it('issues a token for the right password and accepts it', async () => {
      const login = await t.request('/admin/login', { method: 'POST', json: { password: TEST_ADMIN_PASSWORD } });
      expect(login.status).toBe(200);
      const { token } = (await login.json()) as { token: string };
      const me = await t.request('/admin/me', { auth: `Bearer ${token}` });
      expect(me.status).toBe(200);
      expect(await me.json()).toMatchObject({ sub: 'admin', role: 'admin' });
      expect((await t.request('/admin/overview', { auth: `Bearer ${token}` })).status).toBe(200);
    });

    it('rejects no credential, the api key, the ingest token and a forged token', async () => {
      expect((await t.request('/admin/overview')).status).toBe(401);
      expect((await t.request('/admin/overview', { auth: `Bearer ${TEST_API_KEY}` })).status).toBe(401);
      expect((await t.request('/admin/overview', { auth: `Bearer ${TEST_INGEST_TOKEN}` })).status).toBe(401);
      expect((await t.request('/admin/settings', { headers: { 'x-api-key': TEST_API_KEY } })).status).toBe(401);
      const forged = `${(await t.adminToken()).slice(0, -2)}xx`;
      expect((await t.request('/admin/overview', { auth: `Bearer ${forged}` })).status).toBe(401);
    });
  });

  it('serves /health and the OpenAPI document without credentials', async () => {
    const health = await t.request('/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, database: t.ctx.dialect });
    const doc = await t.request('/docs-json');
    expect(doc.status).toBe(200);
    const spec = (await doc.json()) as { paths: Record<string, unknown>; components: { securitySchemes: Record<string, unknown> } };
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(['/ingest/sms', '/ingest/heartbeat', '/api/v1/intents', '/api/v1/intents/{id}', '/admin/login', '/admin/messages/{id}/match', '/admin/webhooks/{id}/redeliver']),
    );
    expect(Object.keys(spec.components.securitySchemes)).toEqual(['IngestToken', 'ApiKey', 'AdminToken']);
    expect((await t.request('/docs')).status).toBe(200);
  });
});
