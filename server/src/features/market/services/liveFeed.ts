import type { Server, Socket } from 'socket.io';
import { MassiveWsClient } from '../../../shared/data/massiveWs';
import { ingestLiveAggregate } from './chartHub';
import { upsertAggregateBars } from './aggregatesStore';
import {
  acquireOptionSubscription,
  addOptionsWsListener,
  releaseOptionSubscription,
} from '../../marketData/optionsSubscriptionManager.service';
import { stocksEntitled, SUBSCRIPTION_PROFILE } from '../../marketData/optionsDataHealth.service';

type SocketSymbolMap = Map<string, Set<string>>;
type SymbolSocketMap = Map<string, Set<string>>;

const socketSubscriptions: SocketSymbolMap = new Map();
const symbolSubscriptions: SymbolSocketMap = new Map();
const aggregateSubscriptions = new Map<string, number>();
let ioServer: Server | null = null;
let wsClientStocks: MassiveWsClient | null = null;
let stocksEntitlementLogged = false;

// Options live data is owned by the options subscription manager
// (features/marketData/optionsSubscriptionManager.service.ts): one shared
// connection, deduped refcounted subscriptions, health reporting.

// Stocks Config — only used when the subscription profile includes stocks.
// Under `options-advanced` (the default) the stocks WebSocket is NEVER opened:
// the plan has no stocks stream entitlement and connecting merely fails auth.
const MASSIVE_WS_URL_STOCKS = process.env.MASSIVE_STOCKS_WS_URL ?? 'wss://socket.massive.com/stocks';
const MASSIVE_WS_CHANNELS_STOCKS = process.env.MASSIVE_STOCKS_WS_CHANNELS ?? 'T,Q';
const MASSIVE_WS_AGG_CHANNELS_STOCKS = process.env.MASSIVE_STOCKS_WS_AGG_CHANNELS ?? 'AM,A';

const MASSIVE_WS_KEY = process.env.MASSIVE_API_KEY ?? '';

const ALLOWED_CHANNELS = new Set(['T', 'Q', 'A', 'AM']);

const STORE_LIVE_AGGS_RAW = process.env.MASSIVE_OPTIONS_WS_STORE_AGGS;
const STORE_LIVE_AGGS =
  STORE_LIVE_AGGS_RAW == null || STORE_LIVE_AGGS_RAW === ''
    ? process.env.NODE_ENV !== 'production'
    : STORE_LIVE_AGGS_RAW.toLowerCase() === 'true';

function isOptionSymbol(symbol: string) {
  return symbol.startsWith('O:');
}

function normalizeContractSymbol(value?: string | null) {
  if (!value) return null;
  // We no longer enforce 'O:' start because we support stocks now.
  // But we still want to uppercase and trim.
  const symbol = value.trim().toUpperCase();
  return symbol.length > 0 ? symbol : null;
}

function buildStockSubscriptionParams(symbol: string, type: 'aggs' | 'trades_quotes') {
  const channelsStr = type === 'aggs' ? MASSIVE_WS_AGG_CHANNELS_STOCKS : MASSIVE_WS_CHANNELS_STOCKS;

  const channels = channelsStr.split(',')
    .map(entry => entry.trim().toUpperCase())
    .filter(entry => entry.length > 0 && ALLOWED_CHANNELS.has(entry));

  // Defaults if env vars are empty
  const defaults = type === 'aggs' ? ['AM', 'A'] : ['T', 'Q'];
  const resolved = channels.length ? channels : defaults;

  return resolved.map(channel => `${channel}.${symbol}`).join(',');
}

function getSocketSymbols(socketId: string) {
  return socketSubscriptions.get(socketId) ?? new Set<string>();
}

function getSymbolSockets(symbol: string) {
  return symbolSubscriptions.get(symbol) ?? new Set<string>();
}

function broadcast(symbol: string, event: string, payload: any) {
  if (!ioServer) return;
  ioServer.to(symbol).emit(event, payload);
}

async function persistLiveAggregate(symbol: string, event: any) {
  if (!STORE_LIVE_AGGS) return;
  const timestamp = typeof event?.s === 'number' ? event.s : typeof event?.t === 'number' ? event.t : null;
  if (timestamp == null) return;
  const bar = {
    timestamp,
    open: Number(event.o),
    high: Number(event.h),
    low: Number(event.l),
    close: Number(event.c),
    volume: Number(event.v) || 0,
    vwap: typeof event.vw === 'number' ? event.vw : null,
    transactions: typeof event.n === 'number' ? event.n : null
  };
  if (![bar.open, bar.high, bar.low, bar.close].every(value => Number.isFinite(value))) return;
  try {
    await upsertAggregateBars(symbol, 1, 'minute', [bar], { source: 'massive' });
  } catch (error) {
    console.warn('[LiveFeed] aggregate cache write failed', { symbol, error: (error as Error)?.message });
  }
}

function handleWsMessage(event: any) {
  if (!event) return;
  const type = event.ev;
  const symbol = event.sym || event.symbol;
  if (!symbol) return;
  const payload = {
    ...event,
    receivedAt: Date.now()
  };
  if (type === 'T' || type === 'trade' || event.ev === 'trade') {
    broadcast(symbol, 'live:trades', payload);
    return;
  }
  if (type === 'Q' || type === 'quote') {
    broadcast(symbol, 'live:quote', payload);
    return;
  }
  if (type === 'AM' || type === 'A') {
    ingestLiveAggregate(payload);
    if (type === 'AM') {
      void persistLiveAggregate(symbol, event);
    }
    return;
  }
  broadcast(symbol, 'live:raw', payload);
}

const STOCKS_WS_FLAG_ENABLED = (process.env.MASSIVE_STOCKS_WS_ENABLED ?? 'false').toLowerCase() === 'true';

function ensureStocksWsClient(): MassiveWsClient | null {
  if (!MASSIVE_WS_KEY) return null;
  // Entitlement gate: Options Advanced has NO stocks WebSocket. Do not open a
  // connection that can only fail auth and burn reconnect cycles. The explicit
  // MASSIVE_STOCKS_WS_ENABLED flag AND a stocks-entitled profile are both
  // required.
  if (!STOCKS_WS_FLAG_ENABLED || !stocksEntitled()) {
    if (!stocksEntitlementLogged) {
      stocksEntitlementLogged = true;
      console.warn('[LiveFeed] stocks WebSocket disabled by subscription profile', {
        profile: SUBSCRIPTION_PROFILE,
        hint: 'set MASSIVE_SUBSCRIPTION_PROFILE to a stocks-entitled profile to enable',
      });
    }
    return null;
  }

  if (!wsClientStocks) {
    wsClientStocks = new MassiveWsClient({
      url: MASSIVE_WS_URL_STOCKS,
      apiKey: MASSIVE_WS_KEY,
      assetClass: 'stocks',
      onMessage: handleWsMessage,
      onConnect: () => console.log('[LiveFeed] Stocks WebSocket connected'),
      onError: (err) => console.error('[LiveFeed] Stocks WS error', err),
    });
    wsClientStocks.connect();
  }
  return wsClientStocks;
}

const LIVE_FEED_CONSUMER = 'live-feed';

function subscribeSymbol(symbol: string) {
  const sockets = getSymbolSockets(symbol);
  symbolSubscriptions.set(symbol, sockets);

  if (sockets.size === 1) {
    if (isOptionSymbol(symbol)) {
      acquireOptionSubscription(symbol, 'trades_quotes', LIVE_FEED_CONSUMER);
    } else {
      const client = ensureStocksWsClient();
      client?.subscribe(buildStockSubscriptionParams(symbol, 'trades_quotes'));
    }
  }
}

function unsubscribeSymbol(symbol: string) {
  const sockets = symbolSubscriptions.get(symbol);
  if (sockets && sockets.size > 0) return;
  symbolSubscriptions.delete(symbol);

  if (isOptionSymbol(symbol)) {
    releaseOptionSubscription(symbol, 'trades_quotes', LIVE_FEED_CONSUMER);
  } else {
    wsClientStocks?.unsubscribe(buildStockSubscriptionParams(symbol, 'trades_quotes'));
  }
}

export function subscribeAggregateSymbol(symbol: string) {
  const count = aggregateSubscriptions.get(symbol) ?? 0;
  aggregateSubscriptions.set(symbol, count + 1);

  if (count === 0) {
    if (isOptionSymbol(symbol)) {
      acquireOptionSubscription(symbol, 'aggs', LIVE_FEED_CONSUMER);
    } else {
      const client = ensureStocksWsClient();
      client?.subscribe(buildStockSubscriptionParams(symbol, 'aggs'));
    }
  }
}

export function unsubscribeAggregateSymbol(symbol: string) {
  const count = aggregateSubscriptions.get(symbol) ?? 0;
  if (count <= 1) {
    aggregateSubscriptions.delete(symbol);
    if (isOptionSymbol(symbol)) {
      releaseOptionSubscription(symbol, 'aggs', LIVE_FEED_CONSUMER);
    } else {
      wsClientStocks?.unsubscribe(buildStockSubscriptionParams(symbol, 'aggs'));
    }
  } else {
    aggregateSubscriptions.set(symbol, count - 1);
  }
}

export function initLiveFeed(io: Server) {
  ioServer = io;
  // Options events flow through the shared subscription manager's connection.
  addOptionsWsListener(handleWsMessage);
}

export function registerLiveFeedHandlers(socket: Socket) {
  socket.on('live:subscribe', payload => {
    const symbol = normalizeContractSymbol(payload?.symbol);
    if (!symbol) {
      socket.emit('live:error', { message: 'Invalid symbol.', request: payload });
      return;
    }
    socket.join(symbol);

    const socketSymbols = getSocketSymbols(socket.id);
    socketSymbols.add(symbol);
    socketSubscriptions.set(socket.id, socketSymbols);

    const symbolSockets = getSymbolSockets(symbol);
    symbolSockets.add(socket.id);
    symbolSubscriptions.set(symbol, symbolSockets);

    subscribeSymbol(symbol);
    socket.emit('live:subscribed', { symbol });
  });

  socket.on('live:unsubscribe', payload => {
    const symbol = normalizeContractSymbol(payload?.symbol);
    if (!symbol) return;

    socket.leave(symbol);
    const socketSymbols = getSocketSymbols(socket.id);
    socketSymbols.delete(symbol);
    if (socketSymbols.size === 0) {
      socketSubscriptions.delete(socket.id);
    } else {
      socketSubscriptions.set(socket.id, socketSymbols);
    }

    const symbolSockets = getSymbolSockets(symbol);
    symbolSockets.delete(socket.id);
    if (symbolSockets.size === 0) {
      symbolSubscriptions.delete(symbol);
      unsubscribeSymbol(symbol);
    } else {
      symbolSubscriptions.set(symbol, symbolSockets);
    }
    socket.emit('live:unsubscribed', { symbol });
  });

  socket.on('disconnect', () => {
    const symbols = getSocketSymbols(socket.id);
    symbols.forEach(symbol => {
      socket.leave(symbol);
      const symbolSockets = getSymbolSockets(symbol);
      symbolSockets.delete(socket.id);
      if (symbolSockets.size === 0) {
        symbolSubscriptions.delete(symbol);
        unsubscribeSymbol(symbol);
      } else {
        symbolSubscriptions.set(symbol, symbolSockets);
      }
    });
    socketSubscriptions.delete(socket.id);
  });
}
