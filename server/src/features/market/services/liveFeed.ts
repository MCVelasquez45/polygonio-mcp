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
let wsClient: MassiveWsClient | null = null;

const MASSIVE_WS_URL = process.env.MASSIVE_OPTIONS_WS_URL ?? 'wss://socket.massive.com/options';
const MASSIVE_WS_KEY = process.env.MASSIVE_API_KEY ?? '';
const MASSIVE_OPTIONS_WS_CHANNELS = process.env.MASSIVE_OPTIONS_WS_CHANNELS ?? 'T,Q';
const MASSIVE_OPTIONS_WS_AGG_CHANNELS = process.env.MASSIVE_OPTIONS_WS_AGG_CHANNELS ?? 'AM,A';
const OPTIONS_WS_ALLOWED_CHANNELS = new Set(['T', 'Q']);
const OPTIONS_WS_AGG_ALLOWED_CHANNELS = new Set(['AM', 'A']);
const STORE_LIVE_AGGS_RAW = process.env.MASSIVE_OPTIONS_WS_STORE_AGGS;
const STORE_LIVE_AGGS =
  STORE_LIVE_AGGS_RAW == null || STORE_LIVE_AGGS_RAW === ''
    ? process.env.NODE_ENV !== 'production'
    : STORE_LIVE_AGGS_RAW.toLowerCase() === 'true';

function normalizeContractSymbol(value?: string | null) {
  if (!value) return null;
  const symbol = value.trim().toUpperCase();
  if (!symbol.startsWith('O:')) return null;
  return symbol;
}

function buildOptionsSubscriptionParams(symbol: string) {
  const channels = MASSIVE_OPTIONS_WS_CHANNELS.split(',')
    .map(entry => entry.trim().toUpperCase())
    .filter(entry => entry.length > 0 && OPTIONS_WS_ALLOWED_CHANNELS.has(entry));
  const resolved = channels.length ? channels : ['T', 'Q'];
  return resolved.map(channel => `${channel}.${symbol}`).join(',');
}

function buildAggregateSubscriptionParams(symbol: string) {
  const channels = MASSIVE_OPTIONS_WS_AGG_CHANNELS.split(',')
    .map(entry => entry.trim().toUpperCase())
    .filter(entry => entry.length > 0 && OPTIONS_WS_AGG_ALLOWED_CHANNELS.has(entry));
  const resolved = channels.length ? channels : ['AM', 'A'];
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

function ensureWsClient() {
  if (wsClient || !MASSIVE_WS_KEY) return;
  wsClient = new MassiveWsClient({
    url: MASSIVE_WS_URL,
    apiKey: MASSIVE_WS_KEY,
    assetClass: 'options',
    onMessage: handleWsMessage,
    onStatus: payload => {
      console.log('[LiveFeed] WS status', payload);
    },
    onError: error => {
      console.error('[LiveFeed] websocket error', error);
    },
    onConnect: () => {
      console.log('[LiveFeed] Massive websocket connected');
    }
  });
  wsClient.connect();
}

function subscribeSymbol(symbol: string) {
  ensureWsClient();
  const sockets = getSymbolSockets(symbol);
  symbolSubscriptions.set(symbol, sockets);
  if (sockets.size === 1) {
    wsClient?.subscribe(buildOptionsSubscriptionParams(symbol));
  }
}

function unsubscribeSymbol(symbol: string) {
  const sockets = symbolSubscriptions.get(symbol);
  if (sockets && sockets.size > 0) return;
  symbolSubscriptions.delete(symbol);
  wsClient?.unsubscribe(buildOptionsSubscriptionParams(symbol));
}

export function subscribeAggregateSymbol(symbol: string) {
  ensureWsClient();
  const count = aggregateSubscriptions.get(symbol) ?? 0;
  aggregateSubscriptions.set(symbol, count + 1);
  if (count === 0) {
    wsClient?.subscribe(buildAggregateSubscriptionParams(symbol));
  }
}

export function unsubscribeAggregateSymbol(symbol: string) {
  const count = aggregateSubscriptions.get(symbol) ?? 0;
  if (count <= 1) {
    aggregateSubscriptions.delete(symbol);
    wsClient?.unsubscribe(buildAggregateSubscriptionParams(symbol));
  } else {
    aggregateSubscriptions.set(symbol, count - 1);
  }
}

export function initLiveFeed(io: Server) {
  ioServer = io;
  ensureWsClient();
}

export function registerLiveFeedHandlers(socket: Socket) {
  socket.on('live:subscribe', payload => {
    const symbol = normalizeContractSymbol(payload?.symbol);
    if (!symbol) {
      socket.emit('live:error', { message: 'Invalid option symbol. Use prefixed O: contracts.', request: payload });
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
