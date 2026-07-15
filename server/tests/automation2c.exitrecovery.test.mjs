// Phase 2C finalization — the EXITING state machine must never strand a
// position. Proves: fill → CLOSED; rejected/cancelled/expired → retry; retries
// exhausted → MANUAL_REVIEW; partial-then-terminal → MANUAL_REVIEW (no
// over-sell); still-working past timeout → MANUAL_REVIEW; broker unreachable
// within timeout → continue. Also proves position-scoped exit idempotency and
// the maxConcurrentPositions>1 startup guard.
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
const ENTRY_LINKS = (sessionId, optionSymbol = OPTION) => ({
  automationSessionId: sessionId,
  strategyVersionId: 'sv-test-1',
  universeEvaluationId: null,
  tradeCandidateId: null,
  contractSelectionId: null,
  riskDecisionId: null,
  underlying: 'SPY',
  optionSymbol,
  direction: 'BULLISH',
});

async function openPosition(mock, sessionId, { qty = 2, entryPrice = 1.0, optionSymbol = OPTION, openedAt } = {}) {
  const { intent } = await mods.createOrderIntent({
    automationSessionId: sessionId,
    strategyVersionId: 'sv-test-1',
    underlying: 'SPY',
    signalDirection: 'BUY',
    closedBarTimestamp: openedAt ?? new Date('2026-07-10T15:00:00.000Z'),
    intentType: 'ENTRY',
    optionSymbol,
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
  const exec = await mods.executeApprovedEntry(intent, mock, ENTRY_LINKS(sessionId, optionSymbol));
  await mods.runSchedulerTick(sessionId, mock, {
    markProvider: async () => ({ mark: entryPrice, stale: false }),
    now: Date.parse('2026-07-10T18:00:00.000Z'),
  });
  const pos = await mods.AutomationPositionModel.findById(exec.positionId);
  assert.equal(pos.status, 'OPEN', 'position reached OPEN');
  return pos;
}

const T0 = Date.parse('2026-07-10T18:30:00.000Z');
const EXIT_TIMEOUT_MS = mods.getExitPolicyConfig().exitTimeoutMs;

test('Phase 2C exit-recovery state machine', async (t) => {
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
    const init = await mods.initializeAutomation({ adapter: mock });
    assert.equal(init.ready, true);
    session = await createReadySession(mods, {
      underlying: 'SPY',
      reconciliationStatus: 'CLEAN',
      lastResetTradingDate: '2026-07-10',
      startingDayEquity: 100_000,
    });
  });

  await t.test('rejected exit is retried, then succeeds → CLOSED', async () => {
    const pos = await openPosition(mock, String(session._id));

    // First exit order is rejected by the broker.
    mock.setDefaultScript({ onSubmit: 'reject' });
    await mods.submitExit(pos, mock, 'HARD_STOP', new Date(T0));
    let fresh = await mods.AutomationPositionModel.findById(pos._id);
    assert.equal(fresh.status, 'EXITING');
    assert.equal(fresh.exitAttemptCount, 1);

    // Now the market accepts a fill; reconcile → retry places a new exit → CLOSED.
    mock.setDefaultScript({ onSubmit: 'fill' });
    mock.setMarketFillPrice(0.9);
    const r = await mods.reconcileExit(fresh, mock, new Date(T0 + 1000));
    assert.equal(r.retried || r.closed, true);
    fresh = await mods.AutomationPositionModel.findById(pos._id);
    assert.equal(fresh.status, 'CLOSED');
    assert.equal(fresh.exitAttemptCount, 2, 'second attempt succeeded');
    assert.equal(fresh.avgExitPrice, 0.9);
  });

  await t.test('exhausted retries escalate to MANUAL_REVIEW (never orphaned)', async () => {
    const pos = await openPosition(mock, String(session._id));
    mock.setDefaultScript({ onSubmit: 'reject' }); // every exit rejects

    await mods.submitExit(pos, mock, 'HARD_STOP', new Date(T0)); // attempt 1
    let fresh = await mods.AutomationPositionModel.findById(pos._id);

    // maxExitRetries default 3: reconcile drives attempts 2, 3, then escalates.
    await mods.reconcileExit(fresh, mock, new Date(T0 + 1000)); // → attempt 2
    fresh = await mods.AutomationPositionModel.findById(pos._id);
    assert.equal(fresh.exitAttemptCount, 2);
    await mods.reconcileExit(fresh, mock, new Date(T0 + 2000)); // → attempt 3
    fresh = await mods.AutomationPositionModel.findById(pos._id);
    assert.equal(fresh.exitAttemptCount, 3);
    const r = await mods.reconcileExit(fresh, mock, new Date(T0 + 3000)); // → escalate
    assert.equal(r.escalated, true);
    fresh = await mods.AutomationPositionModel.findById(pos._id);
    assert.equal(fresh.status, 'MANUAL_REVIEW');
    assert.match(fresh.manualReviewReason ?? '', /EXIT_RETRIES_EXHAUSTED/);
  });

  await t.test('partial fill then terminal → MANUAL_REVIEW (no auto over-sell)', async () => {
    const pos = await openPosition(mock, String(session._id));
    // Exit partially fills (1 of 2) on submit, then the order cancels.
    mock.setDefaultScript({ onSubmit: 'partial_fill', pollSequence: [{ rawStatus: 'canceled', filledQty: 1 }] });

    await mods.submitExit(pos, mock, 'HARD_STOP', new Date(T0));
    let fresh = await mods.AutomationPositionModel.findById(pos._id);
    assert.equal(fresh.status, 'EXITING');
    assert.equal(fresh.exitFilledQty, 1, 'partial exit fill tracked');

    const r = await mods.reconcileExit(fresh, mock, new Date(T0 + 1000));
    assert.equal(r.escalated, true);
    fresh = await mods.AutomationPositionModel.findById(pos._id);
    assert.equal(fresh.status, 'MANUAL_REVIEW');
    assert.match(fresh.manualReviewReason ?? '', /EXIT_PARTIAL_TERMINAL/);
  });

  await t.test('exit still working past timeout → MANUAL_REVIEW', async () => {
    const pos = await openPosition(mock, String(session._id));
    // Exit accepts but never fills (stuck working).
    mock.setDefaultScript({ onSubmit: 'accept' });
    await mods.submitExit(pos, mock, 'HARD_STOP', new Date(T0));

    let fresh = await mods.AutomationPositionModel.findById(pos._id);
    // Within the timeout: keep monitoring, do not escalate.
    let r = await mods.reconcileExit(fresh, mock, new Date(T0 + 1000));
    assert.equal(r.escalated, false);
    assert.equal(r.closed, false);
    fresh = await mods.AutomationPositionModel.findById(pos._id);
    assert.equal(fresh.status, 'EXITING');

    // Past the timeout: escalate.
    r = await mods.reconcileExit(fresh, mock, new Date(T0 + EXIT_TIMEOUT_MS + 1));
    assert.equal(r.escalated, true);
    fresh = await mods.AutomationPositionModel.findById(pos._id);
    assert.equal(fresh.status, 'MANUAL_REVIEW');
    assert.match(fresh.manualReviewReason ?? '', /EXIT_TIMEOUT_ESCALATED/);
  });

  await t.test('broker unreachable within timeout continues; past timeout escalates', async () => {
    // Craft an EXITING position pointing at an order the broker does not know.
    const pos = await mods.AutomationPositionModel.create({
      source: 'AUTOMATION',
      automationSessionId: String(session._id),
      strategyVersionId: 'sv-test-1',
      underlying: 'SPY',
      optionSymbol: OPTION,
      direction: 'BULLISH',
      entryIntentId: 'intent-x',
      entryClientOrderId: 'coid-unreachable-x',
      filledQty: 2,
      avgEntryPrice: 1.0,
      status: 'EXITING',
      exitReason: 'HARD_STOP',
      exitBrokerOrderId: 'does-not-exist',
      exitAttemptCount: 1,
      exitSubmittedAt: new Date(T0),
    });

    let r = await mods.reconcileExit(pos, mock, new Date(T0 + 1000));
    assert.equal(r.escalated, false, 'transient broker outage does not escalate immediately');
    let fresh = await mods.AutomationPositionModel.findById(pos._id);
    assert.equal(fresh.status, 'EXITING');

    r = await mods.reconcileExit(fresh, mock, new Date(T0 + EXIT_TIMEOUT_MS + 1));
    assert.equal(r.escalated, true);
    fresh = await mods.AutomationPositionModel.findById(pos._id);
    assert.equal(fresh.status, 'MANUAL_REVIEW');
  });

  await t.test('exit identity is position-scoped (no collision on same underlying/time)', async () => {
    // Two positions, identical underlying AND identical openedAt basis — the old
    // timestamp-only key would collide. Position-scoped keys must differ.
    const openedAt = new Date('2026-07-10T17:00:00.000Z');
    const a = await mods.AutomationPositionModel.create({
      source: 'AUTOMATION', automationSessionId: String(session._id), strategyVersionId: 'sv-test-1',
      underlying: 'SPY', optionSymbol: OPTION, direction: 'BULLISH',
      entryIntentId: 'ia', entryClientOrderId: 'coid-a', filledQty: 1, avgEntryPrice: 1.0,
      status: 'OPEN', openedAt,
    });
    const b = await mods.AutomationPositionModel.create({
      source: 'AUTOMATION', automationSessionId: String(session._id), strategyVersionId: 'sv-test-1',
      underlying: 'SPY', optionSymbol: OPTION, direction: 'BULLISH',
      entryIntentId: 'ib', entryClientOrderId: 'coid-b', filledQty: 1, avgEntryPrice: 1.0,
      status: 'OPEN', openedAt,
    });
    mock.setDefaultScript({ onSubmit: 'accept' });
    const ia = await mods.submitExit(a, mock, 'HARD_STOP', new Date(T0));
    const ib = await mods.submitExit(b, mock, 'HARD_STOP', new Date(T0));
    assert.ok(ia && ib);
    assert.notEqual(ia.clientOrderId, ib.clientOrderId, 'distinct client_order_id per position');
    assert.notEqual(ia.idempotencyKey, ib.idempotencyKey, 'distinct idempotency key per position');
  });

  await t.test('config guard: maxConcurrentPositions>1 fails closed at startup', () => {
    const prev = process.env.AUTOMATION_MAX_CONCURRENT_POSITIONS;
    try {
      process.env.AUTOMATION_MAX_CONCURRENT_POSITIONS = '2';
      const v = mods.validateAutomationConfig();
      assert.equal(v.ok, false);
      assert.ok(v.errors.some(e => /MAX_CONCURRENT_POSITIONS/.test(e)), 'descriptive config error');
      process.env.AUTOMATION_MAX_CONCURRENT_POSITIONS = '1';
      assert.equal(mods.validateAutomationConfig().ok, true);
    } finally {
      if (prev == null) delete process.env.AUTOMATION_MAX_CONCURRENT_POSITIONS;
      else process.env.AUTOMATION_MAX_CONCURRENT_POSITIONS = prev;
    }
  });
});
