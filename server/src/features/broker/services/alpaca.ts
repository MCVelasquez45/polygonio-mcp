import Alpaca from '@alpacahq/alpaca-trade-api';
// Wraps the Alpaca SDK so broker routes can stay framework-agnostic and testable.

const alpacaKey =
  process.env.ALPACA_API_KEY ?? process.env.ALPACA_KEY_ID ?? process.env.APCA_API_KEY_ID ?? '';
const alpacaSecret =
  process.env.ALPACA_API_SECRET ?? process.env.ALPACA_SECRET_KEY ?? process.env.APCA_API_SECRET_KEY ?? '';

if (!alpacaKey || !alpacaSecret) {
  console.warn('[ALPACA] Missing API credentials. Set ALPACA_API_KEY and ALPACA_API_SECRET to enable trading.');
}

const alpaca = new Alpaca({
  keyId: alpacaKey,
  secretKey: alpacaSecret,
  baseUrl: process.env.ALPACA_API_BASE ?? process.env.ALPACA_BASE_URL ?? process.env.APCA_API_BASE_URL,
  dataBaseUrl: process.env.ALPACA_DATA_BASE_URL ?? process.env.APCA_DATA_BASE_URL,
  paper: (process.env.ALPACA_PAPER ?? 'true').toLowerCase() !== 'false',
  feed: process.env.ALPACA_DATA_FEED,
  optionFeed: process.env.ALPACA_OPTION_FEED
});

async function sendOptionsRequest<T>(
  endpoint: string,
  params?: Record<string, any> | null,
  body?: any,
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH' = 'GET'
): Promise<T> {
  return alpaca.sendRequest(endpoint, params ?? null, body ?? null, method);
}

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

export async function getAlpacaAccount() {
  return alpaca.getAccount();
}

export async function listAlpacaPositions() {
  return alpaca.getPositions();
}

export async function listAlpacaOptionPositions() {
  try {
    return await sendOptionsRequest('/options/positions');
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
  return sendOptionsRequest('/options/orders', null, normalized, 'POST');
}

export async function listAlpacaOptionOrders(params: { status?: string; limit?: number } = {}) {
  return sendOptionsRequest('/options/orders', params);
}
