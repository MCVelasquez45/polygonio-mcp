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

function normalizeOptionPositions(payload: any) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.positions)) return payload.positions;
  return [];
}

function normalizePositionSymbol(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isOptionSymbol(symbol: string) {
  return /^[A-Z]+\\d{6}[CP]\\d{8}$/.test(symbol);
}

function isOptionPosition(pos: any) {
  const rawSymbol = typeof pos?.symbol === 'string' ? pos.symbol : '';
  const symbol = normalizePositionSymbol(rawSymbol);
  const assetClass = String(pos?.asset_class ?? pos?.assetClass ?? pos?.class ?? '').toLowerCase();
  if (assetClass.includes('option')) return true;
  return Boolean(symbol) && isOptionSymbol(symbol);
}

// ---------------------------------------------------------------------------
// Equity trading helpers
// ---------------------------------------------------------------------------

export type AlpacaEquityOrderRequest = {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
  time_in_force: 'day' | 'gtc' | 'ioc' | 'fok';
  limit_price?: number;
  stop_price?: number;
  trail_price?: number;
  trail_percent?: number;
  client_order_id?: string;
  extended_hours?: boolean;
};

export async function submitAlpacaEquityOrder(payload: AlpacaEquityOrderRequest) {
  return alpaca.createOrder({
    symbol: payload.symbol.toUpperCase(),
    qty: payload.qty,
    side: payload.side,
    type: payload.type,
    time_in_force: payload.time_in_force,
    limit_price: payload.limit_price,
    stop_price: payload.stop_price,
    trail_price: payload.trail_price,
    trail_percent: payload.trail_percent,
    client_order_id: payload.client_order_id,
    extended_hours: payload.extended_hours,
  });
}

export async function getAlpacaOrder(orderId: string) {
  return alpaca.getOrder(orderId);
}

export async function cancelAlpacaOrder(orderId: string) {
  return alpaca.cancelOrder(orderId);
}

export async function getAlpacaPosition(symbol: string) {
  return alpaca.getPosition(symbol.toUpperCase());
}

export async function closeAlpacaPosition(symbol: string) {
  return alpaca.closePosition(symbol.toUpperCase());
}

export async function getAlpacaLatestTrade(symbol: string) {
  return alpaca.getLatestTrade(symbol.toUpperCase());
}

export async function getAlpacaLatestBar(symbol: string) {
  return alpaca.getLatestBar(symbol.toUpperCase());
}

export async function getAlpacaSnapshot(symbol: string) {
  return alpaca.getSnapshot(symbol.toUpperCase());
}

/**
 * Collect recent 1-minute bars for a symbol (up to limit).
 * Returns an array of bars from the Alpaca v2 market data API.
 */
export async function getAlpacaBarsV2(
  symbol: string,
  options: { start: string; end?: string; timeframe?: string; limit?: number },
): Promise<Array<{ Timestamp: string; OpenPrice: number; HighPrice: number; LowPrice: number; ClosePrice: number; Volume: number }>> {
  const bars: any[] = [];
  const gen = alpaca.getBarsV2(symbol.toUpperCase(), {
    start: options.start,
    end: options.end,
    timeframe: options.timeframe ?? '1Day',
    limit: options.limit ?? 50,
  });
  for await (const bar of gen) {
    bars.push(bar);
  }
  return bars;
}

// ---------------------------------------------------------------------------
// Options chain & snapshot helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the options chain for an underlying symbol.
 * Returns snapshots with greeks (delta, gamma, theta, vega) for strike selection.
 */
export async function getAlpacaOptionChain(
  underlyingSymbol: string,
  options: {
    expiration_date?: string;
    type?: 'call' | 'put';
    strike_price_gte?: number;
    strike_price_lte?: number;
    limit?: number;
  } = {},
): Promise<any[]> {
  try {
    const chain = await alpaca.getOptionChain(underlyingSymbol.toUpperCase(), {
      expiration_date: options.expiration_date,
      type: options.type,
      strike_price_gte: options.strike_price_gte?.toString(),
      strike_price_lte: options.strike_price_lte?.toString(),
      limit: options.limit ?? 100,
    });
    return Array.isArray(chain) ? chain : [];
  } catch (err: any) {
    console.warn(`[ALPACA] getOptionChain failed for ${underlyingSymbol}:`, err?.message);
    return [];
  }
}

/**
 * Fetch latest quotes for a list of option contract symbols.
 * Returns a Map<symbol, quote> with bid/ask/greeks.
 */
export async function getAlpacaOptionLatestQuotes(
  symbols: string[],
): Promise<Map<string, any>> {
  try {
    return await alpaca.getOptionLatestQuotes(symbols);
  } catch (err: any) {
    console.warn(`[ALPACA] getOptionLatestQuotes failed:`, err?.message);
    return new Map();
  }
}

/**
 * Fetch option snapshots for a list of contract symbols.
 * Each snapshot includes latestTrade, latestQuote, and greeks.
 */
export async function getAlpacaOptionSnapshots(
  symbols: string[],
): Promise<any[]> {
  try {
    const snaps = await alpaca.getOptionSnapshots(symbols);
    return Array.isArray(snaps) ? snaps : [];
  } catch (err: any) {
    console.warn(`[ALPACA] getOptionSnapshots failed:`, err?.message);
    return [];
  }
}

/**
 * Fetch latest trades for multiple equity symbols at once.
 * Used for regime classification (sector ETFs).
 */
export async function getAlpacaLatestTrades(
  symbols: string[],
): Promise<Map<string, any>> {
  try {
    return await alpaca.getLatestTrades(symbols);
  } catch (err: any) {
    console.warn(`[ALPACA] getLatestTrades failed:`, err?.message);
    return new Map();
  }
}

/**
 * Fetch snapshots for multiple equity symbols (includes dailyBar with prevClose).
 * Used for regime classification — need % change from previous close.
 */
export async function getAlpacaSnapshots(
  symbols: string[],
): Promise<any[]> {
  try {
    const snaps = await alpaca.getSnapshots(symbols);
    return Array.isArray(snaps) ? snaps : [];
  } catch (err: any) {
    console.warn(`[ALPACA] getSnapshots failed:`, err?.message);
    return [];
  }
}

async function listOptionPositionsFromAll() {
  const positions: any[] = await alpaca.getPositions();
  if (!Array.isArray(positions)) return [];
  const filtered = positions.filter(pos => isOptionPosition(pos));
  if (!filtered.length && positions.length) {
    console.warn('[ALPACA] no option positions matched filter', {
      total: positions.length,
      sample: positions.slice(0, 3).map(pos => ({
        symbol: pos?.symbol,
        asset_class: pos?.asset_class ?? pos?.assetClass ?? pos?.class
      }))
    });
  }
  return filtered.map(pos => {
    const symbol = typeof pos?.symbol === 'string' ? normalizePositionSymbol(pos.symbol) : pos?.symbol;
    return symbol ? { ...pos, symbol } : pos;
  });
}
