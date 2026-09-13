import {
  ActionIcon,
  Box,
  Button,
  Checkbox,
  Drawer,
  Group,
  Modal,
  NumberInput,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconPlus, IconRefresh, IconSearch, IconX } from '@tabler/icons-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { INTENT_STATUSES, type CreateIntentInput, type Intent, type IntentStatus } from '../api/types';
import { EmptyRow, ErrorAlert, LoadingBlock } from '../components/Feedback';
import { FieldList, type Field } from '../components/FieldList';
import { JsonView } from '../components/JsonView';
import { Money, formatMoney } from '../components/Money';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { StatusBadge } from '../components/StatusBadge';
import { ALL_STATUSES, StatusChips } from '../components/StatusChips';
import { DateTime } from '../components/TimeAgo';
import { notifyError, notifySuccess } from '../lib/notify';
import { useSettings } from '../lib/settings';
import { useAsync } from '../lib/useAsync';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;
const INTENT_PARAM = 'intent';
const COLUMN_COUNT = 8;

function isIntentStatus(value: string): value is IntentStatus {
  return (INTENT_STATUSES as readonly string[]).includes(value);
}

interface IntentFormState {
  reference: string;
  amount: string | number;
  currency: string;
  sender_phone: string;
  allow_amount_only: boolean;
  expires_in_minutes: string | number;
  metadata: string;
  webhook_url: string;
}

function emptyForm(currency: string, ttlMinutes: number | undefined): IntentFormState {
  return {
    reference: '',
    amount: '',
    currency,
    sender_phone: '',
    allow_amount_only: false,
    expires_in_minutes: ttlMinutes ?? '',
    metadata: '',
    webhook_url: '',
  };
}

type MetadataParse = { ok: true; value: Record<string, unknown> | undefined } | { ok: false; error: string };

function parseMetadata(text: string): MetadataParse {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: undefined };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'Metadata must be a JSON object' };
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: 'Metadata is not valid JSON' };
  }
}

function toOptionalNumber(value: string | number): number | undefined {
  if (value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

interface NewIntentModalProps {
  opened: boolean;
  onClose: () => void;
  onCreated: (intent: Intent) => void;
}

function NewIntentModal({ opened, onClose, onCreated }: NewIntentModalProps) {
  const { settings } = useSettings();
  const [form, setForm] = useState<IntentFormState>(() => emptyForm(settings?.currency ?? 'EGP', settings?.intent_ttl_minutes));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (opened) setForm(emptyForm(settings?.currency ?? 'EGP', settings?.intent_ttl_minutes));
  }, [opened, settings?.currency, settings?.intent_ttl_minutes]);

  const update = <K extends keyof IntentFormState>(key: K, value: IntentFormState[K]) => setForm((previous) => ({ ...previous, [key]: value }));

  const metadata = parseMetadata(form.metadata);
  const amount = toOptionalNumber(form.amount);
  const canSubmit = form.reference.trim().length > 0 && amount !== undefined && amount > 0 && metadata.ok;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || !metadata.ok || amount === undefined) return;
    const input: CreateIntentInput = {
      reference: form.reference.trim(),
      amount,
      currency: form.currency.trim() || undefined,
      sender_phone: form.sender_phone.trim() || undefined,
      allow_amount_only: form.allow_amount_only || undefined,
      expires_in_minutes: toOptionalNumber(form.expires_in_minutes),
      metadata: metadata.value,
      webhook_url: form.webhook_url.trim() || undefined,
    };
    setSubmitting(true);
    try {
      const created = await api.intents.create(input);
      notifySuccess(created.message ? `Intent ${created.reference} created and matched immediately` : `Intent ${created.reference} created`);
      onCreated(created);
      onClose();
    } catch (error) {
      notifyError(error, 'Could not create intent');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="New payment intent" size="lg">
      <form onSubmit={(event) => void submit(event)}>
        <Stack gap="sm">
          <TextInput
            label="Reference"
            description="Your own unique id for this payment (order id, invoice number)"
            required
            value={form.reference}
            onChange={(event) => update('reference', event.currentTarget.value)}
            data-autofocus
          />
          <Group grow align="flex-start">
            <NumberInput
              label="Amount"
              description="Major units, e.g. 200 = 200.00"
              required
              min={0.01}
              step={1}
              decimalScale={2}
              value={form.amount}
              onChange={(value) => update('amount', value)}
            />
            <TextInput label="Currency" maxLength={3} value={form.currency} onChange={(event) => update('currency', event.currentTarget.value.toUpperCase())} />
          </Group>
          <TextInput
            label="Sender phone"
            description="The wallet number the customer pays from. Strongly recommended."
            value={form.sender_phone}
            onChange={(event) => update('sender_phone', event.currentTarget.value)}
          />
          <Checkbox
            label="Allow amount-only matching"
            checked={form.allow_amount_only}
            onChange={(event) => update('allow_amount_only', event.currentTarget.checked)}
          />
          {form.allow_amount_only && (
            <Text size="xs" c="red.7" fw={600}>
              Risky: without a sender phone any receipt for exactly this amount will be accepted, as long as it is the only pending intent for that amount.
            </Text>
          )}
          <NumberInput
            label="Expires in minutes"
            description="Leave empty to use the server default"
            min={1}
            value={form.expires_in_minutes}
            onChange={(value) => update('expires_in_minutes', value)}
          />
          <Textarea
            label="Metadata (JSON object)"
            placeholder='{"order_id": "A-1001"}'
            autosize
            minRows={2}
            value={form.metadata}
            onChange={(event) => update('metadata', event.currentTarget.value)}
            error={metadata.ok ? undefined : metadata.error}
            styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
          />
          <TextInput
            label="Webhook URL"
            description="Overrides the server-wide webhook for this intent"
            value={form.webhook_url}
            onChange={(event) => update('webhook_url', event.currentTarget.value)}
          />
          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={!canSubmit}>
              Create intent
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

interface IntentDrawerProps {
  intent: Intent | null;
  cancelling: boolean;
  onClose: () => void;
  onCancel: (intent: Intent) => void;
}

function IntentDrawer({ intent, cancelling, onClose, onCancel }: IntentDrawerProps) {
  const fields: Field[] = intent
    ? [
        { label: 'Status', value: <StatusBadge status={intent.status} /> },
        { label: 'Reference', value: <span style={{ fontFamily: 'monospace' }}>{intent.reference}</span> },
        { label: 'Amount', value: formatMoney(intent.amount_cents, intent.currency) },
        { label: 'Sender phone', value: intent.sender_phone },
        { label: 'Amount-only', value: intent.allow_amount_only },
        { label: 'Created', value: <DateTime iso={intent.created_at} /> },
        { label: 'Expires', value: <DateTime iso={intent.expires_at} /> },
        { label: 'Matched', value: intent.matched_at ? <DateTime iso={intent.matched_at} /> : null },
        {
          label: 'Matched message',
          value: intent.matched_message_id ? (
            <Link to={`/app/messages?message=${encodeURIComponent(intent.matched_message_id)}`}>{intent.matched_message_id}</Link>
          ) : null,
        },
        { label: 'Cancelled', value: intent.cancelled_at ? <DateTime iso={intent.cancelled_at} /> : null },
        { label: 'Webhook URL', value: intent.webhook_url },
        { label: 'Intent id', value: intent.id },
      ]
    : [];

  return (
    <Drawer opened={intent !== null} onClose={onClose} position="right" size="lg" title="Payment intent" padding="md">
      {intent && (
        <Stack gap="md">
          {intent.status === 'pending' && (
            <Group>
              <Button size="xs" color="red" variant="light" leftSection={<IconX size={14} />} loading={cancelling} onClick={() => onCancel(intent)}>
                Cancel intent
              </Button>
            </Group>
          )}
          <FieldList fields={fields} />
          <div>
            <Text size="xs" c="dimmed" fw={600} tt="uppercase" mb={4}>
              Metadata
            </Text>
            <JsonView value={intent.metadata} />
          </div>
        </Stack>
      )}
    </Drawer>
  );
}

export function IntentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<string>(ALL_STATUSES);
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Intent | null>(null);
  const [creating, setCreating] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const intents = useAsync(
    () => api.intents.list({ status: isIntentStatus(status) ? status : undefined, q: debouncedSearch || undefined, limit: PAGE_SIZE, offset }),
    [status, debouncedSearch, offset],
  );

  const requestedIntentId = searchParams.get(INTENT_PARAM);
  useEffect(() => {
    if (!requestedIntentId || !intents.data) return;
    const found = intents.data.items.find((intent) => intent.id === requestedIntentId);
    if (found) setSelected(found);
  }, [requestedIntentId, intents.data]);

  const closeDrawer = () => {
    setSelected(null);
    if (requestedIntentId) {
      const next = new URLSearchParams(searchParams);
      next.delete(INTENT_PARAM);
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

  const cancelIntent = async (intent: Intent) => {
    setCancellingId(intent.id);
    try {
      const updated = await api.intents.cancel(intent.id);
      notifySuccess(`Intent ${updated.reference} cancelled`);
      if (selected?.id === updated.id) setSelected(updated);
      void intents.reload();
    } catch (error) {
      notifyError(error, 'Could not cancel intent');
    } finally {
      setCancellingId(null);
    }
  };

  const page = intents.data;

  return (
    <Stack gap="md">
      <PageHeader
        title="Intents"
        subtitle="Expected payments waiting for a matching wallet receipt"
        actions={
          <>
            <Tooltip label="Refresh now">
              <ActionIcon variant="default" aria-label="Refresh" onClick={() => void intents.reload()} loading={intents.loading}>
                <IconRefresh size={16} />
              </ActionIcon>
            </Tooltip>
            <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setCreating(true)}>
              New intent
            </Button>
          </>
        }
      />

      <Paper p="sm">
        <Stack gap="sm">
          <StatusChips statuses={INTENT_STATUSES} counters={page?.counters} value={status} onChange={changeStatus} />
          <TextInput
            placeholder="Search reference or phone"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(event) => changeSearch(event.currentTarget.value)}
            w={{ base: '100%', sm: 360 }}
            aria-label="Search intents"
          />
        </Stack>
      </Paper>

      {intents.error && <ErrorAlert error={intents.error} />}

      {!page ? (
        intents.loading && <LoadingBlock />
      ) : (
        <Paper>
          <Table.ScrollContainer minWidth={900}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Reference</Table.Th>
                  <Table.Th>Amount</Table.Th>
                  <Table.Th>Sender phone</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Created</Table.Th>
                  <Table.Th>Expires</Table.Th>
                  <Table.Th>Matched</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {page.items.length === 0 && <EmptyRow colSpan={COLUMN_COUNT} label="No intents match these filters." />}
                {page.items.map((intent) => (
                  <Table.Tr key={intent.id} onClick={() => setSelected(intent)} style={{ cursor: 'pointer' }}>
                    <Table.Td>
                      <Text size="sm" ff="monospace" fw={500}>
                        {intent.reference}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Money cents={intent.amount_cents} currency={intent.currency} />
                    </Table.Td>
                    <Table.Td>{intent.sender_phone ?? '—'}</Table.Td>
                    <Table.Td>
                      <StatusBadge status={intent.status} />
                    </Table.Td>
                    <Table.Td>
                      <DateTime iso={intent.created_at} />
                    </Table.Td>
                    <Table.Td>
                      <DateTime iso={intent.expires_at} />
                    </Table.Td>
                    <Table.Td>
                      <DateTime iso={intent.matched_at} />
                    </Table.Td>
                    <Table.Td align="right" onClick={(event) => event.stopPropagation()}>
                      {intent.status === 'pending' && (
                        <Button size="compact-xs" color="red" variant="subtle" loading={cancellingId === intent.id} onClick={() => void cancelIntent(intent)}>
                          Cancel
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

      <NewIntentModal opened={creating} onClose={() => setCreating(false)} onCreated={() => void intents.reload()} />
      <IntentDrawer intent={selected} cancelling={selected !== null && cancellingId === selected.id} onClose={closeDrawer} onCancel={(intent) => void cancelIntent(intent)} />
    </Stack>
  );
}
