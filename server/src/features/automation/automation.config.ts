// Phase 2B strategy configuration. All thresholds are configurable via env
// with the documented defaults below. A resolved snapshot of this config is
// persisted onto every trade candidate so decisions are reproducible.

export type AutomationStrategyConfig = {
  strategyKey: 'spy-5m-momentum-v1';
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

/** Resolve the active strategy configuration (env overrides + defaults). */
export function getStrategyConfig(): AutomationStrategyConfig {
  return {
    strategyKey: 'spy-5m-momentum-v1',
    underlying: process.env.AUTOMATION_UNDERLYING?.toUpperCase() || 'SPY',
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
