import { http } from './http';

export type LearningStatus = {
  status: string;
  generatedAt: string;
  completedTrades: number;
  tradeReviews: number;
  datasets: number;
  pendingReviews: number;
  pendingDatasets: number;
  latestReviewAt: string | null;
  explanation: string;
};

export type LearningTradeReview = {
  reviewId: string;
  sourceTradeId: string;
  entryTimestamp: string | null;
  exitTimestamp: string | null;
  entryStrategy: string | null;
  winningStrategy: string | null;
  marketRegime: string | null;
  sector: string | null;
  symbol: string | null;
  direction: string | null;
  confidence: number | null;
  evidenceScore: number | null;
  riskScore: number | null;
  actualReturn: number | null;
  realizedPnl: number | null;
  outcome: string;
  whySucceeded: string[];
  whyFailed: string[];
  whatCouldImprove: string[];
};

export type LearningScorecard = {
  key: string;
  window: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  averageReturn: number | null;
  medianReturn: number | null;
  averageHoldTimeMinutes: number | null;
  averageRisk: number | null;
  largestWinner: number | null;
  largestLoser: number | null;
  sharpe: number | null;
  maxDrawdown: number | null;
};

export type LearningCalibrationBucket = {
  confidenceBand: string;
  totalTrades: number;
  predictedConfidence: number | null;
  actualSuccessRate: number | null;
  historicalAccuracy: number | null;
  calibrationError: number | null;
  verdict: string;
};

export type LearningRegime = LearningScorecard;

export type LearningEvent = {
  event: string;
  trades: number;
  winRate: number | null;
  averageReturn: number | null;
  topStrategies: Array<{ strategy: string; trades: number }>;
};

export type LearningDataset = {
  datasetId: string;
  sourceTradeId: string;
  sourceReportId: string;
  version: string;
  generatedAt: string;
  outcome: { label: string; actualReturn: number | null; realizedPnl: number | null };
};

export async function getStatus(): Promise<LearningStatus> {
  const { data } = await http.get<LearningStatus>('/api/learning/status');
  return data;
}

export async function getTrades(limit = 20): Promise<LearningTradeReview[]> {
  const { data } = await http.get<{ reviews: LearningTradeReview[] }>('/api/learning/trades', { params: { limit } });
  return data.reviews;
}

export async function getScorecards(): Promise<LearningScorecard[]> {
  const { data } = await http.get<{ scorecards: LearningScorecard[] }>('/api/learning/scorecards');
  return data.scorecards;
}

export async function getCalibration(): Promise<LearningCalibrationBucket[]> {
  const { data } = await http.get<{ buckets: LearningCalibrationBucket[] }>('/api/learning/calibration');
  return data.buckets;
}

export async function getRegimes(): Promise<LearningRegime[]> {
  const { data } = await http.get<{ regimes: LearningRegime[] }>('/api/learning/regimes');
  return data.regimes;
}

export async function getEvents(): Promise<LearningEvent[]> {
  const { data } = await http.get<{ events: LearningEvent[] }>('/api/learning/events');
  return data.events;
}

export async function getDatasets(limit = 20): Promise<LearningDataset[]> {
  const { data } = await http.get<{ datasets: LearningDataset[] }>('/api/learning/datasets', { params: { limit } });
  return data.datasets;
}
