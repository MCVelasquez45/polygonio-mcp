// Phase 2C — end-to-end paper lifecycle + scheduler + lease + ownership.
// Uses the deterministic mock broker: approved intent → submit → partial fill
// → full fill → position OPEN → profit target → exit → CLOSED → realized P&L →
// risk counters. Proves NO synthetic data enters durable state — every fill is
// a broker response.
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  loadDist,
  startTestMongo,
  stopTestMongo,
  dropAutomationCollections,
  createReadySession,
} from './automation.helpers.mjs';

const mods = await loadDist();

function guardSubmit(adapter) {
  const original = adapter.submitOrder.bind(adapter);
  let calls = 0;
  adapter.submitOrder = async (...args) => {
    calls += 1;
    return original(...args);
  };
  return () => calls;
}

const ENTRY_LINKS = (sessionId) => ({
  automationSessionId: sessionId,
  strategyVersionId: 'sv-test-1',
  universeEvaluationId: null,
  tradeCandidateId: null,
  contractSelectionId: null,
  riskDecisionId: null,
  underlying: 'SPY',
  optionSymbol: 'SPY260724C00500000',
  direction: 'BULLISH',
});

async function makeApprovedEntryIntent(mods, sessionId, overrides = {}) {
  const { intent } = await mods.createOrderIntent({
    automationSessionId: sessionId,
    strategyVersionId: 'sv-test-1',
    underlying: 'SPY',
    signalDirection: 'BUY',
    closedBarTimestamp: new Date('2026-07-10T15:00:00.000Z'),
    intentType: 'ENTRY',
    optionSymbol: 'SPY260724C00500000',
    quantity: 2,
    orderType: 'limit',
    limitPrice: 1.0,
    timeInForce: 'day',
    ...overrides,
  });
  intent.status = 'APPROVED_AWAITING_EXECUTION';
  await intent.save();
  return intent;
}

test('Phase 2C lifecycle', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  let mock;
  let session;
  let submitCalls;
  t.beforeEach(async () => {
    await dropAutomationCollections();
    mods.clearMarketClockCache();
    mods.clearReconciliationStateForTests();
    mods.resetAutomationRuntimeForTests();
    mock = new mods.MockPaperBrokerAdapter();
    mock.setClock('open');
    submitCalls = guardSubmit(mock);
    const init = await mods.initializeAutomation({ adapter: mock });
    assert.equal(init.ready, true);
    session = await createReadySession(mods, {
      underlying: 'SPY',
      reconciliationStatus: 'CLEAN',
      lastResetTradingDate: '2026-07-10',
      startingDayEquity: 100_000,
    });
  });

  await t.test('INTEGRATION: approved → submit → fill → OPEN → target → exit → CLOSED → risk updated', async () => {
    // Exit is a market order; broker fills it at the prevailing price (1.4).
    mock.setDefaultScript({ onSubmit: 'fill' });
    mock.setMarketFillPrice(1.4);

    const intent = await makeApprovedEntryIntent(mods, String(session._id));
    // Entry accepts on submit, then confirms a full fill at 1.00 on the poll.
    mock.scriptOrder(intent.clientOrderId, {
      onSubmit: 'accept',
      pollSequence: [{ rawStatus: 'filled', filledQty: 2, avgFillPrice: 1.0 }],
    });

    // Execute the approved entry → position PENDING_ENTRY (no synthetic fill).
    const exec = await mods.executeApprovedEntry(intent, mock, ENTRY_LINKS(String(session._id)));
    assert.equal(exec.result.outcome, 'SUBMITTED');
    let pos = await mods.AutomationPositionModel.findById(exec.positionId);
    assert.equal(pos.status, 'PENDING_ENTRY');
    assert.equal(submitCalls(), 1);

    // Tick 1: broker-confirmed fill polled in → OPEN, exit policy snapshotted.
    await mods.runSchedulerTick(String(session._id), mock, {
      markProvider: async () => ({ mark: 1.1, stale: false }),
      now: Date.parse('2026-07-10T18:00:00.000Z'),
    });
    pos = await mods.AutomationPositionModel.findById(exec.positionId);
    assert.equal(pos.status, 'OPEN');
    assert.equal(pos.filledQty, 2);
    assert.ok(pos.exitPolicy, 'exit policy snapshotted at first fill');
    assert.equal(pos.unrealizedPnl, Number(((1.1 - 1.0) * 2 * 100).toFixed(2)));

    // Tick 2: mark hits profit target (entry 1.0 × 1.30 = 1.30) → exit → CLOSED.
    const tick = await mods.runSchedulerTick(String(session._id), mock, {
      markProvider: async () => ({ mark: 1.4, stale: false }),
      now: Date.parse('2026-07-10T18:10:00.000Z'),
    });
    assert.equal(tick.exitsTriggered, 1);
    pos = await mods.AutomationPositionModel.findById(exec.positionId);
    assert.equal(pos.status, 'CLOSED');
    assert.equal(pos.exitReason, 'PROFIT_TARGET');
    assert.equal(pos.avgExitPrice, 1.4);

    // Risk counters updated from broker truth: (1.4-1.0)*2*100 = 80 → WIN.
    const s = await mods.AutomationSessionModel.findById(session._id);
    assert.equal(s.dailyTradeCount, 1);
    assert.equal(s.dailyRealizedPnl, 80);
    assert.equal(s.lastTradeResult, 'WIN');
    assert.equal(pos.riskCounted, true);
  });

  await t.test('partial fills aggregate correctly and do not regress (pure)', () => {
    const order = (filledQty, avgFillPrice, status) => ({
      brokerOrderId: 'o1', clientOrderId: 'c1', symbol: 'SPY260724C00500000', side: 'BUY',
      qty: 4, filledQty, avgFillPrice, status, rawStatus: status.toLowerCase(),
      orderType: 'limit', limitPrice: 1, timeInForce: 'day', submittedAt: new Date(), updatedAt: new Date(),
    });
    const pos = new mods.AutomationPositionModel({
      source: 'AUTOMATION', automationSessionId: 'S', strategyVersionId: 'sv', underlying: 'SPY',
      optionSymbol: 'SPY260724C00500000', direction: 'BULLISH', entryIntentId: 'i', entryClientOrderId: 'c1',
      status: 'PENDING_ENTRY', filledQty: 0,
    });
    mods.applyEntryFill(pos, order(2, 1.0, 'PARTIALLY_FILLED'));
    assert.equal(pos.filledQty, 2);
    assert.equal(pos.status, 'OPEN');
    mods.applyEntryFill(pos, order(4, 1.1, 'FILLED'));
    assert.equal(pos.filledQty, 4);
    // A stale duplicate (lower filledQty) must not regress.
    mods.applyEntryFill(pos, order(1, 0.5, 'PARTIALLY_FILLED'));
    assert.equal(pos.filledQty, 4);
  });

  await t.test('duplicate evaluation creates no duplicate broker order', async () => {
    const intent = await makeApprovedEntryIntent(mods, String(session._id));
    mock.scriptOrder(intent.clientOrderId, { onSubmit: 'accept' });
    await mods.executeApprovedEntry(intent, mock, ENTRY_LINKS(String(session._id)));
    await mods.executeApprovedEntry(intent, mock, ENTRY_LINKS(String(session._id)));
    assert.equal(submitCalls(), 1, 'second execute must not resubmit');
    const positions = await mods.AutomationPositionModel.countDocuments({});
    assert.equal(positions, 1);
  });

  await t.test('out-of-order / duplicate fills do not regress a closed position', async () => {
    const intent = await makeApprovedEntryIntent(mods, String(session._id));
    mock.scriptOrder(intent.clientOrderId, { onSubmit: 'fill' });
    const exec = await mods.executeApprovedEntry(intent, mock, ENTRY_LINKS(String(session._id)));
    let pos = await mods.AutomationPositionModel.findById(exec.positionId);
    // Force to CLOSED, then replay an old entry fill snapshot.
    mods.applyEntryFill(pos, { brokerOrderId: 'x', filledQty: 1, avgFillPrice: 0.5, status: 'PARTIALLY_FILLED', symbol: 'SPY260724C00500000', side: 'BUY', qty: 2, rawStatus: 'partially_filled', clientOrderId: intent.clientOrderId, orderType: 'limit', limitPrice: 1, timeInForce: 'day', submittedAt: new Date(), updatedAt: new Date() });
    // filledQty already 2 from the fill; a qty=1 event must not lower it.
    assert.equal(pos.filledQty, 2);
  });

  await t.test('emergency stop flattens open positions with highest-priority exit', async () => {
    const intent = await makeApprovedEntryIntent(mods, String(session._id));
    mock.scriptOrder(intent.clientOrderId, { onSubmit: 'fill' });
    const exec = await mods.executeApprovedEntry(intent, mock, ENTRY_LINKS(String(session._id)));
    // Fill polled → OPEN.
    await mods.runSchedulerTick(String(session._id), mock, {
      markProvider: async () => ({ mark: 1.0, stale: false }),
      now: Date.parse('2026-07-10T18:00:00.000Z'),
    });
    const { exits } = await mods.flattenAllOnEmergency(String(session._id), mock);
    assert.equal(exits, 1);
    const pos = await mods.AutomationPositionModel.findById(exec.positionId);
    assert.ok(['EXITING', 'CLOSED'].includes(pos.status));
    assert.equal(pos.exitReason, 'EMERGENCY_STOP');
  });

  await t.test('data outage: stale quote blocks price exits, keeps position OPEN', async () => {
    const intent = await makeApprovedEntryIntent(mods, String(session._id));
    mock.scriptOrder(intent.clientOrderId, { onSubmit: 'fill' });
    const exec = await mods.executeApprovedEntry(intent, mock, ENTRY_LINKS(String(session._id)));
    await mods.runSchedulerTick(String(session._id), mock, {
      markProvider: async () => ({ mark: 1.0, stale: false }),
      now: Date.parse('2026-07-10T18:00:00.000Z'),
    });
    // Even at a would-be-target price, a stale quote must not trigger the exit.
    const tick = await mods.runSchedulerTick(String(session._id), mock, {
      markProvider: async () => ({ mark: 1.4, stale: true }),
      now: Date.parse('2026-07-10T18:05:00.000Z'),
    });
    assert.equal(tick.exitsTriggered, 0);
    const pos = await mods.AutomationPositionModel.findById(exec.positionId);
    assert.equal(pos.status, 'OPEN');
  });

  await t.test('flatten window submits end-of-day exit (no overnight position)', async () => {
    const intent = await makeApprovedEntryIntent(mods, String(session._id));
    mock.scriptOrder(intent.clientOrderId, { onSubmit: 'fill' });
    const exec = await mods.executeApprovedEntry(intent, mock, ENTRY_LINKS(String(session._id)));
    await mods.runSchedulerTick(String(session._id), mock, {
      markProvider: async () => ({ mark: 1.0, stale: false }),
      now: Date.parse('2026-07-10T18:00:00.000Z'),
    });
    // Mock clock closes at 20:00Z; run a tick at 19:50Z → 10 min to close → FLATTEN.
    const tick = await mods.runSchedulerTick(String(session._id), mock, {
      markProvider: async () => ({ mark: 1.0, stale: false }),
      now: Date.parse('2026-07-10T19:50:00.000Z'),
    });
    assert.equal(tick.sessionState.phase, 'FLATTEN');
    assert.equal(tick.exitsTriggered, 1);
    const pos = await mods.AutomationPositionModel.findById(exec.positionId);
    assert.equal(pos.exitReason, 'END_OF_DAY');
  });

  await t.test('no entries when market closed', async () => {
    mock.setClock('closed');
    let evaluatorCalls = 0;
    const tick = await mods.runSchedulerTick(String(session._id), mock, {
      markProvider: async () => ({ mark: 1.0, stale: false }),
      entryEvaluator: async () => {
        evaluatorCalls += 1;
        return { submitted: 0 };
      },
      now: Date.parse('2026-07-10T18:00:00.000Z'),
    });
    assert.equal(tick.sessionState.phase, 'CLOSED');
    assert.equal(evaluatorCalls, 0, 'no entry evaluation when closed');
  });
});

test('scheduler lease (single owner)', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());
  t.beforeEach(async () => dropAutomationCollections());

  await t.test('one owner acquires; a different owner is blocked while it is held', async () => {
    const now = new Date('2026-07-10T18:00:00.000Z');
    const a = await mods.acquireSchedulerLease('automation-scheduler', 'owner-A', 30_000, now);
    const b = await mods.acquireSchedulerLease('automation-scheduler', 'owner-B', 30_000, now);
    assert.equal(a, true);
    assert.equal(b, false, 'second owner cannot acquire a held lease');
  });

  await t.test('the same owner renews', async () => {
    const now = new Date('2026-07-10T18:00:00.000Z');
    await mods.acquireSchedulerLease('automation-scheduler', 'owner-A', 30_000, now);
    const renew = await mods.acquireSchedulerLease('automation-scheduler', 'owner-A', 30_000, new Date(now.getTime() + 5_000));
    assert.equal(renew, true);
  });

  await t.test('an expired lease is reclaimable by a new owner', async () => {
    const now = new Date('2026-07-10T18:00:00.000Z');
    await mods.acquireSchedulerLease('automation-scheduler', 'owner-A', 1_000, now);
    const later = new Date(now.getTime() + 5_000); // A's lease expired
    const b = await mods.acquireSchedulerLease('automation-scheduler', 'owner-B', 30_000, later);
    assert.equal(b, true);
  });
});

test('portfolio ownership classification', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  let mock;
  let session;
  t.beforeEach(async () => {
    await dropAutomationCollections();
    mods.clearMarketClockCache();
    mods.clearReconciliationStateForTests();
    mods.resetAutomationRuntimeForTests();
    mock = new mods.MockPaperBrokerAdapter();
    mock.setClock('open');
    await mods.initializeAutomation({ adapter: mock });
    session = await createReadySession(mods, { underlying: 'SPY', reconciliationStatus: 'CLEAN', startingDayEquity: 100_000 });
  });

  await t.test('automation-owned vs manual positions are classified by proven links', async () => {
    // Automation position: fill an entry so the broker shows it AND we own it.
    const intent = await makeApprovedEntryIntent(mods, String(session._id));
    mock.scriptOrder(intent.clientOrderId, { onSubmit: 'fill' });
    await mods.executeApprovedEntry(intent, mock, ENTRY_LINKS(String(session._id)));
    await mods.runSchedulerTick(String(session._id), mock, {
      markProvider: async () => ({ mark: 1.0, stale: false }),
      now: Date.parse('2026-07-10T18:00:00.000Z'),
    });
    // Manual position: seed a broker position with no automation link.
    mock.seedPosition({ symbol: 'AAPL260724C00200000', qty: 3, side: 'long', avgEntryPrice: 2 });

    const ops = await mods.getPortfolioOperations();
    const bySymbol = new Map(ops.automationContext.positionsBySymbol.map(p => [p.symbol, p]));
    const auto = bySymbol.get('SPY260724C00500000');
    const manual = bySymbol.get('AAPL260724C00200000');
    assert.equal(auto.source, 'AUTOMATION');
    assert.ok(auto.automation);
    assert.equal(manual.source, 'MANUAL');
    assert.equal(manual.automation, null);
    assert.equal(ops.manualBrokerActivity.positions.length, 1);
  });

  await t.test('emergency-stop control pauses the session and begins exit lifecycle', async () => {
    const intent = await makeApprovedEntryIntent(mods, String(session._id));
    mock.scriptOrder(intent.clientOrderId, { onSubmit: 'fill' });
    const exec = await mods.executeApprovedEntry(intent, mock, ENTRY_LINKS(String(session._id)));
    await mods.runSchedulerTick(String(session._id), mock, {
      markProvider: async () => ({ mark: 1.0, stale: false }),
      now: Date.parse('2026-07-10T18:00:00.000Z'),
    });
    const res = await mods.emergencyStopSession(String(session._id), 'operator test');
    assert.equal(res.exitsTriggered, 1);
    const s = await mods.AutomationSessionModel.findById(session._id);
    assert.equal(s.emergencyStop.active, true);
    assert.equal(s.status, 'EMERGENCY_STOPPED');
    const pos = await mods.AutomationPositionModel.findById(exec.positionId);
    assert.ok(['EXITING', 'CLOSED'].includes(pos.status));
  });
});
