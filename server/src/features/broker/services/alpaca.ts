import Alpaca from '@alpacahq/alpaca-trade-api';
import {
  isOptionSymbol,
  toAlpacaOptionSymbol,
  toMongoOptionSymbolKey,
} from '../../../shared/symbols/optionSymbol';
import { writeStructuredLog } from '../../../shared/logging/safeLogging';
// Wraps the Alpaca SDK so broker routes can stay framework-agnostic and testable.

const alpacaKey =
  process.env.ALPACA_API_KEY ?? process.env.ALPACA_KEY_ID ?? process.env.APCA_API_KEY_ID ?? '';
const alpacaSecret =
  process.env.ALPACA_API_SECRET ?? process.env.ALPACA_SECRET_KEY ?? process.env.APCA_API_SECRET_KEY ?? '';

if (!alpacaKey || !alpacaSecret) {
  console.warn('[ALPACA] Missing API credentials. Set ALPACA_API_KEY and ALPACA_API_SECRET to enable trading.');
}

let noOptionPositionsLoggedAt = 0;
const NO_OPTION_POSITIONS_LOG_THROTTLE_MS = 5 * 60 * 1000;

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
  type?: 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
  limit_price?: number;
  position_intent?: 'buy_to_open' | 'buy_to_close' | 'sell_to_open' | 'sell_to_close';
};

export type AlpacaOptionsOrderRequest = {
  legs: AlpacaOrderLeg[];
  quantity?: number;
  time_in_force: 'day' | 'gtc';
  order_class?: 'simple' | 'multi-leg';
  order_type?: 'limit' | 'market' | 'stop' | 'stop_limit' | 'trailing_stop';
  limit_price?: number;
  stop_price?: number;
  trail_price?: number;
  trail_percent?: number;
  client_order_id?: string;
  extended_hours?: boolean;
};

export async function getAlpacaAccount() {
  return alpaca.getAccount();
}

export async function getAlpacaClock() {
  return alpaca.getClock();
}

export async function listAlpacaPositions() {
  return alpaca.getPositions();
}

export async function listAlpacaOptionPositions() {
  return listOptionPositionsFromAll();
}

function normalizeOptionSymbol(symbol: string) {
  return toAlpacaOptionSymbol(symbol) ?? symbol.trim().toUpperCase();
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
  const normalizedType: 'limit' | 'market' | 'stop' | 'stop_limit' | 'trailing_stop' =
    payload.order_type ??
    (payload.trail_price != null || payload.trail_percent != null
      ? 'trailing_stop'
      : payload.stop_price != null && payload.limit_price != null
      ? 'stop_limit'
      : payload.stop_price != null
      ? 'stop'
      : payload.limit_price != null
      ? 'limit'
      : 'market');
  const normalizedClass = mapOrderClass(payload.order_class, payload.legs.length);
  const qty = Number(payload.quantity ?? 1);
  const limitPrice =
    payload.limit_price != null && Number.isFinite(Number(payload.limit_price))
      ? Math.abs(Number(payload.limit_price))
      : undefined;
  const stopPrice =
    payload.stop_price != null && Number.isFinite(Number(payload.stop_price))
      ? Math.abs(Number(payload.stop_price))
      : undefined;
  const trailPrice =
    payload.trail_price != null && Number.isFinite(Number(payload.trail_price))
      ? Math.abs(Number(payload.trail_price))
      : undefined;
  const trailPercent =
    payload.trail_percent != null && Number.isFinite(Number(payload.trail_percent))
      ? Math.abs(Number(payload.trail_percent))
      : undefined;
  const baseOrder: Record<string, any> = {
    order_class: normalizedClass,
    qty,
    type: normalizedType,
    time_in_force: payload.time_in_force,
    client_order_id: payload.client_order_id,
    limit_price: normalizedType === 'limit' || normalizedType === 'stop_limit' ? limitPrice : undefined,
    stop_price: normalizedType === 'stop' || normalizedType === 'stop_limit' ? stopPrice : undefined,
    trail_price: normalizedType === 'trailing_stop' ? trailPrice : undefined,
    trail_percent: normalizedType === 'trailing_stop' ? trailPercent : undefined,
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

// --- Additive order-lifecycle helpers (used by the automation BrokerAdapter) ---
// These extend the surface without altering any existing behavior above.

export async function getAlpacaOrder(orderId: string) {
  return sendOptionsRequest(`/orders/${encodeURIComponent(orderId)}`);
}

export async function getAlpacaOrderByClientOrderId(clientOrderId: string) {
  return sendOptionsRequest(`/orders:by_client_order_id`, { client_order_id: clientOrderId });
}

export async function cancelAlpacaOrder(orderId: string) {
  return sendOptionsRequest(`/orders/${encodeURIComponent(orderId)}`, null, null, 'DELETE');
}

export async function closeAlpacaPosition(symbol: string) {
  return sendOptionsRequest(`/positions/${encodeURIComponent(normalizeOptionSymbol(symbol))}`, null, null, 'DELETE');
}

/**
 * Exposes the resolved Alpaca environment so callers (automation) can hard-fail
 * on any non-paper configuration. Never returns credentials.
 */
export function getAlpacaEnvironment(): { paper: boolean; baseUrl: string | null; hasCredentials: boolean } {
  const config: any = (alpaca as any).configuration ?? {};
  const baseUrl: string | null = typeof config.baseUrl === 'string' ? config.baseUrl : null;
  const paperFlag = (process.env.ALPACA_PAPER ?? 'true').toLowerCase() !== 'false';
  return {
    paper: paperFlag,
    baseUrl,
    hasCredentials: Boolean(alpacaKey && alpacaSecret),
  };
}

function isOptionPosition(pos: any) {
  const rawSymbol = typeof pos?.symbol === 'string' ? pos.symbol : '';
  const symbol = toMongoOptionSymbolKey(rawSymbol);
  const assetClass = String(pos?.asset_class ?? pos?.assetClass ?? pos?.class ?? '').toLowerCase();
  if (assetClass.includes('option')) return true;
  return Boolean(symbol) && isOptionSymbol(symbol);
}

async function listOptionPositionsFromAll() {
  const positions: any[] = await alpaca.getPositions();
  if (!Array.isArray(positions)) return [];
  const filtered = positions.filter(pos => isOptionPosition(pos));
  const now = Date.now();
  if (!filtered.length && positions.length && now - noOptionPositionsLoggedAt > NO_OPTION_POSITIONS_LOG_THROTTLE_MS) {
    noOptionPositionsLoggedAt = now;
    writeStructuredLog({
      component: 'broker',
      module: 'alpaca',
      event: 'NO_OPTION_POSITIONS',
      severity: 'debug',
      context: {
        totalPositions: positions.length,
        sample: positions.slice(0, 3).map(pos => ({
          symbol: pos?.symbol,
          assetClass: pos?.asset_class ?? pos?.assetClass ?? pos?.class,
        })),
      },
    });
  }
  return filtered.map(pos => {
    const symbol = typeof pos?.symbol === 'string' ? toMongoOptionSymbolKey(pos.symbol) : pos?.symbol;
    return symbol ? { ...pos, symbol } : pos;
  });
}
