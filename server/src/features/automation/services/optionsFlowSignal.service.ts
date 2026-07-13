import { REASON, type OptionsFlowConfig } from '../automation.config';
import type { NormalizedChain, NormalizedChainContract } from './automationMarketData.service';

// Phase 2C — the options-native deterministic signal engine.
//
// This replaces real-time STOCK momentum (which the Options Advanced plan does
// NOT authorize) with a signal derived ENTIRELY from authorized real-time
// OPTIONS data. It is a pure function of an already-aggregated flow window;
// the live builder (below) constructs that window from two authorized chain
// snapshots by differencing cumulative day volume — no stock data, no AI, no
// improvised direction. Balanced/stale/insufficient input → NO_TRADE.

export type SignalDirection3 = 'BULLISH' | 'BEARISH' | 'NO_TRADE';

/** Per-side aggregate over a completed observation window. */
export type SideFlow = {
  /** Contract volume traded within the window (Σ per-contract day-volume delta). */
  volume: number;
  /** Premium turned over within the window: Σ (windowVolume × mid × 100). */
  premium: number;
  /** Distinct contracts that showed activity in the window. */
  contracts: number;
  /** Volume-weighted mean IV across active contracts (null when unknown). */
  avgIv: number | null;
  /** Total open interest across the side (context only — never intraday flow). */
  openInterest: number;
  /** Distinct expirations represented. */
  expirations: number;
};

/** Normalized, already-aggregated flow window — the engine's only input. */
export type OptionsFlowWindow = {
  underlying: string;
  observationStart: number;
  observationEnd: number;
  /** Newest provider event timestamp contributing to the window (staleness gate). */
  newestEventTs: number | null;
  /** Whether the window's chain samples were pagination-complete. */
  complete: boolean;
  call: SideFlow;
  put: SideFlow;
  /** Call/put volume over the longer baseline window (for acceleration). */
  baselineCallVolume: number;
  baselinePutVolume: number;
};

/** The deterministic feature snapshot persisted with every signal. */
export type OptionsNativeFeatureSnapshot = {
  callPremium: number;
  putPremium: number;
  callToPutPremiumRatio: number | null;
  netDirectionalPremium: number;
  netPremiumTilt: number;
  callVolume: number;
  putVolume: number;
  volumeRatio: number | null;
  volumeAcceleration: number | null;
  callIv: number | null;
  putIv: number | null;
  ivSkew: number | null;
  callOpenInterest: number;
  putOpenInterest: number;
  contractsRepresented: number;
  expirationsRepresented: number;
  observationStart: string;
  observationEnd: string;
  newestEventTs: string | null;
  windowComplete: boolean;
};

export type OptionsNativeSignal = {
  direction: SignalDirection3;
  score: number;
  reasonCodes: string[];
  observationStart: string;
  observationEnd: string;
  featureSnapshot: OptionsNativeFeatureSnapshot;
  /** True when a reason code represents a hard data gate (→ DATA_REJECTED). */
  dataRejected: boolean;
};

function ratio(a: number, b: number): number | null {
  return b > 0 ? Number((a / b).toFixed(4)) : null;
}

const DATA_GATE_CODES = new Set<string>([
  REASON.OPTIONS_WINDOW_INCOMPLETE,
  REASON.OPTIONS_WINDOW_STALE,
  REASON.OPTIONS_WINDOW_INSUFFICIENT_VOLUME,
  REASON.OPTIONS_WINDOW_INSUFFICIENT_CONTRACTS,
]);

function buildFeatureSnapshot(window: OptionsFlowWindow): OptionsNativeFeatureSnapshot {
  const { call, put } = window;
  const totalPremium = call.premium + put.premium;
  const netDirectionalPremium = Number((call.premium - put.premium).toFixed(2));
  const netPremiumTilt = totalPremium > 0 ? Number((netDirectionalPremium / totalPremium).toFixed(4)) : 0;
  const baselineTotal = window.baselineCallVolume + window.baselinePutVolume;
  const windowTotal = call.volume + put.volume;
  // Acceleration: window volume vs baseline per-minute-equivalent. Baseline is
  // the longer window, so >1 means the recent window is busier than baseline.
  const volumeAcceleration = baselineTotal > 0 ? Number((windowTotal / baselineTotal).toFixed(4)) : null;

  return {
    callPremium: Number(call.premium.toFixed(2)),
    putPremium: Number(put.premium.toFixed(2)),
    callToPutPremiumRatio: ratio(call.premium, put.premium),
    netDirectionalPremium,
    netPremiumTilt,
    callVolume: call.volume,
    putVolume: put.volume,
    volumeRatio: ratio(call.volume, put.volume),
    volumeAcceleration,
    callIv: call.avgIv,
    putIv: put.avgIv,
    ivSkew: call.avgIv != null && put.avgIv != null ? Number((put.avgIv - call.avgIv).toFixed(4)) : null,
    callOpenInterest: call.openInterest,
    putOpenInterest: put.openInterest,
    contractsRepresented: call.contracts + put.contracts,
    expirationsRepresented: Math.max(call.expirations, put.expirations),
    observationStart: new Date(window.observationStart).toISOString(),
    observationEnd: new Date(window.observationEnd).toISOString(),
    newestEventTs: window.newestEventTs != null ? new Date(window.newestEventTs).toISOString() : null,
    windowComplete: window.complete,
  };
}

/**
 * Evaluate a completed options-flow window deterministically.
 *
 * Gate order (fail closed): completeness → freshness → sufficiency. Only then
 * is a direction computed from the net-premium tilt and call/put volume ratio.
 * A balanced or low-conviction window is NO_TRADE, never an improvised guess.
 */
export function evaluateOptionsFlow(
  window: OptionsFlowWindow,
  config: OptionsFlowConfig,
  now: number
): OptionsNativeSignal {
  const featureSnapshot = buildFeatureSnapshot(window);
  const reasonCodes: string[] = [];

  const noTrade = (codes: string[]): OptionsNativeSignal => ({
    direction: 'NO_TRADE',
    score: 0,
    reasonCodes: codes,
    observationStart: featureSnapshot.observationStart,
    observationEnd: featureSnapshot.observationEnd,
    featureSnapshot,
    dataRejected: codes.some(code => DATA_GATE_CODES.has(code)),
  });

  // ---- data gates ----------------------------------------------------------
  if (!window.complete) reasonCodes.push(REASON.OPTIONS_WINDOW_INCOMPLETE);
  if (window.newestEventTs == null || now - window.newestEventTs > config.windowFreshnessMaxAgeMs) {
    reasonCodes.push(REASON.OPTIONS_WINDOW_STALE);
  }
  const contractsRepresented = window.call.contracts + window.put.contracts;
  if (contractsRepresented < config.minContracts) {
    reasonCodes.push(REASON.OPTIONS_WINDOW_INSUFFICIENT_CONTRACTS);
  }
  const windowVolume = window.call.volume + window.put.volume;
  if (windowVolume < config.minWindowVolume) {
    reasonCodes.push(REASON.OPTIONS_WINDOW_INSUFFICIENT_VOLUME);
  }
  if (reasonCodes.length) return noTrade(reasonCodes);

  // ---- deterministic direction ---------------------------------------------
  const tilt = featureSnapshot.netPremiumTilt;
  const volumeRatio = featureSnapshot.volumeRatio;
  const bullish =
    tilt >= config.netPremiumTiltMin && volumeRatio != null && volumeRatio >= config.volumeRatioMin;
  const bearish =
    tilt <= -config.netPremiumTiltMin &&
    volumeRatio != null &&
    volumeRatio <= 1 / config.volumeRatioMin;

  if (!bullish && !bearish) {
    return noTrade([REASON.OPTIONS_FLOW_BALANCED]);
  }

  // Conviction score (0–1): normalized tilt (up to ±0.6) blended with the
  // volume-ratio strength. Deterministic; no AI input.
  const tiltStrength = Math.min(1, Math.abs(tilt) / 0.6);
  const ratioStrength = bullish
    ? Math.min(1, (volumeRatio! - 1) / 2)
    : Math.min(1, (1 / volumeRatio! - 1) / 2);
  const score = Number((0.6 * tiltStrength + 0.4 * ratioStrength).toFixed(4));

  if (score < config.minScore) {
    return {
      ...noTrade([REASON.OPTIONS_FLOW_BELOW_SCORE]),
      score,
    };
  }

  return {
    direction: bullish ? 'BULLISH' : 'BEARISH',
    score,
    reasonCodes: [],
    observationStart: featureSnapshot.observationStart,
    observationEnd: featureSnapshot.observationEnd,
    featureSnapshot,
    dataRejected: false,
  };
}

// ---------------------------------------------------------------------------
// Live window builder — pure over two authorized chain snapshots.
// ---------------------------------------------------------------------------

/** Minimal per-contract fields the builder needs from a chain snapshot. */
export type ChainFlowContract = Pick<
  NormalizedChainContract,
  'type' | 'mid' | 'bid' | 'ask' | 'iv' | 'openInterest' | 'volume' | 'expiration' | 'quoteTimestamp'
>;

function midOf(contract: ChainFlowContract): number | null {
  if (contract.mid != null && contract.mid > 0) return contract.mid;
  if (contract.bid != null && contract.ask != null && contract.bid > 0 && contract.ask >= contract.bid) {
    return (contract.bid + contract.ask) / 2;
  }
  return null;
}

function summarizeSide(
  current: ChainFlowContract[],
  baselineVolumeBySymbol: Map<string, number>,
  keyOf: (c: ChainFlowContract, i: number) => string
): SideFlow {
  let volume = 0;
  let premium = 0;
  let contracts = 0;
  let ivWeight = 0;
  let ivSum = 0;
  let openInterest = 0;
  const expirations = new Set<string>();
  current.forEach((contract, i) => {
    const dayVolume = contract.volume ?? 0;
    const baseline = baselineVolumeBySymbol.get(keyOf(contract, i)) ?? 0;
    // Window volume = cumulative day volume now − cumulative day volume at the
    // window's start. Clamp negatives (session rollover / snapshot resets).
    const windowVolume = Math.max(0, dayVolume - baseline);
    openInterest += contract.openInterest ?? 0;
    if (contract.expiration) expirations.add(contract.expiration);
    if (windowVolume <= 0) return;
    const mid = midOf(contract);
    contracts += 1;
    volume += windowVolume;
    if (mid != null) premium += windowVolume * mid * 100;
    if (contract.iv != null && Number.isFinite(contract.iv)) {
      ivWeight += windowVolume;
      ivSum += contract.iv * windowVolume;
    }
  });
  return {
    volume,
    premium: Number(premium.toFixed(2)),
    contracts,
    avgIv: ivWeight > 0 ? Number((ivSum / ivWeight).toFixed(4)) : null,
    openInterest,
    expirations: expirations.size,
  };
}

/**
 * Build a flow window from two authorized chain snapshots of the SAME symbol:
 * `baseline` sampled at the window start, `current` sampled at the window end.
 * Window volume/premium come from differencing cumulative day volume, so the
 * window reflects genuine intra-window options activity — not open interest,
 * not delayed underlying context.
 */
export function buildFlowWindowFromSnapshots(args: {
  underlying: string;
  baseline: NormalizedChain | null;
  current: NormalizedChain;
  observationStart: number;
  observationEnd: number;
  baselineWindow: NormalizedChain | null;
}): OptionsFlowWindow {
  const baselineVol = new Map<string, number>();
  for (const contract of args.baseline?.contracts ?? []) {
    baselineVol.set(contract.symbol, contract.volume ?? 0);
  }
  const keyOf = (c: any) => c.symbol as string;
  const calls = args.current.contracts.filter(c => c.type === 'call');
  const puts = args.current.contracts.filter(c => c.type === 'put');

  // Baseline-window volumes (for acceleration): total window-start-to-now day
  // volume over the LONGER baseline window snapshot, when available.
  const longBaselineVol = new Map<string, number>();
  for (const contract of args.baselineWindow?.contracts ?? []) {
    longBaselineVol.set(contract.symbol, contract.volume ?? 0);
  }
  const baseSummary = (side: NormalizedChainContract[]) =>
    side.reduce((sum, c) => sum + Math.max(0, (c.volume ?? 0) - (longBaselineVol.get(c.symbol) ?? 0)), 0);

  const newestEventTs = args.current.contracts.reduce<number | null>((max, c) => {
    if (c.quoteTimestamp == null) return max;
    return max == null || c.quoteTimestamp > max ? c.quoteTimestamp : max;
  }, null);

  return {
    underlying: args.underlying,
    observationStart: args.observationStart,
    observationEnd: args.observationEnd,
    newestEventTs,
    complete: args.current.completeness ? args.current.completeness.complete : true,
    call: summarizeSide(calls, baselineVol, keyOf),
    put: summarizeSide(puts, baselineVol, keyOf),
    baselineCallVolume: args.baselineWindow ? baseSummary(calls) : calls.reduce((s, c) => s + (c.volume ?? 0), 0),
    baselinePutVolume: args.baselineWindow ? baseSummary(puts) : puts.reduce((s, c) => s + (c.volume ?? 0), 0),
  };
}
