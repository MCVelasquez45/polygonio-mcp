import Alpaca from '@alpacahq/alpaca-trade-api';
// Wraps the Alpaca SDK so broker routes can stay framework-agnostic and testable.

const alpacaKey =
  process.env.ALPACA_API_KEY ?? process.env.ALPACA_KEY_ID ?? process.env.APCA_API_KEY_ID ?? '';
const alpacaSecret =
  process.env.ALPACA_API_SECRET ?? process.env.ALPACA_SECRET_KEY ?? process.env.APCA_API_SECRET_KEY ?? '';

if (!alpacaKey || !alpacaSecret) {
  console.warn('[ALPACA] Missing API credentials. Set ALPACA_API_KEY and ALPACA_API_SECRET to enable trading.');
}

function normalizeBaseUrl(url?: string | null) {
  if (!url) return undefined;
  let trimmed = url.trim();
  if (!trimmed) return undefined;
  trimmed = trimmed.replace(/\/+$/, '');
  if (trimmed.endsWith('/v2')) {
    trimmed = trimmed.slice(0, -3);
  }
  return trimmed;
}

const alpaca = new Alpaca({
  keyId: alpacaKey,
  secretKey: alpacaSecret,
  baseUrl:
    normalizeBaseUrl(process.env.ALPACA_API_BASE ?? process.env.ALPACA_BASE_URL ?? process.env.APCA_API_BASE_URL) ??
    undefined,
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
  position_intent?: 'buy_to_open' | 'buy_to_close' | 'sell_to_open' | 'sell_to_close';
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
    const payload: any = await sendOptionsRequest('/options/positions');
    const normalized = normalizeOptionPositions(payload);
    if (normalized.length) return normalized;
    const fallback = await listOptionPositionsFromAll();
    if (fallback.length) {
      console.warn('[ALPACA] options positions empty; falling back to /positions');
    }
    return fallback;
  } catch (error: any) {
    if (error?.response?.status === 404) {
      console.warn('[ALPACA] options positions endpoint unavailable, falling back to /positions');
      try {
        return await listOptionPositionsFromAll();
      } catch (fallbackError) {
        console.warn('[ALPACA] fallback /positions failed', fallbackError);
        return [];
      }
    }
    throw error;
  }
}

function normalizeOptionSymbol(symbol: string) {
  return symbol.startsWith('O:') ? symbol.slice(2) : symbol;
}

function mapOrderClass(orderClass: 'simple' | 'multi-leg' | undefined, legCount: number): 'simple' | 'mleg' {
  const resolved = orderClass ?? (legCount > 1 ? 'multi-leg' : 'simple');
  return resolved === 'multi-leg' ? 'mleg' : 'simple';
}

function normalizePositionIntent(side: 'buy' | 'sell', intent?: AlpacaOrderLeg['position_intent']) {
  if (intent === 'buy_to_open' || intent === 'buy_to_close' || intent === 'sell_to_open' || intent === 'sell_to_close') {
    return intent;
  }
  return side === 'sell' ? 'sell_to_open' : 'buy_to_open';
}

export async function submitAlpacaOptionsOrder(payload: AlpacaOptionsOrderRequest) {
  const normalizedType: 'limit' | 'market' =
    payload.order_type ?? (payload.limit_price != null ? 'limit' : 'market');
  const normalizedClass = mapOrderClass(payload.order_class, payload.legs.length);
  const qty = Number(payload.quantity ?? 1);
  const limitPrice =
    payload.limit_price != null && Number.isFinite(Number(payload.limit_price))
      ? Math.abs(Number(payload.limit_price))
      : undefined;
  const baseOrder: Record<string, any> = {
    order_class: normalizedClass,
    qty,
    type: normalizedType,
    time_in_force: payload.time_in_force,
    client_order_id: payload.client_order_id,
    limit_price: normalizedType === 'limit' ? limitPrice : undefined,
    extended_hours:
      typeof payload.extended_hours === 'boolean' ? payload.extended_hours : undefined
  };

  if (normalizedClass === 'mleg' || payload.legs.length > 1) {
    baseOrder.legs = payload.legs.map(leg => ({
      symbol: normalizeOptionSymbol(leg.symbol),
      ratio_qty: leg.qty,
      side: leg.side,
      position_intent: normalizePositionIntent(leg.side, leg.position_intent)
    }));
  } else {
    const leg = payload.legs[0];
    Object.assign(baseOrder, {
      symbol: normalizeOptionSymbol(leg.symbol),
      side: leg.side,
      position_intent: normalizePositionIntent(leg.side, leg.position_intent)
    });
  }

  return sendOptionsRequest('/orders', null, baseOrder, 'POST');
}

export async function listAlpacaOptionOrders(params: { status?: string; limit?: number } = {}) {
  const payload: any = await sendOptionsRequest('/orders', params);
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.orders)) return payload.orders;
  return [];
}

function normalizeOptionPositions(payload: any) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.positions)) return payload.positions;
  return [];
}

function isOptionSymbol(symbol: string) {
  return /^[A-Z]+\\d{6}[CP]\\d{8}$/.test(symbol);
}

async function listOptionPositionsFromAll() {
  const positions: any[] = await alpaca.getPositions();
  return Array.isArray(positions) ? positions.filter(pos => isOptionSymbol(pos?.symbol ?? '')) : [];
}
