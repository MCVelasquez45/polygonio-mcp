import type { AutomationStrategyConfig } from '../automation.config';
import { REASON } from '../automation.config';
import type { RankedContract } from '../models/contractSelection.model';
import type { SignalDirection } from '../models/tradeCandidate.model';
import type { NormalizedChain, NormalizedChainContract } from './automationMarketData.service';

// Server-side deterministic contract selection — the AUTHORITY for automated
// trading. This ports the deterministic scoring that previously lived only in
// the React client (client/src/App.tsx scoreLeg: delta-target weight 4,
// spread ≤0.30 → +2 / ≤0.60 → +1, OI ≥500 → +2 / ≥200 → +1), extended with
// the Phase 2B hard filters and full per-contract rejection persistence.
//
// AI is NEVER involved here. The existing /api/analysis/contract-select AI
// ranking remains available for advisory display only and is not imported.

export type SelectionResult = {
  optionSide: 'call' | 'put';
  candidates: RankedContract[];
  selected: RankedContract | null;
  noSelectionReason: string | null;
  consideredCount: number;
  passedCount: number;
};

function computeDte(expiration: string | null, now: number): number | null {
  if (!expiration) return null;
  const expiry = Date.parse(`${expiration}T21:00:00Z`);
  if (Number.isNaN(expiry)) return null;
  return Math.ceil((expiry - now) / 86_400_000);
}

function scoreContract(
  contract: NormalizedChainContract,
  dte: number | null,
  spreadDollars: number | null,
  config: AutomationStrategyConfig
): { score: number; components: { delta: number; spread: number; liquidity: number; dte: number } } {
  // Delta closeness to target (weight 4) — ported from the client scoreLeg.
  const absDelta = contract.delta != null ? Math.abs(contract.delta) : null;
  const deltaComponent =
    absDelta != null ? Math.max(0, 1 - Math.abs(absDelta - config.contract.deltaTarget) / 0.4) * 4 : 0;
  // Spread tightness — ported thresholds.
  const spreadComponent =
    spreadDollars != null ? (spreadDollars <= 0.3 ? 2 : spreadDollars <= 0.6 ? 1 : 0) : 0;
  // Liquidity: OI thresholds ported; volume adds up to 1.
  const oi = contract.openInterest ?? 0;
  const volume = contract.volume ?? 0;
  const liquidityComponent = (oi >= 500 ? 2 : oi >= 200 ? 1 : 0) + (volume >= 1000 ? 1 : volume >= 250 ? 0.5 : 0);
  // DTE: prefer the middle of the configured window.
  const dteMid = (config.contract.dteMin + config.contract.dteMax) / 2;
  const dteHalfSpan = Math.max(1, (config.contract.dteMax - config.contract.dteMin) / 2);
  const dteComponent = dte != null ? Math.max(0, 1 - Math.abs(dte - dteMid) / dteHalfSpan) : 0;

  const components = {
    delta: Number(deltaComponent.toFixed(4)),
    spread: spreadComponent,
    liquidity: liquidityComponent,
    dte: Number(dteComponent.toFixed(4)),
  };
  return { score: Number((deltaComponent + spreadComponent + liquidityComponent + dteComponent).toFixed(4)), components };
}

/**
 * Deterministically rank contracts for a signal direction.
 * Bullish → calls only. Bearish → puts only. Every contract considered is
 * returned with its pass/fail verdict and full rejection reasons.
 */
export function selectContract(
  direction: SignalDirection,
  chain: NormalizedChain,
  config: AutomationStrategyConfig,
  now: number
): SelectionResult {
  const optionSide: 'call' | 'put' = direction === 'BULLISH' ? 'call' : 'put';
  const filters = config.contract;
  const considered = chain.contracts.filter(contract => contract.type === optionSide);

  const candidates: RankedContract[] = considered.map(contract => {
    const reasons: string[] = [];
    const dte = computeDte(contract.expiration, now);
    const bid = contract.bid;
    const ask = contract.ask;
    const mid = contract.mid ?? (bid != null && ask != null ? (bid + ask) / 2 : null);
    const spreadDollars = bid != null && ask != null ? Number((ask - bid).toFixed(4)) : null;
    const spreadPct =
      spreadDollars != null && mid != null && mid > 0 ? Number((spreadDollars / mid).toFixed(4)) : null;

    if (dte == null || dte < filters.dteMin || dte > filters.dteMax) reasons.push(REASON.DTE_OUT_OF_RANGE);
    if (contract.delta == null) {
      reasons.push(REASON.DELTA_MISSING);
    } else {
      const absDelta = Math.abs(contract.delta);
      if (absDelta < filters.deltaMin || absDelta > filters.deltaMax) reasons.push(REASON.DELTA_OUT_OF_RANGE);
    }
    if ((contract.openInterest ?? 0) < filters.minOpenInterest) reasons.push(REASON.OPEN_INTEREST_TOO_LOW);
    if ((contract.volume ?? 0) < filters.minDailyVolume) reasons.push(REASON.VOLUME_TOO_LOW);
    if (bid == null || bid <= 0) reasons.push(REASON.NON_POSITIVE_BID);
    if (ask == null || ask <= 0) reasons.push(REASON.NON_POSITIVE_ASK);
    if (bid != null && ask != null && ask < bid) reasons.push(REASON.ASK_BELOW_BID);
    if (spreadPct == null || spreadPct > filters.maxSpreadPct) reasons.push(REASON.SPREAD_TOO_WIDE);
    if (contract.quoteTimestamp == null || now - contract.quoteTimestamp > filters.quoteMaxAgeMs) {
      reasons.push(REASON.STALE_QUOTE);
    }
    if (contract.tradable === false) reasons.push(REASON.NOT_TRADABLE);

    const passed = reasons.length === 0;
    const { score, components } = scoreContract(contract, dte, spreadDollars, config);

    return {
      symbol: contract.symbol,
      type: contract.type,
      strike: contract.strike,
      expiration: contract.expiration,
      dte,
      bid,
      ask,
      mid,
      delta: contract.delta,
      iv: contract.iv,
      openInterest: contract.openInterest,
      volume: contract.volume,
      quoteTimestamp: contract.quoteTimestamp != null ? new Date(contract.quoteTimestamp) : null,
      spreadDollars,
      spreadPct,
      passed,
      rejectionReasons: reasons,
      score: passed ? score : null,
      scoreComponents: components,
    };
  });

  const passing = candidates
    .filter(candidate => candidate.passed)
    // Deterministic order: score desc, then symbol asc as an absolute tiebreak.
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.symbol.localeCompare(b.symbol));

  return {
    optionSide,
    candidates,
    selected: passing[0] ?? null,
    noSelectionReason: passing.length
      ? null
      : considered.length
        ? REASON.NO_CONTRACT_PASSED_FILTERS
        : REASON.EMPTY_OPTION_CHAIN,
    consideredCount: considered.length,
    passedCount: passing.length,
  };
}
