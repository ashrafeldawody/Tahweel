import { logger } from '../config/log.js';
import { MINUTE_MS } from '../config/time.js';
import type { AppContext } from '../context.js';

const log = logger('jobs');
const WEBHOOK_TICK_MS = 30_000;
const DEVICE_TICK_MS = MINUTE_MS;

function every(name: string, intervalMs: number, task: () => Promise<void>): NodeJS.Timeout {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await task();
    } catch (error) {
      log.error(`${name} failed: ${(error as Error).message}`);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return timer;
}

export function startJobs(ctx: AppContext): () => void {
  const timers = [
    every('reconcile', ctx.env.RECONCILE_INTERVAL_MINUTES * MINUTE_MS, async () => {
      const summary = await ctx.matcher.reconcile();
      if (summary.matched || summary.expired_intents || summary.demoted_stale || summary.retrusted) {
        log.info(`reconcile: ${JSON.stringify(summary)}`);
      }
    }),
    every('webhooks', WEBHOOK_TICK_MS, async () => {
      await ctx.webhooks.processDue();
    }),
    every('devices', DEVICE_TICK_MS, async () => {
      const offline = await ctx.devices.sweepOffline();
      if (offline) log.warn(`${offline} device(s) went offline`);
    }),
  ];
  log.info(`scheduled reconcile every ${ctx.env.RECONCILE_INTERVAL_MINUTES} min, webhook retries every 30 s, device sweep every 1 min`);
  return () => timers.forEach((t) => clearInterval(t));
}
