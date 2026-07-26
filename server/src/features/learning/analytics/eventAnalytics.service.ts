import { LearningTradeReviewModel } from '../storage/learningTradeReview.model';

function finite(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function classifyEvent(review: any): string[] {
  const text = JSON.stringify([
    review.fedEvent,
    review.newsEvent,
    review.evidence?.eventIds,
    review.entryReason,
    review.exitReason,
    review.whySucceeded,
    review.whyFailed,
  ]).toLowerCase();
  const events = new Set<string>();
  if (text.includes('fed') || text.includes('fomc') || text.includes('powell')) events.add('Fed');
  if (text.includes('cpi')) events.add('CPI');
  if (text.includes('ppi')) events.add('PPI');
  if (text.includes('jobs') || text.includes('payroll')) events.add('Jobs');
  if (text.includes('oil') || text.includes('crude') || text.includes('energy')) events.add('Oil');
  if (text.includes('earnings')) events.add('Earnings');
  if (text.includes('breaking') || text.includes('headline') || review.newsEvent === 'BREAKING_NEWS') events.add('Breaking News');
  if (text.includes('sentiment')) events.add('Sentiment');
  if (finite(review.evidenceScore) != null || text.includes('flow')) events.add('Options Flow');
  if (!events.size) events.add('Unclassified');
  return [...events];
}

export async function getLearningEventAnalytics() {
  const reviews = await LearningTradeReviewModel.find({}).sort({ exitTimestamp: -1 }).lean();
  const groups = new Map<string, typeof reviews>();
  for (const review of reviews) {
    for (const event of classifyEvent(review)) {
      groups.set(event, [...(groups.get(event) ?? []), review]);
    }
  }
  const events = [...groups.entries()].map(([event, group]) => {
    const returns = group.map(review => finite(review.actualReturn)).filter((value): value is number => value != null);
    const wins = group.filter(review => review.outcome === 'WIN' || review.outcome === 'PARTIAL_WIN').length;
    const strategyCounts = new Map<string, number>();
    for (const review of group) {
      const strategy = review.winningStrategy ?? review.entryStrategy ?? 'UNAVAILABLE';
      strategyCounts.set(strategy, (strategyCounts.get(strategy) ?? 0) + 1);
    }
    return {
      event,
      trades: group.length,
      winRate: group.length ? wins / group.length : null,
      averageReturn: returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null,
      topStrategies: [...strategyCounts.entries()]
        .map(([strategy, trades]) => ({ strategy, trades }))
        .sort((a, b) => b.trades - a.trades)
        .slice(0, 5),
    };
  });
  return { generatedAt: new Date().toISOString(), events: events.sort((a, b) => b.trades - a.trades) };
}
