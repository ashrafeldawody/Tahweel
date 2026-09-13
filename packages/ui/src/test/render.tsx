import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { Settings } from '../api/types';
import { SettingsContext, type SettingsContextValue } from '../lib/settings';
import { theme } from '../theme';

interface RenderOptions {
  route?: string;
  settings?: Settings | null;
}

const noop = () => undefined;
const noopAsync = async () => undefined;

export function renderWithProviders(ui: ReactNode, { route = '/', settings = null }: RenderOptions = {}): RenderResult {
  const settingsValue: SettingsContextValue = { settings, refresh: noopAsync, replace: noop };
  return render(
    <MantineProvider theme={theme} env="test">
      <Notifications />
      <SettingsContext.Provider value={settingsValue}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </SettingsContext.Provider>
    </MantineProvider>,
  );
}
