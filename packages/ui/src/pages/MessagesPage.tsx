import { ActionIcon, Box, Group, NativeSelect, Paper, Stack, TextInput, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconRefresh, IconSearch } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { MESSAGE_STATUSES, type Message, type MessageStatus } from '../api/types';
import { ErrorAlert, LoadingBlock } from '../components/Feedback';
import { MessageDrawer } from '../components/MessageDrawer';
import { MessagesTable } from '../components/MessagesTable';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { ALL_STATUSES, StatusChips } from '../components/StatusChips';
import { notifyError } from '../lib/notify';
import { useCurrency } from '../lib/settings';
import { useAsync } from '../lib/useAsync';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;
const MESSAGE_PARAM = 'message';

function isMessageStatus(value: string): value is MessageStatus {
  return (MESSAGE_STATUSES as readonly string[]).includes(value);
}

export function MessagesPage() {
  const currency = useCurrency();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<string>(ALL_STATUSES);
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Message | null>(null);

  const devices = useAsync(() => api.devices.list(), []);
  const messages = useAsync(
    () =>
      api.messages.list({
        status: isMessageStatus(status) ? status : undefined,
        q: debouncedSearch || undefined,
        device_id: deviceId ?? undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    [status, debouncedSearch, deviceId, offset],
  );

  const requestedMessageId = searchParams.get(MESSAGE_PARAM);
  useEffect(() => {
    if (!requestedMessageId) return;
    let cancelled = false;
    api.messages
      .get(requestedMessageId)
      .then((message) => {
        if (!cancelled) setSelected(message);
      })
      .catch((error: unknown) => {
        if (!cancelled) notifyError(error, 'Message not found');
      });
    return () => {
      cancelled = true;
    };
  }, [requestedMessageId]);

  const closeDrawer = () => {
    setSelected(null);
    if (requestedMessageId) {
      const next = new URLSearchParams(searchParams);
      next.delete(MESSAGE_PARAM);
      setSearchParams(next, { replace: true });
    }
  };

  const changeStatus = (next: string) => {
    setStatus(next);
    setOffset(0);
  };

  const changeSearch = (next: string) => {
    setSearch(next);
    setOffset(0);
  };

  const changeDevice = (next: string) => {
    setDeviceId(next || null);
    setOffset(0);
  };

  const applyChange = (updated: Message) => {
    setSelected(updated);
    void messages.reload();
  };

  const deviceOptions = [
    { value: '', label: 'All devices' },
    ...(devices.data?.items ?? []).map((device) => ({ value: device.device_id, label: `${device.name} (${device.device_id})` })),
  ];
  const page = messages.data;

  return (
    <Stack gap="md">
      <PageHeader
        title="Messages"
        subtitle="Every SMS forwarded by the listener phones, with the parsed receipt fields"
        actions={
          <Tooltip label="Refresh now">
            <ActionIcon variant="default" aria-label="Refresh" onClick={() => void messages.reload()} loading={messages.loading}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        }
      />

      <Paper p="sm">
        <Stack gap="sm">
          <StatusChips statuses={MESSAGE_STATUSES} counters={page?.counters} value={status} onChange={changeStatus} />
          <Group gap="sm" wrap="wrap">
            <TextInput
              placeholder="Search phone, name, body, sender id or reference"
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(event) => changeSearch(event.currentTarget.value)}
              w={{ base: '100%', sm: 360 }}
              aria-label="Search messages"
            />
            <NativeSelect
              data={deviceOptions}
              value={deviceId ?? ''}
              onChange={(event) => changeDevice(event.currentTarget.value)}
              w={{ base: '100%', sm: 280 }}
              aria-label="Filter by device"
            />
          </Group>
        </Stack>
      </Paper>

      {messages.error && <ErrorAlert error={messages.error} />}

      {!page ? (
        messages.loading && <LoadingBlock />
      ) : (
        <Paper>
          <MessagesTable messages={page.items} currency={currency} onSelect={setSelected} />
          <Box p="sm">
            <Pagination total={page.total} limit={page.limit} offset={page.offset} onChange={setOffset} />
          </Box>
        </Paper>
      )}

      <MessageDrawer message={selected} currency={currency} onClose={closeDrawer} onChanged={applyChange} />
    </Stack>
  );
}
