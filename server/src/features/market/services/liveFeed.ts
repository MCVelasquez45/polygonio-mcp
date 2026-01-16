import type { Server, Socket } from 'socket.io';
import { MassiveWsClient } from '../../../shared/data/massiveWs';
import { ingestLiveAggregate } from './chartHub';
import { upsertAggregateBars } from './aggregatesStore';

type SocketSymbolMap = Map<string, Set<string>>;
type SymbolSocketMap = Map<string, Set<string>>;

const socketSubscriptions: SocketSymbolMap = new Map();
const symbolSubscriptions: SymbolSocketMap = new Map();
const aggregateSubscriptions = new Map<string, number>();
let ioServer: Server | null = null;
let wsClientOptions: MassiveWsClient | null = null;
let wsClientStocks: MassiveWsClient | null = null;

// Options Config
const MASSIVE_WS_URL_OPTIONS = process.env.MASSIVE_OPTIONS_WS_URL ?? 'wss://socket.polygon.io/options';
const MASSIVE_WS_CHANNELS_OPTIONS = process.env.MASSIVE_OPTIONS_WS_CHANNELS ?? 'T,Q';
const MASSIVE_WS_AGG_CHANNELS_OPTIONS = process.env.MASSIVE_OPTIONS_WS_AGG_CHANNELS ?? 'AM,A';

// Stocks Config (New)
const MASSIVE_WS_URL_STOCKS = process.env.MASSIVE_STOCKS_WS_URL ?? 'wss://socket.polygon.io/stocks';
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

function buildSubscriptionParams(symbol: string, type: 'aggs' | 'trades_quotes') {
  const isOption = isOptionSymbol(symbol);

  let channelsStr = '';
  if (type === 'aggs') {
    channelsStr = isOption ? MASSIVE_WS_AGG_CHANNELS_OPTIONS : MASSIVE_WS_AGG_CHANNELS_STOCKS;
  } else {
    channelsStr = isOption ? MASSIVE_WS_CHANNELS_OPTIONS : MASSIVE_WS_CHANNELS_STOCKS;
  }

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

function ensureWsClients() {
  if (!MASSIVE_WS_KEY) return;

  // 1. Options Client
  if (!wsClientOptions) {
    wsClientOptions = new MassiveWsClient({
      url: MASSIVE_WS_URL_OPTIONS,
      apiKey: MASSIVE_WS_KEY,
      assetClass: 'options',
      onMessage: handleWsMessage,
      onConnect: () => console.log('[LiveFeed] Options WebSocket connected'),
      onError: (err) => console.error('[LiveFeed] Options WS error', err),
    });
    wsClientOptions.connect();
  }

  // 2. Stocks Client
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
}

function getClientForSymbol(symbol: string) {
  return isOptionSymbol(symbol) ? wsClientOptions : wsClientStocks;
}

function subscribeSymbol(symbol: string) {
  ensureWsClients();
  const sockets = getSymbolSockets(symbol);
  symbolSubscriptions.set(symbol, sockets);

  if (sockets.size === 1) {
    const client = getClientForSymbol(symbol);
    client?.subscribe(buildSubscriptionParams(symbol, 'trades_quotes'));
  }
}

function unsubscribeSymbol(symbol: string) {
  const sockets = symbolSubscriptions.get(symbol);
  if (sockets && sockets.size > 0) return;
  symbolSubscriptions.delete(symbol);

  const client = getClientForSymbol(symbol);
  client?.unsubscribe(buildSubscriptionParams(symbol, 'trades_quotes'));
}

export function subscribeAggregateSymbol(symbol: string) {
  ensureWsClients();
  const count = aggregateSubscriptions.get(symbol) ?? 0;
  aggregateSubscriptions.set(symbol, count + 1);

  if (count === 0) {
    const client = getClientForSymbol(symbol);
    client?.subscribe(buildSubscriptionParams(symbol, 'aggs'));
  }
}

export function unsubscribeAggregateSymbol(symbol: string) {
  const count = aggregateSubscriptions.get(symbol) ?? 0;
  if (count <= 1) {
    aggregateSubscriptions.delete(symbol);
    const client = getClientForSymbol(symbol);
    client?.unsubscribe(buildSubscriptionParams(symbol, 'aggs'));
  } else {
    aggregateSubscriptions.set(symbol, count - 1);
  }
}

export function initLiveFeed(io: Server) {
  ioServer = io;
  ensureWsClients();
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
