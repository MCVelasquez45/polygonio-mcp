import {
  getStrategyConfig,
  getUniverseConfig,
  REASON,
  type AutomationStrategyConfig,
  type UniverseConfig,
} from '../automation.config';
import type { AutomationBar } from './indicatorAdapter.service';
import {
  fetchOptionChain,
  fetchUnderlyingBars,
  validateClosedBars,
  type BarValidation,
  type MarketDataHealth,
  type NormalizedChain,
  type NormalizedChainContract,
} from './automationMarketData.service';

// Phase 2.6 — Market Universe Service.
//
// The automation engine is symbol-agnostic: candidate underlyings come ONLY
// from configuration (AUTOMATION_UNDERLYINGS / session universe), never from
// source code. This service validates each configured symbol's market data
// deterministically and ranks the eligible ones. A symbol that fails any
// check is SKIPPED with recorded reason codes — one bad symbol never fails
// the whole evaluation.
//
// Pure assessment/ranking functions are separated from the I/O fetch wrapper
// so tests can drive them with fixtures.

export type SymbolChainSet = {
  call: NormalizedChain | null;
  put: NormalizedChain | null;
};

export type SymbolDataBundle = {
  symbol: string;
  bars: AutomationBar[];
  health: MarketDataHealth | null;
  chains: SymbolChainSet;
  /** Reason codes for fetch failures (bars/chain); never throws upward. */
  fetchFailureCodes: string[];
};

export type SideLiquiditySummary = {
  side: 'call' | 'put';
  contractCount: number;
  /** Contracts passing the spread/OI/volume/quote-freshness screen. */
  liquidCount: number;
  bestSpreadPct: number | null;
  totalOpenInterest: number;
  totalVolume: number;
  /** Pagination completeness of the requested window (null = unknown). */
  complete: boolean | null;
};

export type SymbolEligibility = {
  symbol: string;
  eligible: boolean;
  reasonCodes: string[];
  barSummary: {
    ok: boolean;
    barCount: number;
    closedBarTimestamp: number | null;
    reasonCodes: string[];
    underlyingAuthorized: boolean | null;
  };
  liquidity: { call: SideLiquiditySummary; put: SideLiquiditySummary } | null;
  /** Deterministic symbol-quality score (recorded even when ineligible). */
  score: number;
};

/** Resolve the effective universe for a session: session override → env. */
export function resolveUniverse(sessionUniverse?: string[] | null): UniverseConfig {
  if (Array.isArray(sessionUniverse) && sessionUniverse.length > 0) {
    return {
      symbols: sessionUniverse.map(symbol => symbol.toUpperCase()),
      invalidSymbols: [],
      source: 'AUTOMATION_UNDERLYINGS',
    };
  }
  return getUniverseConfig();
}

/**
 * Pure per-contract liquidity screen using the SAME thresholds the contract
 * selector enforces (config.contract): positive two-sided quote, acceptable
 * spread, minimum open interest, minimum daily volume, fresh quote.
 */
export function isLiquidContract(
  contract: NormalizedChainContract,
  config: AutomationStrategyConfig,
  now: number
): boolean {
  const { bid, ask, mid, openInterest, volume, quoteTimestamp } = contract;
  if (bid == null || bid <= 0 || ask == null || ask <= 0 || ask < bid) return false;
  const effectiveMid = mid ?? (bid + ask) / 2;
  if (!(effectiveMid > 0)) return false;
  const spreadPct = (ask - bid) / effectiveMid;
  if (spreadPct > config.contract.maxSpreadPct) return false;
  if ((openInterest ?? 0) < config.contract.minOpenInterest) return false;
  if ((volume ?? 0) < config.contract.minDailyVolume) return false;
  if (quoteTimestamp == null || now - quoteTimestamp > config.contract.quoteMaxAgeMs) return false;
  return contract.tradable !== false;
}

/** Pure per-side chain liquidity summary. */
export function summarizeChainSide(
  chain: NormalizedChain | null,
  side: 'call' | 'put',
  config: AutomationStrategyConfig,
  now: number
): SideLiquiditySummary {
  const contracts = (chain?.contracts ?? []).filter(contract => contract.type === side);
  let liquidCount = 0;
  let bestSpreadPct: number | null = null;
  let totalOpenInterest = 0;
  let totalVolume = 0;
  for (const contract of contracts) {
    totalOpenInterest += contract.openInterest ?? 0;
    totalVolume += contract.volume ?? 0;
    if (contract.bid != null && contract.ask != null && contract.bid > 0 && contract.ask >= contract.bid) {
      const mid = contract.mid ?? (contract.bid + contract.ask) / 2;
      if (mid > 0) {
        const spreadPct = Number(((contract.ask - contract.bid) / mid).toFixed(4));
        if (bestSpreadPct == null || spreadPct < bestSpreadPct) bestSpreadPct = spreadPct;
      }
    }
    if (isLiquidContract(contract, config, now)) liquidCount += 1;
  }
  return {
    side,
    contractCount: contracts.length,
    liquidCount,
    bestSpreadPct,
    totalOpenInterest,
    totalVolume,
    complete: chain?.completeness?.complete ?? null,
  };
}

/**
 * Deterministic symbol-quality score. Higher = better-ranked symbol. Inputs
 * are threshold buckets (never floating-point market noise) so identical
 * inputs always produce identical rankings.
 */
export function scoreSymbol(
  callSide: SideLiquiditySummary,
  putSide: SideLiquiditySummary,
  barSummaryOk: boolean
): number {
  const liquidCount = callSide.liquidCount + putSide.liquidCount;
  const bestSpread = [callSide.bestSpreadPct, putSide.bestSpreadPct]
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b)[0];
  const totalOi = callSide.totalOpenInterest + putSide.totalOpenInterest;
  const totalVolume = callSide.totalVolume + putSide.totalVolume;

  const liquidityComponent = Math.min(liquidCount, 20) * 0.1; // 0 – 2
  const spreadComponent =
    bestSpread == null ? 0 : bestSpread <= 0.02 ? 2 : bestSpread <= 0.05 ? 1.5 : bestSpread <= 0.1 ? 1 : 0;
  const oiComponent = totalOi >= 50_000 ? 2 : totalOi >= 10_000 ? 1.5 : totalOi >= 2_000 ? 1 : totalOi >= 500 ? 0.5 : 0;
  const volumeComponent =
    totalVolume >= 20_000 ? 2 : totalVolume >= 5_000 ? 1.5 : totalVolume >= 1_000 ? 1 : totalVolume >= 100 ? 0.5 : 0;
  const freshnessComponent = barSummaryOk ? 1 : 0;

  return Number(
    (liquidityComponent + spreadComponent + oiComponent + volumeComponent + freshnessComponent).toFixed(4)
  );
}

/**
 * Pure symbol validation verdict from already-fetched data. Every failed
 * check is recorded; the symbol is simply skipped, never thrown on.
 */
export function assessSymbol(
  bundle: SymbolDataBundle,
  config: AutomationStrategyConfig,
  now: number
): SymbolEligibility {
  const reasonCodes: string[] = [...bundle.fetchFailureCodes];

  // Underlying data: available, authorized, fresh, complete history.
  const validation: BarValidation = validateClosedBars(bundle.bars, config, now);
  if (!validation.ok) reasonCodes.push(...validation.reasonCodes);
  const underlyingAuthorized = bundle.health?.underlyingAuthorized ?? null;
  if (underlyingAuthorized === false) {
    reasonCodes.push(...(bundle.health?.underlyingReasonCodes ?? [REASON.UNDERLYING_DATA_UNAUTHORIZED]));
  }

  // Option chain: window completeness + at least one liquid contract.
  const callSide = summarizeChainSide(bundle.chains.call, 'call', config, now);
  const putSide = summarizeChainSide(bundle.chains.put, 'put', config, now);
  const chainsFetched = bundle.chains.call != null || bundle.chains.put != null;
  if (chainsFetched) {
    if (callSide.complete === false || putSide.complete === false) {
      reasonCodes.push(REASON.CHAIN_INCOMPLETE);
    }
    if (callSide.contractCount + putSide.contractCount === 0) {
      reasonCodes.push(REASON.EMPTY_OPTION_CHAIN);
    } else if (callSide.liquidCount + putSide.liquidCount === 0) {
      reasonCodes.push(REASON.SYMBOL_CHAIN_ILLIQUID);
    }
  } else if (!bundle.fetchFailureCodes.includes(REASON.SYMBOL_CHAIN_UNAVAILABLE)) {
    reasonCodes.push(REASON.SYMBOL_CHAIN_UNAVAILABLE);
  }

  const uniqueReasons = [...new Set(reasonCodes)];
  return {
    symbol: bundle.symbol,
    eligible: uniqueReasons.length === 0,
    reasonCodes: uniqueReasons,
    barSummary: {
      ok: validation.ok,
      barCount: validation.closedBars.length,
      closedBarTimestamp: validation.closedBar?.timestamp ?? null,
      reasonCodes: validation.reasonCodes,
      underlyingAuthorized,
    },
    liquidity: chainsFetched ? { call: callSide, put: putSide } : null,
    score: scoreSymbol(callSide, putSide, validation.ok),
  };
}

/**
 * Deterministic ranking of eligible symbols: score descending, then symbol
 * ascending as an absolute tiebreak. Ineligible symbols never rank.
 */
export function rankEligibleSymbols(eligibilities: SymbolEligibility[]): SymbolEligibility[] {
  return eligibilities
    .filter(entry => entry.eligible)
    .slice()
    .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
}

/**
 * I/O wrapper: fetch bars + both chain sides for one symbol. Every fetch is
 * individually guarded — failures become reason codes on the bundle so the
 * remaining universe keeps evaluating.
 */
export async function fetchSymbolData(symbol: string, now: number): Promise<SymbolDataBundle> {
  const config = getStrategyConfig(symbol);
  const bundle: SymbolDataBundle = {
    symbol,
    bars: [],
    health: null,
    chains: { call: null, put: null },
    fetchFailureCodes: [],
  };

  try {
    const { bars, health } = await fetchUnderlyingBars(config);
    bundle.bars = bars;
    bundle.health = health;
  } catch {
    bundle.fetchFailureCodes.push(REASON.SYMBOL_DATA_UNAVAILABLE);
    return bundle; // no price hint → chain fetch would be unbounded; skip it
  }

  const priceHint = bundle.bars.length ? bundle.bars[bundle.bars.length - 1].close : null;
  const [call, put] = await Promise.all([
    fetchOptionChain(config, 'BULLISH', priceHint, now).catch(() => null),
    fetchOptionChain(config, 'BEARISH', priceHint, now).catch(() => null),
  ]);
  bundle.chains = { call, put };
  if (call == null && put == null) bundle.fetchFailureCodes.push(REASON.SYMBOL_CHAIN_UNAVAILABLE);
  return bundle;
}
