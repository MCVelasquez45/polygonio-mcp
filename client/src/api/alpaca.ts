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
  type?: 'market' | 'limit';
  limit_price?: number;
};

export type SubmitOptionsOrderPayload = {
  legs: OptionsOrderLegPayload[];
  quantity?: number;
  time_in_force?: 'day' | 'gtc';
  client_order_id?: string;
  order_class?: 'simple' | 'multi-leg';
  order_type?: 'market' | 'limit';
  limit_price?: number;
};

export async function getBrokerAccount(): Promise<BrokerAccountResponse> {
  const { data } = await http.get<BrokerAccountResponse>('/api/broker/alpaca/account');
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
