import { http } from './http';

export type TradingSessionStatus =
  | 'INITIALIZING'
  | 'OPEN'
  | 'CLOSING'
  | 'FINALIZING'
  | 'FINALIZED'
  | 'FINALIZATION_FAILED';

export type TradingSession = {
  sessionId: string;
  tradingDate: string;
  timezone: string;
  status: TradingSessionStatus;
  environment: 'PAPER' | 'LIVE';
  marketStatus: string;
  startedAt: string;
  finalizationStartedAt?: string | null;
  finalizedAt?: string | null;
  automationSessionId?: string | null;
  watchlist: {
    symbols: string[];
    size: number;
  };
  evaluationSummary: {
    windowsEvaluated: number;
    symbolsEvaluated: number;
    signalsGenerated: number;
    noSignalCount: number;
    dataRejectCount: number;
    riskRejectCount: number;
    approvedCount: number;
  };
  tradeSummary: {
    tradesOpened: number;
    tradesClosed: number;
    winningTrades: number;
    losingTrades: number;
    breakevenTrades: number;
    realizedPnl: number;
    unrealizedPnlAtClose: number | null;
    totalPnl: number | null;
  };
  orderSummary: {
    intentsCreated: number;
    ordersSubmitted: number;
    fills: number;
    partialFills: number;
    cancellations: number;
    rejections: number;
    manualReviewCount: number;
  };
  portfolioSnapshot?: {
    equity?: number | null;
    cash?: number | null;
    buyingPower?: number | null;
    netUnrealizedPnl?: number | null;
    capturedAt: string;
    source: string;
  } | null;
  providerSummary: {
    totalRequests: number;
    cacheHits: number;
    cacheHitRate: number | null;
    rateLimitCount: number;
    providerErrors: number | null;
    entitlementRejects: number;
  };
  automationHealth: {
    schedulerHealthy?: boolean | null;
    monitorHealthy?: boolean | null;
    reconciliationClean?: boolean | null;
    brokerConnected?: boolean | null;
    marketDataConnected?: boolean | null;
    mongoConnected?: boolean | null;
    emergencyStopActivated: boolean;
  };
  warnings: Array<{ code: string; message: string; count?: number | null }>;
  errors: Array<{ code: string; message: string; component?: string | null }>;
  generation: {
    schemaVersion: number;
    generatorVersion: string;
    generatedBy: string;
    sourceWindowStart: string;
    sourceWindowEnd: string;
    finalizedFromPersistedEvidence: boolean;
    attemptCount: number;
  };
};

export type TradeReportGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' | 'UNAVAILABLE';

export type GradeBreakdown = {
  grade: TradeReportGrade;
  score: number | null;
  reasons: string[];
  unavailableInputs: string[];
};

export type TradeTimelineEvent = {
  at: string;
  label: string;
  source: string;
  sourceId?: string | null;
  severity: 'info' | 'warning' | 'critical';
  details?: Record<string, unknown> | null;
};

export type TradeReport = {
  reportId: string;
  tradeId: string;
  sessionId: string;
  automationSessionId: string;
  status: 'GENERATED' | 'GENERATION_FAILED';
  environment: 'PAPER' | 'LIVE';
  tradingDate: string;
  identity: {
    underlying: string;
    optionSymbol: string;
    direction: 'BULLISH' | 'BEARISH';
    strategyVersionId: string;
    strategy?: string | null;
    contractType?: 'call' | 'put' | null;
    contractStrike?: number | null;
    contractExpiration?: string | null;
  };
  lifecycle: {
    openedAt?: string | null;
    closedAt?: string | null;
    holdTimeMinutes?: number | null;
    exitReason?: string | null;
    overnightRecoveryRequired: boolean;
    manualReviewReason?: string | null;
  };
  execution: {
    entryOrder?: Record<string, unknown> | null;
    exitOrder?: Record<string, unknown> | null;
    entryIntent?: Record<string, unknown> | null;
    exitIntent?: Record<string, unknown> | null;
    fillCount: number;
    partialFillCount: number;
    cancellationCount: number;
    rejectionCount: number;
    retryCount: number;
    entrySlippage?: number | null;
    exitSlippage?: number | null;
    totalEstimatedSlippage?: number | null;
    fillQuality: string;
  };
  marketContext: {
    marketStatus?: string | null;
    underlyingPriceAtSelection?: number | null;
    spyContext?: Record<string, unknown> | null;
    sectorContext?: Record<string, unknown> | null;
    vixContext?: Record<string, unknown> | null;
    trend?: string | null;
    marketRegime?: string | null;
    liquidity?: Record<string, unknown> | null;
  };
  greeks: {
    delta?: number | null;
    theta?: number | null;
    gamma?: number | null;
    vega?: number | null;
    iv?: number | null;
  };
  signal: {
    confidence?: number | null;
    flowScore?: number | null;
    momentumScore?: number | null;
    trendScore?: number | null;
    riskScore?: number | null;
    candidateRank?: number | null;
    candidateStatus?: string | null;
    riskApproved?: boolean | null;
    riskReasonCodes: string[];
    selectedContractScore?: number | null;
    selectedContractRank?: number | null;
  };
  performance: {
    entryPrice?: number | null;
    exitPrice?: number | null;
    contracts: number;
    realizedPnl?: number | null;
    returnPct?: number | null;
    maxFavorableExcursion?: number | null;
    maxAdverseExcursion?: number | null;
    drawdown?: number | null;
    fees?: number | null;
  };
  grades: {
    entry: GradeBreakdown;
    exit: GradeBreakdown;
    risk: GradeBreakdown;
    execution: GradeBreakdown;
    market: GradeBreakdown;
    overall: GradeBreakdown;
  };
  lessons: {
    strengths: string[];
    weaknesses: string[];
    improvementSuggestions: string[];
  };
  timeline: TradeTimelineEvent[];
  evidence: {
    positionId: string;
    tradingSessionId: string;
    brokerOrderIds: string[];
    orderIntentIds: string[];
    riskDecisionId?: string | null;
    tradeCandidateId?: string | null;
    contractSelectionId?: string | null;
    universeEvaluationIds: string[];
    eventIds: string[];
  };
  warnings: Array<{ code: string; message: string; source?: string | null }>;
};

export type DailyReportGrade =
  | 'A+'
  | 'A'
  | 'A-'
  | 'B+'
  | 'B'
  | 'B-'
  | 'C+'
  | 'C'
  | 'C-'
  | 'D'
  | 'F'
  | 'UNAVAILABLE';

export type DailyGradeBreakdown = {
  grade: DailyReportGrade;
  score: number | null;
  reasons: string[];
  unavailableInputs: string[];
};

export type DailyReport = {
  reportId: string;
  sessionId: string;
  tradingDate: string;
  environment: 'PAPER' | 'LIVE';
  status: 'GENERATED' | 'GENERATION_FAILED';
  executiveSummary: {
    overallGrade: DailyReportGrade;
    marketSummary: string;
    sessionSummary: string;
    primaryLesson?: string | null;
    bestDecision?: string | null;
    worstDecision?: string | null;
    highlights: string[];
    keyFindings: string[];
  };
  tradingSummary: {
    watchlistSize: number;
    symbolsEvaluated: number;
    signalsGenerated: number;
    signalsApproved: number;
    signalsRejected: number;
    riskRejects: number;
    dataRejects: number;
    tradesOpened: number;
    tradesClosed: number;
    wins: number;
    losses: number;
    breakeven: number;
  };
  performance: {
    realizedPnl?: number | null;
    unrealizedPnl?: number | null;
    netPnl?: number | null;
    averageWinner?: number | null;
    averageLoser?: number | null;
    largestWinner?: { tradeReportId: string; underlying: string; realizedPnl: number } | null;
    largestLoser?: { tradeReportId: string; underlying: string; realizedPnl: number } | null;
    averageHoldTimeMinutes?: number | null;
    profitFactor?: number | null;
    expectancy?: number | null;
  };
  capital: {
    equity?: number | null;
    cash?: number | null;
    buyingPower?: number | null;
    drawdown?: number | null;
    capitalEfficiency?: number | null;
  };
  execution: {
    ordersSubmitted: number;
    fills: number;
    partialFills: number;
    cancelled: number;
    rejected: number;
    timeouts?: number | null;
    retryCount: number;
    fillRate?: number | null;
  };
  market: {
    marketStatus?: string | null;
    marketRegime?: string | null;
    spyTrend?: string | null;
    vix?: number | null;
    sectorLeadership?: string | null;
  };
  grades: {
    execution: DailyGradeBreakdown;
    risk: DailyGradeBreakdown;
    market: DailyGradeBreakdown;
    tradeQuality: DailyGradeBreakdown;
    performance: DailyGradeBreakdown;
    evidence: DailyGradeBreakdown;
    overall: DailyGradeBreakdown;
  };
  evidenceQuality: {
    availableEvidencePercent: number;
    expectedClosedTrades: number;
    generatedTradeReports: number;
    missingEvidence: string[];
    warnings: Array<{ code: string; message: string; source?: string | null }>;
  };
  tradeReports: Array<{
    reportId: string;
    tradeId: string;
    underlying: string;
    direction: 'BULLISH' | 'BEARISH';
    realizedPnl?: number | null;
    overallGrade: string;
    exitReason?: string | null;
  }>;
  tradeReportIds: string[];
  sessionReference: {
    sessionId: string;
    tradingDate: string;
    status: string;
  };
  timeline: Array<{
    at: string;
    label: string;
    source: string;
    sourceId?: string | null;
    severity: 'info' | 'warning' | 'critical';
  }>;
  warnings: Array<{ code: string; message: string; source?: string | null }>;
};

export type DecisionType =
  | 'BUY_APPROVED'
  | 'BUY_REJECTED'
  | 'SELL_APPROVED'
  | 'SELL_REJECTED'
  | 'SIGNAL_REJECTED'
  | 'NO_SIGNAL'
  | 'DATA_REJECTED'
  | 'RISK_REJECTED'
  | 'ORDER_CANCELLED'
  | 'ORDER_TIMEOUT'
  | 'EXIT_TRIGGERED'
  | 'EMERGENCY_STOP'
  | 'NO_ACTION';

export type DecisionJournalEntry = {
  decisionId: string;
  sessionId?: string | null;
  automationSessionId?: string | null;
  tradeId?: string | null;
  reportId?: string | null;
  timestamp: string;
  decisionType: DecisionType;
  source: {
    type: string;
    id: string;
    collection: string;
  };
  context: {
    symbol?: string | null;
    contract?: string | null;
    strategy?: string | null;
    environment: 'PAPER' | 'LIVE';
    marketRegime?: string | null;
  };
  evaluation: {
    signal?: string | null;
    signalStrength?: number | null;
    confidence?: number | null;
    flowScore?: number | null;
    momentumScore?: number | null;
    trendScore?: number | null;
    riskScore?: number | null;
    candidateRank?: number | null;
    marketRegime?: string | null;
  };
  inputs: {
    liquidity?: Record<string, unknown> | null;
    spread?: number | null;
    volume?: number | null;
    iv?: number | null;
    delta?: number | null;
    theta?: number | null;
    gamma?: number | null;
    vega?: number | null;
    marketClock?: Record<string, unknown> | null;
    buyingPower?: number | null;
    existingPositions?: number | null;
    watchlistRank?: number | null;
  };
  marketSnapshot?: {
    underlying?: string | null;
    underlyingPrice?: number | null;
    bid?: number | null;
    ask?: number | null;
    mark?: number | null;
    spread?: number | null;
    iv?: number | null;
    delta?: number | null;
    volume?: number | null;
    openInterest?: number | null;
    dte?: number | null;
    quoteTimestamp?: string | null;
    marketSession?: string | null;
  };
  contractSnapshot?: {
    contractSymbol?: string | null;
    strike?: number | null;
    expiration?: string | null;
    type?: string | null;
    contractScore?: number | null;
    liquidityScore?: number | null;
    spreadPct?: number | null;
    scoreComponents?: Record<string, unknown> | null;
  };
  decision: {
    decision: 'BUY' | 'SELL' | 'SKIP' | 'REJECT' | 'EXIT' | 'CANCEL' | 'EMERGENCY_STOP' | 'NO_ACTION';
    approved: boolean;
    rejected: boolean;
    skipped: boolean;
    reasonCodes: string[];
    humanReadableReasons: string[];
  };
  riskSnapshot: {
    positionSize?: number | null;
    buyingPowerUsed?: number | null;
    riskPercent?: number | null;
    maxLoss?: number | null;
    estimatedReward?: number | null;
    estimatedRR?: number | null;
    quantity?: number | null;
    entryPrice?: number | null;
    limitPrice?: number | null;
    orderType?: string | null;
    timeInForce?: string | null;
  };
  riskChecks?: Array<{
    name: string;
    passed?: boolean | null;
    observed?: number | string | boolean | null;
    limit?: number | string | null;
    reason?: string | null;
    detail?: string | null;
  }>;
  reasonSummary?: {
    primaryReason?: string | null;
    supportingReasons?: string[];
    humanSummary?: string | null;
    machineCodes?: string[];
  };
  aiContext?: {
    status?: 'AI_NOT_USED' | 'USED' | 'UNAVAILABLE' | 'NOT_RECORDED';
    recommendation?: string | null;
    confidence?: number | null;
    summary?: string | null;
    explanation?: string | null;
    promptVersion?: string | null;
    modelUsed?: string | null;
  };
  dataAvailability?: {
    fields?: Record<string, 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_APPLICABLE' | 'NOT_RECORDED'>;
  };
  executionReference: {
    orderIntentId?: string | null;
    brokerOrderId?: string | null;
    positionId?: string | null;
  };
  evidenceQuality: {
    persistedFields: string[];
    missingFields: string[];
    warnings: Array<{ code: string; message: string; source?: string | null }>;
  };
  timeline: Array<{
    at: string;
    label: string;
    source: string;
    sourceId?: string | null;
    severity: 'info' | 'warning' | 'critical';
  }>;
};

export type StrategyAnalyticsWindowType = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ROLLING';

export type StrategyAnalyticsBucket = {
  key: string;
  label: string;
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  netPnl: number | null;
  winRate: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  averageWinner: number | null;
  averageLoser: number | null;
  averageInputValue: number | null;
  sampleTradeIds: string[];
  sampleReportIds: string[];
  sampleDecisionIds: string[];
  notes: string[];
};

export type StrategyAnalytics = {
  analyticsId: string;
  tradingDate: string;
  windowType: StrategyAnalyticsWindowType;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  environment: 'PAPER' | 'LIVE';
  status: 'GENERATED' | 'GENERATION_FAILED';
  performance: {
    totalTrades: number;
    wins: number;
    losses: number;
    breakeven: number;
    netPnl: number | null;
    winRate: number | null;
    expectancy: number | null;
    profitFactor: number | null;
    averageWinner: number | null;
    averageLoser: number | null;
    drawdown: number | null;
    capitalEfficiency: number | null;
  };
  strategyBreakdown: StrategyAnalyticsBucket[];
  underlyingBreakdown: StrategyAnalyticsBucket[];
  sectorBreakdown: StrategyAnalyticsBucket[];
  marketRegimeBreakdown: StrategyAnalyticsBucket[];
  confidenceBreakdown: StrategyAnalyticsBucket[];
  dteBreakdown: StrategyAnalyticsBucket[];
  deltaBreakdown: StrategyAnalyticsBucket[];
  ivBreakdown: StrategyAnalyticsBucket[];
  weekdayBreakdown: StrategyAnalyticsBucket[];
  timeOfDayBreakdown: StrategyAnalyticsBucket[];
  exitReasonBreakdown: StrategyAnalyticsBucket[];
  riskProfileBreakdown: StrategyAnalyticsBucket[];
  evidenceQuality: {
    availableEvidencePercent: number;
    missingEvidence: string[];
  };
  warnings: Array<{ code: string; message: string; source?: string | null }>;
  references: {
    sessionIds: string[];
    dailyReportIds: string[];
    tradeReportIds: string[];
    decisionJournalIds: string[];
  };
  generation: {
    schemaVersion: number;
    generatorVersion: string;
    generatedBy: string;
    generatedFromPersistedEvidence: boolean;
  };
};

export async function listTradingSessions(limit = 25): Promise<TradingSession[]> {
  const { data } = await http.get<{ sessions: TradingSession[] }>('/api/intelligence/sessions', {
    params: { limit },
  });
  return data.sessions ?? [];
}

export async function listTradeReports(limit = 25): Promise<TradeReport[]> {
  const { data } = await http.get<{ reports: TradeReport[] }>('/api/intelligence/trades', {
    params: { limit },
  });
  return data.reports ?? [];
}

export async function getTradeReport(id: string): Promise<TradeReport> {
  const { data } = await http.get<{ report: TradeReport }>(`/api/intelligence/trades/${encodeURIComponent(id)}`);
  return data.report;
}

export async function listDailyReports(limit = 25): Promise<DailyReport[]> {
  const { data } = await http.get<{ reports: DailyReport[] }>('/api/intelligence/daily', {
    params: { limit },
  });
  return data.reports ?? [];
}

export async function getDailyReport(id: string): Promise<DailyReport> {
  const { data } = await http.get<{ report: DailyReport }>(`/api/intelligence/daily/${encodeURIComponent(id)}`);
  return data.report;
}

export async function listDecisionJournalEntries(limit = 100): Promise<DecisionJournalEntry[]> {
  const { data } = await http.get<{ entries: DecisionJournalEntry[] }>('/api/intelligence/decisions', {
    params: { limit },
  });
  return data.entries ?? [];
}

export async function getDecisionJournalEntry(id: string): Promise<DecisionJournalEntry> {
  const { data } = await http.get<{ entry: DecisionJournalEntry }>(`/api/intelligence/decisions/${encodeURIComponent(id)}`);
  return data.entry;
}

export async function getDecisionJournalEntriesBySession(sessionId: string): Promise<DecisionJournalEntry[]> {
  const { data } = await http.get<{ entries: DecisionJournalEntry[] }>(
    `/api/intelligence/decisions/session/${encodeURIComponent(sessionId)}`
  );
  return data.entries ?? [];
}

export async function getDecisionJournalEntriesByTrade(tradeId: string): Promise<DecisionJournalEntry[]> {
  const { data } = await http.get<{ entries: DecisionJournalEntry[] }>(
    `/api/intelligence/decisions/trade/${encodeURIComponent(tradeId)}`
  );
  return data.entries ?? [];
}

export async function listStrategyAnalytics(limit = 25): Promise<StrategyAnalytics[]> {
  const { data } = await http.get<{ analytics: StrategyAnalytics[] }>('/api/intelligence/analytics', {
    params: { limit },
  });
  return data.analytics ?? [];
}

export async function getLatestStrategyAnalytics(): Promise<StrategyAnalytics> {
  const { data } = await http.get<{ analytics: StrategyAnalytics }>('/api/intelligence/analytics/latest');
  return data.analytics;
}

export async function getStrategyAnalyticsByWindowType(
  windowType: StrategyAnalyticsWindowType,
  limit = 25
): Promise<StrategyAnalytics[]> {
  const { data } = await http.get<{ analytics: StrategyAnalytics[] }>(
    `/api/intelligence/analytics/window/${encodeURIComponent(windowType)}`,
    { params: { limit } }
  );
  return data.analytics ?? [];
}

export async function getStrategyAnalyticsByDate(tradingDate: string): Promise<StrategyAnalytics[]> {
  const { data } = await http.get<{ analytics: StrategyAnalytics[] }>(
    `/api/intelligence/analytics/date/${encodeURIComponent(tradingDate)}`
  );
  return data.analytics ?? [];
}

export async function generateStrategyAnalytics(windowType: StrategyAnalyticsWindowType, tradingDate: string): Promise<{
  analytics: StrategyAnalytics;
  idempotent: boolean;
}> {
  const { data } = await http.post<{ analytics: StrategyAnalytics; idempotent: boolean }>('/api/intelligence/analytics/generate', {
    windowType,
    tradingDate,
  });
  return data;
}
