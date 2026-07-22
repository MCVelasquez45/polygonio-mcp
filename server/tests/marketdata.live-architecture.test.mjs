// P0 live architecture regressions:
//  - stock WebSocket entitlement is active when MASSIVE_STOCKS_WS_ENABLED=true
//    and no explicit options-only profile is configured
//  - option subscribers immediately receive the canonical quote cache used by
//    Ticket and Matrix while waiting for the next provider tick
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';

const stocksFrames = [];
let stockConnections = 0;
const stocksWss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
stocksWss.on('connection', socket => {
  stockConnections += 1;
  socket.on('message', raw => {
    const payload = JSON.parse(raw.toString());
    stocksFrames.push(payload);
    if (payload.action === 'auth') {
      socket.send(JSON.stringify([{ ev: 'status', status: 'auth_success' }]));
    }
  });
});
await new Promise(resolve => stocksWss.once('listening', resolve));

const optionsFrames = [];
const optionsWss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
optionsWss.on('connection', socket => {
  socket.on('message', raw => {
    const payload = JSON.parse(raw.toString());
    optionsFrames.push(payload);
    if (payload.action === 'auth') {
      socket.send(JSON.stringify([{ ev: 'status', status: 'auth_success' }]));
    } else if (payload.action === 'subscribe' && String(payload.params).includes('O:SPY260724C00520000')) {
      socket.send(JSON.stringify([
        {
          ev: 'Q',
          sym: 'O:SPY260724C00520000',
          bp: 1.23,
          ap: 1.27,
          bs: 31,
          as: 29,
          t: 1784917800123,
          q: 1001,
        },
        {
          ev: 'T',
          sym: 'O:SPY260724C00520000',
          p: 1.25,
          s: 4,
          x: 65,
          c: [233],
          t: 1784917800456,
          q: 1002,
        },
      ]));
    }
  });
});
await new Promise(resolve => optionsWss.once('listening', resolve));

process.env.MASSIVE_API_KEY = 'test-key';
process.env.MASSIVE_BASE_URL = 'http://127.0.0.1:9';
process.env.MASSIVE_TIMEOUT_MS = '100';
process.env.MASSIVE_STOCKS_WS_ENABLED = 'true';
process.env.MASSIVE_STOCKS_WS_URL = `ws://127.0.0.1:${stocksWss.address().port}`;
process.env.MASSIVE_OPTIONS_WS_URL = `ws://127.0.0.1:${optionsWss.address().port}`;
process.env.MASSIVE_OPTIONS_ALLOW_NON_PROD_OWNER = 'true';
delete process.env.MASSIVE_SUBSCRIPTION_PROFILE;

const liveFeed = await import('../dist/features/market/services/liveFeed.js');
const quoteCache = await import('../dist/features/marketData/optionsQuoteCache.service.js');
const health = await import('../dist/features/marketData/optionsDataHealth.service.js');
const optionsManager = await import('../dist/features/marketData/optionsSubscriptionManager.service.js');

const waitFor = async (predicate, ms = 2000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};

test('stock stream fails closed when only the stock WS flag is set', async () => {
  assert.equal(health.SUBSCRIPTION_PROFILE, 'options-advanced');
  assert.equal(health.stocksEntitled(), false);
  liveFeed.subscribeAggregateSymbol('SPY');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(stockConnections, 0);
  liveFeed.unsubscribeAggregateSymbol('SPY');
});

test('equity live:subscribe is accepted as REST-only under options-only entitlement', async () => {
  const handlers = new Map();
  const emitted = [];
  const joined = [];
  const left = [];
  const socket = {
    id: 'socket-equity-a',
    on: (event, handler) => handlers.set(event, handler),
    emit: (event, payload) => emitted.push({ event, payload }),
    join: room => joined.push(room),
    leave: room => left.push(room),
  };

  liveFeed.registerLiveFeedHandlers(socket);
  handlers.get('live:subscribe')({ symbol: 'SPY' });
  await new Promise(resolve => setTimeout(resolve, 50));

  assert.deepEqual(joined, ['SPY']);
  assert.equal(stockConnections, 0);
  assert.ok(!emitted.some(entry => entry.event === 'live:error'));
  assert.ok(emitted.some(entry =>
    entry.event === 'live:subscribed'
    && entry.payload.symbol === 'SPY'
    && entry.payload.accepted === true
    && entry.payload.reason === 'equity_rest_only'
    && entry.payload.providerPayload == null
  ));

  handlers.get('disconnect')();
  assert.deepEqual(left, ['SPY']);
});

test('live:subscribe replays cached option quote to the subscribing socket', async () => {
  const symbol = 'O:SPY260724C00500000';
  const providerTimestamp = Date.now() - 250;
  quoteCache.ingestRestQuote({
    symbol,
    bid: 1.11,
    ask: 1.15,
    bidSize: 42,
    askSize: 39,
    providerTimestamp,
  });

  const handlers = new Map();
  const emitted = [];
  const joined = [];
  const socket = {
    id: 'socket-a',
    on: (event, handler) => handlers.set(event, handler),
    emit: (event, payload) => emitted.push({ event, payload }),
    join: room => joined.push(room),
    leave: () => {},
  };

  liveFeed.registerLiveFeedHandlers(socket);
  handlers.get('live:subscribe')({ symbol });

  const quote = emitted.find(entry => entry.event === 'live:quote')?.payload;
  assert.deepEqual(joined, [symbol]);
  assert.equal(quote?.sym, symbol);
  assert.equal(quote?.bp, 1.11);
  assert.equal(quote?.ap, 1.15);
  assert.equal(quote?.bs, 42);
  assert.equal(quote?.as, 39);
  assert.equal(quote?.t, providerTimestamp);
  assert.equal(quote?.source, 'rest-snapshot');
  assert.equal(quote?.dataMode, 'snapshot');
  assert.ok(emitted.some(entry => entry.event === 'live:subscribed' && entry.payload.symbol === symbol));
  await waitFor(() => optionsFrames.some(frame => frame.action === 'auth'));

  handlers.get('disconnect')();
});

test('REST quote cache updates broadcast to existing live subscribers', () => {
  const symbol = 'O:SPY260724C00510000';
  const emitted = [];

  liveFeed.initLiveFeed({
    to: room => ({
      emit: (event, payload) => emitted.push({ room, event, payload }),
    }),
  });

  quoteCache.ingestRestQuote({
    symbol,
    bid: 2.22,
    ask: 2.27,
    bidSize: 12,
    askSize: 18,
    providerTimestamp: Date.now(),
  });

  const quote = emitted.find(entry => entry.room === symbol && entry.event === 'live:quote')?.payload;
  assert.equal(quote?.sym, symbol);
  assert.equal(quote?.bp, 2.22);
  assert.equal(quote?.ap, 2.27);
  assert.equal(quote?.bs, 12);
  assert.equal(quote?.as, 18);
  assert.equal(quote?.source, 'rest-snapshot');
  assert.equal(quote?.dataMode, 'snapshot');
});

test('provider option Q/T events update canonical cache and broadcast once', async () => {
  const symbol = 'O:SPY260724C00520000';
  const emitted = [];
  quoteCache.clearQuoteCache();
  quoteCache.resetQuoteCacheListenersForTest();

  liveFeed.initLiveFeed({
    emit: (event, payload) => emitted.push({ event, payload }),
    to: room => ({
      emit: (event, payload) => emitted.push({ room, event, payload }),
    }),
  });

  const result = optionsManager.acquireOptionSubscription(symbol, 'trades_quotes', 'provider-event-test');
  assert.equal(result.accepted, true);
  await waitFor(() => emitted.some(entry => entry.room === symbol && entry.event === 'live:quote'));
  await waitFor(() => emitted.some(entry => entry.room === symbol && entry.event === 'live:trade'));

  const quoteEvents = emitted.filter(entry => entry.room === symbol && entry.event === 'live:quote');
  const tradeEvents = emitted.filter(entry => entry.room === symbol && entry.event === 'live:trade');
  assert.equal(quoteEvents.length, 2, 'quote update + trade-driven last update');
  assert.equal(tradeEvents.length, 1);

  const quote = quoteEvents[0].payload;
  assert.equal(quote.bp, 1.23);
  assert.equal(quote.ap, 1.27);
  assert.equal(quote.bs, 31);
  assert.equal(quote.as, 29);
  assert.equal(quote.mark, 1.25);
  assert.equal(quote.t, 1784917800123);
  assert.equal(quote.q, 1001);
  assert.equal(quote.dataMode, 'live');
  assert.equal(quoteEvents[1].payload.last, 1.25);
  assert.equal(quoteEvents[1].payload.lastSize, 4);

  const trade = tradeEvents[0].payload;
  assert.equal(trade.p, 1.25);
  assert.equal(trade.s, 4);
  assert.equal(trade.t, 1784917800456);
  assert.equal(trade.timestamp, 1784917800456);
  assert.equal(trade.q, 1002);
  assert.equal(trade.dataMode, 'live');

  const cachedQuote = quoteCache.getCachedQuote(symbol);
  const cachedTrade = quoteCache.getCachedTrade(symbol);
  assert.equal(cachedQuote?.last, 1.25);
  assert.equal(cachedQuote?.lastSize, 4);
  assert.equal(cachedQuote?.lastTradeTimestamp, 1784917800456);
  assert.equal(cachedTrade?.providerTimestamp, 1784917800456);

  optionsManager.releaseOptionSubscription(symbol, 'trades_quotes', 'provider-event-test');
});

test('options components remain live when stocks WebSocket is unavailable', () => {
  const status = health.deriveOptionsComponentStatus({
    socketIoConnected: true,
    providerEnabled: true,
    providerConnected: true,
    providerAuthenticated: true,
    providerConnecting: false,
    providerStatus: 'auth_success',
    activeContractCount: 1,
    freshQuoteCount: 1,
    hasSnapshotQuotes: true,
  });
  assert.equal(health.stocksEntitled(), false);
  assert.equal(status, 'LIVE');
});

test.after(async () => {
  liveFeed.resetLiveFeedForTest();
  optionsManager.resetOptionsSubscriptionsForTest();
  quoteCache.clearQuoteCache();
  quoteCache.resetQuoteCacheListenersForTest();
  await new Promise(resolve => stocksWss.close(resolve));
  await new Promise(resolve => optionsWss.close(resolve));
});
