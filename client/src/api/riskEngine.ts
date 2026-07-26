import { http } from './http';

export type RiskEngineStatus = {
  enabled: boolean;
  approvalRequired: boolean;
  latestApprovalId: string | null;
  latestStatus: 'APPROVE' | 'REJECT' | null;
  pendingRecommendations: number;
  portfolioHeat: number;
  ruleVersion: string;
};

export type RiskPortfolio = {
  portfolioSize: number;
  buyingPower: number | null;
  exposure: {
    sectorExposure: Record<string, number>;
    currentOpenTrades: number;
    maximumConcurrentTrades: number;
  };
  greeks: { delta: number | null; gamma: number | null; theta: number | null; vega: number | null; rho: number | null };
  riskBudget: {
    riskConsumed: number;
    remainingRiskBudget: number;
    openRisk: number;
    maximumOpenRisk: number;
  };
};

export type RiskApprovalRecord = {
  approvalId: string;
  timestamp: string;
  approval: {
    approved: boolean;
    status: 'APPROVE' | 'REJECT';
    reasons: Array<{ code: string; explanation: string }>;
    warnings: string[];
  };
};

export type RiskEngineSnapshot = {
  status: RiskEngineStatus;
  portfolio: RiskPortfolio;
  history: RiskApprovalRecord[];
  queue: { pending: unknown[] };
};

export async function getRiskEngineSnapshot(): Promise<RiskEngineSnapshot> {
  const [status, portfolio, history, queue] = await Promise.all([
    http.get('/api/risk-engine/status'),
    http.get('/api/risk-engine/portfolio'),
    http.get('/api/risk-engine/history?limit=5'),
    http.get('/api/risk-engine/approval-queue'),
  ]);
  return {
    status: status.data.status,
    portfolio: portfolio.data.portfolio,
    history: history.data.history ?? [],
    queue: queue.data.queue ?? { pending: [] },
  };
}
