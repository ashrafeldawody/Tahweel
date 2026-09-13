import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../api/app.js';
import { loadEnv, type Env } from '../config/env.js';
import { buildContext, type AppContext } from '../context.js';
import { migrateToLatest, openDatabase, truncateAll, type DatabaseHandle } from '../db/connection.js';
import { RecordingMailer } from '../services/mail.js';

export const TEST_INGEST_TOKEN = 'test-ingest-token-0123456789abcdef';
export const TEST_API_KEY = 'test-api-key-0123456789abcdefghij';
export const TEST_ADMIN_PASSWORD = 'test-admin-password';
export const TEST_WEBHOOK_SECRET = 'test-webhook-secret-0123456789';

export interface WebhookStub {
  url: string;
  requests: Array<{ headers: IncomingMessage['headers']; body: string; json: Record<string, unknown> }>;
  respondWith: number;
  close(): Promise<void>;
  waitFor(count: number, timeoutMs?: number): Promise<void>;
}

export async function startWebhookStub(): Promise<WebhookStub> {
  const stub: WebhookStub = {
    url: '',
    requests: [],
    respondWith: 200,
    close: async () => undefined,
    waitFor: async () => undefined,
  };
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      stub.requests.push({ headers: req.headers, body, json: JSON.parse(body) as Record<string, unknown> });
      res.statusCode = stub.respondWith;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  stub.url = `http://127.0.0.1:${port}/hook`;
  stub.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  stub.waitFor = async (count, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    while (stub.requests.length < count) {
      if (Date.now() > deadline) throw new Error(`webhook stub received ${stub.requests.length} of ${count} requests`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  return stub;
}

export interface TestContext {
  ctx: AppContext;
  env: Env;
  handle: DatabaseHandle;
  mailer: RecordingMailer;
  webhook: WebhookStub;
  app: ReturnType<typeof createApp>;
  request(path: string, init?: RequestInit & { json?: unknown; auth?: 'ingest' | 'api' | 'admin' | string | null }): Promise<Response>;
  adminToken(): Promise<string>;
  cleanup(): Promise<void>;
}

export async function createTestContext(overrides: Partial<NodeJS.ProcessEnv> = {}): Promise<TestContext> {
  const webhook = await startWebhookStub();
  const externalUrl = process.env.DATABASE_URL;
  const usesPostgres = Boolean(externalUrl && /^postgres/.test(externalUrl));
  const tempDir = usesPostgres ? null : mkdtempSync(join(tmpdir(), 'tahweel-test-'));
  const databaseUrl = usesPostgres ? (externalUrl as string) : `sqlite:${join(tempDir as string, 'test.sqlite')}`;
  const env = loadEnv({
    DATABASE_URL: databaseUrl,
    INGEST_TOKEN: TEST_INGEST_TOKEN,
    API_KEY: TEST_API_KEY,
    ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    WEBHOOK_URL: webhook.url,
    WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    LOG_LEVEL: 'error',
    ...overrides,
  });
  const handle = openDatabase(env.DATABASE_URL);
  await migrateToLatest(handle.db);
  if (usesPostgres) await truncateAll(handle.db);
  const mailer = new RecordingMailer();
  const ctx = await buildContext(env, handle, { mailer });
  const app = createApp(ctx);
  let cachedAdminToken: string | null = null;

  const adminToken = async () => {
    if (!cachedAdminToken) cachedAdminToken = (await ctx.adminJwt.issue()).token;
    return cachedAdminToken;
  };

  const request: TestContext['request'] = async (path, init = {}) => {
    const { json, auth, headers: extraHeaders, ...rest } = init;
    const headers = new Headers(extraHeaders ?? {});
    if (json !== undefined) headers.set('content-type', 'application/json');
    if (auth === 'ingest') headers.set('authorization', `Bearer ${TEST_INGEST_TOKEN}`);
    else if (auth === 'api') headers.set('x-api-key', TEST_API_KEY);
    else if (auth === 'admin') headers.set('authorization', `Bearer ${await adminToken()}`);
    else if (typeof auth === 'string') headers.set('authorization', auth);
    return await app.request(path, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body });
  };

  return {
    ctx,
    env,
    handle,
    mailer,
    webhook,
    app,
    request,
    adminToken,
    cleanup: async () => {
      await handle.close();
      await webhook.close();
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

export function fingerprintOf(address: string, body: string, salt: string = randomUUID()): string {
  return createHash('sha256').update(`${address}|${body}|${salt}`).digest('hex');
}

export function etisalatReceipt(senderPhone: string, amount: string, balance = '999.00'): string {
  return `تم إستلام مبلغ ${amount} ج.م من رقم ${senderPhone} المسجل باسمTEST NAME بنجاح. رصيد محفظتك الحالى ${balance} ج.م.`;
}

export function randomPhone(prefix = '010'): string {
  return `${prefix}${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
}

export async function waitUntil(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("waitUntil timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}
