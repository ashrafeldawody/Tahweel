import { Group, Pagination as MantinePagination, Text } from '@mantine/core';

interface PaginationProps {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}

export function Pagination({ total, limit, offset, onChange }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(pageCount, Math.floor(offset / limit) + 1);
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);

  return (
    <Group justify="space-between" wrap="wrap">
      <Text size="sm" c="dimmed">
        Showing {from}–{to} of {total}
      </Text>
      <MantinePagination total={pageCount} value={page} onChange={(next) => onChange((next - 1) * limit)} size="sm" withEdges />
    </Group>
  );
}
