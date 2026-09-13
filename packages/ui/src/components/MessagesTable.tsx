import { Stack, Table, Text } from '@mantine/core';
import type { Message } from '../api/types';
import { EmptyRow } from './Feedback';
import { Money } from './Money';
import { StatusBadge } from './StatusBadge';
import { DateTime } from './TimeAgo';

interface MessagesTableProps {
  messages: Message[];
  currency: string;
  onSelect?: (message: Message) => void;
  emptyLabel?: string;
}

const COLUMN_COUNT = 8;

export function MessagesTable({ messages, currency, onSelect, emptyLabel = 'No messages match these filters.' }: MessagesTableProps) {
  const clickable = Boolean(onSelect);
  return (
    <Table.ScrollContainer minWidth={900}>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Received</Table.Th>
            <Table.Th>Sender id</Table.Th>
            <Table.Th>Provider</Table.Th>
            <Table.Th>Amount</Table.Th>
            <Table.Th>From</Table.Th>
            <Table.Th>Reference</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Note</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {messages.length === 0 && <EmptyRow colSpan={COLUMN_COUNT} label={emptyLabel} />}
          {messages.map((message) => (
            <Table.Tr
              key={message.id}
              data-testid="message-row"
              onClick={onSelect ? () => onSelect(message) : undefined}
              style={clickable ? { cursor: 'pointer' } : undefined}
            >
              <Table.Td>
                <DateTime iso={message.received_at} />
              </Table.Td>
              <Table.Td>
                <Text size="sm" fw={500}>
                  {message.address}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm" c={message.provider ? undefined : 'dimmed'}>
                  {message.provider ?? '—'}
                </Text>
              </Table.Td>
              <Table.Td>
                <Money cents={message.amount_cents} currency={currency} />
              </Table.Td>
              <Table.Td>
                <Stack gap={0}>
                  <Text size="sm" c={message.sender_phone ? undefined : 'dimmed'}>
                    {message.sender_phone ?? '—'}
                  </Text>
                  {message.sender_name && (
                    <Text size="xs" c="dimmed" dir="auto" truncate maw={180}>
                      {message.sender_name}
                    </Text>
                  )}
                </Stack>
              </Table.Td>
              <Table.Td>
                <Text size="sm" ff="monospace" c={message.reference ? undefined : 'dimmed'}>
                  {message.reference ?? '—'}
                </Text>
              </Table.Td>
              <Table.Td>
                <StatusBadge status={message.status} />
              </Table.Td>
              <Table.Td>
                <Text size="xs" c="dimmed" truncate maw={220} title={message.note ?? undefined}>
                  {message.note ?? ''}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
