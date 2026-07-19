// Client-side derivations over already-generated intelligence data.
//
// IMPORTANT: these are presentation-layer syntheses only. They never call the
// backend and never alter generated intelligence — they re-shape fields the
// generators already produced (e.g. deriving a "Tomorrow focus" line from the
// daily report's existing keyFindings / worstDecision / primaryLesson).

import type { DailyReport, DecisionJournalEntry, StrategyAnalyticsBucket } from '../api/intelligence';
import type { ChartDatum } from '../components/intelligence/ui';

/**
 * Tomorrow's focus, synthesized from the day's existing evidence. Not a backend
 * field — a presentation-layer read of what the report already surfaced.
 */
export function deriveTomorrowFocus(daily: DailyReport | null | undefined): string {
  if (!daily) return 'No focus derived — no report for today yet.';
  const es = daily.executiveSummary;
  const worst = es.worstDecision?.trim();
  const lesson = es.primaryLesson?.trim();
  const lastFinding = [...(es.keyFindings ?? [])].reverse().find(f => f.trim().length > 0);
  if (worst) return `Review and correct: ${worst}`;
  if (lesson) return `Carry forward: ${lesson}`;
  if (lastFinding) return lastFinding;
  return 'No specific focus derived from today’s evidence.';
}

export type DecisionBucketKey =
  | 'BUY_APPROVED'
  | 'BUY_REJECTED'
  | 'RISK_REJECTED'
  | 'DATA_REJECTED'
  | 'NO_SIGNAL'
  | 'EMERGENCY_STOP';

export const DECISION_BUCKETS: Array<{ key: DecisionBucketKey; label: string; tone: 'pos' | 'neg' | 'warn' | 'neutral' }> = [
  { key: 'BUY_APPROVED', label: 'Buy Approved', tone: 'pos' },
  { key: 'BUY_REJECTED', label: 'Buy Rejected', tone: 'neg' },
  { key: 'RISK_REJECTED', label: 'Risk Reject', tone: 'warn' },
  { key: 'DATA_REJECTED', label: 'Data Reject', tone: 'neutral' },
  { key: 'NO_SIGNAL', label: 'No Signal', tone: 'neutral' },
  { key: 'EMERGENCY_STOP', label: 'Emergency', tone: 'neg' },
];

/** Count decision entries into the six summary buckets. */
export function decisionDistribution(entries: DecisionJournalEntry[]): Record<DecisionBucketKey, number> {
  const counts: Record<DecisionBucketKey, number> = {
    BUY_APPROVED: 0, BUY_REJECTED: 0, RISK_REJECTED: 0, DATA_REJECTED: 0, NO_SIGNAL: 0, EMERGENCY_STOP: 0,
  };
  for (const e of entries) {
    if (e.decisionType in counts) counts[e.decisionType as DecisionBucketKey] += 1;
  }
  return counts;
}

/** Map analytics buckets to ranked chart data by net P/L (drops empty buckets). */
export function bucketsToPnlChart(buckets: StrategyAnalyticsBucket[]): ChartDatum[] {
  return buckets
    .filter(b => typeof b.netPnl === 'number' && Number.isFinite(b.netPnl))
    .map(b => ({ label: b.label, value: b.netPnl as number }));
}

/** Map analytics buckets to distribution chart data by trade count. */
export function bucketsToCountChart(buckets: StrategyAnalyticsBucket[]): ChartDatum[] {
  return buckets.map(b => ({ label: b.label, value: b.totalTrades }));
}
