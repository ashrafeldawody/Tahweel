import { Text } from '@mantine/core';

const majorUnits = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatMoney(cents: number | null | undefined, currency?: string | null): string {
  if (cents === null || cents === undefined) return '—';
  const amount = majorUnits.format(cents / 100);
  return currency ? `${amount} ${currency}` : amount;
}

interface MoneyProps {
  cents: number | null | undefined;
  currency?: string | null;
  size?: string;
}

export function Money({ cents, currency, size = 'sm' }: MoneyProps) {
  if (cents === null || cents === undefined) {
    return (
      <Text span c="dimmed" size={size}>
        —
      </Text>
    );
  }
  return (
    <Text span fw={600} size={size} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {formatMoney(cents, currency)}
    </Text>
  );
}
