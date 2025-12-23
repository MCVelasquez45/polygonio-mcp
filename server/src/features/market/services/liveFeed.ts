import type { Server, Socket } from 'socket.io';
import { MassiveWsClient } from '../../../shared/data/massiveWs';

type SocketSymbolMap = Map<string, Set<string>>;
type SymbolSocketMap = Map<string, Set<string>>;

const socketSubscriptions: SocketSymbolMap = new Map();
const symbolSubscriptions: SymbolSocketMap = new Map();
let ioServer: Server | null = null;
let wsClient: MassiveWsClient | null = null;

const MASSIVE_WS_URL = process.env.MASSIVE_OPTIONS_WS_URL ?? 'wss://socket.massive.com/options';
const MASSIVE_WS_KEY = process.env.MASSIVE_API_KEY ?? '';

function normalizeContractSymbol(value?: string | null) {
  if (!value) return null;
  const symbol = value.trim().toUpperCase();
  if (!symbol.startsWith('O:')) return null;
  return symbol;
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
  if (type === 'AM') {
    broadcast(symbol, 'live:agg', payload);
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
  symbolSubscriptions.set(symbol, getSymbolSockets(symbol));
  wsClient?.subscribe(symbol);
}

function unsubscribeSymbol(symbol: string) {
  const sockets = symbolSubscriptions.get(symbol);
  if (sockets && sockets.size > 0) return;
  symbolSubscriptions.delete(symbol);
  wsClient?.unsubscribe(symbol);
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
