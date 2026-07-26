export type AutonomousTradingMode = 'MANUAL' | 'SHADOW' | 'AUTONOMOUS_PAPER';

export type AutonomousExecutionSource = 'MANUAL_PAPER' | 'AUTONOMOUS_PAPER' | 'SHADOW_SIMULATION';

export const AUTONOMOUS_PIPELINE_STATES = [
  'OBSERVING',
  'EVENT_DETECTED',
  'OPPORTUNITY_IDENTIFIED',
  'STRATEGY_SELECTED',
  'RISK_REVIEW',
  'RISK_REJECTED',
  'RISK_APPROVED',
  'LIFECYCLE_CREATED',
  'ENTRY_BLOCKED',
  'ENTRY_REQUESTED',
  'ENTRY_SUBMITTED',
  'ENTRY_FILLED',
  'MONITORING',
  'EXIT_RECOMMENDED',
  'EXIT_REQUESTED',
  'EXIT_FILLED',
  'EVALUATING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type AutonomousPipelineState = (typeof AUTONOMOUS_PIPELINE_STATES)[number];

export type AutonomousPipelineRelatedRecord = {
  subsystem:
    | 'event-intelligence'
    | 'decision-intelligence'
    | 'strategy-orchestrator'
    | 'risk-engine'
    | 'trade-lifecycle'
    | 'execution-gateway'
    | 'alpaca-paper'
    | 'trade-evaluation'
    | 'automation'
    | 'shadow-execution';
  recordId: string;
  collection?: string | null;
};

export type AutonomousPipelineTimelineEvent = {
  at: string;
  state: AutonomousPipelineState;
  actor: string;
  event: string;
  reason: string;
  reasonCode?: string | null;
  relatedRecords: AutonomousPipelineRelatedRecord[];
  metadata?: Record<string, unknown>;
};

export type AutonomousTradePipelineRecord = {
  pipelineId: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  mode: AutonomousTradingMode;
  state: AutonomousPipelineState;
  executionSource: AutonomousExecutionSource;
  symbol: string | null;
  optionContract: string | null;
  idempotencyKey: string;
  eventContext: {
    eventIds: string[];
    importance: number | null;
    sentiment: number | string | null;
    summary: string | null;
  };
  decisionContext: {
    scanId: string | null;
    opportunityScore: number | null;
    rank: number | null;
    recommendation: string | null;
    explanation: string | null;
  };
  strategyContext: {
    runId: string | null;
    winningStrategy: string | null;
    confidence: number | null;
    evidenceScore: number | null;
    conflicts: string[];
  };
  riskContext: {
    approvalId: string | null;
    approved: boolean | null;
    suggestedContracts: number | null;
    dollarRisk: number | null;
    reasonCodes: string[];
    warnings: string[];
    expiresAt: string | null;
  };
  lifecycleContext: {
    lifecycleId: string | null;
    state: string | null;
    currentAction: string | null;
    currentConfidence: number | null;
    nextEvaluationAt: string | null;
  };
  executionContext: {
    requested: boolean;
    executionIntentId: string | null;
    brokerOrderId: string | null;
    status: string | null;
    paper: boolean;
    source: AutonomousExecutionSource;
  };
  evaluationContext: {
    evaluationId: string | null;
    status: string | null;
    outcome: string | null;
    returnPct: number | null;
  };
  blockingReasons: string[];
  plainLanguageStatus: string;
  timeline: AutonomousPipelineTimelineEvent[];
};

export type AutonomousServiceHealth = {
  name: string;
  status: 'HEALTHY' | 'DEGRADED' | 'BLOCKED' | 'STOPPED';
  lastSuccessfulRunAt: string | null;
  lastAttemptAt: string | null;
  latencyMs: number | null;
  dataTimestamp: string | null;
  stale: boolean;
  staleReason: string | null;
  lastError: string | null;
  featureEnabled: boolean;
  ownerStatus: string | null;
};

export type AutonomousOverallHealth = 'HEALTHY' | 'DEGRADED' | 'BLOCKED' | 'STOPPED';

export type AutonomousMetricsSource = {
  source: AutonomousExecutionSource;
  eventsProcessed: number;
  opportunitiesEvaluated: number;
  strategiesEvaluated: number;
  recommendationsGenerated: number;
  riskApprovals: number;
  riskRejections: number;
  shadowEntries: number;
  paperEntriesRequested: number;
  ordersSubmitted: number;
  ordersFilled: number;
  entryFailures: number;
  lifecycleEvaluations: number;
  exitRecommendations: number;
  exitOrders: number;
  completedTrades: number;
  winRate: number | null;
  averageReturn: number | null;
  averageHoldTimeMinutes: number | null;
  maximumDrawdown: number | null;
  topRejectionReason: string | null;
  staleDataBlocks: number;
  duplicateOrderBlocks: number;
};

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

