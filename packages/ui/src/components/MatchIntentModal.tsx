import { Button, Modal, Stack, Table, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { useState } from 'react';
import { api } from '../api/client';
import type { Intent, Message } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { EmptyRow, ErrorAlert, LoadingBlock } from './Feedback';
import { Money } from './Money';
import { DateTime } from './TimeAgo';

interface MatchIntentModalProps {
  message: Message | null;
  currency: string;
  opened: boolean;
  onClose: () => void;
  onPick: (intent: Intent) => Promise<void>;
}

const PENDING_PAGE_SIZE = 50;

export function MatchIntentModal({ message, currency, opened, onClose, onPick }: MatchIntentModalProps) {
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const [pickingId, setPickingId] = useState<string | null>(null);

  const pending = useAsync(
    () => (opened ? api.intents.list({ status: 'pending', q: debouncedSearch || undefined, limit: PENDING_PAGE_SIZE }) : Promise.resolve(null)),
    [opened, debouncedSearch],
  );

  const pick = async (intent: Intent) => {
    setPickingId(intent.id);
    try {
      await onPick(intent);
    } finally {
      setPickingId(null);
    }
  };

  const items = pending.data?.items ?? [];

  return (
    <Modal opened={opened} onClose={onClose} title="Match to a pending intent" size="xl">
      <Stack gap="sm">
        {message && (
          <Text size="sm" c="dimmed">
            Receipt from <b>{message.sender_phone ?? message.address}</b> for{' '}
            <Money cents={message.amount_cents} currency={currency} />. Manual matching overrides the stale and untrusted
            gates, so confirm the wallet balance first.
          </Text>
        )}
        <TextInput
          placeholder="Search by reference or phone"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          data-autofocus
        />
        {pending.error && <ErrorAlert error={pending.error} />}
        {pending.loading && !pending.data ? (
          <LoadingBlock />
        ) : (
          <Table.ScrollContainer minWidth={600}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Reference</Table.Th>
                  <Table.Th>Amount</Table.Th>
                  <Table.Th>Sender phone</Table.Th>
                  <Table.Th>Expires</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.length === 0 && <EmptyRow colSpan={5} label="No pending intents." />}
                {items.map((intent) => (
                  <Table.Tr key={intent.id}>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {intent.reference}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Money cents={intent.amount_cents} currency={intent.currency} />
                    </Table.Td>
                    <Table.Td>{intent.sender_phone ?? '—'}</Table.Td>
                    <Table.Td>
                      <DateTime iso={intent.expires_at} />
                    </Table.Td>
                    <Table.Td align="right">
                      <Button size="compact-xs" loading={pickingId === intent.id} disabled={pickingId !== null} onClick={() => void pick(intent)}>
                        Match
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>
    </Modal>
  );
}
