// Phase 2C finalization — the production monitoring scheduler. Proves the
// deployment blocker is closed: runMonitorTick fail-closes before READY, holds
// a single-owner lease (its own scope), emits a structured heartbeat, and
// autonomously drives stop-loss exits and end-of-day flatten via runSchedulerTick
// with NO entry evaluator. Also proves the live mark provider fails closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadDist,
  startTestMongo,
  stopTestMongo,
  dropAutomationCollections,
  createReadySession,
} from './automation.helpers.mjs';

const mods = await loadDist();

const OPTION = 'SPY260724C00500000';
const ENTRY_LINKS = (sessionId) => ({
  automationSessionId: sessionId,
  strategyVersionId: 'sv-test-1',
  universeEvaluationId: null,
  tradeCandidateId: null,
  contractSelectionId: null,
  riskDecisionId: null,
  underlying: 'SPY',
  optionSymbol: OPTION,
  direction: 'BULLISH',
});

async function openPosition(mock, sessionId, { qty = 2, entryPrice = 1.0 } = {}) {
  const { intent } = await mods.createOrderIntent({
    automationSessionId: sessionId,
    strategyVersionId: 'sv-test-1',
    underlying: 'SPY',
    signalDirection: 'BUY',
    closedBarTimestamp: new Date('2026-07-10T15:00:00.000Z'),
    intentType: 'ENTRY',
    optionSymbol: OPTION,
    quantity: qty,
    orderType: 'limit',
    limitPrice: entryPrice,
    timeInForce: 'day',
  });
  intent.status = 'APPROVED_AWAITING_EXECUTION';
  await intent.save();
  mock.scriptOrder(intent.clientOrderId, {
    onSubmit: 'accept',
    pollSequence: [{ rawStatus: 'filled', filledQty: qty, avgFillPrice: entryPrice }],
  });
  const exec = await mods.executeApprovedEntry(intent, mock, ENTRY_LINKS(sessionId));
  await mods.runSchedulerTick(sessionId, mock, {
    markProvider: async () => ({ mark: entryPrice, stale: false }),
    now: Date.parse('2026-07-10T18:00:00.000Z'),
  });
  const pos = await mods.AutomationPositionModel.findById(exec.positionId);
  assert.equal(pos.status, 'OPEN');
  return pos;
}

test('Phase 2C monitoring scheduler', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  let mock;
  let session;
  t.beforeEach(async () => {
    await dropAutomationCollections();
    mods.clearMarketClockCache();
    mods.clearReconciliationStateForTests();
    mods.resetAutomationRuntimeForTests();
    mods.resetMonitorControllerForTests();
    mock = new mods.MockPaperBrokerAdapter();
    mock.setClock('open');
  });

  await t.test('fails closed before automation is READY', async () => {
    // No initializeAutomation → runtime not READY.
    const r = await mods.runMonitorTick({ adapter: mock, ownerId: 'owner-A', now: Date.parse('2026-07-10T18:00:00.000Z') });
    assert.equal(r.skippedReason, 'AUTOMATION_NOT_READY');
    assert.equal(r.heartbeat.automationReady, false);
    assert.equal(r.exitsTriggered, 0);
  });

  await t.test('single-owner lease: a second owner cannot monitor concurrently', async () => {
    const init = await mods.initializeAutomation({ adapter: mock });
    assert.equal(init.ready, true);
    const now = Date.parse('2026-07-10T18:00:00.000Z');

    const a = await mods.runMonitorTick({ adapter: mock, ownerId: 'owner-A', now });
    assert.equal(a.skippedReason, null);
    assert.equal(a.heartbeat.ownsLease, true);

    const b = await mods.runMonitorTick({ adapter: mock, ownerId: 'owner-B', now });
    assert.equal(b.skippedReason, 'LEASE_NOT_OWNED');
    assert.equal(b.heartbeat.ownsLease, false);

    // Same owner renews and proceeds.
    const a2 = await mods.runMonitorTick({ adapter: mock, ownerId: 'owner-A', now: now + 1000 });
    assert.equal(a2.skippedReason, null);
  });

  await t.test('heartbeat is a structured snapshot of lifecycle health', async () => {
    const init = await mods.initializeAutomation({ adapter: mock });
    assert.equal(init.ready, true);
    session = await createReadySession(mods, {
      underlying: 'SPY', reconciliationStatus: 'CLEAN', lastResetTradingDate: '2026-07-10', startingDayEquity: 100_000,
    });
    await openPosition(mock, String(session._id));

    const r = await mods.runMonitorTick({
      adapter: mock,
      ownerId: 'owner-A',
      now: Date.parse('2026-07-10T18:05:00.000Z'),
      markProvider: async () => ({ mark: 1.05, stale: false }), // no trigger
    });
    for (const key of [
      'ownsLease', 'mongoConnected', 'automationReady', 'brokerConnected', 'brokerTruthCurrent',
      'marketPhase', 'openPositions', 'exitingPositions', 'manualReviewPositions', 'staleExitingPositions',
    ]) {
      assert.ok(key in r.heartbeat, `heartbeat carries ${key}`);
    }
    assert.equal(r.heartbeat.brokerConnected, true);
    assert.equal(r.heartbeat.marketPhase, 'PRE_CUTOFF');
    assert.equal(r.heartbeat.openPositions, 1);
    assert.equal(r.exitsTriggered, 0);
  });

  await t.test('autonomously executes a stop-loss exit (no entry evaluator)', async () => {
    const init = await mods.initializeAutomation({ adapter: mock });
    assert.equal(init.ready, true);
    session = await createReadySession(mods, {
      underlying: 'SPY', reconciliationStatus: 'CLEAN', lastResetTradingDate: '2026-07-10', startingDayEquity: 100_000,
    });
    const pos = await openPosition(mock, String(session._id)); // entry 1.0, stop 0.75

    mock.setDefaultScript({ onSubmit: 'fill' }); // exit market order fills
    mock.setMarketFillPrice(0.7);

    const r = await mods.runMonitorTick({
      adapter: mock,
      ownerId: 'owner-A',
      now: Date.parse('2026-07-10T18:10:00.000Z'),
      markProvider: async () => ({ mark: 0.7, stale: false }), // below stop
    });
    assert.equal(r.exitsTriggered, 1);
    const fresh = await mods.AutomationPositionModel.findById(pos._id);
    assert.equal(fresh.status, 'CLOSED');
    assert.equal(fresh.exitReason, 'HARD_STOP');
  });

  await t.test('autonomously flattens all positions in the flatten window', async () => {
    const init = await mods.initializeAutomation({ adapter: mock });
    assert.equal(init.ready, true);
    session = await createReadySession(mods, {
      underlying: 'SPY', reconciliationStatus: 'CLEAN', lastResetTradingDate: '2026-07-10', startingDayEquity: 100_000,
    });
    const pos = await openPosition(mock, String(session._id));

    mock.setDefaultScript({ onSubmit: 'fill' });
    mock.setMarketFillPrice(1.05);

    // Mock close is 20:00Z; now 19:50Z → minutesToClose 10 → FLATTEN window.
    const r = await mods.runMonitorTick({
      adapter: mock,
      ownerId: 'owner-A',
      now: Date.parse('2026-07-10T19:50:00.000Z'),
      markProvider: async () => ({ mark: 1.05, stale: false }),
    });
    assert.equal(r.heartbeat.marketPhase, 'FLATTEN');
    assert.equal(r.exitsTriggered, 1);
    const fresh = await mods.AutomationPositionModel.findById(pos._id);
    assert.equal(fresh.status, 'CLOSED');
    assert.equal(fresh.exitReason, 'END_OF_DAY');
  });

  await t.test('live mark provider fails closed (no network, no invented mark)', async () => {
    // Massive base URL is unroutable in tests; the chain fetch fails → null mark.
    const provider = mods.createLiveMarkProvider();
    const { mark, stale } = await provider(OPTION);
    assert.equal(mark, null);
    assert.equal(stale, true);
  });
});
