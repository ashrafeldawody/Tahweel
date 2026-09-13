import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../test/harness.js';

describe('dashboard static serving', () => {
  let t: TestContext;
  let dist: string;

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), 'tahweel-ui-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Tahweel</title><div id="root"></div>');
    writeFileSync(join(dist, 'assets', 'app.js'), 'console.log("tahweel")');
    writeFileSync(join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    t = await createTestContext({ UI_DIST: dist });
  });

  afterAll(async () => {
    await t.cleanup();
    rmSync(dist, { recursive: true, force: true });
  });

  it('serves index.html at / and for every /app/* route', async () => {
    for (const path of ['/', '/app/login', '/app/messages']) {
      const res = await t.request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toContain('<title>Tahweel</title>');
    }
  });

  it('serves hashed assets and the favicon', async () => {
    const asset = await t.request('/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect(await asset.text()).toContain('tahweel');
    expect((await t.request('/favicon.svg')).status).toBe(200);
    expect((await t.request('/assets/missing.js')).status).toBe(404);
  });

  it('keeps API routes ahead of the SPA fallback', async () => {
    expect((await t.request('/health')).status).toBe(200);
    expect((await t.request('/admin/overview')).status).toBe(401);
  });
});
