import { http } from './http';

export type BrokerAccountResponse = {
  id: string;
  status: string;
  buying_power: string;
  cash: string;
  equity: string;
  multiplier?: string;
  last_equity?: string;
};

export type BrokerClockResponse = {
  timestamp: string;
  is_open: boolean;
  next_open: string;
  next_close: string;
};

export type OptionPosition = {
  symbol: string;
  qty: string;
  side: 'long' | 'short';
  market_value?: string;
  unrealized_pl?: string;
  avg_entry_price?: string;
  current_price?: string;
};

export type OptionsOrderLegPayload = {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  type?: 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
  limit_price?: number;
  position_intent?: 'buy_to_open' | 'buy_to_close' | 'sell_to_open' | 'sell_to_close';
};

export type SubmitOptionsOrderPayload = {
  legs: OptionsOrderLegPayload[];
  quantity?: number;
  time_in_force?: 'day' | 'gtc';
  client_order_id?: string;
  order_class?: 'simple' | 'multi-leg';
  order_type?: 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
  limit_price?: number;
  stop_price?: number;
  trail_price?: number;
  trail_percent?: number;
};

export async function getBrokerAccount(): Promise<BrokerAccountResponse> {
  const { data } = await http.get<BrokerAccountResponse>('/api/broker/alpaca/account');
  return data;
}

export async function getBrokerClock(): Promise<BrokerClockResponse> {
  const { data } = await http.get<BrokerClockResponse>('/api/broker/alpaca/clock');
  return data;
}

export async function getOptionPositions(): Promise<{ positions: OptionPosition[] }> {
  const { data } = await http.get<{ positions: OptionPosition[] }>('/api/broker/alpaca/options/positions');
  return data;
}

export async function submitOptionOrder(payload: SubmitOptionsOrderPayload) {
  const { data } = await http.post('/api/broker/alpaca/options/orders', payload);
  return data;
}

export type OptionOrder = {
  id?: string;
  symbol?: string;
  status?: string;
  side?: string;
  position_intent?: string | null;
  qty?: string | number;
  filled_qty?: string | number;
  filled_avg_price?: string | number | null;
  type?: string;
  order_type?: string;
  limit_price?: string | number | null;
  time_in_force?: string;
  client_order_id?: string | null;
  source?: string | null;
  submitted_at?: string | null;
  created_at?: string | null;
  filled_at?: string | null;
  expired_at?: string | null;
  canceled_at?: string | null;
  legs?: {
    symbol?: string;
    side?: string;
    position_intent?: string | null;
    limit_price?: string | number | null;
  }[];
};

export async function getOptionOrders(params?: { status?: string; limit?: number }): Promise<{ orders: OptionOrder[] }> {
  const { data } = await http.get<{ orders: OptionOrder[] }>('/api/broker/alpaca/options/orders', { params });
  return data;
}

// ---------------------------------------------------------------------------
// Alpaca paper trading (real orders on Alpaca paper account)
// ---------------------------------------------------------------------------

export type AlpacaPaperSessionState = {
  lastPrice: number;
  equity: number;
  cash: number;
  unrealizedPnl: number;
  realizedPnl: number;
  dailyPnl: number;
  positionSide: 'long' | 'short' | 'flat';
  positionQty: number;
  positionAvgEntry: number;
  riskUtilizationPct: number;
  lastSignal: string;
  lastSignalReason: string;
  lastUpdatedAt: string;
};

export type AlpacaPaperSession = {
  _id: string;
  strategyId: string;
  strategyName: string;
  backtestId?: string;
  versionLabel?: string;
  symbol: string;
  status: 'running' | 'paused' | 'stopped';
  config: {
    qty: number;
    initialCapital: number;
    maxDailyLoss: number;
    maxDrawdownPct: number;
    intervalSeconds: number;
  };
  state: AlpacaPaperSessionState;
  orders: Array<{
    alpacaOrderId: string;
    symbol: string;
    side: 'buy' | 'sell';
    qty: number;
    type: string;
    status: string;
    filledPrice: number | null;
    filledAt: string | null;
    reason: string;
    createdAt: string;
  }>;
  events: Array<{
    type: string;
    timestamp: string;
    payload: Record<string, any>;
  }>;
  startedAt: string;
  endedAt: string | null;
};

export type StartAlpacaPaperPayload = {
  strategyId: string;
  strategyName: string;
  backtestId?: string;
  versionLabel?: string;
  symbol: string;
  qty?: number;
  initialCapital?: number;
  maxDailyLoss?: number;
  maxDrawdownPct?: number;
  intervalSeconds?: number;
};

export async function startAlpacaPaperSession(payload: StartAlpacaPaperPayload): Promise<AlpacaPaperSession> {
  const { data } = await http.post<AlpacaPaperSession>('/api/broker/alpaca/paper/start', payload);
  return data;
}

export async function getAlpacaPaperSession(sessionId: string): Promise<AlpacaPaperSession> {
  const { data } = await http.get<AlpacaPaperSession>(`/api/broker/alpaca/paper/${sessionId}`);
  return data;
}

export async function listAlpacaPaperSessions(strategyId?: string): Promise<{ sessions: AlpacaPaperSession[] }> {
  const { data } = await http.get<{ sessions: AlpacaPaperSession[] }>('/api/broker/alpaca/paper/sessions', {
    params: strategyId ? { strategyId } : undefined,
  });
  return data;
}

export async function controlAlpacaPaperSession(
  sessionId: string,
  action: 'pause' | 'resume' | 'stop',
): Promise<AlpacaPaperSession> {
  const { data } = await http.post<AlpacaPaperSession>(`/api/broker/alpaca/paper/${sessionId}/control`, { action });
  return data;
}

// ---------------------------------------------------------------------------
// Options Paper Trading (0DTE credit spreads via Alpaca)
// ---------------------------------------------------------------------------

export type OptionsPaperSessionState = {
  underlyingPrice: number;
  equity: number;
  cash: number;
  dailyPnl: number;
  realizedPnl: number;
  riskUtilizationPct: number;
  lastUpdatedAt: string;
  phase: 'pre_analysis' | 'analyzing' | 'entry_window' | 'in_trade' | 'monitoring' | 'closing' | 'done';
};

export type SpreadState = {
  active: boolean;
  direction: string;
  shortLeg: { symbol: string; strike: number; type: string; delta: number; entryBid: number; entryAsk: number; currentBid: number; currentAsk: number };
  longLeg: { symbol: string; strike: number; type: string; delta: number; entryBid: number; entryAsk: number; currentBid: number; currentAsk: number };
  entryCredit: number;
  currentValue: number;
  unrealizedPnl: number;
  maxLoss: number;
  enteredAt: string;
  alpacaOrderId: string;
};

export type RegimeState = {
  current: 'risk_on' | 'risk_off' | 'mixed' | 'unknown';
  confidence: number;
  action: string;
  lastClassifiedAt: string;
  tickerChanges: Array<{ symbol: string; changePct: number; group: string }>;
};

export type OptionsPaperSession = {
  _id: string;
  strategyId: string;
  strategyName: string;
  backtestId?: string;
  versionLabel?: string;
  underlying: string;
  status: 'waiting' | 'running' | 'paused' | 'stopped' | 'expired';
  config: {
    underlying: string;
    intervalSeconds: number;
    qty: number;
    spreadWidth: number;
    targetDelta: number;
    maxDailyLoss: number;
    profitTargetPct: number;
    stopLossMultiplier: number;
    entryWindowStart: string;
    entryWindowEnd: string;
    analysisWindowStart: string;
  };
  regime: RegimeState;
  spread: SpreadState;
  state: OptionsPaperSessionState;
  orders: Array<{
    alpacaOrderId: string;
    type: string;
    legs: Array<{ symbol: string; side: string; strike: number }>;
    status: string;
    credit: number;
    createdAt: string;
  }>;
  events: Array<{ type: string; timestamp: string; payload: Record<string, any> }>;
  startedAt: string;
  endedAt: string | null;
};

export async function startOptionsPaperSession(payload: {
  strategyId: string;
  strategyName: string;
  backtestId?: string;
  versionLabel?: string;
  qty?: number;
  intervalSeconds?: number;
}): Promise<OptionsPaperSession> {
  const { data } = await http.post<OptionsPaperSession>('/api/broker/alpaca/options-paper/start', payload);
  return data;
}

export async function getOptionsPaperSession(sessionId: string): Promise<OptionsPaperSession> {
  const { data } = await http.get<OptionsPaperSession>(`/api/broker/alpaca/options-paper/${sessionId}`);
  return data;
}

export async function listOptionsPaperSessions(strategyId?: string): Promise<{ sessions: OptionsPaperSession[] }> {
  const { data } = await http.get<{ sessions: OptionsPaperSession[] }>('/api/broker/alpaca/options-paper/sessions', {
    params: strategyId ? { strategyId } : undefined,
  });
  return data;
}

export async function controlOptionsPaperSession(
  sessionId: string,
  action: 'pause' | 'resume' | 'stop',
): Promise<OptionsPaperSession> {
  const { data } = await http.post<OptionsPaperSession>(`/api/broker/alpaca/options-paper/${sessionId}/control`, { action });
  return data;
}
