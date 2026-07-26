import { randomUUID } from 'crypto';
import type {
  ConflictSummary,
  EvidenceScore,
  RecommendationPackage,
  StrategyRanking,
  StrategyRecommendationAction,
} from '../types/orchestratorTypes';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

export function buildRecommendationPackage(args: {
  rankings: StrategyRanking[];
  conflicts: ConflictSummary;
  evidence: EvidenceScore;
}): RecommendationPackage {
  const winner = args.rankings.find(ranking => !ranking.rejected) ?? null;
  let action: StrategyRecommendationAction = args.conflicts.recommendedAction;
  if (!winner) action = 'NO_TRADE';
  else if (action !== 'WAIT') {
    if (winner.score >= 75 && args.evidence.score >= 65) action = 'BUY';
    else if (winner.score >= 55) action = 'WATCH';
    else if (winner.score >= 40) action = 'WAIT';
    else action = 'SKIP';
  }
  const confidence = clamp01((winner?.confidence ?? 0) + args.conflicts.confidenceAdjustment);
  const supportingStrategies = args.rankings.filter(ranking => !ranking.rejected).slice(0, 5);
  const rejectedStrategies = args.rankings.filter(ranking => ranking.rejected);
  return {
    action,
    explanation: winner
      ? `${action}: ${winner.name} leads with score ${winner.score.toFixed(1)}. ${args.conflicts.explanation} ${args.evidence.explanation}`
      : `NO_TRADE: no strategy cleared the evidence threshold. ${args.evidence.explanation}`,
    supportingStrategies,
    rejectedStrategies,
    confidence,
    evidence: args.evidence,
    riskHandoff: {
      allowedForRiskReview: action === 'BUY' || action === 'WATCH',
      message: 'Recommendation package only. Risk Engine must independently approve before any execution path can act.',
      packageId: randomUUID(),
    },
  };
}
