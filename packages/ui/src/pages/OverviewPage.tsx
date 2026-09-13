import { ActionIcon, Alert, Badge, Grid, Group, Paper, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Counters, Message, Parser } from '../api/types';
import { ErrorAlert, LoadingBlock } from '../components/Feedback';
import { MessagesTable } from '../components/MessagesTable';
import { formatMoney } from '../components/Money';
import { PageHeader } from '../components/PageHeader';
import { formatAbsolute } from '../lib/time';
import { useAsync } from '../lib/useAsync';

const REFRESH_MS = 30_000;

interface StatCardProps {
  id: string;
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'warn' | 'good';
}

function StatCard({ id, label, value, hint, tone = 'default' }: StatCardProps) {
  const color = tone === 'warn' ? 'red.7' : tone === 'good' ? 'tahweel.7' : undefined;
  return (
    <Paper p="md">
      <Text size="xs" c="dimmed" fw={600} tt="uppercase">
        {label}
      </Text>
      <Text fz={28} fw={700} lh={1.2} c={color} data-testid={`stat-${id}`}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Paper>
  );
}

function count(counters: Counters, key: string): number {
  return counters[key] ?? 0;
}

function ParsersList({ parsers }: { parsers: Parser[] }) {
  return (
    <Stack gap="sm">
      {parsers.length === 0 && (
        <Text size="sm" c="dimmed">
          No parsers registered.
        </Text>
      )}
      {parsers.map((parser) => (
        <div key={parser.id}>
          <Text size="sm" fw={600}>
            {parser.name}{' '}
            <Text span size="xs" c="dimmed" ff="monospace">
              {parser.id}
            </Text>
          </Text>
          <Group gap={4} mt={4}>
            {parser.sender_ids.map((sender) => (
              <Badge key={sender} color="gray" tt="none" size="sm">
                {sender}
              </Badge>
            ))}
          </Group>
        </div>
      ))}
    </Stack>
  );
}

export function OverviewPage() {
  const overview = useAsync(() => api.overview(), [], { refreshMs: REFRESH_MS });
  const navigate = useNavigate();
  const data = overview.data;

  if (!data) return overview.loading ? <LoadingBlock /> : <ErrorAlert error={overview.error} />;

  const { settings } = data;
  const noDeviceOnline = data.devices.online === 0;
  const unmatchedCount = count(data.messages, 'unmatched');
  const pendingIntents = count(data.intents, 'pending');
  const failedWebhooks = count(data.webhooks, 'failed');

  const openMessage = (message: Message) => navigate(`/app/messages?message=${encodeURIComponent(message.id)}`);

  return (
    <Stack gap="md">
      <PageHeader
        title="Overview"
        subtitle={`Server time ${formatAbsolute(data.server_time, settings.timezone)} · refreshes every 30 s`}
        actions={
          <Tooltip label="Refresh now">
            <ActionIcon variant="default" aria-label="Refresh" onClick={() => void overview.reload()} loading={overview.loading}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        }
      />

      {overview.error && <ErrorAlert error={overview.error} title="Refresh failed" />}

      {(noDeviceOnline || !data.webhook_configured || !data.mail_configured) && (
        <Stack gap="xs">
          {noDeviceOnline && (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />} title="No listener phone is online">
              Receipts are not being forwarded. Check the listener app and its network connection.
            </Alert>
          )}
          {!data.webhook_configured && (
            <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={18} />} title="Webhook URL not configured">
              Matched payments will not be pushed anywhere. Set WEBHOOK_URL on the server.
            </Alert>
          )}
          {!data.mail_configured && (
            <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={18} />} title="Mail not configured">
              Email alerts (offline phone, unmatched receipts) are disabled. Set the SMTP variables on the server.
            </Alert>
          )}
        </Stack>
      )}

      <SimpleGrid cols={{ base: 1, xs: 2, md: 3, xl: 5 }} spacing="sm">
        <StatCard id="unmatched" label="Unmatched receipts" value={unmatchedCount} tone={unmatchedCount > 0 ? 'warn' : 'default'} hint="Waiting for an intent" />
        <StatCard
          id="matched-24h"
          label="Matched last 24 h"
          value={data.matched_last_24h.count}
          hint={formatMoney(data.matched_last_24h.amount_cents, settings.currency)}
          tone="good"
        />
        <StatCard id="pending-intents" label="Pending intents" value={pendingIntents} hint="Awaiting payment" />
        <StatCard
          id="devices"
          label="Devices online"
          value={`${data.devices.online} / ${data.devices.total}`}
          tone={noDeviceOnline ? 'warn' : 'default'}
          hint={`${data.devices.offline} offline`}
        />
        <StatCard id="failed-webhooks" label="Failed webhooks" value={failedWebhooks} tone={failedWebhooks > 0 ? 'warn' : 'default'} hint="Retry from Webhooks" />
      </SimpleGrid>

      <Grid gutter="sm">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Paper p="md">
            <Text fw={600} mb="xs">
              Recent messages
            </Text>
            <MessagesTable messages={data.recent_messages} currency={settings.currency} onSelect={openMessage} emptyLabel="No messages received yet." />
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Paper p="md">
            <Text fw={600} mb="xs">
              Registered parsers
            </Text>
            <ParsersList parsers={data.parsers} />
          </Paper>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
