import axios from 'axios';
import type { FuturesBar } from './databentoGateway.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SignalContext = {
  bar: FuturesBar;
  barIndex: number;
  history: FuturesBar[];
  position: 1 | -1 | 0;
  entryPrice: number;
  sma: number;
  ema: number;
  rsi: number;
  atr: number;
  dailyPnl: number;
  totalPnl: number;
  equity: number;
  peakEquity: number;
  initialCapital: number;
};

export type Signal = {
  action: 1 | -1 | 0;
  reason: string;
  source: 'rule' | 'ai' | 'sma';
};

export type StrategyRules = {
  entry_rules: string[];
  exit_rules: string[];
  risk_management: string[];
  parameters: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Technical indicator helpers
// ---------------------------------------------------------------------------

export function computeSMA(bars: FuturesBar[], period: number): number {
  if (bars.length === 0) return 0;
  const slice = bars.slice(-period);
  return slice.reduce((sum, b) => sum + b.close, 0) / slice.length;
}

export function computeEMA(bars: FuturesBar[], period: number): number {
  if (bars.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = bars[0].close;
  for (let i = 1; i < bars.length; i += 1) {
    ema = bars[i].close * k + ema * (1 - k);
  }
  return ema;
}

export function computeRSI(bars: FuturesBar[], period: number = 14): number {
  if (bars.length < period + 1) return 50; // neutral default

  // Wilder's smoothed RSI: seed with SMA of first `period` changes,
  // then apply exponential smoothing for all subsequent changes.
  const changes: number[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    changes.push(bars[i].close - bars[i - 1].close);
  }
  if (changes.length < period) return 50;

  // Seed: simple average of first `period` changes
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i += 1) {
    const c = changes[i];
    if (c > 0) avgGain += c;
    else avgLoss += Math.abs(c);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder's smoothing for remaining changes
  for (let i = period; i < changes.length; i += 1) {
    const c = changes[i];
    const gain = c > 0 ? c : 0;
    const loss = c < 0 ? Math.abs(c) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function computeATR(bars: FuturesBar[], period: number = 14): number {
  if (bars.length < 2) return 0;
  const trueRanges: number[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const high = bars[i].high;
    const low = bars[i].low;
    const prevClose = bars[i - 1].close;
    trueRanges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  const recent = trueRanges.slice(-period);
  return recent.reduce((s, v) => s + v, 0) / recent.length;
}

// ---------------------------------------------------------------------------
// Precomputed indicator series — O(n) instead of O(n^2)
// ---------------------------------------------------------------------------

export type PrecomputedIndicators = {
  sma: number[];
  ema: number[];
  rsi: number[];
  atr: number[];
};

/**
 * Precompute all indicator series for the full bar array in a single O(n) pass.
 * Returns arrays aligned with the input bars (index 0 = first bar).
 */
export function precomputeIndicators(
  bars: FuturesBar[],
  smaPeriod: number = 10,
  emaPeriod: number = 10,
  rsiPeriod: number = 14,
  atrPeriod: number = 14,
): PrecomputedIndicators {
  const n = bars.length;
  const sma = new Array<number>(n).fill(0);
  const ema = new Array<number>(n).fill(0);
  const rsi = new Array<number>(n).fill(50);
  const atr = new Array<number>(n).fill(0);

  if (n === 0) return { sma, ema, rsi, atr };

  // --- SMA: rolling sum ---
  let smaSum = 0;
  for (let i = 0; i < n; i += 1) {
    smaSum += bars[i].close;
    if (i >= smaPeriod) smaSum -= bars[i - smaPeriod].close;
    const count = Math.min(i + 1, smaPeriod);
    sma[i] = smaSum / count;
  }

  // --- EMA: incremental ---
  const emaK = 2 / (emaPeriod + 1);
  ema[0] = bars[0].close;
  for (let i = 1; i < n; i += 1) {
    ema[i] = bars[i].close * emaK + ema[i - 1] * (1 - emaK);
  }

  // --- RSI: Wilder's smoothing (incremental) ---
  let rsiAvgGain = 0;
  let rsiAvgLoss = 0;
  for (let i = 1; i < n; i += 1) {
    const change = bars[i].close - bars[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    if (i <= rsiPeriod) {
      // Accumulate for seed
      rsiAvgGain += gain;
      rsiAvgLoss += loss;
      if (i === rsiPeriod) {
        rsiAvgGain /= rsiPeriod;
        rsiAvgLoss /= rsiPeriod;
        if (rsiAvgLoss === 0) rsi[i] = 100;
        else {
          const rs = rsiAvgGain / rsiAvgLoss;
          rsi[i] = 100 - 100 / (1 + rs);
        }
      }
    } else {
      // Wilder's smoothing
      rsiAvgGain = (rsiAvgGain * (rsiPeriod - 1) + gain) / rsiPeriod;
      rsiAvgLoss = (rsiAvgLoss * (rsiPeriod - 1) + loss) / rsiPeriod;
      if (rsiAvgLoss === 0) rsi[i] = 100;
      else {
        const rs = rsiAvgGain / rsiAvgLoss;
        rsi[i] = 100 - 100 / (1 + rs);
      }
    }
  }

  // --- ATR: Wilder's smoothed true range ---
  for (let i = 1; i < n; i += 1) {
    const high = bars[i].high;
    const low = bars[i].low;
    const prevClose = bars[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));

    if (i <= atrPeriod) {
      // Simple average for seed period
      atr[i] = (atr[i - 1] * (i - 1) + tr) / i;
    } else {
      // Wilder's smoothing
      atr[i] = (atr[i - 1] * (atrPeriod - 1) + tr) / atrPeriod;
    }
  }

  return { sma, ema, rsi, atr };
}

// ---------------------------------------------------------------------------
// Rule pattern matchers
// ---------------------------------------------------------------------------

type RulePattern = {
  name: string;
  match: RegExp;
  evaluate: (ctx: SignalContext, captures: RegExpMatchArray, params: Record<string, unknown>) => Signal | null;
};

function num(value: string | undefined): number {
  return Number(value) || 0;
}

const RULE_PATTERNS: RulePattern[] = [
  // SMA crossover — uses captured period if specified, otherwise ctx.sma (precomputed default)
  {
    name: 'sma_crossover',
    match: /(?:price|close)\s*(?:crosses?\s*)?(?:above|>)\s*(?:(\d+)[- ]?(?:period\s*)?)?sma/i,
    evaluate: (ctx, captures) => {
      const period = num(captures[1]);
      const smaValue = period > 0 ? computeSMA(ctx.history, period) : ctx.sma;
      const label = period > 0 ? `SMA(${period})` : 'SMA';
      if (ctx.bar.close > smaValue * 1.0025) {
        return { action: 1, reason: `${label} crossover: close ${ctx.bar.close.toFixed(2)} > ${label} ${smaValue.toFixed(2)}`, source: 'rule' };
      }
      return null;
    },
  },
  {
    name: 'sma_crossover_short',
    match: /(?:price|close)\s*(?:crosses?\s*)?(?:below|<)\s*(?:(\d+)[- ]?(?:period\s*)?)?sma/i,
    evaluate: (ctx, captures) => {
      const period = num(captures[1]);
      const smaValue = period > 0 ? computeSMA(ctx.history, period) : ctx.sma;
      const label = period > 0 ? `SMA(${period})` : 'SMA';
      if (ctx.bar.close < smaValue * 0.9975) {
        return { action: -1, reason: `${label} crossunder: close ${ctx.bar.close.toFixed(2)} < ${label} ${smaValue.toFixed(2)}`, source: 'rule' };
      }
      return null;
    },
  },
  // EMA trend — uses captured period if specified
  {
    name: 'ema_above',
    match: /(?:price|close)\s*(?:above|>)\s*(?:(\d+)[- ]?(?:period\s*)?)?ema|ema\s*(?:trend\s*)?up/i,
    evaluate: (ctx, captures) => {
      const period = num(captures[1]);
      const emaValue = period > 0 ? computeEMA(ctx.history, period) : ctx.ema;
      const label = period > 0 ? `EMA(${period})` : 'EMA';
      if (ctx.bar.close > emaValue) {
        return { action: 1, reason: `${label} trend up: close ${ctx.bar.close.toFixed(2)} > ${label} ${emaValue.toFixed(2)}`, source: 'rule' };
      }
      return null;
    },
  },
  {
    name: 'ema_below',
    match: /(?:price|close)\s*(?:below|<)\s*(?:(\d+)[- ]?(?:period\s*)?)?ema|ema\s*(?:trend\s*)?down/i,
    evaluate: (ctx, captures) => {
      const period = num(captures[1]);
      const emaValue = period > 0 ? computeEMA(ctx.history, period) : ctx.ema;
      const label = period > 0 ? `EMA(${period})` : 'EMA';
      if (ctx.bar.close < emaValue) {
        return { action: -1, reason: `${label} trend down: close ${ctx.bar.close.toFixed(2)} < ${label} ${emaValue.toFixed(2)}`, source: 'rule' };
      }
      return null;
    },
  },
  // RSI overbought/oversold
  {
    name: 'rsi_overbought',
    match: /rsi\s*(?:above|>|exceeds?|overbought)\s*(\d+)/i,
    evaluate: (ctx, captures) => {
      const threshold = num(captures[1]) || 70;
      if (ctx.rsi > threshold) {
        return { action: -1, reason: `RSI overbought: ${ctx.rsi.toFixed(1)} > ${threshold}`, source: 'rule' };
      }
      return null;
    },
  },
  {
    name: 'rsi_oversold',
    match: /rsi\s*(?:below|<|oversold)\s*(\d+)/i,
    evaluate: (ctx, captures) => {
      const threshold = num(captures[1]) || 30;
      if (ctx.rsi < threshold) {
        return { action: 1, reason: `RSI oversold: ${ctx.rsi.toFixed(1)} < ${threshold}`, source: 'rule' };
      }
      return null;
    },
  },
  // ATR-based stop
  {
    name: 'atr_stop',
    match: /(?:stop|exit)\s*(?:at\s*)?(\d+\.?\d*)\s*(?:x|times?)\s*atr/i,
    evaluate: (ctx, captures) => {
      const multiplier = num(captures[1]) || 2;
      if (ctx.position !== 0 && ctx.atr > 0) {
        const pnlPoints = Math.abs(ctx.bar.close - ctx.entryPrice);
        if (pnlPoints > ctx.atr * multiplier) {
          return { action: 0, reason: `ATR stop: loss ${pnlPoints.toFixed(2)} > ${multiplier}x ATR (${(ctx.atr * multiplier).toFixed(2)})`, source: 'rule' };
        }
      }
      return null;
    },
  },
  // Max daily loss
  {
    name: 'max_daily_loss',
    match: /(?:max|daily)\s*loss\s*(?:of\s*)?\$?(\d+[\d,]*)/i,
    evaluate: (ctx, captures) => {
      const maxLoss = num(captures[1].replace(/,/g, ''));
      if (maxLoss > 0 && Math.abs(ctx.dailyPnl) > maxLoss && ctx.dailyPnl < 0) {
        return { action: 0, reason: `Max daily loss hit: $${Math.abs(ctx.dailyPnl).toFixed(0)} > $${maxLoss}`, source: 'rule' };
      }
      return null;
    },
  },
  // Drawdown limit
  {
    name: 'drawdown_limit',
    match: /drawdown\s*(?:exceeds?|>|limit)\s*(\d+\.?\d*)%/i,
    evaluate: (ctx, captures) => {
      const limitPct = num(captures[1]) / 100;
      const currentDD = ctx.peakEquity > 0 ? (ctx.peakEquity - ctx.equity) / ctx.peakEquity : 0;
      if (limitPct > 0 && currentDD > limitPct) {
        return { action: 0, reason: `Drawdown limit: ${(currentDD * 100).toFixed(1)}% > ${(limitPct * 100).toFixed(1)}%`, source: 'rule' };
      }
      return null;
    },
  },
  // Take profit
  {
    name: 'take_profit_pct',
    match: /(?:take\s*profit|tp)\s*(?:at\s*)?(\d+\.?\d*)%/i,
    evaluate: (ctx, captures) => {
      const targetPct = num(captures[1]) / 100;
      if (ctx.position !== 0 && targetPct > 0) {
        const pnlPct = ((ctx.bar.close - ctx.entryPrice) * ctx.position) / ctx.entryPrice;
        if (pnlPct >= targetPct) {
          return { action: 0, reason: `Take profit: ${(pnlPct * 100).toFixed(1)}% >= ${(targetPct * 100).toFixed(1)}%`, source: 'rule' };
        }
      }
      return null;
    },
  },
  // Stop loss percentage
  {
    name: 'stop_loss_pct',
    match: /(?:stop\s*loss|sl)\s*(?:at\s*)?(\d+\.?\d*)%/i,
    evaluate: (ctx, captures) => {
      const stopPct = num(captures[1]) / 100;
      if (ctx.position !== 0 && stopPct > 0) {
        const pnlPct = ((ctx.bar.close - ctx.entryPrice) * ctx.position) / ctx.entryPrice;
        if (pnlPct <= -stopPct) {
          return { action: 0, reason: `Stop loss: ${(pnlPct * 100).toFixed(1)}% <= -${(stopPct * 100).toFixed(1)}%`, source: 'rule' };
        }
      }
      return null;
    },
  },
  // Trend direction (price above/below a moving average value from params)
  {
    name: 'trend_up',
    match: /trend\s*(?:is\s*)?(?:up|bullish)|(?:uptrend|bullish\s*trend)/i,
    evaluate: (ctx) => {
      if (ctx.bar.close > ctx.sma && ctx.bar.close > ctx.ema) {
        return { action: 1, reason: `Uptrend confirmed: close > SMA and EMA`, source: 'rule' };
      }
      return null;
    },
  },
  {
    name: 'trend_down',
    match: /trend\s*(?:is\s*)?(?:down|bearish)|(?:downtrend|bearish\s*trend)/i,
    evaluate: (ctx) => {
      if (ctx.bar.close < ctx.sma && ctx.bar.close < ctx.ema) {
        return { action: -1, reason: `Downtrend confirmed: close < SMA and EMA`, source: 'rule' };
      }
      return null;
    },
  },
];

// ---------------------------------------------------------------------------
// Core evaluation
// ---------------------------------------------------------------------------

function matchAndEvaluate(
  rule: string,
  ctx: SignalContext,
  params: Record<string, unknown>
): Signal | null {
  for (const pattern of RULE_PATTERNS) {
    const match = rule.match(pattern.match);
    if (match) {
      return pattern.evaluate(ctx, match, params);
    }
  }
  return null; // no pattern matched
}

/**
 * Evaluate strategy rules against current market context.
 * Priority: risk_management (force exit) > exit_rules > entry_rules
 */
export function evaluateRuleBasedSignal(
  rules: StrategyRules,
  ctx: SignalContext
): Signal | null {
  // 1. Risk management rules always take priority (can force flat)
  for (const rule of rules.risk_management) {
    const signal = matchAndEvaluate(rule, ctx, rules.parameters);
    if (signal && signal.action === 0) return signal;
  }

  // 2. Exit rules if currently in a position
  if (ctx.position !== 0) {
    for (const rule of rules.exit_rules) {
      const signal = matchAndEvaluate(rule, ctx, rules.parameters);
      if (signal && signal.action === 0) return signal;
    }
  }

  // 3. Entry rules
  for (const rule of rules.entry_rules) {
    const signal = matchAndEvaluate(rule, ctx, rules.parameters);
    if (signal && signal.action !== 0) return signal;
  }

  return null; // no signal = hold current position
}

/**
 * Check if any rules were matched by the rule-based engine.
 * Returns true if at least one rule pattern was recognized.
 */
export function hasMatchableRules(rules: StrategyRules): boolean {
  const allRules = [...rules.entry_rules, ...rules.exit_rules, ...rules.risk_management];
  return allRules.some(rule =>
    RULE_PATTERNS.some(pattern => pattern.match.test(rule))
  );
}

// ---------------------------------------------------------------------------
// AI fallback for unrecognized rules
// ---------------------------------------------------------------------------

export async function evaluateAiSignal(
  rules: StrategyRules,
  ctx: SignalContext
): Promise<Signal> {
  const agentUrl = process.env.PYTHON_URL ?? 'http://localhost:5001';

  const prompt = `You are a trading signal generator. Given the following strategy rules and current market state, decide the signal.

STRATEGY RULES:
Entry: ${JSON.stringify(rules.entry_rules)}
Exit: ${JSON.stringify(rules.exit_rules)}
Risk: ${JSON.stringify(rules.risk_management)}
Parameters: ${JSON.stringify(rules.parameters)}

CURRENT STATE:
Bar: ${ctx.bar.timestamp} O=${ctx.bar.open.toFixed(2)} H=${ctx.bar.high.toFixed(2)} L=${ctx.bar.low.toFixed(2)} C=${ctx.bar.close.toFixed(2)}
Position: ${ctx.position === 1 ? 'LONG' : ctx.position === -1 ? 'SHORT' : 'FLAT'}
Entry Price: ${ctx.entryPrice.toFixed(2)}
SMA: ${ctx.sma.toFixed(2)}, EMA: ${ctx.ema.toFixed(2)}, RSI: ${ctx.rsi.toFixed(1)}, ATR: ${ctx.atr.toFixed(2)}
P&L: Daily=$${ctx.dailyPnl.toFixed(0)} Total=$${ctx.totalPnl.toFixed(0)}
Equity: $${ctx.equity.toFixed(0)} (Peak: $${ctx.peakEquity.toFixed(0)})

Respond with ONLY a JSON object: {"signal": 1, "reasoning": "..."} where signal is 1 (long), -1 (short), or 0 (flat/exit).`;

  try {
    const response = await axios.post(`${agentUrl}/interpret-rules`, {
      entry_rules: rules.entry_rules,
      exit_rules: rules.exit_rules,
      risk_management: rules.risk_management,
      parameters: rules.parameters,
      context: {
        bar: ctx.bar,
        position: ctx.position,
        entryPrice: ctx.entryPrice,
        sma: ctx.sma,
        ema: ctx.ema,
        rsi: ctx.rsi,
        atr: ctx.atr,
        equity: ctx.equity,
        peakEquity: ctx.peakEquity,
        dailyPnl: ctx.dailyPnl,
        totalPnl: ctx.totalPnl,
      },
    }, { timeout: 10_000 });

    const data = response.data;
    const signal = typeof data.signal === 'number' ? data.signal : 0;
    const reasoning = typeof data.reasoning === 'string' ? data.reasoning : 'AI signal';

    return {
      action: signal === 1 ? 1 : signal === -1 ? -1 : 0,
      reason: reasoning,
      source: 'ai',
    };
  } catch (err: any) {
    console.warn('[SIGNAL-ENGINE] AI fallback failed:', err?.message);
    return { action: 0, reason: 'AI fallback unavailable, holding position', source: 'ai' };
  }
}
