// Options WebSocket correction:
//  4. subscriptions are deduplicated (refcounted per contract)
//  5. unused contracts are unsubscribed
//  6. the stock WebSocket is never used as the options stream — under the
//     options-advanced profile it is never even constructed
//  + reconnect never gives up permanently; backoff is bounded and jittered
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';

// Fake Massive options WS host: records subscribe/unsubscribe frames.
const optionsFrames = [];
let optionsConnections = 0;
const optionsWss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
optionsWss.on('connection', socket => {
  optionsConnections += 1;
  socket.on('message', raw => {
    const payload = JSON.parse(raw.toString());
    optionsFrames.push(payload);
    if (payload.action === 'auth') {
      socket.send(JSON.stringify([{ ev: 'status', status: 'auth_success' }]));
    }
  });
});
await new Promise(resolve => optionsWss.once('listening', resolve));

// Fake stocks WS host: must receive ZERO connections.
let stockConnections = 0;
const stocksWss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
stocksWss.on('connection', () => {
  stockConnections += 1;
});
await new Promise(resolve => stocksWss.once('listening', resolve));

process.env.MASSIVE_API_KEY = 'test-key';
process.env.MASSIVE_BASE_URL = 'http://127.0.0.1:9'; // REST off the network
process.env.MASSIVE_TIMEOUT_MS = '100';
process.env.MASSIVE_OPTIONS_WS_URL = `ws://127.0.0.1:${optionsWss.address().port}`;
process.env.MASSIVE_STOCKS_WS_URL = `ws://127.0.0.1:${stocksWss.address().port}`;
process.env.MASSIVE_SUBSCRIPTION_PROFILE = 'options-advanced';
delete process.env.MASSIVE_STOCKS_WS_ENABLED;

const manager = await import('../dist/features/marketData/optionsSubscriptionManager.service.js');
const liveFeed = await import('../dist/features/market/services/liveFeed.js');
const { MassiveWsClient } = await import('../dist/shared/data/massiveWs.js');

const waitFor = async (predicate, ms = 2000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout');
    await new Promise(r => setTimeout(r, 20));
  }
};

test('4+5: option subscriptions are refcounted, deduped, and released when idle', async () => {
  const symbol = 'O:SPY260724C00500000';
  assert.equal(manager.acquireOptionSubscription(symbol, 'trades_quotes', 'consumer-a'), true);
  assert.equal(manager.acquireOptionSubscription(symbol, 'trades_quotes', 'consumer-b'), true);
  await waitFor(() => optionsFrames.some(f => f.action === 'subscribe'));

  const subscribes = optionsFrames.filter(
    f => f.action === 'subscribe' && String(f.params).includes(symbol)
  );
  assert.equal(subscribes.length, 1, 'two consumers → ONE provider subscription');
  assert.equal(manager.getActiveOptionSubscriptions().length, 1);

  // First release: still one consumer → no unsubscribe.
  manager.releaseOptionSubscription(symbol, 'trades_quotes', 'consumer-a');
  await new Promise(r => setTimeout(r, 50));
  assert.equal(optionsFrames.filter(f => f.action === 'unsubscribe').length, 0);

  // Last release: contract is unsubscribed.
  manager.releaseOptionSubscription(symbol, 'trades_quotes', 'consumer-b');
  await waitFor(() => optionsFrames.some(f => f.action === 'unsubscribe' && String(f.params).includes(symbol)));
  assert.equal(manager.getActiveOptionSubscriptions().length, 0);
});

test('non-option symbols are refused by the options subscription manager', () => {
  assert.equal(manager.acquireOptionSubscription('SPY', 'trades_quotes', 'consumer-x'), false);
});

test('6: under options-advanced, a stock live subscription never opens a stocks WebSocket', async () => {
  liveFeed.subscribeAggregateSymbol('SPY');
  await new Promise(r => setTimeout(r, 250));
  assert.equal(stockConnections, 0, 'stocks WS must never be constructed under this profile');
  liveFeed.unsubscribeAggregateSymbol('SPY');
});

test('option aggregate subscriptions from the live feed go through the shared options connection', async () => {
  const symbol = 'O:SPY260724C00505000';
  const before = optionsFrames.filter(f => f.action === 'subscribe').length;
  liveFeed.subscribeAggregateSymbol(symbol);
  await waitFor(() => optionsFrames.filter(f => f.action === 'subscribe').length > before);
  assert.equal(optionsConnections, 1, 'one shared options connection for every consumer');
  liveFeed.unsubscribeAggregateSymbol(symbol);
});

test('reconnect never gives up and backoff stays bounded with jitter', () => {
  const client = new MassiveWsClient({ apiKey: 'k', url: 'ws://127.0.0.1:1', onMessage: () => {} });
  // The compiled client exposes its internals in JS; drive 30 reconnect
  // schedulings — far past the old 20-attempt give-up — and verify each one
  // is actually scheduled with a bounded delay.
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    client.scheduleReconnect();
    assert.ok(client.reconnectTimer, `attempt ${attempt} must schedule a reconnect (no permanent give-up)`);
    const delayMs = client.nextReconnectAt - Date.now();
    assert.ok(delayMs <= 73_000, `delay ${delayMs} bounded (~60s cap + jitter)`);
    assert.ok(delayMs >= 900, `delay ${delayMs} floored`);
    clearTimeout(client.reconnectTimer);
    client.reconnectTimer = null;
  }
  assert.equal(client.getState().reconnectAttempts, 30);
  client.disconnect();
});

test.after(async () => {
  manager.resetOptionsSubscriptionsForTest();
  await new Promise(r => optionsWss.close(r));
  await new Promise(r => stocksWss.close(r));
});
