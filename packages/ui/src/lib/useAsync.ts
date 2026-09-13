import { useCallback, useEffect, useRef, useState } from 'react';

interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
}

interface AsyncOptions {
  refreshMs?: number;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function useAsync<T>(loader: () => Promise<T>, deps: readonly unknown[], options: AsyncOptions = {}) {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true });
  const latestRun = useRef(0);

  const load = useCallback(async (silent = false) => {
    const run = ++latestRun.current;
    if (!silent) setState((previous) => ({ ...previous, loading: true }));
    try {
      const data = await loader();
      if (run === latestRun.current) setState({ data, error: null, loading: false });
    } catch (failure) {
      if (run === latestRun.current) setState((previous) => ({ data: previous.data, error: toError(failure), loading: false }));
    }
  }, deps);

  useEffect(() => {
    void load();
    if (!options.refreshMs) return;
    const timer = setInterval(() => void load(true), options.refreshMs);
    return () => clearInterval(timer);
  }, [load, options.refreshMs]);

  const reload = useCallback(() => load(true), [load]);

  return { ...state, reload };
}
