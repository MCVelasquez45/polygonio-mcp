// Phase 2B strategy configuration. All thresholds are configurable via env
// with the documented defaults below. A resolved snapshot of this config is
// persisted onto every trade candidate so decisions are reproducible.
//
// Phase 2.6: the strategy is symbol-agnostic. The underlying is ALWAYS
// supplied by the caller (session or universe evaluation) — no ticker symbol
// is hardcoded anywhere in automation source.

export type AutomationStrategyConfig = {
  strategyKey: 'momentum-5m-v1';
  underlying: string;
  barTimeframeMinutes: number;
  /** Bars required before any evaluation (indicator warm-up + continuity). */
  minBarHistory: number;
  /** Max age of the newest CLOSED bar before data is considered stale. */
  barFreshnessMaxAgeMs: number;
  /** Gap larger than this is treated as a session boundary, not a data hole. */
  sessionGapMs: number;
  indicators: {
    emaFast: number;
    emaSlow: number;
    rsiPeriod: number;
    atrPeriod: number;
    volumeAvgWindow: number;
  };
  bullish: { rsiMin: number; rsiMax: number };
  bearish: { rsiMin: number; rsiMax: number };
  /** Bar volume must exceed volumeMultiple × rolling average. */
  volumeMultiple: number;
  contract: {
    dteMin: number;
    dteMax: number;
    deltaMin: number;
    deltaMax: number;
    minOpenInterest: number;
    minDailyVolume: number;
    /** Spread as a fraction of mid (0.10 = 10%). */
    maxSpreadPct: number;
    quoteMaxAgeMs: number;
    /** Deterministic scoring target for |delta|. */
    deltaTarget: number;
  };
  risk: {
    riskPerTradePct: number; // of account equity
    maxDailyLossPct: number; // of starting-day equity
    maxDrawdownPct: number; // of starting-day equity, session lifetime
    maxConcurrentPositions: number;
    maxTradesPerDay: number;
    consecutiveLossPause: number;
    /** Planned stop loss as a fraction of premium (long options). */
    stopLossPct: number;
    /** Cap: position cost may not exceed this fraction of equity. */
    maxPositionCostPct: number;
  };
};

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * Resolve the active strategy configuration (env overrides + defaults) for a
 * specific underlying. When no underlying is passed, the first configured
 * universe symbol is used; with no configuration at all, underlying is ''
 * and every data gate fails closed. NO ticker is hardcoded here.
 */
export function getStrategyConfig(underlying?: string): AutomationStrategyConfig {
  const resolved = underlying?.trim() || getUniverseConfig().symbols[0] || '';
  return {
    strategyKey: 'momentum-5m-v1',
    underlying: resolved.toUpperCase(),
    barTimeframeMinutes: 5,
    minBarHistory: envNumber('AUTOMATION_MIN_BAR_HISTORY', 30),
    barFreshnessMaxAgeMs: envNumber('AUTOMATION_BAR_FRESHNESS_MS', 10 * 60_000),
    sessionGapMs: envNumber('AUTOMATION_SESSION_GAP_MS', 3 * 60 * 60_000),
    indicators: {
      emaFast: envNumber('AUTOMATION_EMA_FAST', 9),
      emaSlow: envNumber('AUTOMATION_EMA_SLOW', 21),
      rsiPeriod: envNumber('AUTOMATION_RSI_PERIOD', 14),
      atrPeriod: envNumber('AUTOMATION_ATR_PERIOD', 14),
      volumeAvgWindow: envNumber('AUTOMATION_VOLUME_AVG_WINDOW', 20),
    },
    bullish: {
      rsiMin: envNumber('AUTOMATION_BULL_RSI_MIN', 50),
      rsiMax: envNumber('AUTOMATION_BULL_RSI_MAX', 70),
    },
    bearish: {
      rsiMin: envNumber('AUTOMATION_BEAR_RSI_MIN', 30),
      rsiMax: envNumber('AUTOMATION_BEAR_RSI_MAX', 50),
    },
    volumeMultiple: envNumber('AUTOMATION_VOLUME_MULTIPLE', 1.0),
    contract: {
      dteMin: envNumber('AUTOMATION_DTE_MIN', 7),
      dteMax: envNumber('AUTOMATION_DTE_MAX', 21),
      deltaMin: envNumber('AUTOMATION_DELTA_MIN', 0.55),
      deltaMax: envNumber('AUTOMATION_DELTA_MAX', 0.7),
      minOpenInterest: envNumber('AUTOMATION_MIN_OPEN_INTEREST', 500),
      minDailyVolume: envNumber('AUTOMATION_MIN_DAILY_VOLUME', 100),
      maxSpreadPct: envNumber('AUTOMATION_MAX_SPREAD_PCT', 0.1),
      quoteMaxAgeMs: envNumber('AUTOMATION_QUOTE_MAX_AGE_MS', 2 * 60_000),
      deltaTarget: envNumber('AUTOMATION_DELTA_TARGET', 0.6),
    },
    risk: {
      riskPerTradePct: envNumber('AUTOMATION_RISK_PER_TRADE_PCT', 0.0025),
      maxDailyLossPct: envNumber('AUTOMATION_MAX_DAILY_LOSS_PCT', 0.0075),
      maxDrawdownPct: envNumber('AUTOMATION_MAX_DRAWDOWN_PCT', 0.02),
      maxConcurrentPositions: envNumber('AUTOMATION_MAX_CONCURRENT_POSITIONS', 1),
      maxTradesPerDay: envNumber('AUTOMATION_MAX_TRADES_PER_DAY', 2),
      consecutiveLossPause: envNumber('AUTOMATION_CONSECUTIVE_LOSS_PAUSE', 2),
      stopLossPct: envNumber('AUTOMATION_STOP_LOSS_PCT', 0.5),
      maxPositionCostPct: envNumber('AUTOMATION_MAX_POSITION_COST_PCT', 0.05),
    },
  };
}

// ---------------------------------------------------------------------------
// Phase 2C — live paper execution configuration
// ---------------------------------------------------------------------------

function envString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw == null || raw.trim() === '' ? fallback : raw.trim();
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export type SignalMode = 'OPTIONS_NATIVE_FLOW' | 'EQUITY_MOMENTUM';

/** Active signal engine. OPTIONS_NATIVE_FLOW is the authorized-data default. */
export function getSignalMode(): SignalMode {
  const raw = envString('AUTOMATION_SIGNAL_MODE', 'OPTIONS_NATIVE_FLOW').toUpperCase();
  return raw === 'EQUITY_MOMENTUM' ? 'EQUITY_MOMENTUM' : 'OPTIONS_NATIVE_FLOW';
}

export type OptionsFlowConfig = {
  /** Completed flow window that carries the directional read (minutes). */
  flowWindowMinutes: number;
  /** Longer baseline window the flow window is compared against (minutes). */
  baselineWindowMinutes: number;
  /** Max age of the newest window event before the window is stale (ms). */
  windowFreshnessMaxAgeMs: number;
  /** Minimum option contracts represented before a window is evaluable. */
  minContracts: number;
  /** Minimum total option volume in the flow window before it is evaluable. */
  minWindowVolume: number;
  /** Net-premium tilt (call$−put$)/(call$+put$) beyond ±this → directional. */
  netPremiumTiltMin: number;
  /** Call/put volume ratio ≥ this (bullish) or ≤ 1/this (bearish). */
  volumeRatioMin: number;
  /** Score threshold (0–1) below which a tilt is NO_TRADE. */
  minScore: number;
};

export function getOptionsFlowConfig(): OptionsFlowConfig {
  return {
    flowWindowMinutes: envNumber('AUTOMATION_OPTIONS_FLOW_WINDOW_MINUTES', 5),
    baselineWindowMinutes: envNumber('AUTOMATION_OPTIONS_BASELINE_WINDOW_MINUTES', 30),
    windowFreshnessMaxAgeMs: envNumber('AUTOMATION_OPTIONS_WINDOW_FRESHNESS_MS', 3 * 60_000),
    minContracts: envNumber('AUTOMATION_OPTIONS_MIN_CONTRACTS', 5),
    minWindowVolume: envNumber('AUTOMATION_OPTIONS_MIN_WINDOW_VOLUME', 250),
    netPremiumTiltMin: envNumber('AUTOMATION_OPTIONS_NET_PREMIUM_TILT_MIN', 0.2),
    volumeRatioMin: envNumber('AUTOMATION_OPTIONS_VOLUME_RATIO_MIN', 1.5),
    minScore: envNumber('AUTOMATION_OPTIONS_MIN_SCORE', 0.5),
  };
}

export type MarketHoursConfig = {
  finalEntryMinutesBeforeClose: number;
  cancelEntryOrdersMinutesBeforeClose: number;
  flattenMinutesBeforeClose: number;
};

export function getMarketHoursConfig(): MarketHoursConfig {
  return {
    finalEntryMinutesBeforeClose: envNumber('AUTOMATION_FINAL_ENTRY_MINUTES_BEFORE_CLOSE', 45),
    cancelEntryOrdersMinutesBeforeClose: envNumber('AUTOMATION_CANCEL_ENTRY_ORDERS_MINUTES_BEFORE_CLOSE', 20),
    flattenMinutesBeforeClose: envNumber('AUTOMATION_FLATTEN_MINUTES_BEFORE_CLOSE', 15),
  };
}

export type ExecutionConfig = {
  /** Deterministic limit-price policy for option entries. */
  entryLimitPolicy: 'MID' | 'ASK' | 'BID';
  /** Max slippage from mid tolerated when marketable (fraction of mid). */
  entryMaxSlippagePct: number;
  /** Seconds an unfilled entry may rest before reconcile/replace/cancel. */
  entryOrderTimeoutSeconds: number;
};

export function getExecutionConfig(): ExecutionConfig {
  const policy = envString('AUTOMATION_ENTRY_LIMIT_POLICY', 'MID').toUpperCase();
  return {
    entryLimitPolicy: policy === 'ASK' ? 'ASK' : policy === 'BID' ? 'BID' : 'MID',
    entryMaxSlippagePct: envNumber('AUTOMATION_ENTRY_MAX_SLIPPAGE_PCT', 0.05),
    entryOrderTimeoutSeconds: envNumber('AUTOMATION_ENTRY_ORDER_TIMEOUT_SECONDS', 60),
  };
}

export type ExitPolicyConfig = {
  /** Stop loss as a fraction of entry premium (long options). */
  stopLossPct: number;
  /** Profit target as a fraction of entry premium. */
  profitTargetPct: number;
  trailingEnabled: boolean;
  /** Quote staleness beyond this blocks new entries + raises a warning (ms). */
  monitorStaleQuoteMs: number;
};

export function getExitPolicyConfig(): ExitPolicyConfig {
  return {
    stopLossPct: envNumber('AUTOMATION_STOP_LOSS_PCT', 0.25),
    profitTargetPct: envNumber('AUTOMATION_PROFIT_TARGET_PCT', 0.3),
    trailingEnabled: envBool('AUTOMATION_TRAILING_ENABLED', false),
    monitorStaleQuoteMs: envNumber('AUTOMATION_MONITOR_STALE_QUOTE_MS', 2 * 60_000),
  };
}

export type AutomationConfigValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  resolved: {
    signalMode: SignalMode;
    broker: string;
    subscriptionProfile: string;
  };
};

/**
 * Validate the automation configuration at startup. Fails closed on missing or
 * contradictory required settings so an unsafe runtime never becomes READY.
 */
export function validateAutomationConfig(): AutomationConfigValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const signalMode = getSignalMode();
  const broker = envString('AUTOMATION_BROKER', 'alpaca-paper').toLowerCase();
  const subscriptionProfile = envString('MASSIVE_SUBSCRIPTION_PROFILE', 'options-advanced').toLowerCase();
  const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';

  // Runtime authenticity: production may never select the mock broker.
  if (isProd && broker === 'mock') {
    errors.push('AUTOMATION_BROKER=mock is forbidden in production (real Alpaca paper only)');
  }
  // OPTIONS_NATIVE_FLOW is the only mode the current entitlement can supply.
  if (signalMode === 'EQUITY_MOMENTUM') {
    warnings.push(
      'AUTOMATION_SIGNAL_MODE=EQUITY_MOMENTUM requires real-time stock intraday, which the ' +
        'Options Advanced plan does NOT authorize; live evaluations will fail closed.'
    );
  }
  if (subscriptionProfile !== 'options-advanced') {
    warnings.push(`MASSIVE_SUBSCRIPTION_PROFILE=${subscriptionProfile} — expected options-advanced`);
  }

  const hours = getMarketHoursConfig();
  // Ordering invariant: final-entry ≥ cancel-entries ≥ flatten (minutes before close).
  if (!(hours.finalEntryMinutesBeforeClose >= hours.cancelEntryOrdersMinutesBeforeClose)) {
    errors.push('AUTOMATION_FINAL_ENTRY_MINUTES_BEFORE_CLOSE must be ≥ CANCEL_ENTRY_ORDERS minutes');
  }
  if (!(hours.cancelEntryOrdersMinutesBeforeClose >= hours.flattenMinutesBeforeClose)) {
    errors.push('AUTOMATION_CANCEL_ENTRY_ORDERS_MINUTES_BEFORE_CLOSE must be ≥ FLATTEN minutes');
  }
  if (hours.flattenMinutesBeforeClose <= 0) {
    errors.push('AUTOMATION_FLATTEN_MINUTES_BEFORE_CLOSE must be > 0 (no intentional overnight positions)');
  }

  const exit = getExitPolicyConfig();
  if (!(exit.stopLossPct > 0)) errors.push('AUTOMATION_STOP_LOSS_PCT must be > 0');
  if (!(exit.profitTargetPct > 0)) errors.push('AUTOMATION_PROFIT_TARGET_PCT must be > 0');

  const exec = getExecutionConfig();
  if (!(exec.entryOrderTimeoutSeconds > 0)) errors.push('AUTOMATION_ENTRY_ORDER_TIMEOUT_SECONDS must be > 0');
  if (!(exec.entryMaxSlippagePct >= 0)) errors.push('AUTOMATION_ENTRY_MAX_SLIPPAGE_PCT must be ≥ 0');

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    resolved: { signalMode, broker, subscriptionProfile },
  };
}

// ---------------------------------------------------------------------------
// Phase 2.6 — configurable trading universe
// ---------------------------------------------------------------------------

/** Equity/ETF symbol shape: 1-10 chars, letters with optional dots. */
export const UNIVERSE_SYMBOL_PATTERN = /^[A-Z][A-Z.]{0,9}$/;

export type UniverseConfig = {
  /** Ordered, deduped, validated symbols. Empty when nothing is configured. */
  symbols: string[];
  /** Configured entries that failed symbol validation (recorded, skipped). */
  invalidSymbols: string[];
  source: 'AUTOMATION_UNDERLYINGS' | 'AUTOMATION_UNDERLYING' | 'unconfigured';
};

/**
 * Parse a comma-separated symbol list deterministically: trim, uppercase,
 * dedupe preserving first occurrence, and split valid from invalid entries.
 */
export function parseUniverseSymbols(raw: string | null | undefined): {
  symbols: string[];
  invalidSymbols: string[];
} {
  const symbols: string[] = [];
  const invalidSymbols: string[] = [];
  const seen = new Set<string>();
  for (const entry of String(raw ?? '').split(',')) {
    const symbol = entry.trim().toUpperCase();
    if (!symbol) continue;
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    if (UNIVERSE_SYMBOL_PATTERN.test(symbol)) symbols.push(symbol);
    else invalidSymbols.push(symbol);
  }
  return { symbols, invalidSymbols };
}

/**
 * The configured trading universe. Configuration is the ONLY source of
 * candidate symbols: AUTOMATION_UNDERLYINGS (comma-separated), falling back
 * to the legacy single-symbol AUTOMATION_UNDERLYING. There is deliberately no
 * in-code default list — an unconfigured universe is empty and the engine
 * records UNIVERSE_NOT_CONFIGURED instead of trading.
 */
export function getUniverseConfig(): UniverseConfig {
  const multi = process.env.AUTOMATION_UNDERLYINGS;
  if (multi != null && multi.trim() !== '') {
    return { ...parseUniverseSymbols(multi), source: 'AUTOMATION_UNDERLYINGS' };
  }
  const legacy = process.env.AUTOMATION_UNDERLYING;
  if (legacy != null && legacy.trim() !== '') {
    return { ...parseUniverseSymbols(legacy), source: 'AUTOMATION_UNDERLYING' };
  }
  return { symbols: [], invalidSymbols: [], source: 'unconfigured' };
}

// ---------------------------------------------------------------------------
// Reason-code catalog (persisted verbatim on candidates/selections/decisions)
// ---------------------------------------------------------------------------

export const REASON = {
  // data gates
  NO_BARS: 'NO_BARS',
  BAR_NOT_CLOSED: 'BAR_NOT_CLOSED',
  STALE_BAR: 'STALE_BAR',
  INSUFFICIENT_BAR_HISTORY: 'INSUFFICIENT_BAR_HISTORY',
  BAR_GAP_DETECTED: 'BAR_GAP_DETECTED',
  BAR_NOT_NEWER_THAN_LAST_PROCESSED: 'BAR_NOT_NEWER_THAN_LAST_PROCESSED',
  // market-data entitlement/completeness gates (Options Advanced alignment)
  UNDERLYING_DATA_UNAUTHORIZED: 'UNDERLYING_DATA_UNAUTHORIZED',
  UNDERLYING_DATA_NOT_REALTIME: 'UNDERLYING_DATA_NOT_REALTIME',
  CHAIN_INCOMPLETE: 'CHAIN_INCOMPLETE',
  DATA_INCOMPLETE: 'DATA_INCOMPLETE',
  OPTIONS_STREAM_DISCONNECTED: 'OPTIONS_STREAM_DISCONNECTED',
  // clock gates
  MARKET_CLOCK_UNKNOWN: 'MARKET_CLOCK_UNKNOWN',
  MARKET_CLOSED: 'MARKET_CLOSED',
  CLOCK_CONFLICT: 'CLOCK_CONFLICT',
  // session gates
  SESSION_NOT_READY: 'SESSION_NOT_READY',
  RECONCILIATION_NOT_CLEAN: 'RECONCILIATION_NOT_CLEAN',
  EMERGENCY_STOP_ACTIVE: 'EMERGENCY_STOP_ACTIVE',
  AUTOMATION_NOT_READY: 'AUTOMATION_NOT_READY',
  // strategy — bullish leg
  BULL_CLOSE_NOT_ABOVE_VWAP: 'BULL_CLOSE_NOT_ABOVE_VWAP',
  BULL_EMA_FAST_NOT_ABOVE_SLOW: 'BULL_EMA_FAST_NOT_ABOVE_SLOW',
  BULL_RSI_OUT_OF_RANGE: 'BULL_RSI_OUT_OF_RANGE',
  BULL_VOLUME_BELOW_AVERAGE: 'BULL_VOLUME_BELOW_AVERAGE',
  // strategy — bearish leg
  BEAR_CLOSE_NOT_BELOW_VWAP: 'BEAR_CLOSE_NOT_BELOW_VWAP',
  BEAR_EMA_FAST_NOT_BELOW_SLOW: 'BEAR_EMA_FAST_NOT_BELOW_SLOW',
  BEAR_RSI_OUT_OF_RANGE: 'BEAR_RSI_OUT_OF_RANGE',
  BEAR_VOLUME_BELOW_AVERAGE: 'BEAR_VOLUME_BELOW_AVERAGE',
  // shared strategy context
  OPEN_AUTOMATION_POSITION: 'OPEN_AUTOMATION_POSITION',
  UNRESOLVED_AUTOMATION_ORDER: 'UNRESOLVED_AUTOMATION_ORDER',
  DAILY_TRADE_LIMIT_REACHED: 'DAILY_TRADE_LIMIT_REACHED',
  // contract selection
  DTE_OUT_OF_RANGE: 'DTE_OUT_OF_RANGE',
  DELTA_OUT_OF_RANGE: 'DELTA_OUT_OF_RANGE',
  DELTA_MISSING: 'DELTA_MISSING',
  OPEN_INTEREST_TOO_LOW: 'OPEN_INTEREST_TOO_LOW',
  VOLUME_TOO_LOW: 'VOLUME_TOO_LOW',
  SPREAD_TOO_WIDE: 'SPREAD_TOO_WIDE',
  STALE_QUOTE: 'STALE_QUOTE',
  NON_POSITIVE_BID: 'NON_POSITIVE_BID',
  NON_POSITIVE_ASK: 'NON_POSITIVE_ASK',
  ASK_BELOW_BID: 'ASK_BELOW_BID',
  NOT_TRADABLE: 'NOT_TRADABLE',
  NO_CONTRACT_PASSED_FILTERS: 'NO_CONTRACT_PASSED_FILTERS',
  EMPTY_OPTION_CHAIN: 'EMPTY_OPTION_CHAIN',
  // options-native signal (Phase 2C)
  OPTIONS_WINDOW_INCOMPLETE: 'OPTIONS_WINDOW_INCOMPLETE',
  OPTIONS_WINDOW_STALE: 'OPTIONS_WINDOW_STALE',
  OPTIONS_WINDOW_INSUFFICIENT_VOLUME: 'OPTIONS_WINDOW_INSUFFICIENT_VOLUME',
  OPTIONS_WINDOW_INSUFFICIENT_CONTRACTS: 'OPTIONS_WINDOW_INSUFFICIENT_CONTRACTS',
  OPTIONS_FLOW_BALANCED: 'OPTIONS_FLOW_BALANCED',
  OPTIONS_FLOW_BELOW_SCORE: 'OPTIONS_FLOW_BELOW_SCORE',
  OPTIONS_DATA_UNAVAILABLE: 'OPTIONS_DATA_UNAVAILABLE',
  // market-hours / lifecycle (Phase 2C)
  MARKET_SESSION_CLOSED: 'MARKET_SESSION_CLOSED',
  AFTER_FINAL_ENTRY_CUTOFF: 'AFTER_FINAL_ENTRY_CUTOFF',
  FLATTEN_WINDOW_ACTIVE: 'FLATTEN_WINDOW_ACTIVE',
  SCHEDULER_LEASE_NOT_OWNED: 'SCHEDULER_LEASE_NOT_OWNED',
  // execution / exits (Phase 2C)
  ENTRY_ORDER_TIMEOUT: 'ENTRY_ORDER_TIMEOUT',
  EXIT_ALREADY_IN_PROGRESS: 'EXIT_ALREADY_IN_PROGRESS',
  MONITOR_QUOTE_STALE: 'MONITOR_QUOTE_STALE',
  POSITION_NOT_CONFIRMED_CLOSED: 'POSITION_NOT_CONFIRMED_CLOSED',
  // universe (Phase 2.6)
  UNIVERSE_NOT_CONFIGURED: 'UNIVERSE_NOT_CONFIGURED',
  UNIVERSE_SYMBOL_INVALID: 'UNIVERSE_SYMBOL_INVALID',
  SYMBOL_DATA_UNAVAILABLE: 'SYMBOL_DATA_UNAVAILABLE',
  SYMBOL_CHAIN_UNAVAILABLE: 'SYMBOL_CHAIN_UNAVAILABLE',
  SYMBOL_CHAIN_ILLIQUID: 'SYMBOL_CHAIN_ILLIQUID',
  SYMBOL_EVALUATION_ERROR: 'SYMBOL_EVALUATION_ERROR',
  NO_ELIGIBLE_SYMBOLS: 'NO_ELIGIBLE_SYMBOLS',
  OPPORTUNITY_NOT_SELECTED: 'OPPORTUNITY_NOT_SELECTED',
  // risk engine
  RISK_MONGO_UNAVAILABLE: 'RISK_MONGO_UNAVAILABLE',
  RISK_AUTOMATION_NOT_READY: 'RISK_AUTOMATION_NOT_READY',
  RISK_RECONCILIATION_NOT_CLEAN: 'RISK_RECONCILIATION_NOT_CLEAN',
  RISK_EMERGENCY_STOP: 'RISK_EMERGENCY_STOP',
  RISK_MARKET_NOT_OPEN: 'RISK_MARKET_NOT_OPEN',
  RISK_STALE_UNDERLYING_BAR: 'RISK_STALE_UNDERLYING_BAR',
  RISK_STALE_OPTION_QUOTE: 'RISK_STALE_OPTION_QUOTE',
  RISK_SPREAD_TOO_WIDE: 'RISK_SPREAD_TOO_WIDE',
  RISK_NO_VALID_CONTRACT: 'RISK_NO_VALID_CONTRACT',
  RISK_INSUFFICIENT_BUYING_POWER: 'RISK_INSUFFICIENT_BUYING_POWER',
  RISK_MAX_DAILY_LOSS: 'RISK_MAX_DAILY_LOSS',
  RISK_MAX_DRAWDOWN: 'RISK_MAX_DRAWDOWN',
  RISK_MAX_TRADES: 'RISK_MAX_TRADES',
  RISK_CONSECUTIVE_LOSS_COOLDOWN: 'RISK_CONSECUTIVE_LOSS_COOLDOWN',
  RISK_EXISTING_POSITION: 'RISK_EXISTING_POSITION',
  RISK_UNRESOLVED_ORDER: 'RISK_UNRESOLVED_ORDER',
  RISK_QUANTITY_BELOW_ONE: 'RISK_QUANTITY_BELOW_ONE',
  RISK_DUPLICATE_CANDIDATE: 'RISK_DUPLICATE_CANDIDATE',
} as const;

export type ReasonCode = (typeof REASON)[keyof typeof REASON];
