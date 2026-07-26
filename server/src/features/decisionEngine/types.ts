export const DECISION_ENGINE_REASON_CODES = [
  'LOW_VOLUME',
  'HIGH_SPREAD',
  'LOW_CONFIDENCE',
  'POOR_RISK_REWARD',
  'HIGH_IV',
  'LOW_OPEN_INTEREST',
  'MARKET_CLOSED',
  'BUYING_POWER',
  'DATA_UNAVAILABLE',
  'INCOMPLETE_CHAIN',
  'STALE_QUOTE',
  'NO_BID_ASK',
  'LOW_LIQUIDITY',
  'WEAK_TREND',
  'WEAK_MOMENTUM',
  'ELEVATED_RISK',
] as const;

export type DecisionEngineReasonCode = (typeof DECISION_ENGINE_REASON_CODES)[number];

export type ScoreKey =
  | 'liquidity'
  | 'trend'
  | 'momentum'
  | 'spread'
  | 'volatility'
  | 'risk'
  | 'confidence'
  | 'overall';

export type ExplainedScore = {
  key: ScoreKey;
  score: number;
  maxScore: 100;
  grade: 'STRONG' | 'ACCEPTABLE' | 'WEAK' | 'UNAVAILABLE';
  explanation: string;
  inputs: Record<string, number | string | boolean | null>;
};

export type DecisionScores = Record<ScoreKey, ExplainedScore>;

export type DecisionContractSnapshot = {
  symbol: string;
  type: 'call' | 'put';
  strike: number | null;
  expiration: string | null;
  dte: number | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spread: number | null;
  spreadPct: number | null;
  volume: number | null;
  openInterest: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  quoteTimestamp: string | null;
};

export type DecisionMarketContext = {
  marketStatus: string;
  underlyingPrice: number | null;
  underlyingTimeframe: string | null;
  sector: string | null;
  marketBreadth: Record<string, unknown> | null;
  news: Array<Record<string, unknown>>;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN';
  momentum: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'UNKNOWN';
};

export type AiResearchOutput = {
  symbol: string;
  contract: string;
  confidence: number;
  bullishReasons: string[];
  bearishReasons: string[];
  risks: string[];
  marketContext: DecisionMarketContext;
  expectedMove: {
    source: 'SUPPLIED_IV' | 'UNAVAILABLE';
    value: number | null;
    explanation: string;
  };
  recommendation: 'BUY_CALL' | 'BUY_PUT' | 'WATCH' | 'AVOID';
  explanation: string;
};

export type CandidateOpportunity = {
  id: string;
  symbol: string;
  contract: DecisionContractSnapshot;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  watchlistRank: number | null;
  scores: DecisionScores;
  confidence: number;
  overallScore: number;
  recommendation: 'BUY_CALL' | 'BUY_PUT' | 'WATCH' | 'AVOID';
  thesis: string;
  rejectionCodes: DecisionEngineReasonCode[];
  rejectionExplanation: string | null;
  marketContext: DecisionMarketContext;
  aiResearch: AiResearchOutput;
};

export type RejectedCandidate = {
  candidate: CandidateOpportunity;
  reasonCode: DecisionEngineReasonCode;
  explanation: string;
};

export type DecisionRanking = {
  bestOpportunity: CandidateOpportunity | null;
  secondBest: CandidateOpportunity | null;
  thirdBest: CandidateOpportunity | null;
  top10: CandidateOpportunity[];
  rejectedCandidates: RejectedCandidate[];
};

export type DecisionScan = {
  scanId: string;
  timestamp: string;
  watchlist: string[];
  relatedEvents: Array<{
    eventId: string;
    title: string;
    category: string;
    importance: number;
    sentiment: number | string | null;
    triggeredReevaluation: boolean;
    marketContext: Record<string, unknown>;
    historicalSimilarity: Record<string, unknown> | null;
  }>;
  candidates: CandidateOpportunity[];
  ranking: DecisionRanking;
  winner: CandidateOpportunity | null;
  rejections: RejectedCandidate[];
  aiReasoning: AiResearchOutput[];
  noTradeReason: string | null;
  dataSources: string[];
  schemaVersion: number;
};

export type DecisionEngineScanInput = {
  now?: number;
  marketStatus?: string;
  buyingPower?: number | null;
  eventContext?: DecisionScan['relatedEvents'];
  watchlist: Array<{
    symbol: string;
    priority?: number | null;
    minConfidence?: number | null;
    maxSpreadPercent?: number | null;
    minimumOpenInterest?: number | null;
    minimumVolume?: number | null;
    maximumIV?: number | null;
    riskProfile?: string | null;
    sector?: string | null;
    news?: Array<Record<string, unknown>>;
    marketBreadth?: Record<string, unknown> | null;
  }>;
  chains: Record<string, {
    underlyingPrice: number | null;
    underlyingTimeframe?: string | null;
    complete?: boolean;
    contracts: DecisionContractSnapshot[];
  }>;
};
