import type { Server, Socket } from 'socket.io';
import {
  backfillBars,
  buildSessionNote,
  filterBarsForSessionMode,
  resolveTimeframe,
  resolveTimeframeMs,
  type SessionMetaBase,
  type TimeframeConfig
} from './backfill';
import {
  getHealthMeta,
  getOrCreateBuffer,
  getSnapshot,
  replaceBars,
  setHealthMeta,
  upsertCandle,
  type Candle
} from './buffer';
import { ingestAggregateEvent } from './builder';
import { buildHealth, type HealthMeta } from './health';
import { countGaps, isValidCandle } from './validation';
import {
  clearFocus,
  getFocusForSocketId,
  getFocusKey,
  getFocusKeysForSymbol,
  getSocketsForKey,
  setFocus
} from './subscriptions';

const MAX_BUFFER_BARS = 500;
const MAX_MINUTE_BARS = 720;

let ioServer: Server | null = null;
let subscribeAggregates: (symbol: string) => void = () => {};
let unsubscribeAggregates: (symbol: string) => void = () => {};

const sessionMetaByKey = new Map<string, SessionMetaBase>();
const timeframeByKey = new Map<string, TimeframeConfig>();

export function initChartHub(args: {
  io: Server;
  subscribeAggregates: (symbol: string) => void;
  unsubscribeAggregates: (symbol: string) => void;
}) {
  ioServer = args.io;
  subscribeAggregates = args.subscribeAggregates;
  unsubscribeAggregates = args.unsubscribeAggregates;
}

export function registerChartHubHandlers(socket: Socket) {
  socket.on('chart:focus', async payload => {
    const symbol = normalizeSymbol(payload?.symbol);
    const timeframeKey = typeof payload?.timeframe === 'string' ? payload.timeframe : '5/minute';
    const sessionMode = payload?.sessionMode === 'extended' ? 'extended' : 'regular';

    if (!symbol) {
      const previous = clearFocus(socket.id);
      if (previous) {
        cleanupKeyIfUnused(getFocusKey(previous));
        refreshAggregateSubscription(previous.symbol);
      }
      socket.emit('chart:cleared');
      return;
    }

    const focus = { symbol, timeframe: timeframeKey, sessionMode };
    const { previous, key } = setFocus(socket.id, focus);
    const timeframe = resolveTimeframe(timeframeKey);
    timeframeByKey.set(key, timeframe);
    getOrCreateBuffer(key, symbol, timeframeKey);

    if (previous) {
      cleanupKeyIfUnused(getFocusKey(previous));
      refreshAggregateSubscription(previous.symbol);
    }
    refreshAggregateSubscription(symbol);

    const snapshot = getSnapshot(key);
    if (snapshot && snapshot.bars.length) {
      emitSnapshotToSocket(socket.id, focus, snapshot.bars, timeframe);
    }

    try {
      await runBackfill(key, focus, timeframe);
    } catch (error: any) {
      socket.emit('chart:error', { message: error?.message ?? 'Unable to backfill chart data.' });
    }
  });

  socket.on('disconnect', () => {
    const previous = clearFocus(socket.id);
    if (previous) {
      cleanupKeyIfUnused(getFocusKey(previous));
      refreshAggregateSubscription(previous.symbol);
    }
  });
}

export function ingestLiveAggregate(event: any) {
  if (!event) return;
  const symbol = normalizeSymbol(event?.sym ?? event?.symbol ?? event?.ticker);
  if (!symbol) return;
  const keys = getFocusKeysForSymbol(symbol);
  if (!keys.size) return;

  keys.forEach(key => {
    const timeframe = timeframeByKey.get(key) ?? resolveTimeframe('5/minute');
    const result = ingestAggregateEvent({
      key,
      symbol,
      timeframe,
      event,
      maxMinuteBars: MAX_MINUTE_BARS
    });
    if (!result) return;
    if (!isValidCandle(result.candle)) return;

    const buffer = getOrCreateBuffer(key, symbol, timeframe.key);
    const lastTimestamp = buffer.bars.at(-1)?.t ?? null;
    const timeframeMs = resolveTimeframeMs(timeframe);
    const gapDetected = lastTimestamp != null && result.bucketStart > lastTimestamp + timeframeMs;

    upsertCandle(key, result.candle, MAX_BUFFER_BARS);
    const gapsDetected = countGaps(buffer.bars, timeframeMs);

    const baseSession = sessionMetaByKey.get(key);
    const marketClosed = baseSession?.marketClosed ?? false;
    const healthMeta: HealthMeta = {
      mode: marketClosed ? 'FROZEN' : gapDetected ? 'BACKFILLING' : 'LIVE',
      source: 'ws',
      providerThrottled: false,
      gapsDetected
    };
    setHealthMeta(key, healthMeta);

    if (gapDetected) {
      void runBackfill(key, { symbol, timeframe: timeframe.key, sessionMode: 'regular' }, timeframe).catch(error => {
        console.warn('[ChartHub] backfill failed after gap', { symbol, error: (error as Error)?.message });
      });
    }

    emitUpdate(key, result.candle, healthMeta, timeframe);
  });
}

async function runBackfill(
  key: string,
  focus: { symbol: string; timeframe: string; sessionMode: 'regular' | 'extended' },
  timeframe: TimeframeConfig
) {
  const hasRegular = socketsNeedRegularSession(key);
  const sessionMode = hasRegular ? 'regular' : focus.sessionMode;
  const result = await backfillBars({
    symbol: focus.symbol,
    timeframe,
    sessionMode
  });

  getOrCreateBuffer(key, focus.symbol, focus.timeframe);
  replaceBars(key, result.candles, MAX_BUFFER_BARS);
  setHealthMeta(key, result.healthMeta);
  sessionMetaByKey.set(key, result.sessionMeta);

  const sockets = getSocketsForKey(key);
  sockets.forEach(socketId => {
    const socketFocus = getFocusForSocketId(socketId);
    if (!socketFocus) return;
    const snapshot = getSnapshot(key);
    if (!snapshot) return;
    emitSnapshotToSocket(socketId, socketFocus, snapshot.bars, timeframe);
  });
}

function emitSnapshotToSocket(
  socketId: string,
  focus: { symbol: string; timeframe: string; sessionMode: 'regular' | 'extended' },
  bars: Candle[],
  timeframe: TimeframeConfig
) {
  const filteredBars = filterBarsForSessionMode(bars, focus.sessionMode, timeframe);
  const health = buildHealth(getHealthMeta(getFocusKey(focus)), filteredBars.at(-1)?.t ?? null);
  const baseSession = sessionMetaByKey.get(getFocusKey(focus));
  const sessionNote = buildSessionNote(focus.sessionMode, timeframe);
  const noteParts = [baseSession?.note, sessionNote].filter(Boolean);
  const session = baseSession
    ? {
        ...baseSession,
        note: noteParts.length ? noteParts.join(' ') : baseSession.note,
        health
      }
    : null;

  ioServer?.to(socketId).emit('chart:snapshot', {
    symbol: focus.symbol,
    timeframe: focus.timeframe,
    bars: filteredBars,
    health,
    session
  });
}

function emitUpdate(key: string, candle: Candle, meta: HealthMeta, timeframe: TimeframeConfig) {
  const sockets = getSocketsForKey(key);
  if (!sockets.size) return;
  const health = buildHealth(meta, candle.t);
  sockets.forEach(socketId => {
    const focus = getFocusForSocketId(socketId);
    if (!focus) return;
    if (focus.sessionMode === 'regular' && !filterBarsForSessionMode([candle], focus.sessionMode, timeframe).length) {
      return;
    }
    ioServer?.to(socketId).emit('chart:update', {
      symbol: focus.symbol,
      timeframe: focus.timeframe,
      bar: candle,
      health
    });
  });
}

function socketsNeedRegularSession(key: string): boolean {
  const sockets = getSocketsForKey(key);
  for (const socketId of sockets) {
    const focus = getFocusForSocketId(socketId);
    if (focus?.sessionMode === 'regular') return true;
  }
  return false;
}

function refreshAggregateSubscription(symbol: string) {
  const keys = getFocusKeysForSymbol(symbol);
  let needsLive = false;
  keys.forEach(key => {
    const timeframe = timeframeByKey.get(key);
    if (timeframe?.timespan === 'minute') {
      needsLive = true;
    }
  });
  if (needsLive && symbol.startsWith('O:')) {
    subscribeAggregates(symbol);
  } else {
    unsubscribeAggregates(symbol);
  }
}

function normalizeSymbol(value: any): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return normalized.length ? normalized : null;
}

function cleanupKeyIfUnused(key: string) {
  const sockets = getSocketsForKey(key);
  if (sockets.size > 0) return;
  timeframeByKey.delete(key);
  sessionMetaByKey.delete(key);
}
