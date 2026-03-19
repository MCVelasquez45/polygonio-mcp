export type StrategyPipelineStage =
  | 'draft'
  | 'parsed'
  | 'compiled'
  | 'backtested'
  | 'paper'
  | 'promotion'
  | 'engine';

export type StrategyStatus =
  | 'draft'
  | 'compiled'
  | 'backtested'
  | 'paper'
  | 'promoted'
  | 'archived';

export type StrategyRecord = {
  _id: string;
  name: string;
  description: string;
  status: StrategyStatus;
  pipelineStage: StrategyPipelineStage;
  versionSequence: number;
  latestVersion: string;
  currentVersionId?: string | null;
  latestBacktestRunId?: string | null;
  latestInput?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConditionProvenance = {
  source: 'user' | 'system-generated';
  reason?: string | null;
};

export type StructuredCondition = {
  field: 'RSI' | 'VWAP' | 'PRICE' | 'EMA_9' | 'EMA_20' | 'MACD' | 'SIGNAL';
  operator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'touches' | 'crosses_above' | 'crosses_below';
  value?: number | string;
  raw: string;
  provenance: ConditionProvenance;
};

export type StructuredStrategy = {
  name: string;
  sourceText: string;
  sourceType: 'text' | 'transcript' | 'voice';
  action: 'BUY' | 'SELL' | 'SHORT';
  instrument: 'CALL' | 'PUT' | 'STOCK';
  entry: StructuredCondition[];
  exit: StructuredCondition[];
  riskManagement: {
    stopLossPct: number;
    takeProfitPct: number;
    maxBarsInTrade: number;
  };
  warnings: string[];
};

export type StrategyVersionRecord = {
  _id: string;
  strategyId: string;
  version: string;
  status: StrategyStatus;
  pipelineStage: StrategyPipelineStage;
  inputArtifacts: {
    rawInput: string;
    sourceType: 'text' | 'transcript' | 'voice';
    structured: StructuredStrategy;
  };
  compiledArtifacts: {
    ast: Record<string, unknown>;
    dsl: string;
    runtimeSpec: Record<string, unknown>;
  };
  latestBacktestRun?: BacktestRunRecord | null;
  createdAt: string;
  updatedAt: string;
};

export type BacktestTrade = {
  entryTime: string;
  exitTime: string;
  side: 'long' | 'short';
  entryAction: StructuredStrategy['action'];
  exitAction: 'EXIT';
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  barsHeld: number;
  reason: string;
};

export type BacktestResult = {
  pnl: number;
  winRate: number;
  trades: BacktestTrade[];
  totalTrades: number;
};

export type BacktestRunRecord = {
  _id: string;
  strategyId: string;
  versionId: string;
  version: string;
  status: 'completed';
  pipelineStage: 'backtested';
  seedKey: string;
  executionSnapshot: Record<string, unknown>;
  results: BacktestResult;
  createdAt: string;
  updatedAt: string;
};
