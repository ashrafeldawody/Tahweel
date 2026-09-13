import type { Context, MiddlewareHandler, Next } from 'hono';
import type { Env } from '../config/env.js';
import type { AdminJwt, AdminSession } from './admin-jwt.js';
import { bearerToken, secretsMatch } from './tokens.js';

export const API_KEY_HEADER = 'X-Api-Key';

export interface AdminVariables {
  admin: AdminSession;
}

function unauthorized(c: Context, code: string) {
  return c.json({ error: code }, 401);
}

export function ingestAuth(env: Pick<Env, 'INGEST_TOKEN'>): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const token = bearerToken(c.req.header('authorization'));
    if (!secretsMatch(token, env.INGEST_TOKEN)) return unauthorized(c, 'invalid_ingest_token');
    await next();
  };
}

export function apiKeyAuth(env: Pick<Env, 'API_KEY'>): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const presented = c.req.header(API_KEY_HEADER) ?? bearerToken(c.req.header('authorization'));
    if (!secretsMatch(presented, env.API_KEY)) return unauthorized(c, 'invalid_api_key');
    await next();
  };
}

export function adminAuth(jwt: AdminJwt): MiddlewareHandler<{ Variables: AdminVariables }> {
  return async (c, next) => {
    const token = bearerToken(c.req.header('authorization'));
    const session = token ? await jwt.verify(token) : null;
    if (!session) return unauthorized(c, 'invalid_admin_token');
    c.set('admin', session);
    await next();
  };
}
