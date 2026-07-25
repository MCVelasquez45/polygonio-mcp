import { useEffect, useState } from 'react';
import { http } from '../api/http';
import { getSharedSocket } from '../lib/socket';
import {
  getLastChartActivityAt,
  getLastChartMode,
  getLastEquityDataMode,
  getLastEquityQuoteAt,
  getLastOptionQuoteAt,
  getOptionsSubscriptionActive,
  getOptionsSubscriptionActiveSince,
} from '../lib/liveMarketStore';
import { useAiStatus, type AiStatus } from '../lib/aiStatusStore';
import { useAutomationVisibility } from './useAutomationVisibility';

// Independent connection domains for the workspace status bar. Each subsystem
// owns its own state — the options feed can be fully LIVE while the equity
// feed is DELAYED (that's the actual Massive Options Advanced entitlement),
// and neither ever collapses into a single shared "OFFLINE" flag.

export type BackendStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE';
export type SocketStatus = 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED';
export type OptionsFeedStatus = 'LIVE' | 'CONNECTING' | 'STALE';
export type EquityFeedStatus = 'REALTIME' | 'DELAYED' | 'SNAPSHOT' | 'UNAVAILABLE';
export type ChartFeedStatus = 'LIVE' | 'SNAPSHOT' | 'STALE' | 'CLOSED' | 'CONNECTING';
export type AutomationStatus = 'RUNNING' | 'PAUSED' | 'ERROR' | 'UNKNOWN';

const FEED_FRESH_MS = 10_000;
// A quiet options contract can legitimately go much longer than 10s between
// NBBO prints — that's market inactivity, not a dead feed. Only treat an
// acknowledged, active subscription as STALE if literally no quote has
// arrived within this much longer grace window.
const SUBSCRIBED_QUIET_GRACE_MS = 60_000;
// Equity is snapshot-only (intentional). Snapshots refresh on chain loads and
// chart deliveries; allow a generous window before calling the pipeline dead.
const EQUITY_SNAPSHOT_GRACE_MS = 90_000;
// A chart on entitlement-limited (last-session) data legitimately goes long
// stretches without a new bar. Only a prolonged delivery gap is a real STALE.
const CHART_STALE_MS = 10 * 60_000;
const BACKEND_POLL_MS = 20_000;
const AI_HEALTH_POLL_MS = 20_000;
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

/**
 * Options feed status — driven by subscription-ack health (is the pipe
 * actually up) plus quote delivery, never by equity data. Quote *recency*
 * alone is the wrong signal: a healthy, acknowledged subscription on a quiet
 * contract can go well past FEED_FRESH_MS without a new print, and that is
 * not the same thing as a stale provider.
 */
function useOptionsFeedStatus(): OptionsFeedStatus {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const lastAt = getLastOptionQuoteAt();
  const subscriptionActive = getOptionsSubscriptionActive();
  const subscriptionSince = getOptionsSubscriptionActiveSince();

  if (!subscriptionActive) {
    // No live subscription up yet — fall back to raw recency so an
    // in-flight subscribe still reads LIVE if a REST-fallback quote already
    // landed, otherwise CONNECTING.
    if (lastAt != null && now - lastAt <= FEED_FRESH_MS) return 'LIVE';
    return 'CONNECTING';
  }
  if (lastAt != null) return 'LIVE';
  // Subscribed but no quote has arrived yet for this contract: only flag as
  // STALE once the acknowledged subscription has had a long, genuine chance
  // to deliver something and still hasn't.
  const sinceAge = subscriptionSince != null ? now - subscriptionSince : 0;
  return sinceAge > SUBSCRIBED_QUIET_GRACE_MS ? 'STALE' : 'CONNECTING';
}

/**
 * Equity feed status — driven ONLY by underlying-stock snapshot delivery +
 * dataMode. Never influences options components. This platform is snapshot-only
 * for equities by design (no equity WS entitlement), so a flowing snapshot
 * pipeline is the HEALTHY state and reads 'SNAPSHOT' — not 'UNAVAILABLE'.
 * 'UNAVAILABLE' is reserved for its literal meaning: no snapshot has ever
 * arrived, or the pipeline has genuinely stopped refreshing.
 */
function useEquityFeedStatus(): EquityFeedStatus {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const lastAt = getLastEquityQuoteAt();
  const dataMode = getLastEquityDataMode();
  if (lastAt == null) return 'UNAVAILABLE';
  const fresh = now - lastAt <= EQUITY_SNAPSHOT_GRACE_MS;
  if (!fresh) return 'UNAVAILABLE'; // snapshot pipeline genuinely stopped delivering
  if (dataMode === 'delayed') return 'DELAYED';
  if (dataMode === 'snapshot') return 'SNAPSHOT';
  return 'REALTIME';
}

/**
 * Chart feed status — the underlying-equity aggregate stream. Because equity
 * charts run on entitlement-limited (often last-session) snapshot data, the
 * candle *timestamp* is the wrong staleness signal — it can be hours/days old
 * by plan design while the snapshot pipeline is perfectly healthy. So STALE is
 * driven by DELIVERY freshness (did we stop receiving chart data / did the
 * fetch error), never by data age. Healthy snapshot delivery reads 'SNAPSHOT'.
 */
function useChartFeedStatus(marketClosed: boolean, chartErrored: boolean): {
  status: ChartFeedStatus;
  ageSeconds: number | null;
} {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const lastAt = getLastChartActivityAt();
  const mode = getLastChartMode();
  const ageSeconds = lastAt != null ? Math.max(0, Math.round((now - lastAt) / 1000)) : null;

  if (chartErrored) return { status: 'STALE', ageSeconds };
  if (lastAt == null) return { status: 'CONNECTING', ageSeconds: null };
  const age = now - lastAt;
  if (marketClosed) return { status: 'CLOSED', ageSeconds };
  if (age > CHART_STALE_MS) return { status: 'STALE', ageSeconds };
  if (mode === 'LIVE' && age <= FEED_FRESH_MS) return { status: 'LIVE', ageSeconds };
  return { status: 'SNAPSHOT', ageSeconds };
}

/**
 * AI Engine health — reachability of the AI service (the chat/analysis path
 * runs through the Python agent), polled independently. This is the operator
 * "can the AI run" signal. A single failed user chat NO LONGER latches the
 * global badge to ERROR (that failure surfaces inline in the chat); the badge
 * only reads ERROR when the AI service is actually unreachable.
 */
function useAiHealth(): 'ok' | 'down' {
  const [health, setHealth] = useState<'ok' | 'down'>('ok');
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const res = await http.get('/api/agent/health', { timeout: 6_000 });
        if (!cancelled) setHealth(res?.data?.agentReachable === false ? 'down' : 'ok');
      } catch {
        if (!cancelled) setHealth('down');
      }
    };
    void probe();
    const id = window.setInterval(probe, AI_HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);
  return health;
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
  chart: { status: ChartFeedStatus; ageSeconds: number | null };
  ai: AiStatus;
  automation: AutomationStatus;
};

export function useSystemStatus(opts?: { marketClosed?: boolean; chartErrored?: boolean }): SystemStatus {
  const backend = useBackendStatus();
  const socket = useSocketStatus();
  const optionsFeed = useOptionsFeedStatus();
  const equityFeed = useEquityFeedStatus();
  const chart = useChartFeedStatus(Boolean(opts?.marketClosed), Boolean(opts?.chartErrored));
  // The request-lifecycle signal (busy while a chat is in flight) is combined
  // with the independent service-reachability probe: BUSY during a request,
  // ERROR only when the AI service is actually down, otherwise READY.
  const aiActivity = useAiStatus();
  const aiHealth = useAiHealth();
  const ai: AiStatus = aiActivity === 'busy' ? 'busy' : aiHealth === 'down' ? 'error' : 'ready';
  const { visibility } = useAutomationVisibility();
  const automation = normalizeAutomationStatus((visibility?.engineStatus as any)?.automationState);

  return { backend, socket, optionsFeed, equityFeed, chart, ai, automation };
}
