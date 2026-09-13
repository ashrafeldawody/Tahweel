import { Chip, Group } from '@mantine/core';
import type { Counters } from '../api/types';
import { statusLabel } from './StatusBadge';

export const ALL_STATUSES = 'all';

interface StatusChipsProps {
  statuses: readonly string[];
  counters: Counters | undefined;
  value: string;
  onChange: (value: string) => void;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function StatusChips({ statuses, counters, value, onChange }: StatusChipsProps) {
  const totals = counters ?? {};
  const allCount = Object.values(totals).reduce((sum, count) => sum + count, 0);

  return (
    <Chip.Group multiple={false} value={value} onChange={(next) => onChange(next ?? ALL_STATUSES)}>
      <Group gap={6} wrap="wrap">
        <Chip value={ALL_STATUSES} size="xs" variant="light">
          All · {allCount}
        </Chip>
        {statuses.map((status) => (
          <Chip key={status} value={status} size="xs" variant="light">
            {capitalize(statusLabel(status))} · {totals[status] ?? 0}
          </Chip>
        ))}
      </Group>
    </Chip.Group>
  );
}
