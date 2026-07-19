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

export async function getOptionOrders(
  params?: { status?: string; limit?: number },
  signal?: AbortSignal
): Promise<{ orders: OptionOrder[] }> {
  const { data } = await http.get<{ orders: OptionOrder[] }>('/api/broker/alpaca/options/orders', { params, signal });
  return data;
}

/** Cancel an open broker order. Risk-reducing; call only from a deliberate user action. */
export async function cancelOptionOrder(orderId: string): Promise<{ canceled: boolean; orderId: string }> {
  const { data } = await http.delete<{ canceled: boolean; orderId: string }>(
    `/api/broker/alpaca/options/orders/${encodeURIComponent(orderId)}`
  );
  return data;
}
