// Phase 2C Sprint 2 — approved intent → Alpaca paper submission.
// Proves the 8 pre-submission gates, one-intent = one-broker-order idempotency,
// durable broker-acknowledgement persistence, and the failure matrix (timeout →
// MANUAL_REVIEW, rejected, market-closed, duplicate, existing order). Sprint 2
// STOPS at broker acknowledgement — no fills, positions, P&L, or risk counters.
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

function guardSubmit(adapter) {
  const original = adapter.submitOrder.bind(adapter);
  let calls = 0;
  adapter.submitOrder = async (...args) => {
    calls += 1;
    return original(...args);
  };
  return () => calls;
}

function guardCancel(adapter) {
  const original = adapter.cancelOrder.bind(adapter);
  let calls = 0;
  adapter.cancelOrder = async (...args) => {
    calls += 1;
    return original(...args);
  };
  return () => calls;
}

const OPEN_SESSION = { isOpen: true, phase: 'PRE_CUTOFF', entriesAllowed: true, shouldCancelEntries: false, shouldFlatten: false, minutesToClose: 120, nextClose: null, nextOpen: null, asOf: '' };
const CLOSED_SESSION = { ...OPEN_SESSION, isOpen: false, phase: 'CLOSED', entriesAllowed: false };
const CUTOFF_SESSION = { ...OPEN_SESSION, phase: 'POST_ENTRY_CUTOFF', entriesAllowed: false };

async function approvedEntry(mods, sessionId, overrides = {}) {
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
    limitPrice: 1.15,
    timeInForce: 'day',
    ...overrides,
  });
  intent.status = 'APPROVED_AWAITING_EXECUTION';
  await intent.save();
  return intent;
}

test('order submission (Sprint 2)', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  let mock;
  let submitCalls;
  let cancelCalls;
  let session;
  t.beforeEach(async () => {
    await dropAutomationCollections();
    mods.clearMarketClockCache();
    mods.clearReconciliationStateForTests();
    mods.resetAutomationRuntimeForTests();
    mock = new mods.MockPaperBrokerAdapter();
    mock.setClock('open');
    submitCalls = guardSubmit(mock);
    cancelCalls = guardCancel(mock);
    const init = await mods.initializeAutomation({ adapter: mock });
    assert.equal(init.ready, true);
    session = await createReadySession(mods, { underlying: 'SPY', reconciliationStatus: 'CLEAN' });
  });

  const ctx = (over = {}) => ({ ownsLease: true, marketSession: OPEN_SESSION, ...over });

  // ---- happy path + persistence -------------------------------------------
  await t.test('submits one approved intent and persists the broker acknowledgement', async () => {
    const intent = await approvedEntry(mods, String(session._id));
    mock.scriptOrder(intent.clientOrderId, { onSubmit: 'accept' });
    const res = await mods.submitApprovedIntent(String(intent._id), mock, ctx());
    assert.equal(res.outcome, 'SUBMITTED');
    assert.equal(submitCalls(), 1);

    const saved = await mods.OrderIntentModel.findById(intent._id);
    assert.equal(saved.status, 'SUBMITTED');
    assert.ok(saved.brokerOrderId);
    assert.ok(saved.submittedAt);

    // Broker-order journal persists the acknowledgement (no invented fields).
    const brokerOrder = await mods.BrokerOrderModel.findOne({ clientOrderId: intent.clientOrderId }).lean();
    assert.ok(brokerOrder);
    assert.equal(brokerOrder.clientOrderId, intent.clientOrderId);
    assert.equal(brokerOrder.brokerOrderId, saved.brokerOrderId);
    assert.equal(brokerOrder.symbol, 'SPY260724C00500000');
    assert.equal(brokerOrder.qty, 2);
    assert.equal(brokerOrder.limitPrice, 1.15);
    assert.equal(brokerOrder.intentId, String(intent._id));
    assert.equal(brokerOrder.automationSessionId, String(session._id));
    assert.ok(brokerOrder.submittedAt);
    assert.ok(brokerOrder.rawStatus);

    // Sprint 2 boundary: no position was created.
    assert.equal(await mods.AutomationPositionModel.countDocuments({}), 0);
  });

  await t.test('entry timeout cancels a submitted unfilled order exactly once and releases the slot', async () => {
    const intent = await approvedEntry(mods, String(session._id));
    mock.scriptOrder(intent.clientOrderId, { onSubmit: 'accept' });
    const res = await mods.submitApprovedIntent(String(intent._id), mock, ctx());
    assert.equal(res.outcome, 'SUBMITTED');

    const submitted = await mods.OrderIntentModel.findById(intent._id);
    submitted.submittedAt = new Date('2026-07-10T15:00:00.000Z');
    await submitted.save();
    assert.equal(
      await mods.OrderIntentModel.countDocuments({ automationSessionId: String(session._id), status: { $in: ['SUBMITTED'] } }),
      1,
      'submitted entry occupies the automation slot before timeout'
    );

    const first = await mods.cancelTimedOutEntryOrders(mock, new Date('2026-07-10T15:02:30.000Z'));
    assert.equal(first.scanned, 1);
    assert.equal(first.reconciled, 1);
    assert.equal(first.cancelRequested, 1);
    assert.equal(first.errors, 0);
    assert.equal(cancelCalls(), 1);

    const saved = await mods.OrderIntentModel.findById(intent._id);
    assert.equal(saved.status, 'FAILED');
    assert.equal(saved.brokerOrderId, res.brokerOrderId);
    const brokerOrder = await mods.BrokerOrderModel.findOne({ clientOrderId: intent.clientOrderId }).lean();
    assert.equal(brokerOrder.status, 'CANCELLED');
    assert.equal(brokerOrder.filledQty, 0);
    assert.equal(await mods.AutomationPositionModel.countDocuments({}), 0);
    assert.equal(
      await mods.OrderIntentModel.countDocuments({ automationSessionId: String(session._id), status: { $in: ['SUBMITTED'] } }),
      0,
      'terminal zero-fill cancel releases the automation slot'
    );

    const second = await mods.cancelTimedOutEntryOrders(mock, new Date('2026-07-10T15:03:30.000Z'));
    assert.equal(second.scanned, 0);
    assert.equal(cancelCalls(), 1, 'terminal canceled entry is not canceled again');
  });

  // ---- idempotency: one intent = one broker order --------------------------
  await t.test('idempotent: submitting the same intent twice creates exactly one broker order', async () => {
    const intent = await approvedEntry(mods, String(session._id));
    mock.scriptOrder(intent.clientOrderId, { onSubmit: 'accept' });
    const first = await mods.submitApprovedIntent(String(intent._id), mock, ctx());
    const second = await mods.submitApprovedIntent(String(intent._id), mock, ctx());
    assert.equal(first.outcome, 'SUBMITTED');
    assert.equal(second.outcome, 'ALREADY_SUBMITTED');
    assert.equal(submitCalls(), 1, 'the broker is reached exactly once');
    assert.equal(await mods.BrokerOrderModel.countDocuments({ clientOrderId: intent.clientOrderId }), 1);
  });

  await t.test('a pre-existing broker order for the client_order_id refuses re-submission', async () => {
    const intent = await approvedEntry(mods, String(session._id));
    // Simulate an already-persisted broker order (e.g. recovered by reconciliation).
    await mods.BrokerOrderModel.create({
      brokerOrderId: 'pre-existing-1',
      clientOrderId: intent.clientOrderId,
      intentId: String(intent._id),
      automationSessionId: String(session._id),
      symbol: 'SPY260724C00500000',
      side: 'BUY',
      qty: 2,
      filledQty: 0,
      status: 'ACCEPTED',
      rawStatus: 'accepted',
      orderType: 'limit',
      limitPrice: 1.15,
      timeInForce: 'day',
      lastSource: 'reconciliation',
      statusHistory: [],
    });
    const res = await mods.submitApprovedIntent(String(intent._id), mock, ctx());
    assert.equal(res.outcome, 'ALREADY_SUBMITTED');
    assert.equal(submitCalls(), 0, 'never double-submit');
  });

  // ---- the 8 gates ---------------------------------------------------------
  await t.test('gate: market closed → REFUSED, never reaches broker', async () => {
    const intent = await approvedEntry(mods, String(session._id));
    const res = await mods.submitApprovedIntent(String(intent._id), mock, ctx({ marketSession: CLOSED_SESSION }));
    assert.equal(res.outcome, 'REFUSED');
    assert.equal(res.refusedReason, 'MARKET_CLOSED');
    assert.equal(submitCalls(), 0);
  });

  await t.test('gate: after final-entry cutoff → REFUSED', async () => {
    const intent = await approvedEntry(mods, String(session._id));
    const res = await mods.submitApprovedIntent(String(intent._id), mock, ctx({ marketSession: CUTOFF_SESSION }));
    assert.equal(res.refusedReason, 'AFTER_FINAL_ENTRY_CUTOFF');
    assert.equal(submitCalls(), 0);
  });

  await t.test('gate: scheduler lease not owned → REFUSED', async () => {
    const intent = await approvedEntry(mods, String(session._id));
    const res = await mods.submitApprovedIntent(String(intent._id), mock, ctx({ ownsLease: false }));
    assert.equal(res.refusedReason, 'SCHEDULER_LEASE_NOT_OWNED');
    assert.equal(submitCalls(), 0);
  });

  await t.test('gate: reconciliation not CLEAN → REFUSED', async () => {
    session.reconciliationStatus = 'PENDING';
    await session.save();
    const intent = await approvedEntry(mods, String(session._id));
    const res = await mods.submitApprovedIntent(String(intent._id), mock, ctx());
    assert.equal(res.refusedReason, 'RECONCILIATION_NOT_CLEAN');
    assert.equal(submitCalls(), 0);
  });

  await t.test('gate: paused session cannot submit', async () => {
    session.status = 'PAUSED';
    session.pauseReason = 'operator pause';
    await session.save();
    const intent = await approvedEntry(mods, String(session._id));
    const res = await mods.submitApprovedIntent(String(intent._id), mock, ctx());
    assert.equal(res.refusedReason, 'SESSION_NOT_RUNNABLE');
    assert.equal(submitCalls(), 0);
  });

  await t.test('gate: emergency stop → REFUSED', async () => {
    session.emergencyStop = { active: true, reason: 'test', at: new Date() };
    await session.save();
    const intent = await approvedEntry(mods, String(session._id));
    const res = await mods.submitApprovedIntent(String(intent._id), mock, ctx());
    assert.equal(res.refusedReason, 'EMERGENCY_STOP_ACTIVE');
    assert.equal(submitCalls(), 0);
  });

  await t.test('gate: automation not READY → REFUSED', async () => {
    mods.resetAutomationRuntimeForTests();
    const intent = await approvedEntry(mods, String(session._id));
    const res = await mods.submitApprovedIntent(String(intent._id), mock, ctx());
    assert.equal(res.refusedReason, 'AUTOMATION_NOT_READY');
    assert.equal(submitCalls(), 0);
  });

  // ---- failure matrix ------------------------------------------------------
  await t.test('broker rejects → intent BROKER_REJECTED, acknowledgement persisted', async () => {
    const intent = await approvedEntry(mods, String(session._id));
    mock.scriptOrder(intent.clientOrderId, { onSubmit: 'reject', rejectReason: 'insufficient buying power' });
    const res = await mods.submitApprovedIntent(String(intent._id), mock, ctx());
    assert.equal(res.outcome, 'BROKER_REJECTED');
    const saved = await mods.OrderIntentModel.findById(intent._id);
    assert.equal(saved.status, 'BROKER_REJECTED');
    const bo = await mods.BrokerOrderModel.findOne({ clientOrderId: intent.clientOrderId }).lean();
    assert.equal(bo.status, 'REJECTED');
  });

  await t.test('broker timeout (ambiguous) → intent MANUAL_REVIEW, never blind-retried', async () => {
    const intent = await approvedEntry(mods, String(session._id));
    mock.scriptOrder(intent.clientOrderId, { onSubmit: 'timeout' });
    const res = await mods.submitApprovedIntent(String(intent._id), mock, ctx());
    assert.equal(res.outcome, 'MANUAL_REVIEW');
    const saved = await mods.OrderIntentModel.findById(intent._id);
    assert.equal(saved.status, 'MANUAL_REVIEW');
    assert.ok(saved.rejectionReason?.includes('ambiguous'));
    // A second attempt does not resubmit a MANUAL_REVIEW intent.
    const again = await mods.submitApprovedIntent(String(intent._id), mock, ctx());
    assert.equal(again.outcome, 'ALREADY_SUBMITTED');
  });

  await t.test('broker unavailable at submit (timeout) leaves no phantom broker order', async () => {
    const intent = await approvedEntry(mods, String(session._id));
    mock.scriptOrder(intent.clientOrderId, { onSubmit: 'timeout' });
    await mods.submitApprovedIntent(String(intent._id), mock, ctx());
    // No broker order was acknowledged, so none is journaled.
    assert.equal(await mods.BrokerOrderModel.countDocuments({ clientOrderId: intent.clientOrderId }), 0);
  });
});

// ---- scheduler wiring (gated submission) -----------------------------------
test('scheduler submits approved intents only when execution is enabled', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  let mock;
  let submitCalls;
  let cancelCalls;
  let session;
  t.beforeEach(async () => {
    await dropAutomationCollections();
    mods.clearMarketClockCache();
    mods.clearReconciliationStateForTests();
    mods.resetAutomationRuntimeForTests();
    mods.resetSchedulerControllerForTests?.();
    mock = new mods.MockPaperBrokerAdapter();
    mock.setClock('open');
    submitCalls = guardSubmit(mock);
    cancelCalls = guardCancel(mock);
    await mods.initializeAutomation({ adapter: mock });
    session = await createReadySession(mods, { underlying: 'SPY', reconciliationStatus: 'CLEAN' });
  });

  const NOW = Date.parse('2026-07-10T15:00:00.000Z');

  await t.test('submissionEnabled=false (default): evaluates but never submits', async () => {
    const intent = await approvedEntry(mods, String(session._id));
    const result = await mods.runEvaluationTick({
      adapter: mock,
      ownerId: 'owner-A',
      now: NOW,
      evaluate: async () => ({ approvedIntentId: String(intent._id), outcome: 'INTENT_CREATED' }),
      submissionEnabled: false,
    });
    assert.equal(result.submitted, 0);
    assert.equal(submitCalls(), 0);
  });

  await t.test('submissionEnabled=true: the approved intent is submitted exactly once', async () => {
    const intent = await approvedEntry(mods, String(session._id));
    mock.scriptOrder(intent.clientOrderId, { onSubmit: 'accept' });
    const result = await mods.runEvaluationTick({
      adapter: mock,
      ownerId: 'owner-A',
      now: NOW,
      evaluate: async () => ({ approvedIntentId: String(intent._id), outcome: 'INTENT_CREATED' }),
      submissionEnabled: true,
    });
    assert.equal(result.submitted, 1);
    assert.equal(result.sessions[0].submission.outcome, 'SUBMITTED');
    assert.equal(submitCalls(), 1);
    assert.equal(await mods.BrokerOrderModel.countDocuments({}), 1);
    // Still no positions/fills in Sprint 2.
    assert.equal(await mods.AutomationPositionModel.countDocuments({}), 0);
  });

  await t.test('entry timeout scan still runs when the tick is past the entry cutoff', async () => {
    const intent = await approvedEntry(mods, String(session._id));
    mock.scriptOrder(intent.clientOrderId, { onSubmit: 'accept' });
    await mods.submitApprovedIntent(String(intent._id), mock, { ownsLease: true, marketSession: OPEN_SESSION });
    const submitted = await mods.OrderIntentModel.findById(intent._id);
    submitted.submittedAt = new Date('2026-07-10T15:00:00.000Z');
    await submitted.save();

    const result = await mods.runEvaluationTick({
      adapter: mock,
      ownerId: 'owner-timeout',
      now: Date.parse('2026-07-10T19:50:00.000Z'),
      evaluate: async () => {
        throw new Error('entry evaluation should be skipped after cutoff');
      },
      submissionEnabled: true,
    });

    assert.equal(result.skippedReason, 'MARKET_FLATTEN');
    assert.equal(result.evaluated, 0);
    assert.equal(result.entryOrdersCancelled, 1);
    assert.equal(result.entryOrderTimeouts.cancelRequested, 1);
    assert.equal(cancelCalls(), 1);
    const saved = await mods.OrderIntentModel.findById(intent._id);
    assert.equal(saved.status, 'FAILED');
  });
});
