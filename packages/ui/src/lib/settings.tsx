import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { Settings } from '../api/types';

export interface SettingsContextValue {
  settings: Settings | null;
  refresh: () => Promise<void>;
  replace: (settings: Settings) => void;
}

const noop = () => undefined;
const noopAsync = async () => undefined;

export const SettingsContext = createContext<SettingsContextValue>({ settings: null, refresh: noopAsync, replace: noop });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSettings(await api.settings.get());
    } catch {
      setSettings(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<SettingsContextValue>(() => ({ settings, refresh, replace: setSettings }), [settings, refresh]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}

export function useTimezone(): string | null {
  return useSettings().settings?.timezone ?? null;
}

export function useCurrency(): string {
  return useSettings().settings?.currency ?? '';
}
