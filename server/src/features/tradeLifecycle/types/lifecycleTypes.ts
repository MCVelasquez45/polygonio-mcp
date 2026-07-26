export const TRADE_LIFECYCLE_STATES = [
  'NEW',
  'PENDING_ENTRY',
  'ENTRY_SUBMITTED',
  'ENTRY_FILLED',
  'MONITORING',
  'PARTIAL_EXIT',
  'EXIT_PENDING',
  'EXIT_FILLED',
  'EVALUATION',
  'ARCHIVED',
] as const;

export type TradeLifecycleState = (typeof TRADE_LIFECYCLE_STATES)[number];

export const MONITORING_ACTIONS = [
  'HOLD',
  'SCALE_IN',
  'SCALE_OUT',
  'MOVE_STOP',
  'TAKE_PROFIT',
  'EXIT',
  'WAIT',
  'NO_ACTION',
] as const;

export type MonitoringAction = (typeof MONITORING_ACTIONS)[number];

export type ConfidenceTrend = 'Improving' | 'Weakening' | 'Stable' | 'Unknown';

export type TradeLifecycleFlags = {
  TRADE_LIFECYCLE_ENABLED: boolean;
  TRADE_LIFECYCLE_AUTOSTART: boolean;
  AUTONOMOUS_MONITORING: boolean;
  AUTONOMOUS_ENTRY_ENABLED: boolean;
  AUTONOMOUS_EXIT_ENABLED: boolean;
};

export type LifecycleConfidence = {
  entry: number | null;
  current: number | null;
  trend: ConfidenceTrend;
  delta: number | null;
  changedAt: Date | null;
};

export type LifecycleEvaluationInput = {
  tradeId: string;
  symbol: string;
  state: TradeLifecycleState;
  entryConfidence: number | null;
  currentConfidence: number | null;
  currentProfit: number | null;
  currentLoss: number | null;
  returnPct: number | null;
  spreadPct: number | null;
  liquidityScore: number | null;
  daysToExpiration: number | null;
  timeHeldMinutes: number | null;
  eventRisk: string | null;
  originalThesis: string | null;
  updatedThesis: string | null;
  strategyChanged: boolean;
  riskChanged: boolean;
  marketRegime: string | null;
  volatility: number | null;
};

export type LifecycleMonitoringDecision = {
  action: MonitoringAction;
  confidence: LifecycleConfidence;
  reasoning: string[];
  exitRequired: boolean;
  exitReason: string | null;
};
