import { Alert, Button, Drawer, Group, Paper, Stack, Text } from '@mantine/core';
import { IconArrowBackUp, IconCircleCheck, IconEyeOff, IconLink, IconShieldCheck } from '@tabler/icons-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Intent, Message, MessageStatus } from '../api/types';
import { notifyError, notifySuccess } from '../lib/notify';
import { FieldList, type Field } from './FieldList';
import { MatchIntentModal } from './MatchIntentModal';
import { formatMoney } from './Money';
import { StatusBadge } from './StatusBadge';
import { DateTime } from './TimeAgo';

interface MessageDrawerProps {
  message: Message | null;
  currency: string;
  onClose: () => void;
  onChanged: (message: Message) => void;
}

const IGNORABLE: readonly MessageStatus[] = ['unmatched', 'not_receipt', 'untrusted_sender', 'stale', 'held'];
const REOPENABLE: readonly MessageStatus[] = ['ignored', 'stale', 'untrusted_sender'];
const RETRUSTABLE: readonly MessageStatus[] = ['untrusted_sender'];

type ActionName = 'match' | 'approve' | 'ignore' | 'reopen' | 'retrust';

const HOLD_REASONS: Record<string, string> = {
  balance_mismatch: 'The balance in this SMS does not equal the last confirmed wallet balance plus the amount.',
  no_balance: 'This SMS carries no wallet balance, so it cannot be checked.',
  no_balance_history: 'There is no confirmed wallet balance yet to check this SMS against.',
  above_review_limit: 'The amount is above the review limit set in Settings.',
};

const VERIFICATION_LABELS: Record<string, string> = {
  verified: 'verified',
  mismatch: 'does not add up',
  no_balance: 'no balance in the SMS',
  no_history: 'no confirmed balance yet',
};

export function MessageDrawer({ message, currency, onClose, onChanged }: MessageDrawerProps) {
  const [busy, setBusy] = useState<ActionName | null>(null);
  const [matchOpen, setMatchOpen] = useState(false);

  const runAction = async (name: ActionName, perform: () => Promise<Message>, successText: string) => {
    setBusy(name);
    try {
      const updated = await perform();
      onChanged(updated);
      notifySuccess(successText);
      return true;
    } catch (error) {
      notifyError(error);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const pickIntent = async (intent: Intent) => {
    if (!message) return;
    const done = await runAction('match', () => api.messages.match(message.id, intent.id), `Matched to ${intent.reference}`);
    if (done) setMatchOpen(false);
  };

  const fields: Field[] = message
    ? [
        { label: 'Status', value: <StatusBadge status={message.status} /> },
        { label: 'Amount', value: formatMoney(message.amount_cents, currency) },
        { label: 'Sender phone', value: message.sender_phone },
        { label: 'Sender name', value: message.sender_name ? <span dir="auto">{message.sender_name}</span> : null },
        { label: 'Reference', value: message.reference },
        { label: 'Balance', value: message.balance_cents === null ? null : formatMoney(message.balance_cents, currency) },
        {
          label: 'Expected balance',
          value: message.expected_balance_cents === null ? null : formatMoney(message.expected_balance_cents, currency),
        },
        { label: 'Balance check', value: message.verification ? VERIFICATION_LABELS[message.verification] : null },
        { label: 'Reviewed', value: message.reviewed_at ? <DateTime iso={message.reviewed_at} /> : null },
        { label: 'Provider', value: message.provider },
        { label: 'Parsed', value: message.parsed },
        { label: 'Sender id', value: message.address },
        { label: 'Device', value: message.device_id },
        { label: 'Received', value: <DateTime iso={message.received_at} /> },
        { label: 'Ingested', value: <DateTime iso={message.ingested_at} /> },
        {
          label: 'Intent',
          value: message.intent_id ? (
            <Link to={`/app/intents?intent=${encodeURIComponent(message.intent_id)}`}>{message.intent_id}</Link>
          ) : null,
        },
        { label: 'Matched', value: message.matched_at ? <DateTime iso={message.matched_at} /> : null },
        { label: 'Matched by', value: message.matched_by },
        { label: 'Note', value: message.note },
        { label: 'Message id', value: message.id },
        { label: 'Fingerprint', value: <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{message.fingerprint}</span> },
      ]
    : [];

  const status = message?.status;
  const canMatch = Boolean(status) && status !== 'matched';
  const canApprove = status === 'held';
  const canIgnore = Boolean(status) && IGNORABLE.includes(status as MessageStatus);
  const canReopen = Boolean(status) && REOPENABLE.includes(status as MessageStatus);
  const canRetrust = Boolean(status) && RETRUSTABLE.includes(status as MessageStatus);

  return (
    <>
      <Drawer opened={message !== null} onClose={onClose} position="right" size="lg" title="Message" padding="md">
        {message && (
          <Stack gap="md">
            <Paper p="sm" bg="gray.0">
              <Text dir="auto" fz="md" lh={1.8} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} data-testid="message-body">
                {message.body}
              </Text>
            </Paper>

            {canApprove && (
              <Alert color="grape" variant="light" title="Held for review">
                {HOLD_REASONS[message.note ?? ''] ?? 'This receipt needs a human check.'} Open the wallet app and confirm the transfer
                really arrived before approving. If it did not, ignore it: the SMS was faked.
              </Alert>
            )}

            <Group gap="xs">
              {canApprove && (
                <Button
                  size="xs"
                  color="grape"
                  leftSection={<IconCircleCheck size={14} />}
                  loading={busy === 'approve'}
                  disabled={busy !== null}
                  onClick={() => void runAction('approve', () => api.messages.approve(message.id), 'Receipt approved')}
                >
                  Approve
                </Button>
              )}
              {canMatch && (
                <Button size="xs" leftSection={<IconLink size={14} />} loading={busy === 'match'} disabled={busy !== null} onClick={() => setMatchOpen(true)}>
                  Match
                </Button>
              )}
              {canIgnore && (
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconEyeOff size={14} />}
                  loading={busy === 'ignore'}
                  disabled={busy !== null}
                  onClick={() => void runAction('ignore', () => api.messages.ignore(message.id), 'Message ignored')}
                >
                  Ignore
                </Button>
              )}
              {canReopen && (
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconArrowBackUp size={14} />}
                  loading={busy === 'reopen'}
                  disabled={busy !== null}
                  onClick={() => void runAction('reopen', () => api.messages.reopen(message.id), 'Message reopened')}
                >
                  Reopen
                </Button>
              )}
              {canRetrust && (
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconShieldCheck size={14} />}
                  loading={busy === 'retrust'}
                  disabled={busy !== null}
                  onClick={() => void runAction('retrust', () => api.messages.retrust(message.id), 'Sender re-evaluated')}
                >
                  Retrust
                </Button>
              )}
            </Group>

            <FieldList fields={fields} />
          </Stack>
        )}
      </Drawer>
      <MatchIntentModal message={message} currency={currency} opened={matchOpen} onClose={() => setMatchOpen(false)} onPick={pickIntent} />
    </>
  );
}
