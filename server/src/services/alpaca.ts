import axios, { AxiosInstance } from 'axios';

const ALPACA_API_BASE =
  process.env.ALPACA_API_BASE ??
  process.env.APCA_API_BASE_URL ??
  'https://paper-api.alpaca.markets';
const ALPACA_API_KEY = process.env.ALPACA_API_KEY ?? process.env.APCA_API_KEY_ID ?? '';
const ALPACA_API_SECRET = process.env.ALPACA_API_SECRET ?? process.env.APCA_API_SECRET_KEY ?? '';

if (!ALPACA_API_KEY || !ALPACA_API_SECRET) {
  console.warn('[ALPACA] Missing API credentials. Set ALPACA_API_KEY and ALPACA_API_SECRET to enable trading.');
}

function createClient(): AxiosInstance {
  return axios.create({
    baseURL: ALPACA_API_BASE,
    headers: {
      'APCA-API-KEY-ID': ALPACA_API_KEY,
      'APCA-API-SECRET-KEY': ALPACA_API_SECRET,
      'Content-Type': 'application/json'
    },
    timeout: 10_000
  });
}

const alpacaClient = createClient();

export type AlpacaOrderLeg = {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  type?: 'market' | 'limit';
  limit_price?: number;
};

export type AlpacaOptionsOrderRequest = {
  legs: AlpacaOrderLeg[];
  quantity?: number;
  time_in_force: 'day' | 'gtc';
  order_class?: 'simple' | 'multi-leg';
  order_type?: 'limit' | 'market';
  limit_price?: number;
  client_order_id?: string;
  extended_hours?: boolean;
};

function unwrap<T>(response: { data: T }) {
  return response.data;
}

export async function getAlpacaAccount() {
  const response = await alpacaClient.get('/v2/account');
  return unwrap(response);
}

export async function listAlpacaPositions() {
  const response = await alpacaClient.get('/v2/positions');
  return unwrap(response);
}

export async function listAlpacaOptionPositions() {
  try {
    const response = await alpacaClient.get('/v2/options/positions');
    return unwrap(response);
  } catch (error: any) {
    if (error?.response?.status === 404) {
      console.warn('[ALPACA] options positions endpoint unavailable, returning empty list');
      return [];
    }
    throw error;
  }
}

export async function submitAlpacaOptionsOrder(payload: AlpacaOptionsOrderRequest) {
  const normalized: AlpacaOptionsOrderRequest = {
    ...payload,
    order_class: payload.order_class ?? (payload.legs.length > 1 ? 'multi-leg' : 'simple'),
    order_type: payload.order_type ?? payload.limit_price != null ? 'limit' : 'market'
  };
  const response = await alpacaClient.post('/v2/options/orders', normalized);
  return unwrap(response);
}

export async function listAlpacaOptionOrders(params: { status?: string; limit?: number } = {}) {
  const response = await alpacaClient.get('/v2/options/orders', { params });
  return unwrap(response);
}
