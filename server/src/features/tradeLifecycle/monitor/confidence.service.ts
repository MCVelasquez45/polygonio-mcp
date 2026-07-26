import type { ConfidenceTrend, LifecycleConfidence } from '../types/lifecycleTypes';

function finite(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampConfidence(value: number | null): number | null {
  if (value == null) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function extractEntryConfidence(candidate: any | null, fallback: number | null = null): number | null {
  const conditions = candidate?.conditions ?? {};
  const raw =
    finite(conditions.confidence) ??
    finite(conditions.score) ??
    finite(conditions.flowScore) ??
    finite(candidate?.score) ??
    fallback;
  if (raw == null) return null;
  return clampConfidence(raw <= 1 ? raw * 100 : raw);
}

export function classifyConfidenceTrend(entry: number | null, current: number | null): ConfidenceTrend {
  if (entry == null || current == null) return 'Unknown';
  const delta = current - entry;
  if (delta >= 5) return 'Improving';
  if (delta <= -5) return 'Weakening';
  return 'Stable';
}

export function buildCurrentConfidence(args: {
  entryConfidence: number | null;
  returnPct: number | null;
  spreadPct: number | null;
  daysToExpiration: number | null;
  quoteFresh: boolean | null;
  riskChanged: boolean;
  strategyChanged: boolean;
}): LifecycleConfidence {
  let score = args.entryConfidence ?? 50;
  if (args.returnPct != null) score += Math.max(-12, Math.min(12, args.returnPct / 3));
  if (args.spreadPct != null && args.spreadPct > 15) score -= 8;
  if (args.daysToExpiration != null && args.daysToExpiration <= 2) score -= 10;
  if (args.quoteFresh === false) score -= 10;
  if (args.riskChanged) score -= 12;
  if (args.strategyChanged) score -= 15;
  const current = clampConfidence(score);
  return {
    entry: args.entryConfidence,
    current,
    trend: classifyConfidenceTrend(args.entryConfidence, current),
    delta: args.entryConfidence != null && current != null ? current - args.entryConfidence : null,
    changedAt: new Date(),
  };
}
