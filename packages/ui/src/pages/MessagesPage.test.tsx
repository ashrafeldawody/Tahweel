import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TOKEN_STORAGE_KEY } from '../auth/token';
import { mockFetch } from '../test/fetchMock';
import { RECEIPT_BODY, deviceFixture, messageFixture, settingsFixture } from '../test/fixtures';
import { renderWithProviders } from '../test/render';
import { MessagesPage } from './MessagesPage';

describe('MessagesPage', () => {
  it('lists messages with status badges and amounts, and opens the drawer on row click', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-123');
    const matched = messageFixture({ id: 'msg-2', status: 'matched', amount_cents: 1550, sender_phone: '01000000000', reference: '999', intent_id: 'intent-1' });
    const { calls } = mockFetch({
      'GET /admin/messages': { body: { items: [messageFixture(), matched], total: 2, limit: 50, offset: 0, counters: { unmatched: 1, matched: 1 } } },
      'GET /admin/devices': { body: { items: [deviceFixture] } },
    });

    renderWithProviders(<MessagesPage />, { route: '/app/messages', settings: settingsFixture });

    const rows = await screen.findAllByTestId('message-row');
    expect(rows).toHaveLength(2);

    expect(within(rows[0]).getByText('unmatched')).toBeInTheDocument();
    expect(within(rows[0]).getByText('200.00 EGP')).toBeInTheDocument();
    expect(within(rows[1]).getByText('matched')).toBeInTheDocument();
    expect(within(rows[1]).getByText('15.50 EGP')).toBeInTheDocument();

    expect(screen.getByText('Unmatched · 1')).toBeInTheDocument();
    expect(screen.getByText('All · 2')).toBeInTheDocument();

    const listCall = calls.find((call) => call.path === '/admin/messages');
    expect(listCall?.headers.Authorization).toBe('Bearer jwt-123');
    expect(listCall?.query.get('limit')).toBe('50');

    await userEvent.click(rows[0]);

    const body = await screen.findByTestId('message-body');
    expect(body).toHaveTextContent(RECEIPT_BODY);
    expect(body).toHaveAttribute('dir', 'auto');
    expect(screen.getByRole('button', { name: /^match$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ignore/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reopen/i })).not.toBeInTheDocument();
  });
});
