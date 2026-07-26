import { http } from './http';

export type TradeLifecycleRecord = {
  tradeId: string;
  automationPositionId: string | null;
  automationSessionId: string | null;
  strategyVersionId: string | null;
  underlying: string;
  optionSymbol: string;
  state: string;
  previousState: string | null;
  entryIntentId: string | null;
  exitIntentId: string | null;
  riskDecisionId: string | null;
  recommendationId: string | null;
  evaluationReportId: string | null;
  confidence: {
    entry: number | null;
    current: number | null;
    trend: string;
    delta: number | null;
  };
  currentAction: string;
  reasoning: string[];
  exitReason: string | null;
  evaluationSummary: Record<string, unknown> | null;
  lastEvaluatedAt: string | null;
  nextEvaluationAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TradeLifecycleStatus = {
  generatedAt: string;
  flags: Record<string, boolean>;
  aiStatus: string;
  paperTrading: boolean;
  market: string;
  currentStrategy: string | null;
  currentRegime: string | null;
  nextEvaluation: string | null;
  currentDecision: {
    watching: string;
    recommendation: string;
    confidence: number | null;
    reason: string;
  } | null;
  counts: Record<string, number>;
  schedulers: Record<string, unknown>;
};

export type TradeLifecycleEvent = {
  tradeId?: string;
  at?: string;
  timestamp?: string;
  eventType?: string;
  event?: string;
  state?: string;
  previousState?: string | null;
  source?: string;
  service?: string;
  reason?: string;
  symbol?: string | null;
  payload?: Record<string, unknown>;
};

export async function getTradeLifecycleStatus(): Promise<TradeLifecycleStatus> {
  const { data } = await http.get<TradeLifecycleStatus>('/api/trade-lifecycle/status');
  return data;
}

export async function getTradeLifecycleActive(): Promise<TradeLifecycleRecord[]> {
  const { data } = await http.get<{ trades: TradeLifecycleRecord[] }>('/api/trade-lifecycle/active');
  return data.trades ?? [];
}

export async function getTradeLifecyclePending(): Promise<TradeLifecycleRecord[]> {
  const { data } = await http.get<{ trades: TradeLifecycleRecord[] }>('/api/trade-lifecycle/pending');
  return data.trades ?? [];
}

export async function getTradeLifecycleHistory(limit = 50): Promise<TradeLifecycleRecord[]> {
  const { data } = await http.get<{ trades: TradeLifecycleRecord[] }>('/api/trade-lifecycle/history', {
    params: { limit },
  });
  return data.trades ?? [];
}

export async function getTradeLifecycleTimeline(limit = 60): Promise<TradeLifecycleEvent[]> {
  const { data } = await http.get<{ events: TradeLifecycleEvent[] }>('/api/trade-lifecycle/timeline', {
    params: { limit },
  });
  return data.events ?? [];
}
