import axios from 'axios';

const DEFAULT_API_PORT = '3000';
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

export const http = axios.create({
  baseURL: API_BASE_URL,
});

http.interceptors.request.use(config => {
  config.baseURL = getActiveBaseUrl();
  console.log('[CLIENT] HTTP request', {
    method: config.method,
    url: config.url,
    data: config.data,
    baseURL: config.baseURL
  });
  return config;
});

http.interceptors.response.use(
  response => {
    console.log('[CLIENT] HTTP response', {
      url: response.config.url,
      status: response.status,
      data: response.data,
    });
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
    console.error('[CLIENT] HTTP error', {
      message: error?.message,
      status: error?.response?.status,
      url: error?.config?.url,
      baseURL: error?.config?.baseURL,
      method: error?.config?.method,
      data: error?.response?.data
    });
    return Promise.reject(error);
  }
);
