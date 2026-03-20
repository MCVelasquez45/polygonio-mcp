import { FuturesBacktestModel } from '../models/futuresModels';
import { fetchFuturesDailyBars, type FuturesBar } from './databentoGateway.service';
import { getContractSpec } from './contractSpecs.service';
import {
  evaluateRuleBasedSignal,
  hasMatchableRules,
  precomputeIndicators,
  computeSMA,
  computeEMA,
  computeRSI,
  computeATR,
  type SignalContext,
  type StrategyRules,
} from './signalEngine.service';

export type StrategyBacktestInput = {
  strategyId: string;
  strategyName: string;
  symbol: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  contracts: number;
  rollPolicy: 'volume' | 'calendar' | 'open_interest';
  rollDaysBefore: number;
  slippageBps: number;
  feePerContract: number;
  lookback?: number;
  // Strategy rules for the hybrid signal engine
  entryRules?: string[];
  exitRules?: string[];
  riskManagement?: string[];
  strategyParameters?: Record<string, unknown>;
};

function computeSharpe(returns: number[]) {
  if (!returns.length) return 0;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(252);
}

function buildRollEvents(startDate: string, endDate: string, symbol: string, rollPolicy: StrategyBacktestInput['rollPolicy']) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const events: Array<{ timestamp: string; fromContract: string; toContract: string; reason: string }> = [];
  let idx = 1;
  for (let date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 35)) {
    if (events.length > 12) break;
    const fromContract = `${symbol}${String(idx).padStart(2, '0')}`;
    const toContract = `${symbol}${String(idx + 1).padStart(2, '0')}`;
    events.push({
      timestamp: new Date(date).toISOString(),
      fromContract,
      toContract,
      reason: `${rollPolicy} roll`
    });
    idx += 1;
  }
  return events;
}

// ---------------------------------------------------------------------------
// Credit Spread Simulation
// ---------------------------------------------------------------------------

type CreditSpreadConfig = {
  deltaTarget: number;
  spreadWidthPct: number;       // spread width as % of underlying (e.g., 0.001 = 0.1%)
  maxLossMultiple: number;      // max loss as multiple of credit collected
  atrFilterMultiple: number;    // skip day if ATR > multiple * 20-day avg ATR
  vixChangePctMax: number;      // skip day if ATR change (VIX proxy) exceeds this % (e.g., 3.5 = 3.5%)
  afternoonFraction: number;    // fraction of daily range attributed to afternoon session
  trendClarityThreshold: number; // close must be within this fraction of range extreme
  contractsPerTrade: number;
  dailyRiskPct: number;         // max daily risk as fraction of equity
  contractMultiplier: number;   // 100 for SPX options
  minLayersBetween: number;     // min S/R layers between price and strike
  allowIronCondor: boolean;     // whether to allow iron condor (bi-directional) variant
  highVolMinDistancePct: number; // min OTM distance on high-vol days (e.g., 0.007 = 0.7%)
  highVolThreshold: number;     // daily vol pct threshold to trigger high-vol distance (e.g., VIX~20 ≈ 0.0126)
  newTradeCutoffPct: number;    // stop opening new trades when daily drawdown exceeds this
};

function parseCreditSpreadConfig(
  params: Record<string, unknown>,
  riskRules: string[],
): CreditSpreadConfig {
  // Parse max loss multiple from risk management rules (v18 default: 1.2x)
  let maxLossMultiple = 1.2;
  for (const rule of riskRules) {
    const match = rule.match(/(\d+\.?\d*)x\s*(?:collected\s*)?credit/i);
    if (match) {
      maxLossMultiple = Number(match[1]) || 1.2;
      break;
    }
    const matchAlt = rule.match(/max\s*loss.*?(\d+\.?\d*)\s*(?:x|times)/i);
    if (matchAlt) {
      maxLossMultiple = Number(matchAlt[1]) || 1.2;
      break;
    }
  }

  // Parse daily risk limit (v18 default: 0.75%)
  let dailyRiskPct = 0.0075;
  for (const rule of riskRules) {
    const match = rule.match(/(\d+\.?\d*)\s*(?:%|percent)/i);
    if (match) {
      const val = Number(match[1]);
      if (val > 0 && val < 100) {
        dailyRiskPct = val / 100;
        break;
      }
    }
  }

  // Parse new-trade cutoff (stop opening trades when daily DD exceeds this)
  let newTradeCutoffPct = 0.007; // default 0.7%
  for (const rule of riskRules) {
    const match = rule.match(/(?:cutoff|stop\s*open|no\s*new\s*trades?).*?(\d+\.?\d*)\s*(?:%|percent)/i);
    if (match) {
      const val = Number(match[1]);
      if (val > 0 && val < 100) {
        newTradeCutoffPct = val / 100;
        break;
      }
    }
  }

  // Parse entry_volatility_filters from strategy params
  const volFilters = (params.entry_volatility_filters ?? {}) as Record<string, unknown>;
  const vixChangePctMax = Number(volFilters.vix_intraday_change_pct_max) || 3.5; // v18: 3.5%
  const rawAtrRatio = Number(volFilters.atr_ratio_max) || Number(params.atr_filter_multiplier) || 1.1;
  // Floor at 1.0 — values below 1.0 mean "only trade when ATR is below average"
  // which filters out nearly all normal trading days and produces 0 trades.
  const atrRatioMax = Math.max(1.0, rawAtrRatio);

  return {
    deltaTarget: Number(params.option_delta_target) || 0.12,
    spreadWidthPct: Number(params.spread_width_pct) || 0.003, // default ~$16.50 on ES ~$5500 (realistic $15-25 wide 0-DTE verticals)
    maxLossMultiple,
    atrFilterMultiple: atrRatioMax,
    vixChangePctMax,
    afternoonFraction: Number(params.afternoon_fraction) || 0.35,
    trendClarityThreshold: Number(params.trend_clarity_threshold) || 0.35,
    contractsPerTrade: Number(params.contracts_per_trade) || 1,
    dailyRiskPct,
    contractMultiplier: 100, // SPX options are 100x
    minLayersBetween: Number(params.minimum_layers_between_price_and_strike) || 4, // v18: 4 layers
    allowIronCondor: params.allow_iron_condor_variant !== false, // default true unless explicitly disabled
    highVolMinDistancePct: Number(params.high_vol_min_distance_pct) || 0.007, // 0.7% on high-vol days
    highVolThreshold: Number(params.high_vol_threshold) || 0.0126, // ~VIX 20 daily vol
    newTradeCutoffPct,
  };
}

/**
 * Detect whether the strategy is a 0-DTE credit spread based on parameters.
 */
function isCreditSpreadStrategy(params: Record<string, unknown>): boolean {
  return (
    params.option_expiry_type === '0DTE' ||
    params.strategy_template_type === '0dte' ||
    (params.prefer_put_credit_spread_on_up_day === true &&
     params.prefer_call_credit_spread_on_down_day === true)
  );
}

/**
 * Approximate inverse normal CDF for converting delta to OTM distance.
 * Uses Beasley-Springer-Moro algorithm for p in (0, 1).
 */
function normInv(p: number): number {
  if (p <= 0) return -8;
  if (p >= 1) return 8;
  if (p === 0.5) return 0;

  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
             1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
             6.680131188771972e1, -1.328068155288572e1];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return ((((((-7.784894002430293e-3 * q - 3.223964580411365e-1) * q - 2.400758277161838e0) * q - 2.549732539343734e0) * q + 4.374664141464968e0) * q + 2.938163982698783e0) /
            ((((7.784695709041462e-3 * q + 3.224671290700398e-1) * q + 2.445134137142996e0) * q + 3.754408661907416e0) * q + 1));
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -((((((-7.784894002430293e-3 * q - 3.223964580411365e-1) * q - 2.400758277161838e0) * q - 2.549732539343734e0) * q + 4.374664141464968e0) * q + 2.938163982698783e0) /
           ((((7.784695709041462e-3 * q + 3.224671290700398e-1) * q + 2.445134137142996e0) * q + 3.754408661907416e0) * q + 1));
}

/**
 * Convert delta target + ATR-based volatility to OTM distance as fraction of price.
 * Models 0-DTE with ~2 hours to expiry (entry at 2pm, close at 4pm).
 */
function deltaToOtmDistance(deltaTarget: number, dailyVolPct: number): number {
  // For 0-DTE at 2pm entry: ~2 hours remaining out of 6.5-hour trading day
  // Time fraction of year: 2 / (252 * 6.5) ≈ 0.00122
  const hoursRemaining = 2;
  const tradingHoursPerDay = 6.5;
  const tradingDaysPerYear = 252;
  const T = hoursRemaining / (tradingHoursPerDay * tradingDaysPerYear);
  const sqrtT = Math.sqrt(T);

  // Annualized vol from daily vol
  const annualizedVol = dailyVolPct * Math.sqrt(tradingDaysPerYear);

  // OTM distance = N^{-1}(1 - delta) * sigma * sqrt(T)
  const zScore = normInv(1 - deltaTarget);
  const otmDistance = zScore * annualizedVol * sqrtT;

  // Clamp to reasonable range (0.1% to 5% OTM)
  return Math.max(0.001, Math.min(0.05, otmDistance));
}

/**
 * Estimate credit collected for a credit spread as a fraction of spread width.
 * Higher delta → more premium, higher vol → more premium.
 *
 * Calibrated against real 0-DTE SPX vertical pricing:
 * - 10-delta $5-wide: ~$0.50-$1.50 (10-30% of width)
 * - 15-delta $15-wide: ~$3.00-$5.00 (20-33% of width)
 * - 20-delta $25-wide: ~$7.00-$12.00 (28-48% of width)
 */
function estimateCreditFraction(deltaTarget: number, dailyVolPct: number): number {
  // Empirical: credit ≈ delta * scaleFactor, adjusted for vol
  // At normal vol (VIX ~15, daily vol ~1%), 12-delta spread → ~30% of width
  const volAdjust = Math.max(0.8, Math.min(1.5, dailyVolPct / 0.01));
  const baseFraction = deltaTarget * 2.5 * volAdjust;
  // Clamp between 8% and 55% of spread width
  return Math.max(0.08, Math.min(0.55, baseFraction));
}

type CreditSpreadTrade = {
  type: 'put_credit' | 'call_credit';
  shortStrike: number;
  longStrike: number;
  spreadWidth: number;
  creditPerContract: number;
  pnlPerContract: number;
  win: boolean;
  reason: string;
};

/**
 * Run a credit spread backtest using daily OHLC bars.
 * Simulates 0-DTE credit spread outcomes with entry filters and risk management.
 *
 * Look-ahead bias elimination:
 * - ENTRY DECISION uses the previous bar (yesterday's close/OHLC) to determine trend
 * - STRIKE PLACEMENT uses the current bar's open (known at entry time)
 * - OUTCOME uses the current bar's high/low (the actual trading session)
 * - ATR/volatility filters use history up to (but not including) the current bar
 */
async function runCreditSpreadBacktest(input: StrategyBacktestInput, barsResponse: any) {
  const bars: FuturesBar[] = barsResponse.bars;
  const params = input.strategyParameters ?? {};
  const config = parseCreditSpreadConfig(params, input.riskManagement ?? []);

  let cash = input.initialCapital;
  let equity = input.initialCapital;
  let peakEquity = input.initialCapital;
  let maxDrawdownPct = 0;
  let wins = 0;
  let dailyPnl = 0;
  let dailyTradesCount = 0;
  let lastDate = '';

  const equityCurve: Array<{ timestamp: string; equity: number }> = [];
  const tradeLedger: Array<{
    timestamp: string;
    side: 'buy' | 'sell';
    contracts: number;
    fillPrice: number;
    pnl: number;
    reason: string;
    signalSource?: 'rule' | 'ai' | 'sma' | 'credit_spread';
  }> = [];
  const dailyReturns: number[] = [];

  // Need at least 22 bars: 21 for ATR warmup + 1 previous bar for entry decision
  const warmupBars = 22;

  let skippedNoTrend = 0;
  let skippedHighVol = 0;
  let skippedVixChange = 0;
  let skippedMixedSignals = 0;
  let skippedDailyLimit = 0;
  let skippedDrawdownCutoff = 0;
  let highVolDays = 0;

  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    const barDate = bar.timestamp.slice(0, 10);

    // Reset daily counters
    if (barDate !== lastDate) {
      dailyPnl = 0;
      dailyTradesCount = 0;
      lastDate = barDate;
    }

    // Need warmup period for indicators + previous bar for entry decision
    if (i < warmupBars) {
      equityCurve.push({ timestamp: bar.timestamp, equity });
      dailyReturns.push(0);
      continue;
    }

    // --- NO LOOK-AHEAD: entry decision uses PREVIOUS bar ---
    const prevBar = bars[i - 1];
    const twoBarsAgo = bars[i - 2];

    // ATR computed from history EXCLUDING current bar (known at decision time)
    const prevHistory = bars.slice(0, i);
    const atr = computeATR(prevHistory.slice(-15), 14);
    const atr20 = computeATR(prevHistory.slice(-21), 14);
    const dailyVolPct = atr / prevBar.close;

    // --- ENTRY FILTERS (all based on previous bar / known info) ---

    // 1. Determine trend from PREVIOUS bar (yesterday was an up/down day)
    const isUpDay = prevBar.close > prevBar.open && prevBar.close > twoBarsAgo.close;
    const isDownDay = prevBar.close < prevBar.open && prevBar.close < twoBarsAgo.close;

    if (!isUpDay && !isDownDay) {
      skippedMixedSignals++;
      equityCurve.push({ timestamp: bar.timestamp, equity });
      dailyReturns.push(0);
      continue;
    }

    // 2. ATR volatility filter: skip if recent vol is elevated
    if (atr20 > 0 && atr > atr20 * config.atrFilterMultiple) {
      skippedHighVol++;
      equityCurve.push({ timestamp: bar.timestamp, equity });
      dailyReturns.push(0);
      continue;
    }

    // 2b. VIX proxy filter: ATR change day-over-day
    if (i >= warmupBars + 1) {
      const olderHistory = bars.slice(0, i - 1);
      const prevAtr = computeATR(olderHistory.slice(-15), 14);
      if (prevAtr > 0) {
        const atrChangePct = ((atr - prevAtr) / prevAtr) * 100;
        if (atrChangePct > config.vixChangePctMax) {
          skippedVixChange++;
          equityCurve.push({ timestamp: bar.timestamp, equity });
          dailyReturns.push(0);
          continue;
        }
      }
    }

    // 3. Trend clarity filter: previous bar's close should be near its extreme
    const prevDayRange = prevBar.high - prevBar.low;
    if (prevDayRange > 0) {
      if (isUpDay) {
        const closeToHighRatio = (prevBar.high - prevBar.close) / prevDayRange;
        if (closeToHighRatio > config.trendClarityThreshold) {
          skippedNoTrend++;
          equityCurve.push({ timestamp: bar.timestamp, equity });
          dailyReturns.push(0);
          continue;
        }
      } else {
        const closeToLowRatio = (prevBar.close - prevBar.low) / prevDayRange;
        if (closeToLowRatio > config.trendClarityThreshold) {
          skippedNoTrend++;
          equityCurve.push({ timestamp: bar.timestamp, equity });
          dailyReturns.push(0);
          continue;
        }
      }
    }

    // 4. Daily risk limit check (portfolio state, not look-ahead)
    const maxDailyLoss = equity * config.dailyRiskPct;
    if (dailyPnl < -maxDailyLoss) {
      skippedDailyLimit++;
      equityCurve.push({ timestamp: bar.timestamp, equity });
      dailyReturns.push(0);
      continue;
    }

    // 5. New-trade cutoff: stop opening new trades when daily drawdown exceeds threshold
    const dailyDrawdown = equity > 0 ? -dailyPnl / equity : 0;
    if (dailyDrawdown > config.newTradeCutoffPct) {
      skippedDrawdownCutoff++;
      equityCurve.push({ timestamp: bar.timestamp, equity });
      dailyReturns.push(0);
      continue;
    }

    // --- TRADE SIMULATION ---
    // Strike placement uses today's OPEN (known at entry time)
    const entryPrice = bar.open;

    // Calculate OTM distance from delta target, with high-vol adaptive floor
    let otmDistance = deltaToOtmDistance(config.deltaTarget, dailyVolPct);
    const isHighVol = dailyVolPct > config.highVolThreshold;
    if (isHighVol) {
      highVolDays++;
      otmDistance = Math.max(otmDistance, config.highVolMinDistancePct);
    }

    // Spread width in price terms (based on entry price)
    const spreadWidth = entryPrice * config.spreadWidthPct;

    // Credit collected as fraction of spread width
    const creditFraction = estimateCreditFraction(config.deltaTarget, dailyVolPct);
    const creditPerPoint = spreadWidth * creditFraction;
    const creditPerContract = creditPerPoint * config.contractMultiplier;

    // Max loss per contract (capped by max loss multiple and spread width)
    const maxLossPerPoint = Math.min(
      spreadWidth - creditPerPoint,
      creditPerPoint * config.maxLossMultiple
    );
    const maxLossPerContract = maxLossPerPoint * config.contractMultiplier;

    let trade: CreditSpreadTrade;

    if (isUpDay) {
      // Yesterday was an up day → sell put credit spread below today's open
      const shortStrike = entryPrice * (1 - otmDistance);
      const longStrike = shortStrike - spreadWidth;

      // OUTCOME: did today's actual low breach the short strike?
      if (bar.low > shortStrike) {
        trade = {
          type: 'put_credit',
          shortStrike,
          longStrike,
          spreadWidth,
          creditPerContract,
          pnlPerContract: creditPerContract,
          win: true,
          reason: `Put credit spread expired OTM (strike ${shortStrike.toFixed(0)}, day low ${bar.low.toFixed(0)})`,
        };
      } else {
        const breach = shortStrike - bar.low;
        const lossPts = Math.min(breach, spreadWidth) - creditPerPoint;
        const cappedLoss = Math.min(lossPts * config.contractMultiplier, maxLossPerContract);
        trade = {
          type: 'put_credit',
          shortStrike,
          longStrike,
          spreadWidth,
          creditPerContract,
          pnlPerContract: -cappedLoss,
          win: false,
          reason: `Put credit spread breached (strike ${shortStrike.toFixed(0)}, day low ${bar.low.toFixed(0)}, loss capped)`,
        };
      }
    } else {
      // Yesterday was a down day → sell call credit spread above today's open
      const shortStrike = entryPrice * (1 + otmDistance);
      const longStrike = shortStrike + spreadWidth;

      // OUTCOME: did today's actual high breach the short strike?
      if (bar.high < shortStrike) {
        trade = {
          type: 'call_credit',
          shortStrike,
          longStrike,
          spreadWidth,
          creditPerContract,
          pnlPerContract: creditPerContract,
          win: true,
          reason: `Call credit spread expired OTM (strike ${shortStrike.toFixed(0)}, day high ${bar.high.toFixed(0)})`,
        };
      } else {
        const breach = bar.high - shortStrike;
        const lossPts = Math.min(breach, spreadWidth) - creditPerPoint;
        const cappedLoss = Math.min(lossPts * config.contractMultiplier, maxLossPerContract);
        trade = {
          type: 'call_credit',
          shortStrike,
          longStrike,
          spreadWidth,
          creditPerContract,
          pnlPerContract: -cappedLoss,
          win: false,
          reason: `Call credit spread breached (strike ${shortStrike.toFixed(0)}, day high ${bar.high.toFixed(0)}, loss capped)`,
        };
      }
    }

    // Apply trade to portfolio
    const tradePnl = trade.pnlPerContract * config.contractsPerTrade;
    const fee = input.feePerContract * config.contractsPerTrade * 2; // 2 legs
    const slip = Math.abs(trade.creditPerContract * config.contractsPerTrade * (input.slippageBps / 10000));
    const netPnl = tradePnl - fee - slip;

    cash += netPnl;
    dailyPnl += netPnl;
    dailyTradesCount++;
    if (trade.win) wins++;

    // Record entry + exit as single round-trip
    tradeLedger.push({
      timestamp: bar.timestamp,
      side: trade.type === 'put_credit' ? 'sell' : 'sell',
      contracts: config.contractsPerTrade,
      fillPrice: bar.close,
      pnl: netPnl,
      reason: trade.reason,
      signalSource: 'credit_spread',
    });

    const prevEquity = equity;
    equity = cash;
    equityCurve.push({ timestamp: bar.timestamp, equity });

    const r = prevEquity > 0 ? (equity - prevEquity) / prevEquity : 0;
    dailyReturns.push(r);

    if (equity > peakEquity) peakEquity = equity;
    const dd = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
  }

  // --- METRICS ---
  const totalPnl = equity - input.initialCapital;
  const totalReturnPct = input.initialCapital > 0 ? totalPnl / input.initialCapital : 0;
  const closedTrades = tradeLedger.filter(t => t.pnl !== 0 || t.reason.includes('expired'));
  const winRatePct = closedTrades.length > 0 ? wins / closedTrades.length : 0;

  const grossWins = closedTrades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLosses = Math.abs(closedTrades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 9999 : 0;

  const saved = await FuturesBacktestModel.create({
    strategyId: input.strategyId,
    strategyName: input.strategyName,
    symbol: input.symbol,
    provider: barsResponse.provider,
    config: {
      startDate: input.startDate,
      endDate: input.endDate,
      initialCapital: input.initialCapital,
      contracts: config.contractsPerTrade,
      rollPolicy: input.rollPolicy,
      rollDaysBefore: input.rollDaysBefore,
      slippageBps: input.slippageBps,
      feePerContract: input.feePerContract,
    },
    diagnostics: {
      usedFallbackData: barsResponse.usedFallbackData,
      sourceMessage: barsResponse.sourceMessage,
      proxyTicker: barsResponse.proxyTicker ?? null,
      requestedSymbol: barsResponse.requestedSymbol ?? input.symbol,
      barsLoaded: bars.length,
      signalEngine: 'credit_spread',
      creditSpreadConfig: {
        deltaTarget: config.deltaTarget,
        spreadWidthPct: config.spreadWidthPct,
        maxLossMultiple: config.maxLossMultiple,
        atrFilterMultiple: config.atrFilterMultiple,
        vixChangePctMax: config.vixChangePctMax,
        afternoonFraction: config.afternoonFraction,
        trendClarityThreshold: config.trendClarityThreshold,
        dailyRiskPct: config.dailyRiskPct,
        allowIronCondor: config.allowIronCondor,
        highVolMinDistancePct: config.highVolMinDistancePct,
        highVolThreshold: config.highVolThreshold,
        newTradeCutoffPct: config.newTradeCutoffPct,
        minLayersBetween: config.minLayersBetween,
      },
      tradeFiltering: {
        totalBars: bars.length,
        warmupBars,
        skippedMixedSignals,
        skippedHighVol,
        skippedVixChange,
        skippedNoTrend,
        skippedDailyLimit,
        skippedDrawdownCutoff,
        highVolDays,
        tradesExecuted: closedTrades.length,
      },
    },
    metrics: {
      totalReturnPct,
      sharpeRatio: computeSharpe(dailyReturns),
      maxDrawdownPct,
      winRatePct,
      totalPnl,
      tradeCount: closedTrades.length,
      profitFactor,
    },
    equityCurve,
    tradeLedger,
    rollEvents: [],
  });

  return saved.toObject();
}


// ---------------------------------------------------------------------------
// Stress Test Engine
// ---------------------------------------------------------------------------

export type StressScenario = {
  name: string;
  description: string;
  overrides: Partial<CreditSpreadConfig> & { volMultiplier?: number };
};

const DEFAULT_STRESS_SCENARIOS: StressScenario[] = [
  {
    name: 'Baseline',
    description: 'Current parameters, no modifications',
    overrides: {},
  },
  {
    name: 'Vol Shock (2x)',
    description: 'Doubled daily volatility — simulates sudden VIX spike',
    overrides: { volMultiplier: 2.0 },
  },
  {
    name: 'Vol Shock (3x)',
    description: 'Tripled daily volatility — extreme tail event (2020-style)',
    overrides: { volMultiplier: 3.0 },
  },
  {
    name: 'Relaxed VIX Filter (7.5%)',
    description: 'VIX change filter at 7.5% instead of 3.5% — more trades, more vol exposure',
    overrides: { vixChangePctMax: 7.5 },
  },
  {
    name: 'Higher Delta (0.15)',
    description: 'Delta target 0.15 — more premium collected but strikes closer to money',
    overrides: { deltaTarget: 0.15 },
  },
  {
    name: 'Higher Delta (0.20)',
    description: 'Delta target 0.20 — aggressive premium, significantly higher breach risk',
    overrides: { deltaTarget: 0.20 },
  },
  {
    name: 'Wider Spreads (0.5%)',
    description: 'Spread width at 0.5% of underlying — tests credit-to-fee ratio improvement',
    overrides: { spreadWidthPct: 0.005 },
  },
  {
    name: 'Wide Spreads + High Vol',
    description: 'Spread width 0.5% + 2x volatility — worst-case slippage regime',
    overrides: { spreadWidthPct: 0.005, volMultiplier: 2.0 },
  },
  {
    name: 'Tight Stops (1.0x credit)',
    description: 'Max loss capped at 1x credit collected — aggressive stop',
    overrides: { maxLossMultiple: 1.0 },
  },
  {
    name: 'Loose Stops (3x credit)',
    description: 'Max loss at 3x credit — tests tail risk exposure',
    overrides: { maxLossMultiple: 3.0 },
  },
];

type StressTestResult = {
  scenario: string;
  description: string;
  metrics: {
    totalReturnPct: number;
    sharpeRatio: number;
    maxDrawdownPct: number;
    winRatePct: number;
    totalPnl: number;
    tradeCount: number;
    profitFactor: number;
  };
  overrides: Record<string, unknown>;
};

/**
 * Run the credit spread backtest under multiple stress scenarios.
 * Returns an array of results, one per scenario.
 */
async function runCreditSpreadStressTest(
  input: StrategyBacktestInput,
  barsResponse: any,
  scenarios?: StressScenario[],
): Promise<StressTestResult[]> {
  const scenarioList = scenarios ?? DEFAULT_STRESS_SCENARIOS;
  const bars: FuturesBar[] = barsResponse.bars;
  const params = input.strategyParameters ?? {};
  const baseConfig = parseCreditSpreadConfig(params, input.riskManagement ?? []);
  const results: StressTestResult[] = [];

  for (const scenario of scenarioList) {
    const config: CreditSpreadConfig = { ...baseConfig, ...scenario.overrides };
    const volMultiplier = scenario.overrides.volMultiplier ?? 1.0;

    let cash = input.initialCapital;
    let equity = input.initialCapital;
    let peakEquity = input.initialCapital;
    let maxDrawdownPct = 0;
    let wins = 0;
    let dailyPnl = 0;
    let lastDate = '';
    const dailyReturns: number[] = [];
    const trades: Array<{ pnl: number }> = [];
    const warmupBars = 22; // 21 for ATR + 1 previous bar for entry decision

    for (let i = 0; i < bars.length; i += 1) {
      const bar = bars[i];
      const barDate = bar.timestamp.slice(0, 10);
      if (barDate !== lastDate) { dailyPnl = 0; lastDate = barDate; }
      if (i < warmupBars) { dailyReturns.push(0); continue; }

      // NO LOOK-AHEAD: entry decision uses previous bar
      const prevBar = bars[i - 1];
      const twoBarsAgo = bars[i - 2];
      const prevHistory = bars.slice(0, i);
      const atr = computeATR(prevHistory.slice(-15), 14);
      const atr20 = computeATR(prevHistory.slice(-21), 14);
      const dailyVolPct = (atr / prevBar.close) * volMultiplier;

      // Trend from PREVIOUS bar
      const isUpDay = prevBar.close > prevBar.open && prevBar.close > twoBarsAgo.close;
      const isDownDay = prevBar.close < prevBar.open && prevBar.close < twoBarsAgo.close;
      if (!isUpDay && !isDownDay) { dailyReturns.push(0); continue; }
      if (atr20 > 0 && atr > atr20 * config.atrFilterMultiple) { dailyReturns.push(0); continue; }

      // VIX proxy filter
      if (i >= warmupBars + 1) {
        const olderHist = bars.slice(0, i - 1);
        const prevAtr = computeATR(olderHist.slice(-15), 14);
        if (prevAtr > 0 && ((atr - prevAtr) / prevAtr) * 100 > config.vixChangePctMax) {
          dailyReturns.push(0); continue;
        }
      }

      // Trend clarity on PREVIOUS bar
      const prevDayRange = prevBar.high - prevBar.low;
      if (prevDayRange > 0) {
        if (isUpDay && (prevBar.high - prevBar.close) / prevDayRange > config.trendClarityThreshold) { dailyReturns.push(0); continue; }
        if (isDownDay && (prevBar.close - prevBar.low) / prevDayRange > config.trendClarityThreshold) { dailyReturns.push(0); continue; }
      }

      if (dailyPnl < -(equity * config.dailyRiskPct)) { dailyReturns.push(0); continue; }
      if (equity > 0 && -dailyPnl / equity > config.newTradeCutoffPct) { dailyReturns.push(0); continue; }

      // Strike placement uses today's OPEN
      const entryPrice = bar.open;
      let otmDistance = deltaToOtmDistance(config.deltaTarget, dailyVolPct);
      if (dailyVolPct > config.highVolThreshold) {
        otmDistance = Math.max(otmDistance, config.highVolMinDistancePct);
      }

      const spreadWidth = entryPrice * config.spreadWidthPct;
      const creditFraction = estimateCreditFraction(config.deltaTarget, dailyVolPct);
      const creditPerPoint = spreadWidth * creditFraction;
      const creditPerContract = creditPerPoint * config.contractMultiplier;
      const maxLossPerPoint = Math.min(spreadWidth - creditPerPoint, creditPerPoint * config.maxLossMultiple);
      const maxLossPerContract = maxLossPerPoint * config.contractMultiplier;

      let pnlPerContract: number;
      if (isUpDay) {
        // Put credit spread — outcome uses today's actual low
        // For vol shock: scale the bar's range to simulate wider swings
        const scaledLow = volMultiplier > 1 ? entryPrice - (entryPrice - bar.low) * volMultiplier : bar.low;
        const shortStrike = entryPrice * (1 - otmDistance);
        if (scaledLow > shortStrike) {
          pnlPerContract = creditPerContract;
          wins++;
        } else {
          const breach = shortStrike - scaledLow;
          const lossPts = Math.min(breach, spreadWidth) - creditPerPoint;
          pnlPerContract = -Math.min(lossPts * config.contractMultiplier, maxLossPerContract);
        }
      } else {
        // Call credit spread — outcome uses today's actual high
        const scaledHigh = volMultiplier > 1 ? entryPrice + (bar.high - entryPrice) * volMultiplier : bar.high;
        const shortStrike = entryPrice * (1 + otmDistance);
        if (scaledHigh < shortStrike) {
          pnlPerContract = creditPerContract;
          wins++;
        } else {
          const breach = scaledHigh - shortStrike;
          const lossPts = Math.min(breach, spreadWidth) - creditPerPoint;
          pnlPerContract = -Math.min(lossPts * config.contractMultiplier, maxLossPerContract);
        }
      }

      const tradePnl = pnlPerContract * config.contractsPerTrade;
      const fee = input.feePerContract * config.contractsPerTrade * 2;
      const slip = Math.abs(creditPerContract * config.contractsPerTrade * (input.slippageBps / 10000));
      const netPnl = tradePnl - fee - slip;

      cash += netPnl;
      dailyPnl += netPnl;
      trades.push({ pnl: netPnl });

      const prevEquity = equity;
      equity = cash;
      dailyReturns.push(prevEquity > 0 ? (equity - prevEquity) / prevEquity : 0);
      if (equity > peakEquity) peakEquity = equity;
      const dd = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    }

    const totalPnl = equity - input.initialCapital;
    const totalReturnPct = input.initialCapital > 0 ? totalPnl / input.initialCapital : 0;
    const winRatePct = trades.length > 0 ? wins / trades.length : 0;
    const grossWins = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
    const grossLosses = Math.abs(trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 9999 : 0;

    results.push({
      scenario: scenario.name,
      description: scenario.description,
      metrics: {
        totalReturnPct,
        sharpeRatio: computeSharpe(dailyReturns),
        maxDrawdownPct,
        winRatePct,
        totalPnl,
        tradeCount: trades.length,
        profitFactor,
      },
      overrides: scenario.overrides,
    });
  }

  return results;
}

export async function runStressTest(input: StrategyBacktestInput, scenarios?: StressScenario[]) {
  const spec = await getContractSpec(input.symbol);
  if (!spec) throw new Error(`Unsupported futures symbol: ${input.symbol}`);

  const barsResponse = await fetchFuturesDailyBars({
    symbol: input.symbol,
    startDate: input.startDate,
    endDate: input.endDate,
  });

  if (!barsResponse.bars.length) throw new Error('No bars available for stress test window.');
  return runCreditSpreadStressTest(input, barsResponse, scenarios);
}

// ---------------------------------------------------------------------------
// Main entry point — routes to credit spread or directional backtest
// ---------------------------------------------------------------------------

// Map index/equity symbols to their futures equivalent for the backtest engine
const SYMBOL_TO_FUTURES: Record<string, string> = {
  SPX: 'ES', SPY: 'ES', 'I:SPX': 'ES',
  NDX: 'NQ', QQQ: 'NQ', 'I:NDX': 'NQ',
  RUT: 'RTY', IWM: 'RTY',
  DJX: 'YM', DIA: 'YM',
};

export async function runStrategyBacktest(input: StrategyBacktestInput) {
  // Resolve symbol: map equity/index tickers to futures equivalents
  const resolvedSymbol = SYMBOL_TO_FUTURES[input.symbol.toUpperCase()] ?? input.symbol.toUpperCase();
  const resolvedInput = { ...input, symbol: resolvedSymbol };

  const spec = await getContractSpec(resolvedSymbol);
  if (!spec) {
    throw new Error(`Unsupported symbol: ${input.symbol} (resolved to ${resolvedSymbol}). Supported: ES, NQ, CL, GC, YM, RTY.`);
  }

  const barsResponse = await fetchFuturesDailyBars({
    symbol: resolvedSymbol,
    startDate: resolvedInput.startDate,
    endDate: resolvedInput.endDate,
    allowSyntheticData: true,
  });

  const bars = barsResponse.bars;
  if (!bars.length) {
    throw new Error('No bars available for backtest window.');
  }

  // Route to credit spread simulation if strategy is 0-DTE credit spread
  const params = resolvedInput.strategyParameters ?? {};
  if (isCreditSpreadStrategy(params)) {
    console.log('[BACKTEST] Detected 0-DTE credit spread strategy, using credit spread simulation engine');
    return runCreditSpreadBacktest(resolvedInput, barsResponse);
  }

  // --- Original directional backtest below ---

  const lookback = Math.max(2, input.lookback ?? 10);
  let cash = input.initialCapital;
  let equity = input.initialCapital;
  let position: 1 | -1 | 0 = 0;
  let entryPrice = bars[0].close;
  const contracts = Math.max(1, input.contracts);

  const equityCurve: Array<{ timestamp: string; equity: number }> = [];
  const tradeLedger: Array<{
    timestamp: string;
    side: 'buy' | 'sell';
    contracts: number;
    fillPrice: number;
    pnl: number;
    reason: string;
    signalSource?: 'rule' | 'ai' | 'sma';
  }> = [];
  const dailyReturns: number[] = [];

  let peakEquity = input.initialCapital;
  let maxDrawdownPct = 0;
  let wins = 0;
  let dailyPnl = 0;
  let lastDate = '';

  // Determine if we should use strategy rules or fall back to SMA
  const strategyRules: StrategyRules = {
    entry_rules: input.entryRules ?? [],
    exit_rules: input.exitRules ?? [],
    risk_management: input.riskManagement ?? [],
    parameters: input.strategyParameters ?? {},
  };

  // Only use the hybrid engine if at least one rule matches a known regex pattern.
  // If rules exist but none are recognizable, fall back to SMA so we still get trades.
  const hasRules = hasMatchableRules(strategyRules);

  // Precompute all indicators in O(n) instead of O(n^2) per-bar recomputation
  const indicators = precomputeIndicators(bars, lookback, lookback, 14, 14);

  // Parse max indicator period from rules so we provide enough history
  const allRuleTexts = [...(input.entryRules ?? []), ...(input.exitRules ?? []), ...(input.riskManagement ?? [])];
  let maxRulePeriod = lookback;
  for (const rule of allRuleTexts) {
    const periodMatch = rule.match(/(\d+)[- ]?(?:period\s*)?(?:sma|ema)/i);
    if (periodMatch) {
      const p = Number(periodMatch[1]);
      if (p > maxRulePeriod) maxRulePeriod = p;
    }
  }
  const historyWindow = Math.max(lookback, maxRulePeriod);

  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    const history = bars.slice(Math.max(0, i - historyWindow), i + 1);

    // Reset daily PnL on new day
    const barDate = bar.timestamp.slice(0, 10);
    if (barDate !== lastDate) {
      dailyPnl = 0;
      lastDate = barDate;
    }

    // Use precomputed indicator values — O(1) lookup
    const sma = indicators.sma[i];

    let signal: 1 | -1 | 0 = position;
    let signalSource: 'rule' | 'ai' | 'sma' = 'sma';

    if (hasRules) {
      // Hybrid signal engine: use strategy rules
      const ctx: SignalContext = {
        bar,
        barIndex: i,
        history,
        position,
        entryPrice,
        sma,
        ema: indicators.ema[i],
        rsi: indicators.rsi[i],
        atr: indicators.atr[i],
        dailyPnl,
        totalPnl: equity - input.initialCapital,
        equity,
        peakEquity,
        initialCapital: input.initialCapital,
      };

      const engineSignal = evaluateRuleBasedSignal(strategyRules, ctx);
      if (engineSignal) {
        signal = engineSignal.action;
        signalSource = engineSignal.source;
      } else {
        // No rule fired this bar — use SMA as base signal so we still trade
        if (bar.close > sma * 1.0025) signal = 1;
        else if (bar.close < sma * 0.9975) signal = -1;
        signalSource = 'sma';
      }
    } else {
      // Default: SMA crossover (backward compatible)
      if (bar.close > sma * 1.0025) signal = 1;
      else if (bar.close < sma * 0.9975) signal = -1;
      signalSource = 'sma';
    }

    const fee = input.feePerContract * contracts;
    const slippageMultiplier = input.slippageBps / 10000;

    if (signal !== position) {
      if (position !== 0) {
        const grossPoints = (bar.close - entryPrice) * position;
        const grossPnl = grossPoints * spec.contractMultiplier * contracts;
        const slip = Math.abs(bar.close * slippageMultiplier * spec.contractMultiplier * contracts);
        const pnl = grossPnl - slip - fee;
        cash += pnl;
        dailyPnl += pnl;
        wins += pnl > 0 ? 1 : 0;
        tradeLedger.push({
          timestamp: bar.timestamp,
          side: position === 1 ? 'sell' : 'buy',
          contracts,
          fillPrice: bar.close,
          pnl,
          reason: 'signal flip exit',
          signalSource,
        });
      }

      if (signal !== 0) {
        entryPrice = bar.close;
        tradeLedger.push({
          timestamp: bar.timestamp,
          side: signal === 1 ? 'buy' : 'sell',
          contracts,
          fillPrice: bar.close,
          pnl: 0,
          reason: 'signal flip entry',
          signalSource,
        });
      }

      position = signal;
    }

    const unrealized =
      position === 0 ? 0 : (bar.close - entryPrice) * position * spec.contractMultiplier * contracts;
    const previousEquity = equity;
    equity = cash + unrealized;
    equityCurve.push({ timestamp: bar.timestamp, equity });

    const r = previousEquity > 0 ? (equity - previousEquity) / previousEquity : 0;
    dailyReturns.push(r);

    if (equity > peakEquity) peakEquity = equity;
    const dd = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
  }

  const totalPnl = equity - input.initialCapital;
  const totalReturnPct = input.initialCapital > 0 ? totalPnl / input.initialCapital : 0;
  const closedTrades = tradeLedger.filter(item => item.reason.includes('exit'));
  const winRatePct = closedTrades.length ? wins / closedTrades.length : 0;
  const rollEvents = buildRollEvents(input.startDate, input.endDate, input.symbol, input.rollPolicy);

  // Compute profit factor
  const grossWins = closedTrades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLosses = Math.abs(closedTrades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 9999 : 0;

  const saved = await FuturesBacktestModel.create({
    strategyId: input.strategyId,
    strategyName: input.strategyName,
    symbol: input.symbol,
    provider: barsResponse.provider,
    config: {
      startDate: input.startDate,
      endDate: input.endDate,
      initialCapital: input.initialCapital,
      contracts,
      rollPolicy: input.rollPolicy,
      rollDaysBefore: input.rollDaysBefore,
      slippageBps: input.slippageBps,
      feePerContract: input.feePerContract
    },
    diagnostics: {
      usedFallbackData: barsResponse.usedFallbackData,
      sourceMessage: barsResponse.sourceMessage,
      barsLoaded: bars.length,
      signalEngine: hasRules ? 'hybrid' : 'sma',
      rulesProvided: (input.entryRules?.length ?? 0) + (input.exitRules?.length ?? 0) + (input.riskManagement?.length ?? 0),
      rulesMatchable: hasRules,
    },
    metrics: {
      totalReturnPct,
      sharpeRatio: computeSharpe(dailyReturns),
      maxDrawdownPct,
      winRatePct,
      totalPnl,
      tradeCount: closedTrades.length,
      profitFactor,
    },
    equityCurve,
    tradeLedger,
    rollEvents
  });

  return saved.toObject();
}

export async function getFuturesBacktest(backtestId: string) {
  return FuturesBacktestModel.findById(backtestId).lean();
}
