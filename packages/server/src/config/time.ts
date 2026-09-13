export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoAfterMs(offsetMs: number, from: number = Date.now()): string {
  return new Date(from + offsetMs).toISOString();
}

export function parseIso(value: string): number {
  return Date.parse(value);
}

export function toIso(value: string): string | null {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}
