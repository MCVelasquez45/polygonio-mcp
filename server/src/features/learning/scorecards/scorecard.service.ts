import { LearningTradeReviewModel } from '../storage/learningTradeReview.model';
import type { LearningWindow } from '../types/learningTypes';

type ReviewLike = {
  winningStrategy?: string | null;
  marketRegime?: string | null;
  sector?: string | null;
  exitTimestamp?: Date | string | null;
  outcome?: string | null;
  actualReturn?: number | null;
  realizedPnl?: number | null;
  holdingTimeMinutes?: number | null;
  riskScore?: number | null;
  confidence?: number | null;
};

function finite(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function avg(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function stddev(values: number[]): number | null {
  const average = avg(values);
  if (average == null || values.length < 2) return null;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function maxDrawdown(returns: number[]): number | null {
  if (!returns.length) return null;
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const value of returns) {
    equity += value;
    peak = Math.max(peak, equity);
    drawdown = Math.min(drawdown, equity - peak);
  }
  return drawdown;
}

function since(window: LearningWindow): Date | null {
  const now = Date.now();
  if (window === 'LAST_30_DAYS') return new Date(now - 30 * 24 * 60 * 60 * 1000);
  if (window === 'LAST_90_DAYS') return new Date(now - 90 * 24 * 60 * 60 * 1000);
  return null;
}

function summarize(group: ReviewLike[], key: string, window: LearningWindow) {
  const returns = group.map(item => finite(item.actualReturn)).filter((value): value is number => value != null);
  const risks = group.map(item => finite(item.riskScore)).filter((value): value is number => value != null);
  const holds = group.map(item => finite(item.holdingTimeMinutes)).filter((value): value is number => value != null);
  const wins = group.filter(item => item.outcome === 'WIN' || item.outcome === 'PARTIAL_WIN').length;
  const losses = group.filter(item => item.outcome === 'LOSS').length;
  const largestWinner = returns.length ? Math.max(...returns) : null;
  const largestLoser = returns.length ? Math.min(...returns) : null;
  const volatility = stddev(returns);
  const averageReturn = avg(returns);
  return {
    key,
    window,
    totalTrades: group.length,
    wins,
    losses,
    winRate: group.length ? wins / group.length : null,
    averageReturn,
    medianReturn: median(returns),
    averageHoldTimeMinutes: avg(holds),
    averageRisk: avg(risks),
    largestWinner,
    largestLoser,
    sharpe: averageReturn != null && volatility && volatility > 0 ? averageReturn / volatility : null,
    maxDrawdown: maxDrawdown(returns),
  };
}

async function reviewsForWindow(window: LearningWindow) {
  const start = since(window);
  const query = start ? { exitTimestamp: { $gte: start } } : {};
  return LearningTradeReviewModel.find(query).sort({ exitTimestamp: 1 }).lean();
}

export async function getLearningStrategyScorecards() {
  const windows: LearningWindow[] = ['LAST_30_DAYS', 'LAST_90_DAYS', 'LIFETIME'];
  const results = await Promise.all(windows.map(async window => {
    const reviews = await reviewsForWindow(window);
    const byStrategy = new Map<string, ReviewLike[]>();
    for (const review of reviews) {
      const key = review.winningStrategy ?? review.entryStrategy ?? 'UNAVAILABLE';
      byStrategy.set(key, [...(byStrategy.get(key) ?? []), review]);
    }
    return [...byStrategy.entries()]
      .map(([key, group]) => summarize(group, key, window))
      .sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1) || b.totalTrades - a.totalTrades);
  }));
  return { generatedAt: new Date().toISOString(), scorecards: results.flat() };
}

export async function getLearningRegimeAnalytics() {
  const reviews = await LearningTradeReviewModel.find({}).sort({ exitTimestamp: -1 }).lean();
  const groups = new Map<string, ReviewLike[]>();
  for (const review of reviews) {
    const keys = new Set([review.marketRegime ?? 'UNAVAILABLE']);
    const regimeText = `${review.marketRegime ?? ''} ${review.newsEvent ?? ''} ${review.fedEvent ?? ''}`.toLowerCase();
    if (regimeText.includes('trend')) keys.add('TRENDING');
    if (regimeText.includes('range')) keys.add('RANGE');
    if (regimeText.includes('high vol')) keys.add('HIGH_VOLATILITY');
    if (regimeText.includes('low vol')) keys.add('LOW_VOLATILITY');
    if (regimeText.includes('risk on')) keys.add('RISK_ON');
    if (regimeText.includes('risk off')) keys.add('RISK_OFF');
    if (review.newsEvent) keys.add('NEWS_DRIVEN');
    if (review.fedEvent) keys.add('FED');
    if (`${review.sector ?? ''}`.toLowerCase().includes('energy')) keys.add('ENERGY_ROTATION');
    for (const key of keys) groups.set(key, [...(groups.get(key) ?? []), review]);
  }
  return {
    generatedAt: new Date().toISOString(),
    regimes: [...groups.entries()].map(([key, group]) => summarize(group, key, 'LIFETIME')).sort((a, b) => b.totalTrades - a.totalTrades),
  };
}
