import { http } from './http';

export type ExplainedDecisionScore = {
  key: string;
  score: number;
  maxScore: number;
  grade: 'STRONG' | 'ACCEPTABLE' | 'WEAK' | 'UNAVAILABLE';
  explanation: string;
  inputs: Record<string, number | string | boolean | null>;
};

export type DecisionEngineCandidate = {
  id: string;
  symbol: string;
  contract: {
    symbol: string;
    type: 'call' | 'put';
    strike: number | null;
    expiration: string | null;
    bid: number | null;
    ask: number | null;
    mid: number | null;
    spreadPct: number | null;
    volume: number | null;
    openInterest: number | null;
    iv: number | null;
    delta: number | null;
  };
  confidence: number;
  overallScore: number;
  recommendation: 'BUY_CALL' | 'BUY_PUT' | 'WATCH' | 'AVOID';
  thesis: string;
  rejectionCodes: string[];
  rejectionExplanation: string | null;
  scores: Record<string, ExplainedDecisionScore>;
};

export type DecisionEngineRejectedCandidate = {
  candidate: DecisionEngineCandidate;
  reasonCode: string;
  explanation: string;
};

export type DecisionEngineScan = {
  scanId: string;
  timestamp: string;
  watchlist: string[];
  candidates: DecisionEngineCandidate[];
  ranking: {
    bestOpportunity: DecisionEngineCandidate | null;
    secondBest: DecisionEngineCandidate | null;
    thirdBest: DecisionEngineCandidate | null;
    top10: DecisionEngineCandidate[];
    rejectedCandidates: DecisionEngineRejectedCandidate[];
  };
  winner: DecisionEngineCandidate | null;
  rejections: DecisionEngineRejectedCandidate[];
  noTradeReason: string | null;
  schemaVersion: number;
};

export async function getLatestDecisionEngineScan(): Promise<DecisionEngineScan | null> {
  try {
    const res = await http.get('/api/decision-engine/latest');
    return res.data?.scan ?? null;
  } catch (error: any) {
    if (error?.response?.status === 404) return null;
    throw error;
  }
}
