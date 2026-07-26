import type { ConflictSummary, StrategyEvaluation, StrategyRanking, StrategyRecommendationAction } from '../types/orchestratorTypes';

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}

export function rankStrategies(evaluations: StrategyEvaluation[]): StrategyRanking[] {
  return evaluations
    .map(evaluation => ({
      strategyId: evaluation.strategyId,
      name: evaluation.name,
      score: evaluation.rejected
        ? 0
        : clamp(evaluation.confidence * 35 + evaluation.expectedReturn * 20 + evaluation.evidenceScore * 0.35 - evaluation.risk * 15),
      confidence: evaluation.confidence,
      risk: evaluation.risk,
      expectedReturn: evaluation.expectedReturn,
      evidenceScore: evaluation.evidenceScore,
      rejected: evaluation.rejected,
      rejectionReason: evaluation.rejectionReason,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export function resolveStrategyConflicts(evaluations: StrategyEvaluation[]): ConflictSummary {
  const active = evaluations.filter(evaluation => !evaluation.rejected && evaluation.confidence >= 0.45);
  const bullishStrategies = active.filter(evaluation => evaluation.direction === 'BULLISH').map(evaluation => evaluation.name);
  const bearishStrategies = active.filter(evaluation => evaluation.direction === 'BEARISH').map(evaluation => evaluation.name);
  const neutralStrategies = active.filter(evaluation => evaluation.direction === 'NEUTRAL').map(evaluation => evaluation.name);
  const hasConflict = bullishStrategies.length > 0 && bearishStrategies.length > 0;
  const confidenceAdjustment = hasConflict ? -0.18 : neutralStrategies.length > bullishStrategies.length + bearishStrategies.length ? -0.08 : 0;
  let recommendedAction: StrategyRecommendationAction = 'WATCH';
  if (hasConflict) recommendedAction = 'WAIT';
  else if (!active.length) recommendedAction = 'NO_TRADE';
  return {
    hasConflict,
    bullishStrategies,
    bearishStrategies,
    neutralStrategies,
    confidenceAdjustment,
    recommendedAction,
    explanation: hasConflict
      ? `Conflict detected: bullish strategies (${bullishStrategies.join(', ')}) disagree with bearish strategies (${bearishStrategies.join(', ')}).`
      : `No directional conflict across ${active.length} active strategies.`,
  };
}
