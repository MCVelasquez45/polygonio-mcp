export type StrategyAssetClass = 'equity' | 'option' | 'etf' | 'commodity' | 'macro';
export type StrategyDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type StrategyRecommendationAction = 'BUY' | 'WATCH' | 'WAIT' | 'SKIP' | 'NO_TRADE';
export type MarketRegimeType =
  | 'TRENDING'
  | 'RANGE_BOUND'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'RISK_OFF'
  | 'RISK_ON'
  | 'MACRO_DRIVEN'
  | 'NEWS_DRIVEN'
  | 'SECTOR_ROTATION'
  | 'UNKNOWN';

export type StrategyEvaluationContext = {
  timestamp: string;
  eventContext: {
    latestEvents: Array<{
      id: string;
      title: string;
      category: string;
      importance: number;
      sentiment: number | string | null;
      affectedSymbols: string[];
      affectedEtfs: string[];
      affectedSectors: string[];
    }>;
  };
  decisionContext: {
    latestScanId: string | null;
    bestOpportunity: { symbol: string; score: number; confidence: number; recommendation: string } | null;
    rejectedCount: number;
    noTradeReason: string | null;
  };
  marketData: {
    marketStatus: string;
    trendScore: number | null;
    momentumScore: number | null;
    volatilityScore: number | null;
  };
  portfolio: PortfolioContext;
  watchlist: string[];
  news: string[];
  sentiment: { bullish: number; bearish: number; neutral: number };
  technicalAnalysis: Record<string, number | string | null>;
  marketRegime: MarketRegime;
};

export type PortfolioContext = {
  currentPositions: Array<{
    symbol: string;
    underlying: string | null;
    sector: string | null;
    quantity: number | null;
    marketValue: number | null;
    unrealizedPnl: number | null;
    delta: number | null;
    gamma: number | null;
    theta: number | null;
    vega: number | null;
  }>;
  buyingPower: number | null;
  sectorExposure: Record<string, number>;
  openRisk: number | null;
  greeks: { delta: number | null; gamma: number | null; theta: number | null; vega: number | null };
  availableCapital: number | null;
  maximumDailyLoss: number | null;
  adjustmentExplanation: string;
};

export type MarketRegime = {
  current: MarketRegimeType;
  historical: MarketRegimeType[];
  confidence: number;
  explanation: string;
};

export type StrategyEvaluation = {
  strategyId: string;
  name: string;
  direction: StrategyDirection;
  confidence: number;
  risk: number;
  expectedReturn: number;
  positionSize: number;
  evidenceScore: number;
  reasoning: string[];
  rejected: boolean;
  rejectionReason: string | null;
};

export type StrategyDefinition = {
  id: string;
  name: string;
  description: string;
  requiredInputs: string[];
  supportedAssets: StrategyAssetClass[];
  evaluate: (context: StrategyEvaluationContext) => StrategyEvaluation;
};

export type StrategyRanking = {
  strategyId: string;
  name: string;
  score: number;
  confidence: number;
  risk: number;
  expectedReturn: number;
  evidenceScore: number;
  rejected: boolean;
  rejectionReason: string | null;
};

export type ConflictSummary = {
  hasConflict: boolean;
  bullishStrategies: string[];
  bearishStrategies: string[];
  neutralStrategies: string[];
  confidenceAdjustment: number;
  recommendedAction: StrategyRecommendationAction;
  explanation: string;
};

export type EvidenceScore = {
  score: number;
  explanation: string;
  components: Record<string, number>;
};

export type RecommendationPackage = {
  action: StrategyRecommendationAction;
  explanation: string;
  supportingStrategies: StrategyRanking[];
  rejectedStrategies: StrategyRanking[];
  confidence: number;
  evidence: EvidenceScore;
  riskHandoff: {
    allowedForRiskReview: boolean;
    message: string;
    packageId: string;
  };
};

export type StrategyOrchestratorRun = {
  runId: string;
  timestamp: string;
  strategiesEvaluated: StrategyEvaluation[];
  rankings: StrategyRanking[];
  winner: StrategyRanking | null;
  conflicts: ConflictSummary;
  recommendation: RecommendationPackage;
  evidence: EvidenceScore;
  marketContext: { regime: MarketRegime; marketStatus: string };
  decisionEngineContext: StrategyEvaluationContext['decisionContext'];
  eventContext: StrategyEvaluationContext['eventContext'];
  portfolioContext: PortfolioContext;
  schemaVersion: number;
};
