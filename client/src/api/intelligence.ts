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

export async function listTradingSessions(limit = 25): Promise<TradingSession[]> {
  const { data } = await http.get<{ sessions: TradingSession[] }>('/api/intelligence/sessions', {
    params: { limit },
  });
  return data.sessions ?? [];
}
