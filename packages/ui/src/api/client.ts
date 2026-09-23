import { clearToken, getToken } from '../auth/token';
import type {
  CreateIntentInput,
  Delivery,
  DeliveryListParams,
  Device,
  Health,
  Intent,
  IntentListParams,
  IntentWithMessage,
  LoginResponse,
  Message,
  MessageListParams,
  MessageWithIntent,
  Overview,
  Page,
  ReconcileSummary,
  Session,
  Settings,
  SettingsPatch,
} from './types';

export interface ApiIssue {
  path: Array<string | number>;
  message: string;
}

interface ParsedErrorBody {
  code: string;
  issues: ApiIssue[];
}

const LOGIN_PATH = '/admin/login';

function parseErrorBody(body: unknown): ParsedErrorBody {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const code = typeof record.error === 'string' ? record.error : 'request_failed';
    const issues = Array.isArray(record.issues) ? (record.issues as ApiIssue[]) : [];
    return { code, issues };
  }
  return { code: 'request_failed', issues: [] };
}

function humanizeCode(code: string): string {
  return code.replace(/_/g, ' ');
}

function describeError(status: number, parsed: ParsedErrorBody): string {
  if (parsed.issues.length > 0) {
    return parsed.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ');
  }
  return `${humanizeCode(parsed.code)} (HTTP ${status})`;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: ApiIssue[];

  constructor(status: number, body: unknown) {
    const parsed = parseErrorBody(body);
    super(describeError(status, parsed));
    this.name = 'ApiError';
    this.status = status;
    this.code = parsed.code;
    this.issues = parsed.issues;
  }
}

type QueryValue = string | number | boolean | null | undefined;

export function buildQuery(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params) as Array<[string, QueryValue]>) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  const isLogin = path === LOGIN_PATH;
  if (token && !isLogin) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await readJson(response);

  if (response.status === 401 && !isLogin) clearToken();
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload as T;
}

const encode = encodeURIComponent;

export const api = {
  login: (password: string) => request<LoginResponse>('POST', LOGIN_PATH, { password }),
  me: () => request<Session>('GET', '/admin/me'),
  overview: () => request<Overview>('GET', '/admin/overview'),
  health: () => request<Health>('GET', '/admin/health'),
  reconcile: () => request<ReconcileSummary>('POST', '/admin/reconcile'),

  devices: {
    list: () => request<{ items: Device[] }>('GET', '/admin/devices'),
  },

  messages: {
    list: (params: MessageListParams) => request<Page<Message>>('GET', `/admin/messages${buildQuery(params)}`),
    get: (id: string) => request<MessageWithIntent>('GET', `/admin/messages/${encode(id)}`),
    match: (id: string, intentId: string) => request<Message>('POST', `/admin/messages/${encode(id)}/match`, { intent_id: intentId }),
    approve: (id: string) => request<Message>('POST', `/admin/messages/${encode(id)}/approve`),
    ignore: (id: string) => request<Message>('POST', `/admin/messages/${encode(id)}/ignore`),
    reopen: (id: string) => request<Message>('POST', `/admin/messages/${encode(id)}/reopen`),
    retrust: (id: string) => request<Message>('POST', `/admin/messages/${encode(id)}/retrust`),
  },

  intents: {
    list: (params: IntentListParams) => request<Page<Intent>>('GET', `/admin/intents${buildQuery(params)}`),
    create: (input: CreateIntentInput) => request<IntentWithMessage>('POST', '/admin/intents', input),
    cancel: (id: string) => request<Intent>('POST', `/admin/intents/${encode(id)}/cancel`),
  },

  settings: {
    get: () => request<Settings>('GET', '/admin/settings'),
    patch: (patch: SettingsPatch) => request<Settings>('PATCH', '/admin/settings', patch),
  },

  webhooks: {
    list: (params: DeliveryListParams) => request<Page<Delivery>>('GET', `/admin/webhooks${buildQuery(params)}`),
    redeliver: (id: string) => request<Delivery>('POST', `/admin/webhooks/${encode(id)}/redeliver`),
    test: (url?: string) => request<Delivery>('POST', '/admin/webhooks/test', url ? { url } : {}),
  },
};
