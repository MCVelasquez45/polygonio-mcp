import { resolveAggregates } from '../../market/services/aggregatesService';
import { getMassiveOptionsChain } from '../../../shared/data/massive';
import type { AutomationStrategyConfig } from '../automation.config';
import { REASON } from '../automation.config';
import type { AutomationBar } from './indicatorAdapter.service';

// Market-data access for the decision pipeline. REUSES the existing
// aggregates resolver (cache + fallback + health) and the existing Massive
// options-chain fetcher — nothing here talks to Massive directly except
// through those shared services.

export type BarValidation = {
  ok: boolean;
  reasonCodes: string[];
  closedBar: AutomationBar | null;
  closedBars: AutomationBar[];
};

export type MarketDataHealth = {
  source: 'live' | 'fixture';
  fetchedAt: string;
  barCount: number;
  resolverHealth?: Record<string, unknown> | null;
  resolverNote?: string | null;
};

export type NormalizedChainContract = {
  symbol: string;
  type: 'call' | 'put';
  strike: number | null;
  expiration: string | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  delta: number | null;
  iv: number | null;
  openInterest: number | null;
  volume: number | null;
  quoteTimestamp: number | null;
  tradable: boolean | null;
};

export type NormalizedChain = {
  underlying: string;
  underlyingPrice: number | null;
  fetchedAt: number;
  contracts: NormalizedChainContract[];
};

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Massive sip timestamps are nanoseconds; normalize.
    if (value > 1e17) return Math.floor(value / 1e6);
    if (value > 1e14) return Math.floor(value / 1e3);
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** Fetch recent 5-minute bars for the underlying via the shared resolver. */
export async function fetchUnderlyingBars(
  config: AutomationStrategyConfig
): Promise<{ bars: AutomationBar[]; health: MarketDataHealth }> {
  const window = Math.max(config.minBarHistory * 2, 80);
  const response: any = await resolveAggregates({
    ticker: config.underlying,
    multiplier: config.barTimeframeMinutes,
    timespan: 'minute',
    window,
  });
  const bars: AutomationBar[] = (response?.results ?? [])
    .map((entry: any) => {
      const ts = parseTimestamp(entry?.t);
      if (ts == null) return null;
      const open = Number(entry?.o);
      const high = Number(entry?.h);
      const low = Number(entry?.l);
      const close = Number(entry?.c);
      const volume = Number(entry?.v);
      if (![open, high, low, close, volume].every(Number.isFinite)) return null;
      return { timestamp: ts, open, high, low, close, volume };
    })
    .filter((bar: AutomationBar | null): bar is AutomationBar => bar != null)
    .sort((a: AutomationBar, b: AutomationBar) => a.timestamp - b.timestamp);

  return {
    bars,
    health: {
      source: 'live',
      fetchedAt: new Date().toISOString(),
      barCount: bars.length,
      resolverHealth: response?.health ?? null,
      resolverNote: response?.note ?? null,
    },
  };
}

/**
 * Deterministic closed-bar validation:
 *  - drops the still-forming bar (a bar is closed only when start+timeframe ≤ now),
 *  - requires freshness of the newest closed bar,
 *  - requires complete history,
 *  - requires continuity (gaps within a session are data holes; gaps larger
 *    than sessionGapMs are session boundaries and allowed).
 */
export function validateClosedBars(
  bars: AutomationBar[],
  config: AutomationStrategyConfig,
  now: number
): BarValidation {
  const timeframeMs = config.barTimeframeMinutes * 60_000;
  const reasonCodes: string[] = [];

  const closedBars = bars.filter(bar => bar.timestamp + timeframeMs <= now);
  if (!closedBars.length) {
    return { ok: false, reasonCodes: [REASON.NO_BARS], closedBar: null, closedBars: [] };
  }

  const closedBar = closedBars[closedBars.length - 1];
  const closeTime = closedBar.timestamp + timeframeMs;
  if (now - closeTime > config.barFreshnessMaxAgeMs) {
    reasonCodes.push(REASON.STALE_BAR);
  }
  if (closedBars.length < config.minBarHistory) {
    reasonCodes.push(REASON.INSUFFICIENT_BAR_HISTORY);
  } else {
    const lookback = closedBars.slice(-config.minBarHistory);
    for (let i = 1; i < lookback.length; i += 1) {
      const gap = lookback[i].timestamp - lookback[i - 1].timestamp;
      if (gap !== timeframeMs && gap <= config.sessionGapMs) {
        reasonCodes.push(REASON.BAR_GAP_DETECTED);
        break;
      }
    }
  }

  return { ok: reasonCodes.length === 0, reasonCodes, closedBar, closedBars };
}

/** Fetch + normalize the option chain via the shared Massive service. */
export async function fetchOptionChain(config: AutomationStrategyConfig): Promise<NormalizedChain> {
  const response: any = await getMassiveOptionsChain(config.underlying, 250);
  const fetchedAt = Date.now();
  const contracts: NormalizedChainContract[] = [];
  for (const group of response?.expirations ?? []) {
    for (const row of group?.strikes ?? []) {
      for (const side of ['call', 'put'] as const) {
        const leg = row?.[side];
        if (!leg?.ticker) continue;
        contracts.push(normalizeChainLeg(leg, side, fetchedAt));
      }
    }
  }
  return {
    underlying: config.underlying,
    underlyingPrice: Number.isFinite(Number(response?.underlyingPrice))
      ? Number(response.underlyingPrice)
      : null,
    fetchedAt,
    contracts,
  };
}

export function normalizeChainLeg(
  leg: any,
  side: 'call' | 'put',
  chainFetchedAt: number
): NormalizedChainContract {
  const quoteTs =
    parseTimestamp(leg?.lastQuote?.sip_timestamp ?? leg?.lastQuote?.timestamp) ??
    parseTimestamp(leg?.lastTrade?.sip_timestamp ?? leg?.lastTrade?.timestamp) ??
    // Chain snapshots don't always carry per-leg quote timestamps; the chain
    // fetch time is then the best available normalized quote timestamp.
    chainFetchedAt;
  return {
    symbol: String(leg.ticker).toUpperCase(),
    type: side,
    strike: Number.isFinite(Number(leg?.strike)) ? Number(leg.strike) : null,
    expiration: typeof leg?.expiration === 'string' ? leg.expiration : null,
    bid: Number.isFinite(Number(leg?.bid)) ? Number(leg.bid) : null,
    ask: Number.isFinite(Number(leg?.ask)) ? Number(leg.ask) : null,
    mid: Number.isFinite(Number(leg?.mid)) ? Number(leg.mid) : null,
    delta: Number.isFinite(Number(leg?.delta)) ? Number(leg.delta) : null,
    iv: Number.isFinite(Number(leg?.iv)) ? Number(leg.iv) : null,
    openInterest: Number.isFinite(Number(leg?.openInterest)) ? Number(leg.openInterest) : null,
    volume: Number.isFinite(Number(leg?.volume)) ? Number(leg.volume) : null,
    quoteTimestamp: quoteTs,
    tradable: typeof leg?.tradable === 'boolean' ? leg.tradable : null,
  };
}
