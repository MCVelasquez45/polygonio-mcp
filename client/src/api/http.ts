import axios from 'axios';

const DEFAULT_API_PORT = String(4e3);
const PRODUCTION_API_BASE_URL = 'https://polygonio-backend.onrender.com';
const DEV_SERVER_PORTS = new Set([
  String(Number.parseInt('5', 10) * 1000 + 173),
  String(Number.parseInt('5', 10) * 1000 + 174),
  String(Number.parseInt('3', 10) * 1000),
]);
const LOCALHOST = String.fromCharCode(108, 111, 99, 97, 108, 104, 111, 115, 116);
const LOOPBACK_IPV4 = [127, 0, 0, 1].map(String).join('.');

function normalizeHost(hostname: string): string {
  return hostname.includes(':') ? `[${hostname}]` : hostname;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isLoopbackHost(hostname: string): boolean {
  return [LOCALHOST, LOOPBACK_IPV4, '::1'].includes(hostname);
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

function shouldUseSameOriginProxy(): boolean {
  if (!import.meta.env.PROD || typeof window === 'undefined' || !window.location) return false;
  return !isLocalHost(window.location.hostname || LOCALHOST);
}

function parseAbsoluteUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function assertApiRuntimeConfig(): void {
  const configuredUrl =
    typeof import.meta.env.VITE_API_BASE_URL === 'string' && import.meta.env.VITE_API_BASE_URL.trim()
      ? import.meta.env.VITE_API_BASE_URL.trim()
      : '';
  if (configuredUrl) {
    const parsed = parseAbsoluteUrl(configuredUrl);
    if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      throw new Error(
        `[CLIENT] Invalid VITE_API_BASE_URL '${configuredUrl}'. Expected an absolute http(s) backend URL.`
      );
    }
    if (import.meta.env.PROD && typeof window !== 'undefined' && window.location && parsed.host === window.location.host) {
      throw new Error('[CLIENT] VITE_API_BASE_URL must point to the Render backend, not the frontend origin.');
    }
  }

  const configuredPort = import.meta.env.DEV && typeof import.meta.env.VITE_API_PORT === 'string' ? import.meta.env.VITE_API_PORT.trim() : '';
  if (configuredPort) {
    const asNumber = Number(configuredPort);
    if (!Number.isInteger(asNumber) || asNumber <= 0 || asNumber > 65535) {
      throw new Error(`[CLIENT] Invalid VITE_API_PORT '${configuredPort}'. Expected an integer between 1 and 65535.`);
    }
  }
}

function resolveApiBaseUrl(): string {
  if (shouldUseSameOriginProxy()) {
    return window.location.origin;
  }
  const configured =
    typeof import.meta.env.VITE_API_BASE_URL === 'string' && import.meta.env.VITE_API_BASE_URL.trim()
      ? import.meta.env.VITE_API_BASE_URL.trim()
      : '';
  if (configured) {
    const trimmed = stripTrailingSlash(configured);
    const parsed = parseAbsoluteUrl(trimmed);
    if (parsed && typeof window !== 'undefined' && window.location) {
      const windowHost = window.location.hostname || LOCALHOST;
      const configuredIsLocal = isLocalHost(parsed.hostname);
      const windowIsLocal = isLocalHost(windowHost);
      if (import.meta.env.PROD && parsed.host === window.location.host) {
        return PRODUCTION_API_BASE_URL;
      }
      if (configuredIsLocal && !windowIsLocal) {
        // Ignore localhost configs when the UI is served from a different host (mobile/LAN).
      } else {
        return trimmed;
      }
    } else {
      return trimmed;
    }
  }
  if (import.meta.env.PROD) {
    return PRODUCTION_API_BASE_URL;
  }
  if (typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname || LOCALHOST;
    const host = normalizeHost(hostname);
    const protocol = window.location.protocol || 'http:';
    const port = window.location.port || '';
    const isDevServer = Boolean(port && DEV_SERVER_PORTS.has(port));
    const configuredPort = import.meta.env.DEV ? import.meta.env.VITE_API_PORT : '';
    if (configuredPort || isLocalHost(hostname) || isDevServer) {
      const apiPort = configuredPort || DEFAULT_API_PORT;
      return `${protocol}//${host}:${apiPort}`;
    }
    throw new Error('[CLIENT] VITE_API_BASE_URL is required outside local development.');
  }
  if (import.meta.env.DEV) return `http://${LOCALHOST}:${DEFAULT_API_PORT}`;
  throw new Error('[CLIENT] VITE_API_BASE_URL is required for production builds.');
}

export const API_BASE_URL = resolveApiBaseUrl();
let fallbackBaseUrl: string | null = null;

function computeFallbackBaseUrl(): string | null {
  if (typeof window === 'undefined' || !window.location) return null;
  if (import.meta.env.PROD) return null;
  const hostname = window.location.hostname || LOCALHOST;
  const host = normalizeHost(hostname);
  const protocol = window.location.protocol || 'http:';
  const port = window.location.port || '';
  const isDevServer = Boolean(port && DEV_SERVER_PORTS.has(port));
  const configuredPort = import.meta.env.DEV ? import.meta.env.VITE_API_PORT : '';
  if (configuredPort || isLocalHost(hostname) || isDevServer) {
    const apiPort = configuredPort || DEFAULT_API_PORT;
    return `${protocol}//${host}:${apiPort}`;
  }
  return null;
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

function createCorrelationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function setHeader(config: any, key: string, value: string): void {
  if (typeof config.headers?.set === 'function') {
    config.headers.set(key, value);
    return;
  }
  config.headers = { ...(config.headers ?? {}), [key]: value };
}

function getHeader(headers: any, key: string): string | undefined {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') {
    return headers.get(key) ?? headers.get(key.toLowerCase()) ?? undefined;
  }
  return headers[key] ?? headers[key.toLowerCase()];
}

function redactedPayload(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return redactedPayload(JSON.parse(value));
    } catch {
      return value.length > 2000 ? `${value.slice(0, 2000)}...` : value;
    }
  }
  if (Array.isArray(value)) {
    return value.map(redactedPayload);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        /secret|password|token|api[_-]?key|authorization|mongo|uri/i.test(key) ? '[REDACTED]' : redactedPayload(entry),
      ])
    );
  }
  return value;
}

function fullRequestUrl(config: any): string {
  try {
    return new URL(config?.url ?? '', config?.baseURL ?? getActiveBaseUrl()).toString();
  } catch {
    return `${config?.baseURL ?? getActiveBaseUrl()}${config?.url ?? ''}`;
  }
}

function expectedRouteFor(method: string, url: string): string {
  const path = (() => {
    try {
      return new URL(url, getActiveBaseUrl()).pathname;
    } catch {
      return url;
    }
  })();
  const normalizedMethod = method.toUpperCase();
  const routes: Array<{ method: string; match: RegExp; expected: string }> = [
    { method: 'GET', match: /^\/api\/broker\/account$/, expected: 'GET /api/broker/account -> server/src/features/broker/broker.routes.ts' },
    { method: 'GET', match: /^\/api\/broker\/alpaca\/account$/, expected: 'GET /api/broker/alpaca/account -> server/src/features/broker/broker.routes.ts' },
    { method: 'GET', match: /^\/api\/portfolio\/operations$/, expected: 'GET /api/portfolio/operations -> server/src/features/portfolio/portfolio.routes.ts' },
    { method: 'GET', match: /^\/api\/watchlist/, expected: 'GET /api/watchlist -> server/src/features/watchlist/watchlist.routes.ts' },
    { method: 'GET', match: /^\/api\/automation\/status$/, expected: 'GET /api/automation/status -> server/src/features/automation/automation.routes.ts' },
    { method: 'POST', match: /^\/api\/market\/options\/selection$/, expected: 'POST /api/market/options/selection -> server/src/features/market/market.routes.ts' },
    { method: 'PUT', match: /^\/api\/market\/options\/selection$/, expected: 'PUT /api/market/options/selection -> server/src/features/market/market.routes.ts' },
    { method: 'POST', match: /^\/api\/options\/select$/, expected: 'POST /api/options/select -> server/src/features/options/options.routes.ts' },
    { method: 'PUT', match: /^\/api\/options\/select$/, expected: 'PUT /api/options/select -> server/src/features/options/options.routes.ts' },
    { method: 'POST', match: /^\/api\/analyze$/, expected: 'POST /api/analyze -> server/src/features/assistant/analyze.routes.ts' },
  ];
  return routes.find(route => route.method === normalizedMethod && route.match.test(path))?.expected ?? 'No explicit client route metadata registered';
}

http.interceptors.request.use(config => {
  config.baseURL = getActiveBaseUrl();
  setHeader(config, 'x-request-id', getHeader(config.headers, 'x-request-id') ?? createCorrelationId());
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
    console.error('[CLIENT] HTTP failure', {
      message: error?.message,
      method: String(error?.config?.method ?? 'GET').toUpperCase(),
      url: fullRequestUrl(error?.config),
      status: error?.response?.status ?? null,
      responseBody: redactedPayload(error?.response?.data),
      requestPayload: redactedPayload(error?.config?.data),
      correlationId:
        getHeader(error?.response?.headers, 'x-request-id') ??
        getHeader(error?.config?.headers, 'x-request-id') ??
        null,
      expectedRoute: expectedRouteFor(String(error?.config?.method ?? 'GET'), error?.config?.url ?? ''),
      baseURL: error?.config?.baseURL,
    });
    return Promise.reject(error);
  }
);
