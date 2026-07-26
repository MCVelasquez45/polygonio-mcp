import type { EvidenceScore, StrategyEvaluationContext } from '../types/orchestratorTypes';

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}

export function buildEvidenceScore(context: StrategyEvaluationContext): EvidenceScore {
  const event = Math.min(25, context.eventContext.latestEvents.reduce((max, item) => Math.max(max, item.importance), 0) * 0.25);
  const decision = context.decisionContext.bestOpportunity ? context.decisionContext.bestOpportunity.score * 0.25 : 0;
  const portfolio = context.portfolio.currentPositions.length ? 10 : 15;
  const sentiment = Math.min(15, context.sentiment.bullish * 4 + context.sentiment.bearish * 4 + context.sentiment.neutral * 2);
  const regime = context.marketRegime.confidence * 15;
  const watchlist = Math.min(10, context.watchlist.length);
  const score = clamp(event + decision + portfolio + sentiment + regime + watchlist);
  return {
    score,
    explanation: `Evidence score ${score}/100 from event impact, decision context, portfolio capacity, sentiment, regime confidence, and watchlist breadth.`,
    components: { event, decision, portfolio, sentiment, regime, watchlist },
  };
}
