import { Alert, Autocomplete, Badge, Button, Grid, Group, NumberInput, Paper, Stack, Switch, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconDeviceFloppy, IconRefresh } from '@tabler/icons-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import type { ReconcileSummary, Settings, SettingsPatch } from '../api/types';
import { ErrorAlert, LoadingBlock } from '../components/Feedback';
import { FieldList } from '../components/FieldList';
import { PageHeader } from '../components/PageHeader';
import { DateTime } from '../components/TimeAgo';
import { notifyError, notifySuccess } from '../lib/notify';
import { useSettings } from '../lib/settings';
import { useAsync } from '../lib/useAsync';

const TIMEZONE_SUGGESTIONS = ['Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai', 'Asia/Kuwait', 'Asia/Amman', 'Europe/London', 'Europe/Berlin', 'UTC'];

interface SettingsFormState {
  trusted_senders: string;
  max_age_hours: string | number;
  auto_match: boolean;
  currency: string;
  timezone: string;
  intent_ttl_minutes: string | number;
  offline_alert_minutes: string | number;
  webhook_unmatched_receipts: boolean;
  email_alerts: boolean;
}

function toFormState(settings: Settings): SettingsFormState {
  return {
    trusted_senders: settings.trusted_senders.join('\n'),
    max_age_hours: settings.max_age_hours,
    auto_match: settings.auto_match,
    currency: settings.currency,
    timezone: settings.timezone,
    intent_ttl_minutes: settings.intent_ttl_minutes,
    offline_alert_minutes: settings.offline_alert_minutes,
    webhook_unmatched_receipts: settings.webhook_unmatched_receipts,
    email_alerts: settings.email_alerts,
  };
}

function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

type PatchResult = { ok: true; patch: SettingsPatch } | { ok: false; error: string };

function toPatch(form: SettingsFormState): PatchResult {
  const trustedSenders = splitLines(form.trusted_senders);
  if (trustedSenders.length === 0) return { ok: false, error: 'At least one trusted sender id is required' };
  const currency = form.currency.trim().toUpperCase();
  if (currency.length !== 3) return { ok: false, error: 'Currency must be a 3-letter code' };
  if (!form.timezone.trim()) return { ok: false, error: 'Timezone is required' };
  const numbers = {
    max_age_hours: Number(form.max_age_hours),
    intent_ttl_minutes: Number(form.intent_ttl_minutes),
    offline_alert_minutes: Number(form.offline_alert_minutes),
  };
  for (const [key, value] of Object.entries(numbers)) {
    if (!Number.isInteger(value) || value <= 0) return { ok: false, error: `${key.replace(/_/g, ' ')} must be a positive whole number` };
  }
  return {
    ok: true,
    patch: {
      trusted_senders: trustedSenders,
      currency,
      timezone: form.timezone.trim(),
      auto_match: form.auto_match,
      webhook_unmatched_receipts: form.webhook_unmatched_receipts,
      email_alerts: form.email_alerts,
      ...numbers,
    },
  };
}

function ReconcileCard() {
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<ReconcileSummary | null>(null);

  const run = async () => {
    setRunning(true);
    try {
      const result = await api.reconcile();
      setSummary(result);
      notifySuccess(`Matched ${result.matched} receipt(s)`, 'Matching finished');
    } catch (error) {
      notifyError(error, 'Reconcile failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Paper p="md">
      <Stack gap="sm">
        <div>
          <Title order={5}>Matching</Title>
          <Text size="sm" c="dimmed">
            Re-trusts messages whose sender id is now allowed, expires old intents, demotes stale receipts and matches everything unmatched.
          </Text>
        </div>
        <Group>
          <Button variant="default" size="xs" leftSection={<IconRefresh size={14} />} loading={running} onClick={() => void run()}>
            Re-run matching
          </Button>
        </Group>
        {summary && (
          <Alert color="tahweel" variant="light" title="Last run">
            <Group gap="lg">
              <Text size="sm">Re-trusted: {summary.retrusted}</Text>
              <Text size="sm">Expired intents: {summary.expired_intents}</Text>
              <Text size="sm">Demoted stale: {summary.demoted_stale}</Text>
              <Text size="sm" fw={600}>
                Matched: {summary.matched}
              </Text>
            </Group>
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}

function ConfiguredBadge({ configured }: { configured: boolean }) {
  return (
    <Badge color={configured ? 'green' : 'yellow'} tt="none" size="sm">
      {configured ? 'configured' : 'not configured'}
    </Badge>
  );
}

function HealthCard() {
  const health = useAsync(() => api.health(), []);
  const data = health.data;

  return (
    <Paper p="md">
      <Title order={5} mb="xs">
        Server
      </Title>
      {health.error && <ErrorAlert error={health.error} />}
      {!data ? (
        health.loading && <LoadingBlock />
      ) : (
        <FieldList
          fields={[
            { label: 'Version', value: data.version },
            { label: 'Database', value: `${data.database.dialect} · ${data.database.location}` },
            {
              label: 'Parsers',
              value: (
                <Group gap={4}>
                  {data.parsers.map((parser) => (
                    <Badge key={parser} color="gray" tt="none" size="sm">
                      {parser}
                    </Badge>
                  ))}
                </Group>
              ),
            },
            { label: 'Webhook', value: <ConfiguredBadge configured={data.webhook_configured} /> },
            { label: 'Mail', value: <ConfiguredBadge configured={data.mail_configured} /> },
            { label: 'Started', value: <DateTime iso={data.started_at} /> },
            { label: 'Server time', value: <DateTime iso={data.server_time} /> },
          ]}
        />
      )}
    </Paper>
  );
}

export function SettingsPage() {
  const { replace } = useSettings();
  const loaded = useAsync(() => api.settings.get(), []);
  const [form, setForm] = useState<SettingsFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (loaded.data) setForm(toFormState(loaded.data));
  }, [loaded.data]);

  const update = <K extends keyof SettingsFormState>(key: K, value: SettingsFormState[K]) =>
    setForm((previous) => (previous ? { ...previous, [key]: value } : previous));

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form) return;
    const result = toPatch(form);
    if (!result.ok) {
      setValidationError(result.error);
      return;
    }
    setValidationError(null);
    setSaving(true);
    try {
      const saved = await api.settings.patch(result.patch);
      setForm(toFormState(saved));
      replace(saved);
      notifySuccess('Settings saved');
    } catch (error) {
      notifyError(error, 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="md">
      <PageHeader title="Settings" subtitle="Matching rules, alerts and display preferences" />
      {loaded.error && <ErrorAlert error={loaded.error} />}
      <Grid gutter="sm">
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Paper p="md">
            {!form ? (
              loaded.loading && <LoadingBlock />
            ) : (
              <form onSubmit={(event) => void save(event)}>
                <Stack gap="sm">
                  <Textarea
                    label="Trusted sender ids"
                    description="One per line. Receipts from any other sender id are flagged as untrusted."
                    autosize
                    minRows={3}
                    value={form.trusted_senders}
                    onChange={(event) => update('trusted_senders', event.currentTarget.value)}
                  />
                  <Group grow align="flex-start">
                    <NumberInput
                      label="Max receipt age (hours)"
                      description="Older receipts are marked stale"
                      min={1}
                      value={form.max_age_hours}
                      onChange={(value) => update('max_age_hours', value)}
                    />
                    <NumberInput
                      label="Intent TTL (minutes)"
                      description="Default expiry for new intents"
                      min={1}
                      value={form.intent_ttl_minutes}
                      onChange={(value) => update('intent_ttl_minutes', value)}
                    />
                    <NumberInput
                      label="Offline alert (minutes)"
                      description="Silence before a phone counts as offline"
                      min={5}
                      value={form.offline_alert_minutes}
                      onChange={(value) => update('offline_alert_minutes', value)}
                    />
                  </Group>
                  <Group grow align="flex-start">
                    <TextInput label="Currency" maxLength={3} value={form.currency} onChange={(event) => update('currency', event.currentTarget.value.toUpperCase())} />
                    <Autocomplete
                      label="Timezone"
                      description="IANA name used for all timestamps in this dashboard"
                      data={TIMEZONE_SUGGESTIONS}
                      value={form.timezone}
                      onChange={(value) => update('timezone', value)}
                    />
                  </Group>
                  <Switch
                    label="Auto-match receipts to intents"
                    description="When off, every receipt waits for a manual match"
                    checked={form.auto_match}
                    onChange={(event) => update('auto_match', event.currentTarget.checked)}
                  />
                  <Switch
                    label="Webhook for unmatched receipts"
                    description="Send payment.unmatched_receipt events too"
                    checked={form.webhook_unmatched_receipts}
                    onChange={(event) => update('webhook_unmatched_receipts', event.currentTarget.checked)}
                  />
                  <Switch
                    label="Email alerts"
                    description="Offline phones and unmatched receipts by mail (needs SMTP on the server)"
                    checked={form.email_alerts}
                    onChange={(event) => update('email_alerts', event.currentTarget.checked)}
                  />
                  {validationError && (
                    <Alert color="red" variant="light">
                      {validationError}
                    </Alert>
                  )}
                  <Group justify="flex-end">
                    <Button type="submit" leftSection={<IconDeviceFloppy size={16} />} loading={saving}>
                      Save
                    </Button>
                  </Group>
                </Stack>
              </form>
            )}
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Stack gap="sm">
            <ReconcileCard />
            <HealthCard />
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
