export type FuturesContractSpec = {
  _id?: string;
  symbol: string;
  exchange: string;
  venue: string;
  description: string;
  tickSize: number;
  tickValue: number;
  contractMultiplier: number;
  currency: string;
  defaultInitialMargin: number;
  defaultMaintenanceMargin: number;
  active: boolean;
};

export type FuturesStrategyConfig = {
  contract: string;
  exchange: string;
  tickSize: number;
  tickValue: number;
  contractSize: number;
  marginRequired: number;
  tradingHours: string;
  rollStrategy: 'volume' | 'calendar' | 'open_interest';
  rollDaysBefore: number;
};

export type FuturesBacktestConfig = {
  strategyId: string;
  strategyName: string;
  symbol: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  contracts: number;
  rollPolicy: 'volume' | 'calendar' | 'open_interest';
  rollDaysBefore: number;
  slippageBps: number;
  feePerContract: number;
  lookback?: number;
};

export type FuturesBacktestResult = {
  _id: string;
  strategyId: string;
  strategyName: string;
  symbol: string;
  provider: 'databento' | 'synthetic' | 'quandl' | 'polygon';
  config: FuturesBacktestConfig;
  diagnostics: {
    usedFallbackData: boolean;
    sourceMessage: string;
    barsLoaded: number;
  };
  metrics: {
    totalReturnPct: number;
    sharpeRatio: number;
    maxDrawdownPct: number;
    winRatePct: number;
    totalPnl: number;
    tradeCount: number;
    profitFactor?: number;
  };
  equityCurve: Array<{ timestamp: string; equity: number }>;
  tradeLedger: Array<{
    timestamp: string;
    side: 'buy' | 'sell';
    contracts: number;
    fillPrice: number;
    pnl: number;
    reason: string;
  }>;
  rollEvents: Array<{
    timestamp: string;
    fromContract: string;
    toContract: string;
    reason: string;
  }>;
  createdAt: string;
};

export type FuturesPaperSession = {
  _id: string;
  strategyId: string;
  strategyName: string;
  backtestId?: string;
  versionLabel?: string;
  symbol: string;
  status: 'running' | 'paused' | 'stopped' | 'deployed';
  mode: 'lab-paper' | 'engine-paper';
  config: {
    contracts: number;
    initialCapital: number;
    maxDailyLoss: number;
    maxDrawdown: number;
    slippageBps: number;
    feePerContract: number;
  };
  state: {
    markPrice: number;
    lastPriceUpdateAt: string;
    cash: number;
    equity: number;
    unrealizedPnl: number;
    realizedPnl: number;
    dailyPnl: number;
    marginUsed: number;
    marginUtilizationPct: number;
    riskUtilizationPct: number;
    readinessScore: number;
    position: {
      side: 'long' | 'short' | 'flat';
      contracts: number;
      avgEntryPrice: number;
      currentContract: string;
      openedAt: string | null;
    };
  };
};

export type FuturesPromotionReport = {
  _id: string;
  sessionId: string;
  strategyId: string;
  status: 'eligible' | 'blocked';
  score: number;
  checks: Array<{
    key: string;
    label: string;
    passed: boolean;
    value: string;
    threshold: string;
  }>;
  generatedAt: string;
};

export type FuturesEngineState = {
  count: number;
  active: number;
  aggregate: {
    todayPnl: number;
    riskUtilizationPct: number;
  };
  sessions: Array<{
    _id: string;
    sessionId: string;
    strategyId: string;
    symbol: string;
    status: 'active' | 'paused' | 'stopped';
    summary: {
      todayPnl: number;
      mtdPnl: number;
      ytdPnl: number;
      riskUtilizationPct: number;
    };
  }>;
};

export type AiSuggestion = {
  field: string;
  currentValue: unknown;
  suggestedValue: unknown;
  reasoning: string;
  action?: 'add' | 'modify' | 'remove';
};

export type StrategyVersion = {
  _id: string;
  strategyId: string;
  versionNumber: number;
  versionLabel: string;
  snapshot: Record<string, unknown>;
  backtestId?: string;
  backtestMetrics?: {
    totalReturnPct: number;
    sharpeRatio: number;
    maxDrawdownPct: number;
    winRatePct: number;
    totalPnl: number;
    tradeCount: number;
    profitFactor?: number;
  };
  aiReview?: {
    analysis: string;
    suggestions?: AiSuggestion[];
  };
  createdAt: string;
};

export type StressTestScenarioResult = {
  scenario: string;
  description: string;
  metrics: {
    totalReturnPct: number;
    sharpeRatio: number;
    maxDrawdownPct: number;
    winRatePct: number;
    totalPnl: number;
    tradeCount: number;
    profitFactor: number;
  };
  overrides: Record<string, unknown>;
};

export type StressTestResponse = {
  scenarios: StressTestScenarioResult[];
};

export type FuturesHealthMetrics = {
  symbol: string;
  timeframe: string;
  mode: 'LIVE' | 'DEGRADED' | 'BACKFILLING' | 'FROZEN';
  source: 'ws' | 'rest' | 'cache' | 'snapshot';
  barCount: number;
  gapsDetected: number;
  lastUpdateMsAgo: number | null;
  lastTimestamp: number | null;
  anomalyCount: number;
  providerThrottled: boolean;
  updatedAt: number;
};
