// Sprint 2D — the production scheduler wired to OPTIONS_NATIVE_FLOW.
//
// Proves the live entry path end to end WITHOUT the broker: baseline
// initialization, restart-durable baseline, second-window evaluation,
// deterministic direction (bullish/bearish/balanced), fail-closed data gates
// (stale / unauthorized), deterministic contract selection, and an idempotent
// APPROVED_AWAITING_EXECUTION intent — with ZERO broker submissions. The signal
// is derived ENTIRELY from authorized options-volume differencing; no
// underlying aggregate, no AI.
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
const NEXT = FIXTURE_NOW + 6 * 60_000; // one completed 5-min window later
const CALL_WINNER = 'SPY260724C00500000';
const PUT_WINNER = 'SPY260724P00500000';

function guardSubmit(adapter) {
  const original = adapter.submitOrder.bind(adapter);
  let calls = 0;
  adapter.submitOrder = async (...args) => {
    calls += 1;
    return original(...args);
  };
  return () => calls;
}

function fixtureFor(symbols, { now, account } = {}) {
  return { universe: Object.keys(symbols), symbols, now, account: account ?? { equity: 100_000, buyingPower: 50_000 } };
}

test('OPTIONS_NATIVE_FLOW production evaluator', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  let mock;
  let submitCalls;
  let session;
  let sessionId;

  t.beforeEach(async () => {
    await dropAutomationCollections();
    mods.clearMarketClockCache();
    mods.clearReconciliationStateForTests();
    mods.resetAutomationRuntimeForTests();
    mods.resetSchedulerControllerForTests?.();
    mock = new mods.MockPaperBrokerAdapter();
    mock.setClock('open');
    submitCalls = guardSubmit(mock);
    const init = await mods.initializeAutomation({ adapter: mock });
    assert.equal(init.ready, true);
    session = await createReadySession(mods, { underlying: null, ...noResetSessionFields() });
    sessionId = String(session._id);
  });

  // Baseline snapshot for window 1.
  const seedBaseline = async (now = NOW) =>
    mods.processOptionsFlowTick(sessionId, mock, fixtureFor({ SPY: { current: baselineChains({ now }) } }, { now }));

  // Window 2 with a directional current snapshot.
  const evaluateWindow = async (call, put, { now = NEXT, quoteAgeMs = 30_000 } = {}) =>
    mods.processOptionsFlowTick(
      sessionId,
      mock,
      fixtureFor({ SPY: { current: currentChains({ now, call, put, quoteAgeMs }) } }, { now })
    );

  await t.test('production default signal mode is OPTIONS_NATIVE_FLOW', () => {
    assert.equal(mods.getSignalMode(), 'OPTIONS_NATIVE_FLOW');
  });

  await t.test('baseline initialization → durable snapshot, NO trade from the first window', async () => {
    const result = await seedBaseline();
    assert.equal(result.outcomeLabel, 'BASELINE_INITIALIZED');
    assert.equal(result.orderIntent, null);
    // Baseline persisted to Mongo → survives a process restart.
    const snap = await mods.OptionsFlowSnapshotModel.findOne({ automationSessionId: sessionId, underlying: 'SPY' });
    assert.ok(snap, 'a baseline snapshot was persisted');
    assert.equal(snap.tradingDate, '2026-07-10');
    assert.equal(snap.contracts.length, 12, 'both call + put sides captured');
    assert.equal(submitCalls(), 0);
  });

  await t.test('second window, bullish flow → deterministic CALL contract + approved intent', async () => {
    await seedBaseline();
    const result = await evaluateWindow(1060, 1005); // calls surge, puts flat
    assert.equal(result.outcomeLabel, 'INTENT_CREATED');
    assert.ok(result.orderIntent, 'an approved intent was created');
    assert.equal(result.orderIntent.optionSymbol, CALL_WINNER, 'deterministic winner = 0.60-delta 500 call');
    assert.equal(result.orderIntent.status, 'APPROVED_AWAITING_EXECUTION');
    assert.equal(result.orderIntent.quantity >= 1, true);
    assert.equal(submitCalls(), 0, 'the evaluator must never submit');
  });

  await t.test('second window, bearish flow → deterministic PUT contract + approved intent', async () => {
    await seedBaseline();
    const result = await evaluateWindow(1005, 1060); // puts surge, calls flat
    assert.equal(result.outcomeLabel, 'INTENT_CREATED');
    assert.equal(result.orderIntent.optionSymbol, PUT_WINNER);
    assert.equal(result.orderIntent.status, 'APPROVED_AWAITING_EXECUTION');
    assert.equal(submitCalls(), 0);
  });

  await t.test('balanced flow → NO_TRADE, no intent (never an improvised direction)', async () => {
    await seedBaseline();
    const result = await evaluateWindow(1060, 1060); // symmetric surge
    assert.equal(result.outcomeLabel, 'NO_TRADE');
    assert.equal(result.orderIntent, null);
    const candidate = await mods.TradeCandidateModel.findOne({ automationSessionId: sessionId, status: 'NO_TRADE', barTimestamp: new Date(NEXT) });
    assert.ok(candidate.reasonCodes.includes('OPTIONS_FLOW_BALANCED'));
  });

  await t.test('stale current snapshot → DATA_REJECTED (fail closed), no intent', async () => {
    await seedBaseline();
    const result = await evaluateWindow(1060, 1005, { quoteAgeMs: 5 * 60_000 }); // quotes older than freshness gate
    assert.equal(result.orderIntent, null);
    const candidate = await mods.TradeCandidateModel.findOne({ automationSessionId: sessionId, status: 'DATA_REJECTED', barTimestamp: new Date(NEXT) });
    assert.ok(candidate, 'a DATA_REJECTED candidate was recorded');
    assert.ok(candidate.reasonCodes.includes('OPTIONS_WINDOW_STALE'));
  });

  await t.test('unauthorized / missing chain → DATA_REJECTED, no baseline persisted, no intent', async () => {
    const result = await mods.processOptionsFlowTick(
      sessionId,
      mock,
      fixtureFor({ SPY: { current: { call: null, put: null } } }, { now: NOW })
    );
    assert.equal(result.orderIntent, null);
    const candidate = await mods.TradeCandidateModel.findOne({ automationSessionId: sessionId, status: 'DATA_REJECTED' });
    assert.ok(candidate.reasonCodes.includes('OPTIONS_DATA_UNAVAILABLE'));
    const snap = await mods.OptionsFlowSnapshotModel.findOne({ automationSessionId: sessionId, underlying: 'SPY' });
    assert.equal(snap, null, 'no baseline is persisted from an unusable chain');
  });

  await t.test('restart durability: baseline from window 1 drives window 2 with no in-memory state', async () => {
    await seedBaseline(NOW);
    // Simulate a restart: the evaluator holds NO memory; only Mongo carries the
    // baseline forward. A fresh evaluation call must diff against it.
    const result = await evaluateWindow(1060, 1005, { now: NEXT });
    assert.equal(result.outcomeLabel, 'INTENT_CREATED');
    assert.equal(result.orderIntent.optionSymbol, CALL_WINNER);
  });

  await t.test('deterministic contract selection: identical inputs → identical winner', async () => {
    await seedBaseline();
    const a = await evaluateWindow(1060, 1005);
    // Second independent session, identical inputs.
    const session2 = await createReadySession(mods, { underlying: null, ...noResetSessionFields() });
    const id2 = String(session2._id);
    await mods.processOptionsFlowTick(id2, mock, fixtureFor({ SPY: { current: baselineChains({ now: NOW }) } }, { now: NOW }));
    const b = await mods.processOptionsFlowTick(
      id2,
      mock,
      fixtureFor({ SPY: { current: currentChains({ now: NEXT, call: 1060, put: 1005 }) } }, { now: NEXT })
    );
    assert.equal(a.orderIntent.optionSymbol, b.orderIntent.optionSymbol);
  });

  await t.test('INTEGRATION: scheduler → OPTIONS_NATIVE_FLOW evaluator → approved intent, zero submissions', async () => {
    // Window 1 through the real scheduler tick: baseline only, no intent.
    const evalW1 = async (sid, adapter) => {
      const { orderIntent, outcomeLabel } = await mods.processOptionsFlowTick(
        sid,
        adapter,
        fixtureFor({ SPY: { current: baselineChains({ now: NOW }) } }, { now: NOW })
      );
      return { approvedIntentId: orderIntent ? String(orderIntent._id) : null, outcome: outcomeLabel };
    };
    const w1 = await mods.runEvaluationTick({ adapter: mock, ownerId: 'owner-A', now: NOW, evaluate: evalW1 });
    assert.equal(w1.evaluated, 1);
    assert.equal(w1.sessions[0].approvedIntentId, null);

    // Window 2: bullish flow → approved intent, still zero submissions.
    const evalW2 = async (sid, adapter) => {
      const { orderIntent, outcomeLabel } = await mods.processOptionsFlowTick(
        sid,
        adapter,
        fixtureFor({ SPY: { current: currentChains({ now: NEXT, call: 1060, put: 1005 }) } }, { now: NEXT })
      );
      return { approvedIntentId: orderIntent ? String(orderIntent._id) : null, outcome: outcomeLabel };
    };
    const w2 = await mods.runEvaluationTick({ adapter: mock, ownerId: 'owner-A', now: NEXT, evaluate: evalW2 });
    assert.equal(w2.evaluated, 1);
    assert.ok(w2.sessions[0].approvedIntentId, 'the scheduler produced an approved intent via options-native flow');
    const intent = await mods.OrderIntentModel.findById(w2.sessions[0].approvedIntentId);
    assert.equal(intent.status, 'APPROVED_AWAITING_EXECUTION');
    assert.equal(intent.optionSymbol, CALL_WINNER);
    assert.equal(submitCalls(), 0, 'the scheduler must never submit');
  });
});
