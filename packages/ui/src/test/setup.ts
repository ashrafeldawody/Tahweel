import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function matchMediaStub(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;
}

function installBrowserStubs(): void {
  Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: matchMediaStub });
  Object.defineProperty(window, 'ResizeObserver', { writable: true, configurable: true, value: ResizeObserverStub });
  Object.defineProperty(globalThis, 'ResizeObserver', { writable: true, configurable: true, value: ResizeObserverStub });
  window.HTMLElement.prototype.scrollIntoView = () => undefined;
}

installBrowserStubs();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  installBrowserStubs();
});
