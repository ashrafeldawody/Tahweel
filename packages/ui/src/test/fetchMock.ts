import { vi } from 'vitest';

export interface MockResult {
  status?: number;
  body?: unknown;
}

export interface RecordedCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string>;
}

export type MockHandler = (call: RecordedCall) => MockResult | Promise<MockResult>;
export type MockRoutes = Record<string, MockResult | MockHandler>;

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, 'http://localhost');
  if (input instanceof URL) return input;
  return new URL(input.url, 'http://localhost');
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function mockFetch(routes: MockRoutes) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const call: RecordedCall = { method, path: url.pathname, query: url.searchParams, body, headers: normalizeHeaders(init?.headers) };
    calls.push(call);
    const route = routes[`${method} ${url.pathname}`];
    if (route === undefined) return jsonResponse(404, { error: 'not_found' });
    const result = typeof route === 'function' ? await route(call) : route;
    return jsonResponse(result.status ?? 200, result.body);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}
