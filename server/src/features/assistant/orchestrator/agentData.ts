import axios from 'axios';

// Thin client for the Python agent's deterministic /data endpoints
// (capitol trades, FRED release calendar, earnings). Failures degrade to
// { available: false } — the orchestrator reports the gap instead of failing.

const PYTHON_URL = process.env.AGENT_API_URL || process.env.FASTAPI_URL || process.env.PYTHON_URL || 'http://localhost:5001';
const DATA_TIMEOUT_MS = Math.max(2_000, Number(process.env.AGENT_DATA_TIMEOUT_MS ?? 10_000));

export type AgentDataResult = { available: boolean; data?: unknown; error?: string };

async function agentDataGet(path: string, params: Record<string, unknown>): Promise<AgentDataResult> {
  try {
    const { data } = await axios.get(`${PYTHON_URL}${path}`, { params, timeout: DATA_TIMEOUT_MS });
    if (data && typeof data.available === 'boolean') return data as AgentDataResult;
    return { available: true, data };
  } catch (error: any) {
    return { available: false, error: error?.message ?? 'agent data service unreachable' };
  }
}

const cache = new Map<string, { expiresAt: number; value: AgentDataResult }>();

async function cached(key: string, ttlMs: number, fetcher: () => Promise<AgentDataResult>): Promise<AgentDataResult> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await fetcher();
  // Only cache successful results — a transient outage should retry next call.
  if (value.available) cache.set(key, { expiresAt: Date.now() + ttlMs, value });
  return value;
}

export function getCapitolTrades(ticker?: string, limit = 10): Promise<AgentDataResult> {
  return cached(`congress:${ticker ?? 'all'}:${limit}`, 30 * 60_000, () =>
    agentDataGet('/data/capitol-trades', { ticker, limit })
  );
}

export function getFredCalendar(limit = 25): Promise<AgentDataResult> {
  return cached(`fred-calendar:${limit}`, 15 * 60_000, () => agentDataGet('/data/fred-calendar', { limit }));
}

export function getEarnings(ticker: string, limit = 8): Promise<AgentDataResult> {
  return cached(`earnings:${ticker}:${limit}`, 30 * 60_000, () =>
    agentDataGet('/data/earnings', { ticker, limit })
  );
}

export function resetAgentDataCacheForTests(): void {
  cache.clear();
}
