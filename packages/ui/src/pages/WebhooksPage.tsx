import { ActionIcon, Box, Button, Drawer, Group, Paper, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconRefresh, IconSend, IconRotateClockwise } from '@tabler/icons-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { DELIVERY_STATUSES, type Delivery, type DeliveryStatus } from '../api/types';
import { EmptyRow, ErrorAlert, LoadingBlock } from '../components/Feedback';
import { FieldList, type Field } from '../components/FieldList';
import { JsonView } from '../components/JsonView';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { StatusBadge } from '../components/StatusBadge';
import { ALL_STATUSES, StatusChips } from '../components/StatusChips';
import { DateTime } from '../components/TimeAgo';
import { notifyError, notifySuccess } from '../lib/notify';
import { useAsync } from '../lib/useAsync';

const PAGE_SIZE = 50;
const COLUMN_COUNT = 9;

function isDeliveryStatus(value: string): value is DeliveryStatus {
  return (DELIVERY_STATUSES as readonly string[]).includes(value);
}

interface DeliveryDrawerProps {
  delivery: Delivery | null;
  redelivering: boolean;
  onClose: () => void;
  onRedeliver: (delivery: Delivery) => void;
}

function DeliveryDrawer({ delivery, redelivering, onClose, onRedeliver }: DeliveryDrawerProps) {
  const fields: Field[] = delivery
    ? [
        { label: 'Status', value: <StatusBadge status={delivery.status} /> },
        { label: 'Event', value: <span style={{ fontFamily: 'monospace' }}>{delivery.event}</span> },
        { label: 'URL', value: delivery.url },
        { label: 'Attempts', value: delivery.attempts },
        { label: 'Last status', value: delivery.last_status_code },
        { label: 'Last error', value: delivery.last_error },
        { label: 'Created', value: <DateTime iso={delivery.created_at} /> },
        { label: 'Next attempt', value: delivery.next_attempt_at ? <DateTime iso={delivery.next_attempt_at} /> : null },
        { label: 'Delivered', value: delivery.delivered_at ? <DateTime iso={delivery.delivered_at} /> : null },
        {
          label: 'Intent',
          value: delivery.intent_id ? <Link to={`/app/intents?intent=${encodeURIComponent(delivery.intent_id)}`}>{delivery.intent_id}</Link> : null,
        },
        {
          label: 'Message',
          value: delivery.message_id ? <Link to={`/app/messages?message=${encodeURIComponent(delivery.message_id)}`}>{delivery.message_id}</Link> : null,
        },
        { label: 'Delivery id', value: delivery.id },
      ]
    : [];

  return (
    <Drawer opened={delivery !== null} onClose={onClose} position="right" size="lg" title="Webhook delivery" padding="md">
      {delivery && (
        <Stack gap="md">
          {delivery.status !== 'delivered' && (
            <Group>
              <Button size="xs" leftSection={<IconRotateClockwise size={14} />} loading={redelivering} onClick={() => onRedeliver(delivery)}>
                Redeliver now
              </Button>
            </Group>
          )}
          <FieldList fields={fields} />
          <div>
            <Text size="xs" c="dimmed" fw={600} tt="uppercase" mb={4}>
              Payload
            </Text>
            <JsonView value={delivery.payload} />
          </div>
        </Stack>
      )}
    </Drawer>
  );
}

export function WebhooksPage() {
  const [status, setStatus] = useState<string>(ALL_STATUSES);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Delivery | null>(null);
  const [redeliveringId, setRedeliveringId] = useState<string | null>(null);
  const [sendingTest, setSendingTest] = useState(false);

  const deliveries = useAsync(() => api.webhooks.list({ status: isDeliveryStatus(status) ? status : undefined, limit: PAGE_SIZE, offset }), [status, offset]);

  const changeStatus = (next: string) => {
    setStatus(next);
    setOffset(0);
  };

  const redeliver = async (delivery: Delivery) => {
    setRedeliveringId(delivery.id);
    try {
      const updated = await api.webhooks.redeliver(delivery.id);
      if (updated.status === 'delivered') notifySuccess(`Delivered with HTTP ${updated.last_status_code ?? '?'}`);
      else notifyError(updated.last_error ?? `HTTP ${updated.last_status_code ?? '?'}`, 'Delivery still failing');
      if (selected?.id === updated.id) setSelected(updated);
      void deliveries.reload();
    } catch (error) {
      notifyError(error, 'Could not redeliver');
    } finally {
      setRedeliveringId(null);
    }
  };

  const sendTest = async () => {
    setSendingTest(true);
    try {
      const delivery = await api.webhooks.test();
      if (delivery.status === 'delivered') notifySuccess(`Test event delivered with HTTP ${delivery.last_status_code ?? '?'}`);
      else notifyError(delivery.last_error ?? `HTTP ${delivery.last_status_code ?? '?'}`, 'Test event not delivered');
      void deliveries.reload();
    } catch (error) {
      notifyError(error, 'Could not send test event');
    } finally {
      setSendingTest(false);
    }
  };

  const page = deliveries.data;

  return (
    <Stack gap="md">
      <PageHeader
        title="Webhooks"
        subtitle="Signed HTTP deliveries for matched payments, unmatched receipts and device alerts"
        actions={
          <>
            <Tooltip label="Refresh now">
              <ActionIcon variant="default" aria-label="Refresh" onClick={() => void deliveries.reload()} loading={deliveries.loading}>
                <IconRefresh size={16} />
              </ActionIcon>
            </Tooltip>
            <Button size="xs" variant="default" leftSection={<IconSend size={14} />} loading={sendingTest} onClick={() => void sendTest()}>
              Send test event
            </Button>
          </>
        }
      />

      <Paper p="sm">
        <StatusChips statuses={DELIVERY_STATUSES} counters={page?.counters} value={status} onChange={changeStatus} />
      </Paper>

      {deliveries.error && <ErrorAlert error={deliveries.error} />}

      {!page ? (
        deliveries.loading && <LoadingBlock />
      ) : (
        <Paper>
          <Table.ScrollContainer minWidth={1000}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Event</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Attempts</Table.Th>
                  <Table.Th>URL</Table.Th>
                  <Table.Th>HTTP</Table.Th>
                  <Table.Th>Last error</Table.Th>
                  <Table.Th>Created</Table.Th>
                  <Table.Th>Next attempt</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {page.items.length === 0 && <EmptyRow colSpan={COLUMN_COUNT} label="No deliveries yet." />}
                {page.items.map((delivery) => (
                  <Table.Tr key={delivery.id} onClick={() => setSelected(delivery)} style={{ cursor: 'pointer' }}>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {delivery.event}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <StatusBadge status={delivery.status} />
                    </Table.Td>
                    <Table.Td>{delivery.attempts}</Table.Td>
                    <Table.Td>
                      <Text size="sm" truncate maw={260} title={delivery.url}>
                        {delivery.url}
                      </Text>
                    </Table.Td>
                    <Table.Td>{delivery.last_status_code ?? '—'}</Table.Td>
                    <Table.Td>
                      <Text size="xs" c="red.7" truncate maw={220} title={delivery.last_error ?? undefined}>
                        {delivery.last_error ?? ''}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <DateTime iso={delivery.created_at} />
                    </Table.Td>
                    <Table.Td>
                      <DateTime iso={delivery.next_attempt_at} />
                    </Table.Td>
                    <Table.Td align="right" onClick={(event) => event.stopPropagation()}>
                      {delivery.status !== 'delivered' && (
                        <Button size="compact-xs" variant="subtle" loading={redeliveringId === delivery.id} onClick={() => void redeliver(delivery)}>
                          Redeliver
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          <Box p="sm">
            <Pagination total={page.total} limit={page.limit} offset={page.offset} onChange={setOffset} />
          </Box>
        </Paper>
      )}

      <DeliveryDrawer
        delivery={selected}
        redelivering={selected !== null && redeliveringId === selected.id}
        onClose={() => setSelected(null)}
        onRedeliver={(delivery) => void redeliver(delivery)}
      />
    </Stack>
  );
}
