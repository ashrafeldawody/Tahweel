import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);

export const EMPTY_TIME = '—';
const ABSOLUTE_FORMAT = 'YYYY-MM-DD HH:mm:ss';

function inZone(value: dayjs.Dayjs, tz: string | null | undefined): dayjs.Dayjs {
  if (!tz) return value;
  try {
    return value.tz(tz);
  } catch {
    return value;
  }
}

export function formatAbsolute(iso: string | null | undefined, tz?: string | null): string {
  if (!iso) return EMPTY_TIME;
  const parsed = dayjs(iso);
  if (!parsed.isValid()) return iso;
  return inZone(parsed, tz).format(ABSOLUTE_FORMAT);
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return EMPTY_TIME;
  const parsed = dayjs(iso);
  return parsed.isValid() ? parsed.fromNow() : iso;
}

export function isPast(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const parsed = dayjs(iso);
  return parsed.isValid() && parsed.isBefore(dayjs());
}
