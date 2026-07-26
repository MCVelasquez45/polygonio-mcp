import { http } from './http';

export type StrategyOrchestratorRun = {
  runId: string;
  timestamp: string;
  rankings: Array<{
    strategyId: string;
    name: string;
    score: number;
    confidence: number;
    evidenceScore: number;
    rejected: boolean;
    rejectionReason: string | null;
  }>;
  winner: { strategyId: string; name: string; score: number; confidence: number; evidenceScore: number } | null;
  conflicts: {
    hasConflict: boolean;
    bullishStrategies: string[];
    bearishStrategies: string[];
    confidenceAdjustment: number;
    recommendedAction: string;
    explanation: string;
  };
  recommendation: {
    action: 'BUY' | 'WATCH' | 'WAIT' | 'SKIP' | 'NO_TRADE';
    explanation: string;
    confidence: number;
    supportingStrategies: StrategyOrchestratorRun['rankings'];
    rejectedStrategies: StrategyOrchestratorRun['rankings'];
    evidence: { score: number; explanation: string; components: Record<string, number> };
    riskHandoff: { allowedForRiskReview: boolean; message: string; packageId: string };
  };
  evidence: { score: number; explanation: string; components: Record<string, number> };
  marketContext: { regime: { current: string; confidence: number; explanation: string }; marketStatus: string };
  portfolioContext: { adjustmentExplanation: string; sectorExposure: Record<string, number>; openRisk: number | null };
};

export async function getLatestStrategyRecommendation(): Promise<StrategyOrchestratorRun | null> {
  try {
    const res = await http.get('/api/strategy-orchestrator/recommendations');
    return res.data?.run ?? null;
  } catch (error: any) {
    if (error?.response?.status === 404) return null;
    throw error;
  }
}
