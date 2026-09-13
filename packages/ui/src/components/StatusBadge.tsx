import { Badge } from '@mantine/core';

const STATUS_COLORS: Record<string, string> = {
  unmatched: 'orange',
  matching: 'blue',
  matched: 'green',
  ignored: 'gray',
  not_receipt: 'gray',
  untrusted_sender: 'red',
  stale: 'yellow',
  pending: 'blue',
  expired: 'gray',
  cancelled: 'gray',
  delivered: 'green',
  failed: 'red',
};

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? 'gray';
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge color={statusColor(status)} size="sm" tt="none" fw={600}>
      {statusLabel(status)}
    </Badge>
  );
}
