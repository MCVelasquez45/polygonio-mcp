import { http } from './http';

// Phase 2C — Portfolio command-center client API. Reads the server-side
// aggregation (broker truth + automation context) and drives the safe control
// endpoints. The UI never calls Alpaca directly — every action goes here.

export type PortfolioRisk = {
  automationSessionId: string;
  status: string;
  dailyRealizedPnl: number;
  dailyTradeCount: number;
  consecutiveLossCount: number;
  currentDrawdown: number;
  maxDrawdown: number;
  lastTradeResult: string | null;
  emergencyStop: boolean;
  reconciliationStatus: string;
};

export type OwnedPosition = {
  symbol: string;
  qty: number;
  side: string;
  avgEntryPrice: number | null;
  unrealizedPnl: number | null;
  source: 'AUTOMATION' | 'MANUAL';
  automation: {
    positionId: string;
    automationSessionId: string;
    strategyVersionId: string;
    direction: string;
    status: string;
    stopPrice: number | null;
    targetPrice: number | null;
    openedAt: string | null;
  } | null;
};

export type PortfolioOperations = {
  brokerTruth: { account: any; positions: any[]; orders: any[] };
  automationContext: {
    sessions: any[];
    positions: any[];
    positionsBySymbol: OwnedPosition[];
    ordersWithContext: any[];
  };
  manualBrokerActivity: { positions: OwnedPosition[]; orders: any[] };
  health: any;
  runtime?: {
    evaluationScheduler?: { state?: string; ownerId?: string | null; lastTickAt?: string | null; lastError?: string | null };
    monitorScheduler?: { state?: string; ownerId?: string | null; lastTickAt?: string | null; lastError?: string | null };
  };
  risk: PortfolioRisk[];
};

export type AutomationVisibilityEvent = {
  id?: string;
  timestamp?: string | null;
  service?: string;
  event?: string;
  severity?: string;
  automationSessionId?: string | null;
  intentId?: string | null;
  brokerOrderId?: string | null;
  symbol?: string | null;
  payload?: Record<string, unknown>;
};

export type AutomationVisibility = {
  generatedAt: string;
  engineStatus: any;
  watchlistEvaluation: {
    evaluationId: string | null;
    evaluatedAt: string | null;
    symbolCount: number;
    symbols: string[];
    outcome: string | null;
    reasonCodes: string[];
    selectedSymbol: string | null;
    selectedContract: string | null;
    riskApproved: boolean | null;
    riskReasonCodes: string[];
    results: any[];
    ranking: any[];
    dataHealth: any;
  };
  activeTrades: any[];
  pendingOrders: any[];
  timeline: AutomationVisibilityEvent[];
  metrics: any;
  schedulerPanel: any;
  tradeHistory: any[];
  portfolioIntegration: {
    automationPositions: OwnedPosition[];
    manualPositions: OwnedPosition[];
  };
  configuration: any;
};

export async function getOperations(): Promise<PortfolioOperations> {
  const { data } = await http.get<PortfolioOperations>('/api/portfolio/operations');
  return data;
}

export async function getAutomationVisibility(): Promise<AutomationVisibility> {
  const { data } = await http.get<AutomationVisibility>('/api/portfolio/automation/visibility');
  return data;
}

export async function getTimeline(sessionId: string) {
  const { data } = await http.get(`/api/portfolio/timeline/${sessionId}`);
  return data;
}

export async function getClosedTrades() {
  const { data } = await http.get('/api/portfolio/trades');
  return data.trades ?? [];
}

export async function pauseEntries(sessionId: string, reason = 'operator pause') {
  const { data } = await http.post('/api/portfolio/automation/pause', { sessionId, reason });
  return data;
}

export async function resumeSession(sessionId: string) {
  const { data } = await http.post('/api/portfolio/automation/resume', { sessionId });
  return data;
}

export async function emergencyStop(sessionId: string, reason = 'operator emergency stop') {
  const { data } = await http.post('/api/portfolio/automation/emergency-stop', { sessionId, reason });
  return data;
}

export async function cancelOrder(intentId: string) {
  const { data } = await http.post(`/api/portfolio/orders/${intentId}/cancel`, {});
  return data;
}

export type PositionLiveSnapshot = {
  positionId: string;
  asOf: string;
  available: boolean;
  reason?: string;
  optionSymbol?: string;
  underlying?: string | null;
  greeks?: {
    delta: number | null;
    gamma: number | null;
    theta: number | null;
    vega: number | null;
    rho: number | null;
  };
  impliedVolatility?: number | null;
  openInterest?: number | null;
  dayVolume?: number | null;
  breakEvenPrice?: number | null;
  bid?: number | null;
  ask?: number | null;
  mid?: number | null;
  daysToExpiration?: number | null;
  source?: string;
};

/** Live greeks/IV/OI/day snapshot for a held position (cockpit 3s poll). */
export async function getPositionLive(positionId: string): Promise<PositionLiveSnapshot> {
  const { data } = await http.get<PositionLiveSnapshot>(
    `/api/portfolio/automation/position/${positionId}/live`
  );
  return data;
}

export async function closePosition(positionId: string) {
  const { data } = await http.post(`/api/portfolio/positions/${positionId}/close`, {});
  return data;
}
