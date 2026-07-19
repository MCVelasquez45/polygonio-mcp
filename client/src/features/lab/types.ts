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

export type TradingMethod = 'equities' | 'options' | 'futures';

export type OptionsContractSelection = {
  underlying: string;
  contractType: 'call' | 'put';
  strikeSelection: 'atm' | 'otm_1' | 'otm_2' | 'itm_1' | 'delta_target';
  deltaTarget?: number;
  dteMin: number;
  dteMax: number;
};

export type FuturesContractSelection = {
  symbol: string;
  rollStrategy: 'volume' | 'calendar' | 'open_interest';
};

export type EquitiesContractSelection = {
  ticker: string;
};

export type ContractSelection =
  | { method: 'options'; options: OptionsContractSelection }
  | { method: 'futures'; futures: FuturesContractSelection }
  | { method: 'equities'; equities: EquitiesContractSelection };

export type SpreadStrategy = 'credit_spread' | 'debit_spread' | 'iron_condor' | 'single_leg';

export type SpreadLeg = {
  role: 'short' | 'long';
  contractType: 'call' | 'put';
  strikeSelection: 'atm' | 'otm_1' | 'otm_2' | 'itm_1' | 'delta_target' | 'offset';
  deltaTarget?: number;
  offsetFromShort?: number;
};

export type SpreadConfig = {
  strategy: SpreadStrategy;
  spreadWidth: number;
  legs: SpreadLeg[];
};

export type RegimeConfig = {
  riskOnTickers: string[];
  riskOffTickers: string[];
  leaderTickers: string[];
  riskOnAction: 'put_credit_spread' | 'call_credit_spread';
  riskOffAction: 'call_credit_spread' | 'put_credit_spread';
};

export type TimeRule = {
  type: 'time_window' | 'time_before_close' | 'profit_target_pct' | 'stop_loss_multiplier' | 'proximity_exit' | 'hold_until_close';
  startTime?: string;
  endTime?: string;
  minutesBeforeClose?: number;
  targetPct?: number;
  multiplier?: number;
  pctToStrike?: number;
  minMinutesRemaining?: number;
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
  instrument: 'CALL' | 'PUT' | 'STOCK' | 'FUTURE';
  tradingMethod?: TradingMethod;
  contractSelection?: ContractSelection;
  spreadConfig?: SpreadConfig;
  regimeConfig?: RegimeConfig;
  timeRules?: TimeRule[];
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
  contractSymbol?: string;
  dte?: number;
  entryPremium?: number;
  exitPremium?: number;
  contractSpec?: string;
  spreadType?: SpreadStrategy;
  legs?: { role: 'short' | 'long'; contractSymbol: string; strike: number; premium: number; delta?: number }[];
  creditReceived?: number;
  maxLoss?: number;
  regime?: 'risk_on' | 'risk_off' | 'mixed';
};

export type BacktestResult = {
  pnl: number;
  winRate: number;
  trades: BacktestTrade[];
  totalTrades: number;
  sharpeRatio?: number;
  maxDrawdownPct?: number;
  equityCurve?: { timestamp: string; equity: number }[];
  diagnostics?: {
    provider: string;
    barsLoaded: number;
    usedFallbackData: boolean;
    dataWarning?: string;
    resolvedSymbol?: string;
  };
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
