import { http } from './http';

export type AutonomousOperatorStatus = {
  generatedAt: string;
  status: 'Running' | 'Paused' | 'Stopped' | 'Degraded';
  mode: 'Manual' | 'Shadow' | 'Autonomous Paper';
  modeBanner: string;
  market: string;
  broker: 'Alpaca Paper';
  automationOwner: 'Owned' | 'Not Owned' | 'Unknown';
  marketData: 'Live' | 'Delayed' | 'Stale' | 'Unavailable';
  nextEvaluationAt: string | null;
  emergencyStop: 'Active' | 'Inactive' | 'Unknown';
  watching: string[];
  currentActivity: string;
  latestPipelineId: string | null;
  featureFlags: Record<string, boolean | string>;
};

export type AutonomousPipeline = {
  pipelineId: string;
  state: string;
  mode: string;
  symbol: string | null;
  optionContract: string | null;
  plainLanguageStatus: string;
  blockingReasons: string[];
  eventContext: Record<string, unknown>;
  decisionContext: Record<string, unknown>;
  strategyContext: Record<string, unknown>;
  riskContext: Record<string, unknown>;
  lifecycleContext: Record<string, unknown>;
  executionContext: Record<string, unknown>;
  evaluationContext: Record<string, unknown>;
  timeline: Array<Record<string, unknown>>;
};

export type AutonomousRecentDecision = {
  time: string;
  symbol: string | null;
  action: string;
  subsystem: string;
  reason: string;
  pipelineId: string | null;
};

export type AutonomousTimelineEvent = {
  at: string;
  pipelineId: string | null;
  symbol: string | null;
  event: string;
  actor: string;
  reason: string;
  state: string | null;
  relatedRecords: Array<Record<string, unknown>>;
};

export type AutonomousHealthResponse = {
  overall: 'HEALTHY' | 'DEGRADED' | 'BLOCKED' | 'STOPPED';
  generatedAt: string;
  explanation: string;
  services: Array<{
    name: string;
    status: string;
    dataTimestamp: string | null;
    stale: boolean;
    staleReason: string | null;
    lastError: string | null;
    featureEnabled: boolean;
    ownerStatus: string | null;
  }>;
};

export type AutonomousActiveResponse = {
  trades: Array<Record<string, unknown>>;
  positions: Array<Record<string, unknown>>;
};

export type AutonomousPendingResponse = {
  trades: Array<Record<string, unknown>>;
  intents: Array<Record<string, unknown>>;
  current: {
    symbol: string | null;
    contract: string | null;
    recommendation: string | null;
    winningStrategy: string | null;
    evidenceScore: number | null;
    riskStatus: string;
    entryStatus: string;
    blockingReason: string | null;
    ageSeconds: number;
  } | null;
};

export async function getAutonomousTradingStatus(): Promise<AutonomousOperatorStatus | null> {
  const { data } = await http.get<{ status: AutonomousOperatorStatus }>('/api/autonomous-trading/status');
  return data.status ?? null;
}

export async function getAutonomousTradingCurrent(): Promise<AutonomousPipeline | null> {
  const { data } = await http.get<{ pipeline: AutonomousPipeline }>('/api/autonomous-trading/current');
  return data.pipeline ?? null;
}

export async function getAutonomousTradingActive(): Promise<AutonomousActiveResponse> {
  const { data } = await http.get<AutonomousActiveResponse>('/api/autonomous-trading/active');
  return { trades: data.trades ?? [], positions: data.positions ?? [] };
}

export async function getAutonomousTradingPending(): Promise<AutonomousPendingResponse> {
  const { data } = await http.get<AutonomousPendingResponse>('/api/autonomous-trading/pending');
  return { trades: data.trades ?? [], intents: data.intents ?? [], current: data.current ?? null };
}

export async function getAutonomousTradingRecentDecisions(limit = 8): Promise<AutonomousRecentDecision[]> {
  const { data } = await http.get<{ decisions: AutonomousRecentDecision[] }>('/api/autonomous-trading/recent-decisions', {
    params: { limit },
  });
  return data.decisions ?? [];
}

export async function getAutonomousTradingTimeline(limit = 8): Promise<AutonomousTimelineEvent[]> {
  const { data } = await http.get<{ events: AutonomousTimelineEvent[] }>('/api/autonomous-trading/timeline', {
    params: { limit },
  });
  return data.events ?? [];
}

export async function getAutonomousTradingHealth(): Promise<AutonomousHealthResponse | null> {
  const { data } = await http.get<AutonomousHealthResponse>('/api/autonomous-trading/health');
  return data ?? null;
}

