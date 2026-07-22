import { useEffect, useState } from 'react';
import { http } from '../api/http';
import { getSharedSocket } from '../lib/socket';
import { getLastEquityDataMode, getLastEquityQuoteAt, getLastOptionQuoteAt } from '../lib/liveMarketStore';
import { useAiStatus } from '../lib/aiStatusStore';
import { useAutomationVisibility } from './useAutomationVisibility';

// Independent connection domains for the workspace status bar. Each subsystem
// owns its own state — the options feed can be fully LIVE while the equity
// feed is DELAYED (that's the actual Massive Options Advanced entitlement),
// and neither ever collapses into a single shared "OFFLINE" flag.

export type BackendStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE';
export type SocketStatus = 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED';
export type OptionsFeedStatus = 'LIVE' | 'CONNECTING' | 'STALE';
export type EquityFeedStatus = 'REALTIME' | 'DELAYED' | 'SNAPSHOT' | 'UNAVAILABLE';
export type AutomationStatus = 'RUNNING' | 'PAUSED' | 'ERROR' | 'UNKNOWN';

const FEED_FRESH_MS = 10_000;
const BACKEND_POLL_MS = 20_000;
const BACKEND_SLOW_MS = 1_500;
const CLOCK_TICK_MS = 1_000;

function useBackendStatus(): BackendStatus {
  const [status, setStatus] = useState<BackendStatus>('ONLINE');

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      const started = Date.now();
      try {
        await http.get('/health', { timeout: 5_000 });
        if (cancelled) return;
        setStatus(Date.now() - started > BACKEND_SLOW_MS ? 'DEGRADED' : 'ONLINE');
      } catch {
        if (!cancelled) setStatus('OFFLINE');
      }
    };
    void probe();
    const id = window.setInterval(probe, BACKEND_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return status;
}

function useSocketStatus(): SocketStatus {
  const [status, setStatus] = useState<SocketStatus>('CONNECTING');

  useEffect(() => {
    let socket: ReturnType<typeof getSharedSocket> | null = null;
    const onConnect = () => setStatus('CONNECTED');
    const onDisconnect = () => setStatus('DISCONNECTED');
    try {
      socket = getSharedSocket();
      setStatus(socket.connected ? 'CONNECTED' : 'CONNECTING');
      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);
    } catch {
      setStatus('DISCONNECTED');
    }
    return () => {
      try {
        socket?.off('connect', onConnect);
        socket?.off('disconnect', onDisconnect);
      } catch {
        /* no-op */
      }
    };
  }, []);

  return status;
}

/** Options feed status — driven ONLY by option quote/trade delivery. Never references equity data. */
function useOptionsFeedStatus(): OptionsFeedStatus {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const lastAt = getLastOptionQuoteAt();
  if (lastAt == null) return 'CONNECTING';
  const age = now - lastAt;
  return age <= FEED_FRESH_MS ? 'LIVE' : 'STALE';
}

/** Equity feed status — driven ONLY by underlying-stock quote delivery + dataMode. Never influences options components. */
function useEquityFeedStatus(): EquityFeedStatus {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const lastAt = getLastEquityQuoteAt();
  const dataMode = getLastEquityDataMode();
  if (lastAt == null) return 'UNAVAILABLE';
  const age = now - lastAt;
  const stale = age > FEED_FRESH_MS * 3;
  if (dataMode === 'delayed') return 'DELAYED';
  if (dataMode === 'snapshot') return 'SNAPSHOT';
  return stale ? 'UNAVAILABLE' : 'REALTIME';
}

function normalizeAutomationStatus(raw: unknown): AutomationStatus {
  const value = String(raw ?? '').toUpperCase();
  if (value.includes('RUN') || value.includes('ACTIVE')) return 'RUNNING';
  if (value.includes('PAUSE')) return 'PAUSED';
  if (value.includes('ERROR') || value.includes('FAIL') || value.includes('REJECT')) return 'ERROR';
  return 'UNKNOWN';
}

export type SystemStatus = {
  backend: BackendStatus;
  socket: SocketStatus;
  optionsFeed: OptionsFeedStatus;
  equityFeed: EquityFeedStatus;
  ai: ReturnType<typeof useAiStatus>;
  automation: AutomationStatus;
};

export function useSystemStatus(): SystemStatus {
  const backend = useBackendStatus();
  const socket = useSocketStatus();
  const optionsFeed = useOptionsFeedStatus();
  const equityFeed = useEquityFeedStatus();
  const ai = useAiStatus();
  const { visibility } = useAutomationVisibility();
  const automation = normalizeAutomationStatus((visibility?.engineStatus as any)?.automationState);

  return { backend, socket, optionsFeed, equityFeed, ai, automation };
}
