import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockFetch } from '../test/fetchMock';
import { overviewFixture, settingsFixture } from '../test/fixtures';
import { renderWithProviders } from '../test/render';
import { OverviewPage } from './OverviewPage';

describe('OverviewPage', () => {
  it('renders the counters, warnings, recent messages and parsers', async () => {
    mockFetch({ 'GET /admin/overview': { body: overviewFixture() } });

    renderWithProviders(<OverviewPage />, { route: '/app/overview', settings: settingsFixture });

    expect(await screen.findByTestId('stat-unmatched')).toHaveTextContent('3');
    expect(screen.getByTestId('stat-matched-24h')).toHaveTextContent('5');
    expect(screen.getByText('1,234.50 EGP')).toBeInTheDocument();
    expect(screen.getByTestId('stat-pending-intents')).toHaveTextContent('7');
    expect(screen.getByTestId('stat-devices')).toHaveTextContent('1 / 2');
    expect(screen.getByTestId('stat-failed-webhooks')).toHaveTextContent('4');

    expect(screen.getByText(/mail not configured/i)).toBeInTheDocument();
    expect(screen.queryByText(/webhook url not configured/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no listener phone is online/i)).not.toBeInTheDocument();

    expect(screen.getAllByTestId('message-row')).toHaveLength(1);
    expect(screen.getByText('Etisalat Cash')).toBeInTheDocument();
    expect(screen.getByText('etisalat cash')).toBeInTheDocument();
  });

  it('warns when no device is online', async () => {
    mockFetch({ 'GET /admin/overview': { body: overviewFixture({ devices: { total: 1, online: 0, offline: 1, items: [] } }) } });

    renderWithProviders(<OverviewPage />, { route: '/app/overview', settings: settingsFixture });

    expect(await screen.findByText(/no listener phone is online/i)).toBeInTheDocument();
    expect(screen.getByTestId('stat-devices')).toHaveTextContent('0 / 1');
  });
});
