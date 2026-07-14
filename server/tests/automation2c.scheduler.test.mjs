// Phase 2C Sprint 1 — the production evaluation scheduler.
// Proves: single-owner lease, once-per-window evaluation, reconciliation gate,
// authoritative market-hours + entry-cutoff gating, restart dedupe, and — the
// hard boundary of this sprint — NO broker submission. Output stops at the
// Approved Evaluation Request.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadDist,
  startTestMongo,
  stopTestMongo,
  dropAutomationCollections,
  createReadySession,
} from './automation.helpers.mjs';
import { FIXTURE_NOW, noResetSessionFields, universeFixtureFor } from './automation2b.fixtures.mjs';

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

// now = FIXTURE_NOW (15:00Z). Mock clock: open, next_close 20:00Z → ~300 min to
// close → PRE_CUTOFF (entries allowed).
const NOW = FIXTURE_NOW;

test('evaluation scheduler tick', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  let mock;
  let submitCalls;
  let session;
  let evalCalls;
  const countingEvaluator = async (sessionId) => {
    evalCalls.push(sessionId);
    return { approvedIntentId: 'intent-x', outcome: 'INTENT_CREATED' };
  };

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
    evalCalls = [];
  });

  await t.test('evaluates each READY session once and produces an approved request — never submits', async () => {
    const result = await mods.runEvaluationTick({ adapter: mock, ownerId: 'owner-A', now: NOW, evaluate: countingEvaluator });
    assert.equal(result.ownsLease, true);
    assert.equal(result.marketSession.phase, 'PRE_CUTOFF');
    assert.equal(result.evaluated, 1);
    assert.equal(evalCalls.length, 1);
    assert.equal(result.sessions[0].approvedIntentId, 'intent-x');
    assert.equal(submitCalls(), 0, 'Sprint 1 must never reach the broker');
  });

  await t.test('once-per-window: a second tick in the same window does not re-evaluate', async () => {
    await mods.runEvaluationTick({ adapter: mock, ownerId: 'owner-A', now: NOW, evaluate: countingEvaluator });
    const second = await mods.runEvaluationTick({ adapter: mock, ownerId: 'owner-A', now: NOW, evaluate: countingEvaluator });
    assert.equal(evalCalls.length, 1, 'the window is evaluated exactly once');
    assert.equal(second.sessions[0].skippedReason, 'WINDOW_ALREADY_EVALUATED');
  });

  await t.test('a new window evaluates again', async () => {
    await mods.runEvaluationTick({ adapter: mock, ownerId: 'owner-A', now: NOW, evaluate: countingEvaluator });
    // Advance beyond one window (default 5 min).
    const later = NOW + 6 * 60_000;
    await mods.runEvaluationTick({ adapter: mock, ownerId: 'owner-A', now: later, evaluate: countingEvaluator });
    assert.equal(evalCalls.length, 2);
  });

  await t.test('restart dedupe: a persisted window key blocks re-evaluation of that window', async () => {
    const tradingDate = mods.exchangeTradingDate(new Date(NOW));
    const key = mods.windowKeyFor(NOW, 5 * 60_000, tradingDate);
    session.lastEvaluatedWindowKey = key;
    await session.save();
    const result = await mods.runEvaluationTick({ adapter: mock, ownerId: 'owner-A', now: NOW, evaluate: countingEvaluator });
    assert.equal(evalCalls.length, 0);
    assert.equal(result.sessions[0].skippedReason, 'WINDOW_ALREADY_EVALUATED');
  });

  await t.test('market closed → no evaluation', async () => {
    mock.setClock('closed');
    const result = await mods.runEvaluationTick({ adapter: mock, ownerId: 'owner-A', now: NOW, evaluate: countingEvaluator });
    assert.equal(result.skippedReason, 'MARKET_CLOSED');
    assert.equal(evalCalls.length, 0);
  });

  await t.test('after the final-entry cutoff → no new evaluation', async () => {
    // 19:30Z is 30 min before the 20:00Z close → inside the 45-min cutoff.
    const afterCutoff = Date.parse('2026-07-10T19:30:00.000Z');
    const result = await mods.runEvaluationTick({ adapter: mock, ownerId: 'owner-A', now: afterCutoff, evaluate: countingEvaluator });
    assert.equal(result.marketSession.phase, 'POST_ENTRY_CUTOFF');
    assert.equal(result.skippedReason, 'MARKET_POST_ENTRY_CUTOFF');
    assert.equal(evalCalls.length, 0);
  });

  await t.test('reconciliation gate: never evaluates before automation is READY', async () => {
    mods.resetAutomationRuntimeForTests(); // automation no longer READY
    const result = await mods.runEvaluationTick({ adapter: mock, ownerId: 'owner-A', now: NOW, evaluate: countingEvaluator });
    assert.equal(result.skippedReason, 'AUTOMATION_NOT_READY');
    assert.equal(result.ownsLease, false);
    assert.equal(evalCalls.length, 0);
  });

  await t.test('a session whose reconciliation is not CLEAN is skipped', async () => {
    session.reconciliationStatus = 'PENDING';
    await session.save();
    const result = await mods.runEvaluationTick({ adapter: mock, ownerId: 'owner-A', now: NOW, evaluate: countingEvaluator });
    assert.equal(result.sessions[0].skippedReason, 'RECONCILIATION_NOT_CLEAN');
    assert.equal(evalCalls.length, 0);
  });

  await t.test('an emergency-stopped session is skipped', async () => {
    session.emergencyStop = { active: true, reason: 'test', at: new Date() };
    await session.save();
    const result = await mods.runEvaluationTick({ adapter: mock, ownerId: 'owner-A', now: NOW, evaluate: countingEvaluator });
    assert.equal(result.sessions[0].skippedReason, 'EMERGENCY_STOP_ACTIVE');
  });

  await t.test('single-owner lease: a different owner cannot tick while the lease is held', async () => {
    const a = await mods.runEvaluationTick({ adapter: mock, ownerId: 'owner-A', now: NOW, evaluate: countingEvaluator });
    assert.equal(a.ownsLease, true);
    const b = await mods.runEvaluationTick({ adapter: mock, ownerId: 'owner-B', now: NOW, evaluate: countingEvaluator });
    assert.equal(b.ownsLease, false);
    assert.equal(b.skippedReason, 'LEASE_NOT_OWNED');
  });

  await t.test('INTEGRATION: real universe evaluation via scheduler → Approved Evaluation Request, zero submissions', async () => {
    const fixture = universeFixtureFor({ QQQ: 'bullish' }, { now: NOW });
    const evaluate = async (sessionId, adapter) => {
      const { evaluation, orderIntent } = await mods.processUniverseTick(sessionId, adapter, fixture);
      return { approvedIntentId: orderIntent ? String(orderIntent._id) : null, outcome: evaluation.outcome };
    };
    const result = await mods.runEvaluationTick({ adapter: mock, ownerId: 'owner-A', now: NOW, evaluate });
    assert.equal(result.evaluated, 1);
    assert.ok(result.sessions[0].approvedIntentId, 'an approved intent was produced');
    // The produced intent is APPROVED_AWAITING_EXECUTION and NOT submitted.
    const intent = await mods.OrderIntentModel.findById(result.sessions[0].approvedIntentId);
    assert.equal(intent.status, 'APPROVED_AWAITING_EXECUTION');
    assert.equal(submitCalls(), 0, 'the scheduler must never submit in Sprint 1');
  });
});

test('scheduler controller lifecycle', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  t.beforeEach(async () => {
    await dropAutomationCollections();
    mods.clearMarketClockCache();
    mods.clearReconciliationStateForTests();
    mods.resetAutomationRuntimeForTests();
    mods.resetSchedulerControllerForTests?.();
  });

  await t.test('start refuses until automation is READY (reconciliation before activation)', async () => {
    // Not initialized → not ready → start refused.
    const started = mods.startAutomationScheduler(new mods.MockPaperBrokerAdapter());
    assert.equal(started, false);
    assert.equal(mods.getSchedulerStatus().state, 'STOPPED');
  });

  await t.test('start after READY sets ACTIVE with a single owner; stop releases the lease', async () => {
    const mock = new mods.MockPaperBrokerAdapter();
    mock.setClock('open');
    await mods.initializeAutomation({ adapter: mock });
    const started = mods.startAutomationScheduler(mock);
    assert.equal(started, true);
    const status = mods.getSchedulerStatus();
    assert.equal(status.state, 'ACTIVE');
    assert.ok(status.ownerId);
    // A second start in-process must not create a duplicate owner.
    assert.equal(mods.startAutomationScheduler(mock), false);
    await mods.stopAutomationScheduler('test');
    assert.equal(mods.getSchedulerStatus().state, 'STOPPED');
  });
});
