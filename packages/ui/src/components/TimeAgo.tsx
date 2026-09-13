import { Stack, Text, Tooltip } from '@mantine/core';
import { useTimezone } from '../lib/settings';
import { EMPTY_TIME, formatAbsolute, formatRelative } from '../lib/time';

interface TimeProps {
  iso: string | null | undefined;
  size?: string;
}

export function TimeAgo({ iso, size = 'sm' }: TimeProps) {
  const tz = useTimezone();
  if (!iso) {
    return (
      <Text span c="dimmed" size={size}>
        {EMPTY_TIME}
      </Text>
    );
  }
  const absolute = formatAbsolute(iso, tz);
  return (
    <Tooltip label={absolute} withArrow>
      <Text span size={size} title={absolute}>
        {formatRelative(iso)}
      </Text>
    </Tooltip>
  );
}

export function DateTime({ iso, size = 'sm' }: TimeProps) {
  const tz = useTimezone();
  return (
    <Text span size={size} c={iso ? undefined : 'dimmed'} style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
      {formatAbsolute(iso, tz)}
    </Text>
  );
}

export function TimeStack({ iso }: TimeProps) {
  const tz = useTimezone();
  if (!iso) {
    return (
      <Text span c="dimmed" size="sm">
        {EMPTY_TIME}
      </Text>
    );
  }
  return (
    <Stack gap={0}>
      <Text size="sm">{formatRelative(iso)}</Text>
      <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
        {formatAbsolute(iso, tz)}
      </Text>
    </Stack>
  );
}
