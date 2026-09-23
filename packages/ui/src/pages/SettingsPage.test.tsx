import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Health, Settings } from '../api/types';
import { mockFetch, type RecordedCall } from '../test/fetchMock';
import { settingsFixture } from '../test/fixtures';
import { renderWithProviders } from '../test/render';
import { SettingsPage } from './SettingsPage';

vi.mock('@mantine/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mantine/core')>();
  return { ...actual, Autocomplete: actual.TextInput };
});

const health: Health = {
  ok: true,
  version: '0.1.0',
  database: { dialect: 'sqlite', location: '/app/data/tahweel.sqlite' },
  parsers: ['etisalat_money'],
  webhook_configured: true,
  mail_configured: false,
  started_at: '2026-09-13T09:00:00.000Z',
  server_time: '2026-09-13T10:00:00.000Z',
};

function renderSettings(settings: Settings) {
  const calls: RecordedCall[] = [];
  mockFetch({
    'GET /admin/settings': { body: settings },
    'GET /admin/health': { body: health },
    'PATCH /admin/settings': (call) => {
      calls.push(call);
      const body = call.body as Record<string, unknown>;
      return { body: { ...settings, ...body, webhook_secret_set: settings.webhook_secret_set || Boolean(body.webhook_secret) } };
    },
  });
  renderWithProviders(<SettingsPage />, { route: '/app/settings', settings });
  return calls;
}

describe('SettingsPage webhook fields', () => {
  it('shows the current URL and that a secret is set without revealing it', async () => {
    renderSettings(settingsFixture);

    expect(await screen.findByLabelText('Webhook URL')).toHaveValue('https://shop.example.com/webhooks/tahweel');
    expect(screen.getByText('set')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('••••••••••••••••')).toHaveValue('');
  });

  it('saves the URL and omits the secret when it was left empty', async () => {
    const calls = renderSettings(settingsFixture);
    const url = await screen.findByLabelText('Webhook URL');

    await userEvent.clear(url);
    await userEvent.type(url, 'https://new.example.com/hook');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toMatchObject({ webhook_url: 'https://new.example.com/hook' });
    expect(calls[0].body).not.toHaveProperty('webhook_secret');
  });

  it('sends null for an emptied URL and the secret when one is typed', async () => {
    const calls = renderSettings(settingsFixture);
    const url = await screen.findByLabelText('Webhook URL');

    await userEvent.clear(url);
    await userEvent.type(screen.getByPlaceholderText('••••••••••••••••'), 'a-brand-new-secret-value-0123');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toMatchObject({ webhook_url: null, webhook_secret: 'a-brand-new-secret-value-0123' });
  });

  it('refuses a URL without a secret when none is set yet', async () => {
    const calls = renderSettings({ ...settingsFixture, webhook_url: null, webhook_secret_set: false });
    const url = await screen.findByLabelText('Webhook URL');
    expect(screen.getByText('not set')).toBeInTheDocument();

    await userEvent.type(url, 'https://new.example.com/hook');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('A webhook secret is required together with the URL')).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    await userEvent.type(screen.getByPlaceholderText('openssl rand -hex 32'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Webhook secret must be at least 16 characters')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});

describe('SettingsPage fake SMS protection', () => {
  it('saves the balance check, its margin, the review limit and the phone filter', async () => {
    const calls = renderSettings(settingsFixture);
    const limit = await screen.findByLabelText('Review receipts above (EGP)');
    const balanceSwitch = screen.getByRole('switch', { name: /verify the wallet balance/i });
    expect(balanceSwitch).not.toBeChecked();
    const margin = screen.getByLabelText('Balance margin (EGP)');
    expect(margin).toHaveValue('0.02');
    expect(margin).toBeDisabled();

    await userEvent.click(balanceSwitch);
    await userEvent.clear(margin);
    await userEvent.type(margin, '0.01');

    await userEvent.type(limit, '1500');
    await userEvent.click(screen.getByRole('switch', { name: /filter sms on the phone/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toMatchObject({ verify_balance: true, balance_margin: 0.01, review_above_amount: 1500, phone_filter: false });
  });

  it('sends null when the review limit is left empty', async () => {
    const calls = renderSettings({ ...settingsFixture, review_above_amount: 800 });
    const limit = await screen.findByLabelText('Review receipts above (EGP)');
    await userEvent.clear(limit);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toMatchObject({ review_above_amount: null });
  });
});
