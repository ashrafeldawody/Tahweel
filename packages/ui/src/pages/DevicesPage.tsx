import { ActionIcon, Badge, Paper, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { api } from '../api/client';
import type { Device } from '../api/types';
import { EmptyRow, ErrorAlert, LoadingBlock } from '../components/Feedback';
import { PageHeader } from '../components/PageHeader';
import { TimeStack } from '../components/TimeAgo';
import { useAsync } from '../lib/useAsync';

const REFRESH_MS = 30_000;
const COLUMN_COUNT = 9;

function OnlineBadge({ online }: { online: boolean }) {
  return (
    <Badge variant="dot" color={online ? 'green' : 'red'} tt="none" size="sm">
      {online ? 'online' : 'offline'}
    </Badge>
  );
}

function batteryLabel(device: Device): string {
  return device.battery === null ? '—' : `${device.battery}%`;
}

export function DevicesPage() {
  const devices = useAsync(() => api.devices.list(), [], { refreshMs: REFRESH_MS });
  const items = devices.data?.items ?? [];

  return (
    <Stack gap="md">
      <PageHeader
        title="Devices"
        subtitle="Listener phones that forward wallet SMS to this server"
        actions={
          <Tooltip label="Refresh now">
            <ActionIcon variant="default" aria-label="Refresh" onClick={() => void devices.reload()} loading={devices.loading}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        }
      />
      {devices.error && <ErrorAlert error={devices.error} />}
      {devices.loading && !devices.data ? (
        <LoadingBlock />
      ) : (
        <Paper>
          <Table.ScrollContainer minWidth={900}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Device id</Table.Th>
                  <Table.Th>App</Table.Th>
                  <Table.Th>Battery</Table.Th>
                  <Table.Th>Network</Table.Th>
                  <Table.Th>Queued</Table.Th>
                  <Table.Th>Last seen</Table.Th>
                  <Table.Th>Last SMS</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.length === 0 && <EmptyRow colSpan={COLUMN_COUNT} label="No device has sent a heartbeat yet." />}
                {items.map((device) => (
                  <Table.Tr key={device.device_id}>
                    <Table.Td>
                      <OnlineBadge online={device.online} />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {device.name}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {device.device_id}
                      </Text>
                    </Table.Td>
                    <Table.Td>{device.app_version ?? '—'}</Table.Td>
                    <Table.Td>{batteryLabel(device)}</Table.Td>
                    <Table.Td>{device.network ?? '—'}</Table.Td>
                    <Table.Td>
                      <Badge color={device.pending_count > 0 ? 'orange' : 'gray'} size="sm">
                        {device.pending_count}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <TimeStack iso={device.last_seen_at} />
                    </Table.Td>
                    <Table.Td>
                      <TimeStack iso={device.last_sms_at} />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
    </Stack>
  );
}
