import 'dotenv/config';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('sqlite:./data/tahweel.sqlite'),
  INGEST_TOKEN: z.string().min(16),
  API_KEY: z.string().min(16),
  ADMIN_PASSWORD: z.string().min(8),
  JWT_SECRET: z.string().optional(),
  JWT_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(24),
  WEBHOOK_URL: z.string().url().optional(),
  WEBHOOK_SECRET: z.string().min(16).optional(),
  RECONCILE_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(60).default(5),
  UI_DIST: z.string().optional(),
  SMTP_URL: z.string().optional(),
  ALERT_EMAIL_TO: z.string().optional(),
  ALERT_EMAIL_FROM: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof EnvSchema> & { jwtSecret: string };

function emptyToUndefined(raw: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key] = value === '' ? undefined : value;
  }
  return out;
}

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(emptyToUndefined(raw));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  if (env.WEBHOOK_URL && !env.WEBHOOK_SECRET) {
    throw new Error('WEBHOOK_SECRET is required when WEBHOOK_URL is set');
  }
  const jwtSecret =
    env.JWT_SECRET ?? createHash('sha256').update(`tahweel-jwt:${env.ADMIN_PASSWORD}`).digest('hex');
  return { ...env, jwtSecret };
}
