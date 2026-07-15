// Sprint 2E — the Watchlist is the authoritative automation universe.
//
// Proves the scheduler sources its universe from the watchlist (not .env):
// empty/all-disabled fail closed with ZERO broker calls, disabled symbols are
// ignored, priority breaks ranking ties, one approved intent maximum, dynamic
// updates take effect with no restart (cache invalidation on write), and the
// TTL cache refreshes external changes. Chains are fixtures; the UNIVERSE comes
// from the seeded watchlist.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadDist,
  startTestMongo,
  stopTestMongo,
  dropAutomationCollections,
  createReadySession,
} from './automation.helpers.mjs';
import { FIXTURE_NOW, noResetSessionFields } from './automation2b.fixtures.mjs';
import { baselineChains, currentChains } from './automation2d.fixtures.mjs';

const mods = await loadDist();

const NOW = FIXTURE_NOW;
const NEXT = FIXTURE_NOW + 6 * 60_000;
const ACCOUNT = { equity: 100_000, buyingPower: 50_000 };

function guardSubmit(adapter) {
  const original = adapter.submitOrder.bind(adapter);
  let calls = 0;
  adapter.submitOrder = async (...args) => {
    calls += 1;
    return original(...args);
  };
  return () => calls;
}

// A universe-less fixture: chains keyed by symbol; the universe comes from the
// seeded watchlist (usingWatchlist = true).
function chainsFixture(map, now) {
  const symbols = {};
  for (const [sym, chains] of Object.entries(map)) symbols[sym] = { current: chains };
  return { symbols, now, account: ACCOUNT };
}

test('watchlist-driven automation universe', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  let mock;
  let submitCalls;
  let sessionId;

  const seed = (symbol, overrides = {}) =>
    mods.upsertWatchlistItem({ symbol, enabled: true, automationEnabled: true, strategy: 'OPTIONS_NATIVE_FLOW', ...overrides });

  t.beforeEach(async () => {
    await dropAutomationCollections();
    mods.clearMarketClockCache();
    mods.clearReconciliationStateForTests();
    mods.resetAutomationRuntimeForTests();
    mods.resetSchedulerControllerForTests?.();
    mods.resetAutomationUniverseProviderForTests();
    mock = new mods.MockPaperBrokerAdapter();
    mock.setClock('open');
    submitCalls = guardSubmit(mock);
    await mods.initializeAutomation({ adapter: mock });
    const session = await createReadySession(mods, { underlying: null, ...noResetSessionFields() });
    sessionId = String(session._id);
  });

  await t.test('empty watchlist → fail closed, no evaluation, no broker submission', async () => {
    const result = await mods.processOptionsFlowTick(sessionId, mock, chainsFixture({}, NOW));
    assert.equal(result.outcomeLabel, 'WATCHLIST_EMPTY');
    assert.equal(result.orderIntent, null);
    assert.equal(result.evaluation.reasonCodes.includes('WATCHLIST_EMPTY'), true);
    assert.equal(submitCalls(), 0);
  });

  await t.test('all symbols automation-disabled → treated as empty, no broker submission', async () => {
    await seed('SPY', { automationEnabled: false });
    await seed('QQQ', { enabled: false });
    const result = await mods.processOptionsFlowTick(sessionId, mock, chainsFixture({ SPY: baselineChains({ symbol: 'SPY', now: NOW }) }, NOW));
    assert.equal(result.outcomeLabel, 'WATCHLIST_EMPTY');
    assert.equal(result.orderIntent, null);
    assert.equal(submitCalls(), 0);
  });

  await t.test('disabled symbol is ignored; only enabled symbols are evaluated', async () => {
    await seed('SPY'); // automationEnabled
    await seed('QQQ', { automationEnabled: false }); // ignored
    await mods.processOptionsFlowTick(
      sessionId,
      mock,
      chainsFixture({ SPY: baselineChains({ symbol: 'SPY', now: NOW }), QQQ: baselineChains({ symbol: 'QQQ', now: NOW }) }, NOW)
    );
    const spySnap = await mods.OptionsFlowSnapshotModel.findOne({ automationSessionId: sessionId, underlying: 'SPY' });
    const qqqSnap = await mods.OptionsFlowSnapshotModel.findOne({ automationSessionId: sessionId, underlying: 'QQQ' });
    assert.ok(spySnap, 'enabled symbol was evaluated (baseline persisted)');
    assert.equal(qqqSnap, null, 'disabled symbol was never evaluated');
  });

  await t.test('priority breaks ranking ties → higher-priority symbol wins the single intent', async () => {
    await seed('SPY', { priority: 100 });
    await seed('QQQ', { priority: 10 }); // lower number = higher priority
    const bothBaseline = chainsFixture(
      { SPY: baselineChains({ symbol: 'SPY', now: NOW }), QQQ: baselineChains({ symbol: 'QQQ', now: NOW }) },
      NOW
    );
    await mods.processOptionsFlowTick(sessionId, mock, bothBaseline);
    const bothBullish = chainsFixture(
      {
        SPY: currentChains({ symbol: 'SPY', now: NEXT, call: 1060, put: 1005 }),
        QQQ: currentChains({ symbol: 'QQQ', now: NEXT, call: 1060, put: 1005 }),
      },
      NEXT
    );
    const result = await mods.processOptionsFlowTick(sessionId, mock, bothBullish);
    assert.equal(result.outcomeLabel, 'INTENT_CREATED');
    assert.equal(result.orderIntent.optionSymbol, 'QQQ260724C00500000', 'priority-10 QQQ beat priority-100 SPY');
    assert.equal(result.orderIntent.underlying, 'QQQ');
  });

  await t.test('multiple symbols, one autonomous position maximum → exactly one intent', async () => {
    await seed('SPY', { priority: 10 });
    await seed('QQQ', { priority: 20 });
    await mods.processOptionsFlowTick(
      sessionId,
      mock,
      chainsFixture({ SPY: baselineChains({ symbol: 'SPY', now: NOW }), QQQ: baselineChains({ symbol: 'QQQ', now: NOW }) }, NOW)
    );
    await mods.processOptionsFlowTick(
      sessionId,
      mock,
      chainsFixture(
        { SPY: currentChains({ symbol: 'SPY', now: NEXT, call: 1060, put: 1005 }), QQQ: currentChains({ symbol: 'QQQ', now: NEXT, call: 1060, put: 1005 }) },
        NEXT
      )
    );
    const intents = await mods.OrderIntentModel.countDocuments({
      automationSessionId: sessionId,
      intentType: 'ENTRY',
      status: 'APPROVED_AWAITING_EXECUTION',
    });
    assert.equal(intents, 1, 'at most one approved intent across the whole universe');
    assert.equal(submitCalls(), 0);
  });

  await t.test('no duplicate intent: an unresolved approved intent blocks a second (risk rejects)', async () => {
    await seed('SPY', { priority: 10 });
    await mods.processOptionsFlowTick(sessionId, mock, chainsFixture({ SPY: baselineChains({ symbol: 'SPY', now: NOW }) }, NOW));
    const first = await mods.processOptionsFlowTick(sessionId, mock, chainsFixture({ SPY: currentChains({ symbol: 'SPY', now: NEXT, call: 1060, put: 1005 }) }, NEXT));
    assert.equal(first.outcomeLabel, 'INTENT_CREATED');
    // A later window while the intent is still unresolved must NOT create another.
    const LATER = NEXT + 6 * 60_000;
    const second = await mods.processOptionsFlowTick(sessionId, mock, chainsFixture({ SPY: currentChains({ symbol: 'SPY', now: LATER, call: 1120, put: 1010 }) }, LATER));
    assert.equal(second.outcomeLabel, 'RISK_REJECTED');
    assert.equal(second.orderIntent, null);
    const intents = await mods.OrderIntentModel.countDocuments({ automationSessionId: sessionId, intentType: 'ENTRY' });
    assert.equal(intents, 1);
  });

  await t.test('dynamic update: adding a symbol takes effect with NO restart (cache invalidated on write)', async () => {
    await seed('SPY');
    const u1 = await mods.getAutomationUniverse(NOW);
    assert.deepEqual(u1.symbols, ['SPY']);
    await seed('QQQ'); // upsert invalidates the provider cache
    const u2 = await mods.getAutomationUniverse(NOW);
    assert.equal(u2.symbols.includes('QQQ'), true, 'new symbol visible immediately, no restart');
    assert.equal(u2.symbols.length, 2);
  });

  await t.test('cache refresh: an external DB change is picked up after the TTL', async () => {
    await seed('SPY');
    const u1 = await mods.getAutomationUniverse(NOW);
    assert.deepEqual(u1.symbols, ['SPY']);
    // Mutate directly (bypassing the service) so the cache is NOT invalidated.
    await mods.WatchlistItemModel.updateOne({ symbol: 'SPY' }, { $set: { automationEnabled: false } });
    const cached = await mods.getAutomationUniverse(NOW); // still within TTL
    assert.deepEqual(cached.symbols, ['SPY'], 'cache serves the prior universe within its TTL');
    const ttl = mods.getAutomationUniverseRefreshTtlMs();
    const refreshed = await mods.getAutomationUniverse(NOW + ttl + 1_000);
    assert.deepEqual(refreshed.symbols, [], 'after the TTL the external change is reflected');
  });

  await t.test('watchlist minimumOpenInterest gate blocks a low-OI contract (no intent)', async () => {
    // Fixture contracts have OI 1000; require 5000 → no contract passes selection.
    await seed('SPY', { priority: 10, minimumOpenInterest: 5000 });
    await mods.processOptionsFlowTick(sessionId, mock, chainsFixture({ SPY: baselineChains({ symbol: 'SPY', now: NOW }) }, NOW));
    const result = await mods.processOptionsFlowTick(sessionId, mock, chainsFixture({ SPY: currentChains({ symbol: 'SPY', now: NEXT, call: 1060, put: 1005 }) }, NEXT));
    assert.equal(result.orderIntent, null, 'per-symbol minimumOpenInterest rejected the contract');
    assert.notEqual(result.outcomeLabel, 'INTENT_CREATED');
  });

  await t.test('INTEGRATION: scheduler → watchlist universe → OPTIONS_NATIVE_FLOW → approved intent, zero submissions', async () => {
    await seed('SPY', { priority: 5 });
    const evalW1 = async (sid, adapter) => {
      const r = await mods.processOptionsFlowTick(sid, adapter, chainsFixture({ SPY: baselineChains({ symbol: 'SPY', now: NOW }) }, NOW));
      return { approvedIntentId: r.orderIntent ? String(r.orderIntent._id) : null, outcome: r.outcomeLabel };
    };
    const w1 = await mods.runEvaluationTick({ adapter: mock, ownerId: 'owner-A', now: NOW, evaluate: evalW1 });
    assert.equal(w1.sessions[0].approvedIntentId, null, 'window 1 = baseline only');

    const evalW2 = async (sid, adapter) => {
      const r = await mods.processOptionsFlowTick(sid, adapter, chainsFixture({ SPY: currentChains({ symbol: 'SPY', now: NEXT, call: 1060, put: 1005 }) }, NEXT));
      return { approvedIntentId: r.orderIntent ? String(r.orderIntent._id) : null, outcome: r.outcomeLabel };
    };
    const w2 = await mods.runEvaluationTick({ adapter: mock, ownerId: 'owner-A', now: NEXT, evaluate: evalW2 });
    assert.ok(w2.sessions[0].approvedIntentId, 'scheduler produced an approved intent from the watchlist universe');
    const intent = await mods.OrderIntentModel.findById(w2.sessions[0].approvedIntentId);
    assert.equal(intent.status, 'APPROVED_AWAITING_EXECUTION');
    assert.equal(intent.optionSymbol, 'SPY260724C00500000');
    assert.equal(submitCalls(), 0);
  });

  await t.test('watchlist telemetry: last signal + status recorded for the UI control center', async () => {
    await seed('SPY', { priority: 10 });
    await mods.processOptionsFlowTick(sessionId, mock, chainsFixture({ SPY: baselineChains({ symbol: 'SPY', now: NOW }) }, NOW));
    let item = await mods.WatchlistItemModel.findOne({ symbol: 'SPY' });
    assert.equal(item.automationStatus, 'WAITING_FOR_BASELINE');
    assert.equal(item.lastSignal, 'BASELINE');
    await mods.processOptionsFlowTick(sessionId, mock, chainsFixture({ SPY: currentChains({ symbol: 'SPY', now: NEXT, call: 1060, put: 1005 }) }, NEXT));
    item = await mods.WatchlistItemModel.findOne({ symbol: 'SPY' });
    assert.equal(item.lastSignal, 'BULLISH');
    // Risk approved → INTENT_APPROVED (NOT a position). POSITION_OPEN/lastTradeAt
    // are derived from broker truth, never asserted at approval time.
    assert.equal(item.automationStatus, 'INTENT_APPROVED');
    assert.equal(item.lastTradeAt, null, 'no broker-confirmed trade yet → no trade timestamp');
  });
});
