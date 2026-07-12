import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// jsdom lacks a few browser APIs the workstation uses.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver ?? ResizeObserverStub;

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
}

if (!window.localStorage) {
  const backing = new Map<string, string>();
  const storageStub = {
    getItem: (key: string) => (backing.has(key) ? backing.get(key)! : null),
    setItem: (key: string, value: string) => void backing.set(key, String(value)),
    removeItem: (key: string) => void backing.delete(key),
    clear: () => backing.clear(),
    key: (index: number) => Array.from(backing.keys())[index] ?? null,
    get length() {
      return backing.size;
    },
  };
  Object.defineProperty(window, 'localStorage', { value: storageStub, configurable: true });
}

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}
