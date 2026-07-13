// Deterministic Phase 2B fixtures. All timestamps are fixed constants aligned
// with the mock broker clock (2026-07-10T15:00Z = 11:00 ET, market open).

export const FIXTURE_NOW = Date.parse('2026-07-10T15:00:00.000Z');
export const BAR_MS = 5 * 60_000;
/** Exchange trading date matching the mock broker clock. */
export const FIXTURE_TRADING_DATE = '2026-07-10';

/**
 * Build a deterministic 5-minute bar series ending with a bar that CLOSED at
 * FIXTURE_NOW - 5min (i.e., fresh). Patterns:
 *  - bullish: gentle up-drift (+0.30 / −0.22 alternating) + strong final bar
 *  - bearish: mirrored down-drift + weak final bar
 *  - overbought: straight up every bar (RSI → 100, out of both RSI windows)
 */
export function buildBars(kind, { count = 40, now = FIXTURE_NOW } = {}) {
  const lastStart = now - BAR_MS - 10_000 > now - 2 * BAR_MS ? now - 2 * BAR_MS + 0 : now - 2 * BAR_MS;
  // Bars start at fixed 5-min grid; last bar starts now-10min, closes now-5min.
  const firstStart = now - (count + 1) * BAR_MS;
  const bars = [];
  let close = 500;
  for (let i = 0; i < count; i += 1) {
    let delta;
    if (kind === 'bullish') delta = i === count - 1 ? 0.6 : i % 2 === 0 ? 0.3 : -0.22;
    // 'mixed' shares the bearish price shape but fails on volume (below) —
    // so the bearish leg fails volume and the bullish leg fails price/trend:
    // deterministically NO_TRADE, never a directional signal.
    else if (kind === 'bearish' || kind === 'mixed')
      delta = i === count - 1 ? -0.6 : i % 2 === 0 ? -0.3 : 0.22;
    else if (kind === 'overbought') delta = 0.4;
    else delta = i % 2 === 0 ? 0.3 : -0.3;
    const open = close;
    close = Number((close + delta).toFixed(4));
    const high = Math.max(open, close) + 0.1;
    const low = Math.min(open, close) - 0.1;
    // Mixed: final-bar volume BELOW the rolling average → volume condition
    // fails for both directions.
    const volume = i === count - 1 ? (kind === 'mixed' ? 800 : 2500) : 1000;
    bars.push({ timestamp: firstStart + i * BAR_MS, open, high, low, close, volume });
  }
  void lastStart;
  return bars;
}

/** One contract spec → normalized chain contract. */
export function contract(overrides = {}) {
  return {
    symbol: overrides.symbol ?? 'SPY260724C00500000',
    type: overrides.type ?? 'call',
    strike: overrides.strike ?? 500,
    expiration: overrides.expiration ?? '2026-07-24', // 14 DTE from 2026-07-10
    bid: overrides.bid ?? 1.1,
    ask: overrides.ask ?? 1.2,
    mid: overrides.mid ?? (overrides.bid != null && overrides.ask != null ? (overrides.bid + overrides.ask) / 2 : 1.15),
    delta: overrides.delta ?? 0.6,
    iv: overrides.iv ?? 0.2,
    openInterest: overrides.openInterest ?? 1000,
    volume: overrides.volume ?? 500,
    quoteTimestamp: overrides.quoteTimestamp ?? FIXTURE_NOW - 30_000,
    tradable: overrides.tradable ?? true,
  };
}

/**
 * Chain with one clean winner plus one reject per filter dimension.
 * side: 'call' | 'put'. Put deltas are negative (abs() is filtered).
 * Phase 2.6: `symbol` parameterizes the underlying — the SAME builder serves
 * every configured universe symbol (defaults keep the 2B call sites working).
 */
export function buildChain(side, { now = FIXTURE_NOW, symbol = 'SPY', winnerDelta = 0.6 } = {}) {
  const sign = side === 'call' ? 1 : -1;
  const sym = (tag) => `${symbol}260724${side === 'call' ? 'C' : 'P'}00${tag}000`;
  return {
    underlying: symbol,
    underlyingPrice: 500,
    fetchedAt: now - 10_000,
    contracts: [
      // the deterministic winner
      contract({ symbol: sym('500'), type: side, strike: 500, delta: winnerDelta * sign }),
      // near-miss good contract (worse delta) — should rank second
      contract({ symbol: sym('505'), type: side, strike: 505, delta: 0.56 * sign }),
      // rejects — one per filter
      contract({ symbol: sym('510'), type: side, strike: 510, bid: 1.0, ask: 1.5, mid: 1.25 }), // spread 0.5/1.25=40%
      contract({ symbol: sym('515'), type: side, strike: 515, quoteTimestamp: now - 10 * 60_000 }), // stale quote
      contract({ symbol: sym('520'), type: side, strike: 520, openInterest: 50 }), // low OI
      contract({ symbol: sym('525'), type: side, strike: 525, volume: 5 }), // low volume
      contract({ symbol: sym('530'), type: side, strike: 530, expiration: '2026-07-13' }), // 3 DTE
      contract({ symbol: sym('535'), type: side, strike: 535, delta: 0.2 * sign }), // delta out
      contract({ symbol: sym('540'), type: side, strike: 540, bid: 0, ask: 0 }), // non-positive quote
      // opposite side contract that must be ignored entirely
      contract({
        symbol: `${symbol}260724${side === 'call' ? 'P' : 'C'}00500000`,
        type: side === 'call' ? 'put' : 'call',
        delta: -0.6 * sign,
      }),
    ],
  };
}

/** Chain where nothing passes (all wide spreads). */
export function buildAllRejectChain(side, { now = FIXTURE_NOW, symbol = 'SPY' } = {}) {
  return {
    underlying: symbol,
    underlyingPrice: 500,
    fetchedAt: now - 10_000,
    contracts: [
      contract({ symbol: `${symbol}260724C00500000`, type: side, bid: 0.5, ask: 1.5, mid: 1.0 }),
      contract({ symbol: `${symbol}260724C00505000`, type: side, strike: 505, bid: 0.4, ask: 1.4, mid: 0.9 }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Phase 2.6 — universe fixtures. Symbols here are TEST DATA, chosen by each
// test; nothing in automation source references them.
// ---------------------------------------------------------------------------

/**
 * One universe symbol entry for a UniverseTickFixture. `kind` is the bar
 * pattern ('bullish' | 'bearish' | 'mixed' | ...); options tune the chain:
 *   { winnerDelta, incompleteChain, illiquidChain, failFetch }
 */
export function universeSymbol(symbol, kind, options = {}) {
  const { now = FIXTURE_NOW, winnerDelta = 0.6, incompleteChain = false, illiquidChain = false, failFetch = false } = options;
  if (failFetch) return { bars: [], chains: { call: null, put: null }, failFetch: true };
  const build = (side) =>
    illiquidChain ? buildAllRejectChain(side, { now, symbol }) : buildChain(side, { now, symbol, winnerDelta });
  const withCompleteness = (chain) =>
    incompleteChain ? { ...chain, completeness: { complete: false, pagesFetched: 1, truncated: true } } : chain;
  return {
    bars: buildBars(kind, { now }),
    chains: { call: withCompleteness(build('call')), put: withCompleteness(build('put')) },
  };
}

/**
 * Build a UniverseTickFixture from { SYMBOL: kindOrSpec } where kindOrSpec is
 * either a bar-pattern string or { kind, ...options }.
 */
export function universeFixtureFor(spec, { now = FIXTURE_NOW, account = FIXTURE_ACCOUNT } = {}) {
  const symbols = {};
  for (const [symbol, kindOrSpec] of Object.entries(spec)) {
    const { kind, ...options } = typeof kindOrSpec === 'string' ? { kind: kindOrSpec } : kindOrSpec;
    symbols[symbol] = universeSymbol(symbol, kind, { now, ...options });
  }
  return { universe: Object.keys(spec), symbols, account, now };
}

export const FIXTURE_ACCOUNT = { equity: 100_000, buyingPower: 50_000 };

export function fixtureFor(kind, side, { account = FIXTURE_ACCOUNT, now = FIXTURE_NOW, chain } = {}) {
  return {
    bars: buildBars(kind, { now }),
    chain: chain ?? buildChain(side, { now }),
    account,
    now,
  };
}

/** Session overrides so no daily reset fires mid-test (same trading day). */
export function noResetSessionFields() {
  return {
    reconciliationStatus: 'CLEAN',
    lastResetTradingDate: FIXTURE_TRADING_DATE,
    startingDayEquity: FIXTURE_ACCOUNT.equity,
    dailyLossBudget: FIXTURE_ACCOUNT.equity * 0.0075,
  };
}
