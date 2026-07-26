export type LearningOutcome = 'WIN' | 'LOSS' | 'PARTIAL_WIN' | 'BREAKEVEN' | 'UNKNOWN';

export type LearningWindow = 'LAST_30_DAYS' | 'LAST_90_DAYS' | 'LIFETIME';

export type LearningTradeReview = {
  reviewId: string;
  schemaVersion: number;
  sourceReportId: string;
  sourceTradeId: string;
  generatedAt: Date;
  entryTimestamp: Date | null;
  exitTimestamp: Date | null;
  entryStrategy: string | null;
  winningStrategy: string | null;
  marketRegime: string | null;
  fedEvent: string | null;
  newsEvent: string | null;
  sector: string | null;
  symbol: string | null;
  contract: string | null;
  direction: string | null;
  confidence: number | null;
  evidenceScore: number | null;
  riskScore: number | null;
  entryReason: string | null;
  exitReason: string | null;
  maximumFavorableExcursion: number | null;
  maximumAdverseExcursion: number | null;
  holdingTimeMinutes: number | null;
  expectedReturn: number | null;
  actualReturn: number | null;
  realizedPnl: number | null;
  outcome: LearningOutcome;
  win: boolean;
  loss: boolean;
  partialWin: boolean;
  whySucceeded: string[];
  whyFailed: string[];
  whatCouldImprove: string[];
  evidence: {
    eventIds: string[];
    positionId: string | null;
    riskDecisionId: string | null;
    tradeCandidateId: string | null;
    contractSelectionId: string | null;
    universeEvaluationIds: string[];
    tradeReportId: string;
  };
};

export type LearningDatasetRecord = {
  datasetId: string;
  schemaVersion: number;
  sourceReportId: string;
  sourceTradeId: string;
  generatedAt: Date;
  version: string;
  marketSnapshot: Record<string, unknown> | null;
  technicalIndicators: Record<string, unknown> | null;
  massiveData: Record<string, unknown> | null;
  news: Record<string, unknown> | null;
  sentiment: Record<string, unknown> | null;
  eventIntelligence: Record<string, unknown> | null;
  decisionIntelligence: Record<string, unknown> | null;
  strategyRankings: Record<string, unknown> | null;
  riskPackage: Record<string, unknown> | null;
  lifecycle: Record<string, unknown> | null;
  executionResult: Record<string, unknown> | null;
  tradeEvaluation: Record<string, unknown> | null;
  outcome: {
    label: LearningOutcome;
    actualReturn: number | null;
    realizedPnl: number | null;
  };
};
