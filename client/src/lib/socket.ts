import { io, type Socket } from 'socket.io-client';
import { getApiBaseUrl } from '../api/http';

// Single multiplexed Socket.IO connection for the whole app.
//
// Every consumer (live market feed, chart stream, scanner signals, futures
// paper/engine updates, strategy extraction) attaches its own listeners to
// this one connection instead of opening private io() connections per panel.
// The socket lives for the lifetime of the page; consumers MUST remove their
// listeners on unmount (socket.off) and MUST NOT call socket.disconnect().
let sharedSocket: Socket | null = null;
let lastConnectErrorLogAt = 0;
const CONNECT_ERROR_LOG_INTERVAL_MS = 15_000;

function resolveSocketBaseUrl(): string {
  const apiBaseUrl = getApiBaseUrl();
  if (import.meta.env.PROD && typeof window !== 'undefined' && window.location) {
    const parsedApiUrl = new URL(apiBaseUrl, window.location.href);
    if (parsedApiUrl.origin === window.location.origin) {
      return apiBaseUrl.replace(/\/+$/, '');
    }
  }

  const configured =
    typeof import.meta.env.VITE_SOCKET_URL === 'string' && import.meta.env.VITE_SOCKET_URL.trim()
      ? import.meta.env.VITE_SOCKET_URL.trim()
      : '';
  return (configured || apiBaseUrl).replace(/\/+$/, '');
}

export function getSharedSocket(): Socket {
  if (sharedSocket) return sharedSocket;

  const baseUrl = resolveSocketBaseUrl();
  const parsed = typeof window !== 'undefined' ? new URL(baseUrl, window.location.href) : null;
  const isMixedContent =
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    parsed?.protocol === 'http:';
  const usesSameOriginProxy =
    import.meta.env.PROD &&
    typeof window !== 'undefined' &&
    parsed?.origin === window.location.origin;
  const usePollingOnly = isMixedContent || usesSameOriginProxy;

  const socket = io(baseUrl, {
    transports: usePollingOnly ? ['polling'] : ['websocket', 'polling'],
    upgrade: !usePollingOnly,
    withCredentials: false,
    path: '/socket.io',
    timeout: 10_000,
    reconnection: true,
    reconnectionAttempts: 12,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 5_000,
    randomizationFactor: 0.5,
  });

  // Transport-level failure handling lives here (module-owned), so every
  // consumer benefits from the polling fallback without duplicating it.
  const forcePolling = () => {
    const opts = socket.io.opts;
    if (opts.transports?.length === 1 && opts.transports[0] === 'polling') return;
    opts.transports = ['polling'];
    opts.upgrade = false;
    if (socket.connected) {
      socket.disconnect();
    }
    socket.connect();
  };

  socket.on('connect_error', (error: any) => {
    const description =
      typeof (error as { description?: unknown })?.description === 'string'
        ? (error as { description?: string }).description
        : undefined;
    const now = Date.now();
    if (now - lastConnectErrorLogAt > CONNECT_ERROR_LOG_INTERVAL_MS) {
      lastConnectErrorLogAt = now;
      console.warn('[CLIENT] shared socket connect error', {
        message: error?.message,
        ...(description ? { description } : {}),
      });
    }
    const shouldForcePolling =
      isMixedContent || String(error?.message ?? '').toLowerCase().includes('websocket');
    if (shouldForcePolling) {
      forcePolling();
    }
  });

  sharedSocket = socket;
  return socket;
}
