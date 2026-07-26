import type {
  MarketRegime,
  RecommendationPackage,
  StrategyOrchestratorRun,
} from '../../strategyOrchestrator/types/orchestratorTypes';

export type RiskDecisionStatus = 'APPROVE' | 'REJECT';

export type RiskReasonCode =
  | 'MAX_SECTOR_EXPOSURE'
  | 'MAX_POSITION_SIZE'
  | 'LOW_LIQUIDITY'
  | 'HIGH_SPREAD'
  | 'HIGH_IV'
  | 'LOW_CONFIDENCE'
  | 'MAX_DAILY_LOSS'
  | 'INSUFFICIENT_BUYING_POWER'
  | 'HIGH_CORRELATION'
  | 'MAX_GAMMA'
  | 'MAX_DELTA'
  | 'MAX_THETA'
  | 'MAX_VEGA'
  | 'MARKET_CLOSED'
  | 'NEWS_LOCKOUT'
  | 'MAX_OPEN_TRADES'
  | 'MAX_DOLLAR_RISK'
  | 'NO_ACTIONABLE_RECOMMENDATION'
  | 'MISSING_LIQUIDITY_DATA';

export type RiskRuleSet = {
  ruleVersion: string;
  maximumContracts: number;
  maximumDollarRisk: number;
  maximumDailyLoss: number;
  maximumPositionSizePct: number;
  maximumSectorExposurePct: number;
  maximumCorrelation: number;
  maximumGamma: number;
  maximumTheta: number;
  maximumDelta: number;
  maximumVega: number;
  maximumOpenTrades: number;
  minimumConfidence: number;
  maximumSpreadPct: number;
  minimumVolume: number;
  minimumOpenInterest: number;
  maximumIv: number;
  newsLockoutImportance: number;
  defaultPortfolioSize: number;
  defaultContractRisk: number;
  createdAt: string;
  reason: string;
};

export type RiskLiquidityMetrics = {
  bid: number | null;
  ask: number | null;
  spreadPct: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
};

export type RiskRecommendationInput = {
  recommendationId: string;
  strategyRunId: string | null;
  recommendation: RecommendationPackage;
  symbol: string | null;
  sector: string | null;
  strategyId: string | null;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  expectedReturn: number;
  contract?: {
    symbol: string | null;
    estimatedUnitRisk: number | null;
    liquidity: RiskLiquidityMetrics;
    greeks: RiskGreekSnapshot;
  };
  marketRegime: MarketRegime;
  marketStatus: string;
  eventContext: StrategyOrchestratorRun['eventContext'];
  raw: StrategyOrchestratorRun | Record<string, unknown>;
};

export type RiskExposureSnapshot = {
  sectorExposure: Record<string, number>;
  tickerExposure: Record<string, number>;
  strategyExposure: Record<string, number>;
  macroExposure: Record<string, number>;
  longExposure: number;
  shortExposure: number;
  cashAllocation: number | null;
  maximumConcurrentTrades: number;
  currentOpenTrades: number;
  historicalMaximum: Record<string, number>;
  recommended: Record<string, number>;
};

export type RiskGreekSnapshot = {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
};

export type RiskBudgetSnapshot = {
  dailyRealizedLoss: number;
  dailyUnrealizedLoss: number;
  riskConsumed: number;
  remainingRiskBudget: number;
  maximumConsecutiveLosses: number;
  consecutiveLosses: number;
  maximumOpenRisk: number;
  openRisk: number;
};

export type RiskPortfolioSnapshot = {
  timestamp: string;
  portfolioSize: number;
  buyingPower: number | null;
  availableCapital: number | null;
  currentPositions: Array<{
    symbol: string;
    underlying: string | null;
    sector: string | null;
    strategyId: string | null;
    direction: 'LONG' | 'SHORT' | 'UNKNOWN';
    quantity: number;
    marketValue: number;
    unrealizedPnl: number;
    greeks: RiskGreekSnapshot;
  }>;
  exposure: RiskExposureSnapshot;
  greeks: RiskGreekSnapshot;
  riskBudget: RiskBudgetSnapshot;
};

export type CorrelationResult = {
  score: number;
  correlatedSymbols: string[];
  explanation: string;
};

export type PositionSizeResult = {
  suggestedContracts: number;
  dollarRisk: number;
  capitalAllocation: number;
  expectedPortfolioImpact: number;
  explanation: string;
};

export type RiskCheck = {
  code: RiskReasonCode | 'PASSED';
  passed: boolean;
  explanation: string;
  supportingMetrics: Record<string, number | string | boolean | null>;
  suggestedImprovement: string | null;
};

export type ApprovalPackage = {
  approved: boolean;
  status: RiskDecisionStatus;
  approvalId: string;
  recommendationId: string;
  suggestedPositionSize: PositionSizeResult;
  portfolioRisk: RiskBudgetSnapshot;
  sectorExposure: RiskExposureSnapshot['sectorExposure'];
  correlationRisk: CorrelationResult;
  liquidityRisk: RiskCheck;
  greekRisk: RiskCheck;
  buyingPowerRisk: RiskCheck;
  remainingRiskBudget: number;
  reasons: Array<{
    code: RiskReasonCode;
    explanation: string;
    supportingMetrics: Record<string, number | string | boolean | null>;
    suggestedImprovement: string | null;
  }>;
  warnings: string[];
  timestamp: string;
};

export type RiskJournalRecord = {
  approvalId: string;
  timestamp: string;
  recommendation: RiskRecommendationInput;
  approval: ApprovalPackage;
  rejection: ApprovalPackage['reasons'];
  reasonCodes: RiskReasonCode[];
  portfolioSnapshot: RiskPortfolioSnapshot;
  exposure: RiskExposureSnapshot;
  greeks: RiskGreekSnapshot;
  buyingPower: number | null;
  riskBudget: RiskBudgetSnapshot;
  ruleVersion: string;
  schemaVersion: number;
};
