import type { DeviceRow, HoldReason, PaymentIntentRow, SmsMessageRow } from '../db/schema.js';
import type { Mailer } from './mail.js';
import { serializeDevice, serializeIntent, serializeMessage } from './serializers.js';
import type { SettingsService } from './settings.js';
import type { WebhookService } from './webhooks.js';

function money(cents: number | null, currency: string): string {
  return `${((cents ?? 0) / 100).toFixed(2)} ${currency}`;
}

const HOLD_REASON_TEXT: Record<HoldReason, string> = {
  balance_mismatch: 'the balance in the SMS does not match the last confirmed wallet balance plus this amount',
  no_balance: 'the SMS carries no wallet balance, so it cannot be checked',
  no_balance_history: 'there is no confirmed wallet balance yet to check it against',
  above_review_limit: 'the amount is above the review limit set in Settings',
};

export class AlertService {
  constructor(
    private readonly webhooks: WebhookService,
    private readonly mail: Mailer,
    private readonly settings: SettingsService,
  ) {}

  async paymentMatched(intent: PaymentIntentRow, message: SmsMessageRow): Promise<void> {
    await this.webhooks.enqueue(
      'payment.matched',
      { intent: serializeIntent(intent), message: serializeMessage(message) },
      { url: intent.webhook_url, intentId: intent.id, messageId: message.id },
    );
  }

  async unmatchedReceipt(message: SmsMessageRow): Promise<void> {
    const settings = await this.settings.get();
    if (settings.webhook_unmatched_receipts) {
      await this.webhooks.enqueue('payment.unmatched_receipt', { message: serializeMessage(message) }, { messageId: message.id });
    }
    if (settings.email_alerts) {
      await this.mail.send(
        'Wallet receipt without a matching intent',
        [
          `From sender id: ${message.address}`,
          `Amount: ${money(message.amount_cents, settings.currency)}`,
          `Sender phone: ${message.sender_phone ?? '-'}`,
          `Sender name: ${message.sender_name ?? '-'}`,
          `Provider: ${message.provider ?? '-'}`,
          `Received at: ${message.received_at}`,
          '',
          'Open the Tahweel dashboard to match it by hand or ignore it.',
        ].join('\n'),
      );
    }
  }

  async heldReceipt(message: SmsMessageRow, reason: HoldReason): Promise<void> {
    const settings = await this.settings.get();
    if (!settings.email_alerts) return;
    await this.mail.send(
      'Wallet receipt held for review',
      [
        `Reason: ${HOLD_REASON_TEXT[reason]}`,
        `From sender id: ${message.address}`,
        `Amount: ${money(message.amount_cents, settings.currency)}`,
        `Balance in the SMS: ${message.balance_cents == null ? '-' : money(message.balance_cents, settings.currency)}`,
        `Expected balance: ${message.expected_balance_cents == null ? '-' : money(message.expected_balance_cents, settings.currency)}`,
        `Sender phone: ${message.sender_phone ?? '-'}`,
        `Received at: ${message.received_at}`,
        '',
        'Nothing was matched. Open the wallet app, confirm the transfer really arrived, then approve it on the Messages page of the Tahweel dashboard. If it did not arrive, ignore it: the SMS was faked.',
      ].join('\n'),
    );
  }

  async untrustedSender(message: SmsMessageRow): Promise<void> {
    const settings = await this.settings.get();
    if (!settings.email_alerts) return;
    await this.mail.send(
      'Receipt-looking SMS from an untrusted sender id',
      [
        `Sender id: ${message.address}`,
        `Amount: ${money(message.amount_cents, settings.currency)}`,
        `Sender phone: ${message.sender_phone ?? '-'}`,
        `Received at: ${message.received_at}`,
        '',
        'Nothing was matched. If this sender id belongs to a real wallet operator, add it to the trusted senders list in Settings and press "Re-run matching".',
      ].join('\n'),
    );
  }

  async deviceOffline(device: DeviceRow): Promise<void> {
    await this.webhooks.enqueue('device.offline', { device: serializeDevice(device, false) });
    const settings = await this.settings.get();
    if (!settings.email_alerts) return;
    await this.mail.send(
      `Listener phone offline: ${device.name}`,
      [
        `Device: ${device.name} (${device.device_id})`,
        `Last heartbeat: ${device.last_seen_at}`,
        `Messages queued on the phone: ${device.pending_count}`,
        '',
        'Automatic matching is paused until the phone reports back. Check the charger, the network and that the Tahweel Listener notification is still visible.',
      ].join('\n'),
    );
  }

  async deviceOnline(device: DeviceRow, offlineSince: string): Promise<void> {
    await this.webhooks.enqueue('device.online', { device: serializeDevice(device, true), offline_since: offlineSince });
    const settings = await this.settings.get();
    if (!settings.email_alerts) return;
    await this.mail.send(`Listener phone back online: ${device.name}`, `Device ${device.name} reported again after being offline since ${offlineSince}.`);
  }
}
