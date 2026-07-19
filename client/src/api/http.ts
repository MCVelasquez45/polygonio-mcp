import axios from 'axios';

const DEFAULT_API_PORT = '4000';
const DEV_SERVER_PORTS = new Set(['5173', '5174', '3000']);

function normalizeHost(hostname: string): string {
  return hostname.includes(':') ? `[${hostname}]` : hostname;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isLoopbackHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

function isPrivateHostname(hostname: string): boolean {
  if (isLoopbackHost(hostname)) return true;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return false;
  const [a, b] = hostname.split('.').map(part => Number(part));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isLocalHost(hostname: string): boolean {
  return isLoopbackHost(hostname) || isPrivateHostname(hostname);
}

function parseAbsoluteUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function assertApiRuntimeConfig(): void {
  const configuredUrl = typeof import.meta.env.VITE_API_URL === 'string' ? import.meta.env.VITE_API_URL.trim() : '';
  if (configuredUrl) {
    const parsed = parseAbsoluteUrl(configuredUrl);
    if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      throw new Error(
        `[CLIENT] Invalid VITE_API_URL '${configuredUrl}'. Expected an absolute http(s) URL like http://localhost:4000`
      );
    }
  }

  const configuredPort = typeof import.meta.env.VITE_API_PORT === 'string' ? import.meta.env.VITE_API_PORT.trim() : '';
  if (configuredPort) {
    const asNumber = Number(configuredPort);
    if (!Number.isInteger(asNumber) || asNumber <= 0 || asNumber > 65535) {
      throw new Error(`[CLIENT] Invalid VITE_API_PORT '${configuredPort}'. Expected an integer between 1 and 65535.`);
    }
  }
}

function resolveApiBaseUrl(): string {
  const configured = typeof import.meta.env.VITE_API_URL === 'string' ? import.meta.env.VITE_API_URL.trim() : '';
  if (configured) {
    const trimmed = stripTrailingSlash(configured);
    const parsed = parseAbsoluteUrl(trimmed);
    if (parsed && typeof window !== 'undefined' && window.location) {
      const windowHost = window.location.hostname || 'localhost';
      const configuredIsLocal = isLocalHost(parsed.hostname);
      const windowIsLocal = isLocalHost(windowHost);
      if (configuredIsLocal && !windowIsLocal) {
        // Ignore localhost configs when the UI is served from a different host (mobile/LAN).
      } else {
        return trimmed;
      }
    } else {
      return trimmed;
    }
  }
  if (typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname || 'localhost';
    const host = normalizeHost(hostname);
    const protocol = window.location.protocol || 'http:';
    const port = window.location.port || '';
    const isDevServer = Boolean(port && DEV_SERVER_PORTS.has(port));
    const configuredPort = import.meta.env.VITE_API_PORT;
    if (configuredPort || isLocalHost(hostname) || isDevServer) {
      const apiPort = configuredPort || DEFAULT_API_PORT;
      return `${protocol}//${host}:${apiPort}`;
    }
    return `${protocol}//${window.location.host}`;
  }
  return `http://localhost:${DEFAULT_API_PORT}`;
}

export const API_BASE_URL = resolveApiBaseUrl();
let fallbackBaseUrl: string | null = null;

function computeFallbackBaseUrl(): string | null {
  if (typeof window === 'undefined' || !window.location) return null;
  const hostname = window.location.hostname || 'localhost';
  const host = normalizeHost(hostname);
  const protocol = window.location.protocol || 'http:';
  const port = window.location.port || '';
  const isDevServer = Boolean(port && DEV_SERVER_PORTS.has(port));
  const configuredPort = import.meta.env.VITE_API_PORT;
  if (configuredPort || isLocalHost(hostname) || isDevServer) {
    const apiPort = configuredPort || DEFAULT_API_PORT;
    return `${protocol}//${host}:${apiPort}`;
  }
  return `${protocol}//${window.location.host}`;
}

function getActiveBaseUrl(): string {
  return fallbackBaseUrl ?? API_BASE_URL;
}

export function getApiBaseUrl(): string {
  return getActiveBaseUrl();
}

export { assertApiRuntimeConfig };

export const http = axios.create({
  baseURL: API_BASE_URL,
});

// Verbose request/response logging is opt-in: it floods the console (and leaks
// payloads) under live market traffic. Enable with VITE_DEBUG_HTTP=true.
const HTTP_DEBUG = import.meta.env.VITE_DEBUG_HTTP === 'true';

function isCancellation(error: any): boolean {
  return error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' || error?.name === 'AbortError';
}

function isLegacyBrokerSubmissionDisabled(error: any): boolean {
  return (
    error?.response?.status === 410 &&
    error?.response?.data?.error === 'DIRECT_BROKER_SUBMISSION_DISABLED' &&
    String(error?.config?.url ?? '').includes('/api/broker/alpaca/options/orders')
  );
}

http.interceptors.request.use(config => {
  config.baseURL = getActiveBaseUrl();
  if (HTTP_DEBUG) {
    console.log('[CLIENT] HTTP request', {
      method: config.method,
      url: config.url,
      baseURL: config.baseURL
    });
  }
  return config;
});

http.interceptors.response.use(
  response => {
    if (HTTP_DEBUG) {
      console.log('[CLIENT] HTTP response', {
        url: response.config.url,
        status: response.status,
      });
    }
    return response;
  },
  async error => {
    const config = error?.config as (typeof error.config & { __baseUrlRetried?: boolean }) | undefined;
    if (config && !error?.response && !config.__baseUrlRetried) {
      const fallback = computeFallbackBaseUrl();
      if (fallback && fallback !== getActiveBaseUrl()) {
        config.__baseUrlRetried = true;
        fallbackBaseUrl = fallback;
        config.baseURL = fallback;
        return http.request(config);
      }
    }
    if (isCancellation(error)) {
      if (HTTP_DEBUG) {
        console.debug('[CLIENT] HTTP canceled', {
          url: error?.config?.url,
          method: error?.config?.method,
        });
      }
      return Promise.reject(error);
    }
    if (isLegacyBrokerSubmissionDisabled(error)) {
      console.warn('[CLIENT] Direct broker submission disabled', {
        url: error?.config?.url,
        method: error?.config?.method,
        message: 'This submission path is disabled. Use the governed order ticket.',
      });
      return Promise.reject(error);
    }
    console.error('[CLIENT] HTTP error', {
      message: error?.message,
      status: error?.response?.status,
      url: error?.config?.url,
      baseURL: error?.config?.baseURL,
      method: error?.config?.method,
    });
    return Promise.reject(error);
  }
);
