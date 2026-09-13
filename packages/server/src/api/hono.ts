import { OpenAPIHono, type Hook } from '@hono/zod-openapi';
import type { Env as HonoEnv } from 'hono';

export function validationHook<E extends HonoEnv>(): Hook<unknown, E, string, unknown> {
  return (result, c) => {
    if (result.success) return undefined;
    return c.json(
      {
        error: 'invalid_request',
        issues: result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      },
      400,
    );
  };
}

export function createRouter<E extends HonoEnv = HonoEnv>(): OpenAPIHono<E> {
  return new OpenAPIHono<E>({ defaultHook: validationHook<E>() });
}
