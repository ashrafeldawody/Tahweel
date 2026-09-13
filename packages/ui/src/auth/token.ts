import { useSyncExternalStore } from 'react';

export const TOKEN_STORAGE_KEY = 'tahweel.admin_token';

const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    return;
  }
  notifyListeners();
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    return;
  }
  notifyListeners();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function tokenOnServer(): string | null {
  return null;
}

export function useToken(): string | null {
  return useSyncExternalStore(subscribe, getToken, tokenOnServer);
}
