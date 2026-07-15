// Sprint 2D — deterministic options-native flow fixtures.
//
// Flow direction comes from DIFFERENCING cumulative day option volume between a
// baseline snapshot and a current snapshot of the SAME contract symbols. These
// builders produce (a) a strong, unambiguous directional flow and (b) a clean,
// deterministically-selectable winning contract on the active side.

import { FIXTURE_NOW } from './automation2b.fixtures.mjs';

export { FIXTURE_NOW };

// Six strikes per side. The 500 strike is the deterministic selection winner
// (delta exactly at the 0.6 target, deep liquidity, tight spread, 14 DTE).
const STRIKES = [500, 501, 502, 503, 504, 505];
const DELTAS = [0.6, 0.58, 0.62, 0.56, 0.64, 0.59];

function occ(symbol, side, strike) {
  const cp = side === 'call' ? 'C' : 'P';
  const strikeStr = String(strike * 1000).padStart(8, '0');
  return `${symbol}260724${cp}${strikeStr}`;
}

/**
 * Build one side of a chain at a given cumulative day-volume level.
 * `dayVolume` is the cumulative volume stamped on every contract (baseline vs
 * current differ only by this). `now` stamps the quote freshness.
 */
export function flowSide(side, { symbol = 'SPY', now = FIXTURE_NOW, dayVolume, quoteAgeMs = 30_000 } = {}) {
  const sign = side === 'call' ? 1 : -1;
  const contracts = STRIKES.map((strike, i) => ({
    symbol: occ(symbol, side, strike),
    type: side,
    strike,
    expiration: '2026-07-24', // 14 DTE from 2026-07-10
    bid: 1.1,
    ask: 1.2,
    mid: 1.15,
    delta: DELTAS[i] * sign,
    iv: 0.2,
    openInterest: 1000,
    volume: dayVolume,
    quoteTimestamp: now - quoteAgeMs,
    tradable: true,
  }));
  return { underlying: symbol, underlyingPrice: 500, fetchedAt: now - 10_000, contracts };
}

/** Baseline snapshot: equal, moderate cumulative volume on both sides. */
export function baselineChains({ symbol = 'SPY', now = FIXTURE_NOW, level = 1000 } = {}) {
  return {
    call: flowSide('call', { symbol, now, dayVolume: level }),
    put: flowSide('put', { symbol, now, dayVolume: level }),
  };
}

/**
 * Current snapshot. `call`/`put` are the per-contract cumulative volume at the
 * end of the window. Window volume = current − baseline (differenced per symbol).
 *   bullish:  call >> put   |   bearish: put >> call   |   balanced: equal
 */
export function currentChains({
  symbol = 'SPY',
  now = FIXTURE_NOW,
  call = 1000,
  put = 1000,
  quoteAgeMs = 30_000,
} = {}) {
  return {
    call: flowSide('call', { symbol, now, dayVolume: call, quoteAgeMs }),
    put: flowSide('put', { symbol, now, dayVolume: put, quoteAgeMs }),
  };
}
