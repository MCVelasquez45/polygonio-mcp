import { resolveAggregates } from '../../market/services/aggregatesService';
import { getMassiveOptionQuoteSnapshot } from '../../../shared/data/massive';
import { getAutomationChain } from '../../marketData/optionsMarketDataOrchestrator.service';
import type { ChainCompleteness, UnderlyingContext } from '../../marketData/optionsData.types';
import type { AutomationStrategyConfig } from '../automation.config';
import { getStrategyConfig, REASON } from '../automation.config';
import type { AutomationBar } from './indicatorAdapter.service';
import type { SignalDirection } from '../models/tradeCandidate.model';

// Market-data access for the decision pipeline. REUSES the existing
// aggregates resolver (cache + fallback + health) and the shared Options
// Market Data Orchestrator — nothing here talks to Massive directly except
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
  /**
   * Whether the bars are authorized, real-time intraday data. Under the
   * Options Advanced plan real-time stock intraday is NOT included; when the
   * resolver served fallback/delayed/cached data these reason codes gate the
   * pipeline closed (DATA_REJECTED) before any strategy evaluation.
   */
  underlyingAuthorized?: boolean;
  underlyingReasonCodes?: string[];
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
  /** Pagination-completeness for the requested DTE window (absent on fixtures). */
  completeness?: ChainCompleteness | null;
  /** Delayed underlying context from the options snapshot (labeled, never real-time). */
  underlyingContext?: UnderlyingContext | null;
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

/**
 * Pure authorization gate for underlying bars: the strategy requires CURRENT,
 * authorized, intraday data. Reason codes are returned (empty = authorized):
 *  - the provider plan blocked intraday (entitlement) → UNDERLYING_DATA_UNAUTHORIZED
 *  - the resolver degraded to daily/cache/snapshot fallback (e.g. previous
 *    close) while the market is open → UNDERLYING_DATA_NOT_REALTIME
 * Previous-close or delayed data can never satisfy a real-time gate.
 */
export function assessUnderlyingAuthorization(response: {
  intradayEntitlement?: string;
  resultGranularity?: string;
  marketClosed?: boolean;
  health?: { mode?: string; source?: string } | null;
}): string[] {
  const reasonCodes: string[] = [];
  if (response?.intradayEntitlement === 'blocked') {
    reasonCodes.push(REASON.UNDERLYING_DATA_UNAUTHORIZED);
  }
  const resolverMode = response?.health?.mode;
  const source = response?.health?.source;
  const granularity = response?.resultGranularity;
  if (
    granularity !== 'intraday' ||
    source === 'snapshot' ||
    (resolverMode !== 'LIVE' && response?.marketClosed !== true)
  ) {
    reasonCodes.push(REASON.UNDERLYING_DATA_NOT_REALTIME);
  }
  return reasonCodes;
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

  const underlyingReasonCodes = assessUnderlyingAuthorization(response);

  return {
    bars,
    health: {
      source: 'live',
      fetchedAt: new Date().toISOString(),
      barCount: bars.length,
      resolverHealth: response?.health ?? null,
      resolverNote: response?.note ?? null,
      underlyingAuthorized: underlyingReasonCodes.length === 0,
      underlyingReasonCodes,
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

/**
 * Fetch + normalize the option chain via the shared Options Market Data
 * Orchestrator: a direction-specific window covering exactly the configured
 * 7–21 DTE range (calls for bullish, puts for bearish), strike-bounded around
 * the underlying when known. One orchestrated fetch is shared by every
 * concurrent consumer of the same window.
 */
export async function fetchOptionChain(
  config: AutomationStrategyConfig,
  direction: SignalDirection,
  underlyingPriceHint?: number | null,
  now?: number
): Promise<NormalizedChain> {
  const response = await getAutomationChain({
    underlying: config.underlying,
    direction,
    dteMin: config.contract.dteMin,
    dteMax: config.contract.dteMax,
    underlyingPriceHint: underlyingPriceHint ?? null,
    now,
  });
  const fetchedAt = Date.now();
  const contracts: NormalizedChainContract[] = [];
  for (const group of response?.expirations ?? []) {
    for (const row of group?.strikes ?? []) {
      for (const side of ['call', 'put'] as const) {
        const leg = (row as any)?.[side];
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
    completeness: response.completeness,
    underlyingContext: response.underlyingContext,
  };
}

/** Parsed underlying root of an OCC option symbol (O:SPY260724P00756000 → SPY). */
export function underlyingFromOccSymbol(optionSymbol: string): string {
  const bare = optionSymbol.toUpperCase().replace(/^O:/, '');
  const m = bare.match(/^([A-Z]+)\d{6}[CP]\d{8}$/);
  return m ? m[1] : bare;
}

/**
 * Pure mark-freshness decision. A mark is stale when: there is no usable mark,
 * the provider gave no quote timestamp (we refuse to trust an untimed quote), or
 * the quote's age (from ITS OWN provider timestamp, never the request cadence)
 * exceeds the threshold. This is the single source of truth for staleness so a
 * slow paginated fetch cannot fake freshness and an old quote cannot look fresh.
 */
export function isMarkStale(
  params: { mark: number | null; providerQuoteTimestamp: number | null; computedAgeMs: number | null },
  thresholdMs: number
): boolean {
  const hasMark = params.mark != null && Number.isFinite(params.mark) && params.mark > 0;
  if (!hasMark) return true;
  if (params.providerQuoteTimestamp == null) return true;
  if (params.computedAgeMs != null && params.computedAgeMs > thresholdMs) return true;
  return false;
}

export type HeldContractMarkResult = {
  mark: number | null;
  providerQuoteTimestamp: number | null;
  fetchStartedAt: number;
  fetchCompletedAt: number;
  computedAgeMs: number | null;
  source: 'contract-snapshot' | 'chain-fallback' | 'none';
  cacheStatus: 'LIVE' | 'FALLBACK' | 'NONE';
};

/**
 * Targeted held-contract mark for the monitoring path. Uses the NARROWEST
 * authorized request — a single direct option-contract snapshot by OCC symbol
 * (one request, routed through the shared request manager with OPEN_POSITION
 * priority + dedup + cache), NOT a full-chain download. The mark's freshness is
 * derived from the contract's OWN provider quote timestamp, never the fetch
 * start/finish, so a slow request cannot fake staleness and a stale quote cannot
 * look fresh. Full-chain fetch is a guarded last-resort fallback only.
 */
export async function fetchHeldContractMark(
  optionSymbol: string,
  now: number = Date.now()
): Promise<HeldContractMarkResult> {
  const symbol = optionSymbol.toUpperCase();
  const underlying = underlyingFromOccSymbol(symbol);
  const fetchStartedAt = now;

  const midFrom = (bid: number | null, ask: number | null, mid: number | null): number | null => {
    if (mid != null && mid > 0) return mid;
    if (bid != null && ask != null && bid > 0 && ask >= bid) return Number(((bid + ask) / 2).toFixed(4));
    return null;
  };

  try {
    const quote = await getMassiveOptionQuoteSnapshot(underlying, symbol);
    const fetchCompletedAt = Date.now();
    const mark = midFrom(quote.bid, quote.ask, quote.mid);
    return {
      mark: mark != null && mark > 0 ? mark : null,
      providerQuoteTimestamp: quote.quoteTimestamp,
      fetchStartedAt,
      fetchCompletedAt,
      computedAgeMs: quote.quoteTimestamp != null ? fetchCompletedAt - quote.quoteTimestamp : null,
      source: 'contract-snapshot',
      cacheStatus: 'LIVE',
    };
  } catch {
    // Guarded fallback: a single chain read (still one orchestrated fetch), only
    // when the direct snapshot is unavailable. Never the default hot path.
    try {
      const config = getStrategyConfig(underlying);
      const direction: SignalDirection = symbol.replace(/^O:/, '').match(/\d{6}P\d{8}$/)
        ? 'BEARISH'
        : 'BULLISH';
      const chain = await fetchOptionChain(config, direction, null, now);
      const contract = chain.contracts.find(c => c.symbol === symbol);
      const fetchCompletedAt = Date.now();
      const mark = contract ? midFrom(contract.bid, contract.ask, contract.mid) : null;
      return {
        mark: mark != null && mark > 0 ? mark : null,
        providerQuoteTimestamp: contract?.quoteTimestamp ?? null,
        fetchStartedAt,
        fetchCompletedAt,
        computedAgeMs:
          contract?.quoteTimestamp != null ? fetchCompletedAt - contract.quoteTimestamp : null,
        source: 'chain-fallback',
        cacheStatus: 'FALLBACK',
      };
    } catch {
      return {
        mark: null,
        providerQuoteTimestamp: null,
        fetchStartedAt,
        fetchCompletedAt: Date.now(),
        computedAgeMs: null,
        source: 'none',
        cacheStatus: 'NONE',
      };
    }
  }
}

export function normalizeChainLeg(
  leg: any,
  side: 'call' | 'put',
  chainFetchedAt: number
): NormalizedChainContract {
  const quoteTs =
    parseTimestamp(leg?.lastQuote?.sip_timestamp ?? leg?.lastQuote?.timestamp) ??
    // v3 snapshot legs carry the provider quote time as last_quote.last_updated.
    parseTimestamp(leg?.snapshot?.last_quote?.last_updated) ??
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
