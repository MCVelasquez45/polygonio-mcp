// Phase 2A reconciliation/recovery tests. (Required tests 10, 11, 12, 13, 14.)
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  loadDist,
  startTestMongo,
  stopTestMongo,
  dropAutomationCollections,
  createReadySession,
  baseIntentInput,
} from './automation.helpers.mjs';

const mods = await loadDist();

test('startup reconciliation', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());
  t.beforeEach(async () => {
    await dropAutomationCollections();
    mods.clearMarketClockCache();
    mods.clearReconciliationStateForTests();
    mods.resetAutomationRuntimeForTests();
  });

  await t.test('10. orphaned broker position pauses the session', async () => {
    const session = await createReadySession(mods, { underlying: 'SPY' });
    const mock = new mods.MockPaperBrokerAdapter();
    // Position on the session's underlying with NO local intent anywhere.
    mock.seedPosition({ symbol: 'SPY260821C00450000', qty: 3 });

    const report = await mods.runStartupReconciliation(mock);
    assert.equal(report.status, 'MISMATCH');
    assert.ok(report.mismatches.some(m => m.kind === 'ORPHANED_BROKER_POSITION'));
    assert.ok(report.pausedSessionIds.includes(String(session._id)));

    const stored = await mongoose.connection.db
      .collection('automation_sessions')
      .findOne({ _id: session._id });
    assert.equal(stored.status, 'PAUSED');
    assert.equal(stored.reconciliationStatus, 'MANUAL_REVIEW');
    assert.match(stored.pauseReason, /orphaned broker position/i);
  });

  await t.test('unrelated broker positions do not pause sessions (manual trading is expected)', async () => {
    const session = await createReadySession(mods, { underlying: 'SPY' });
    const mock = new mods.MockPaperBrokerAdapter();
    mock.seedPosition({ symbol: 'TSLA260821P00200000', qty: 1 });

    const report = await mods.runStartupReconciliation(mock);
    assert.equal(report.status, 'CLEAN');
    const stored = await mongoose.connection.db
      .collection('automation_sessions')
      .findOne({ _id: session._id });
    assert.equal(stored.status, 'READY');
    assert.equal(stored.reconciliationStatus, 'CLEAN');
  });

  await t.test('11. local order missing at broker moves to MANUAL_REVIEW and pauses', async () => {
    const session = await createReadySession(mods);
    const mock = new mods.MockPaperBrokerAdapter();
    const { intent } = await mods.createOrderIntent(baseIntentInput(session._id));
    // Simulate a crash right after we durably marked SUBMITTING but the broker
    // never received the order.
    await mongoose.connection.db
      .collection('automation_order_intents')
      .updateOne({ _id: intent._id }, { $set: { status: 'SUBMITTING', attemptCount: 1 } });

    const report = await mods.runStartupReconciliation(mock);
    assert.ok(report.mismatches.some(m => m.kind === 'LOCAL_ORDER_MISSING_AT_BROKER'));

    const storedIntent = await mongoose.connection.db
      .collection('automation_order_intents')
      .findOne({ _id: intent._id });
    assert.equal(storedIntent.status, 'MANUAL_REVIEW');

    const storedSession = await mongoose.connection.db
      .collection('automation_sessions')
      .findOne({ _id: session._id });
    assert.equal(storedSession.status, 'PAUSED');
  });

  await t.test('12. broker order missing locally is imported and flagged safely', async () => {
    await createReadySession(mods);
    const mock = new mods.MockPaperBrokerAdapter();
    const foreign = mock.seedUnknownOrder({
      symbol: 'SPY260821C00455000',
      clientOrderId: 'at2a-ffffffffffffffffffffffffffffffff',
      rawStatus: 'new',
      status: 'PENDING_NEW',
    });

    const report = await mods.runStartupReconciliation(mock);
    const mismatch = report.mismatches.find(m => m.kind === 'BROKER_ORDER_MISSING_LOCALLY');
    assert.ok(mismatch);
    assert.equal(mismatch.resolution, 'IMPORTED');

    const imported = await mongoose.connection.db
      .collection('automation_broker_orders')
      .findOne({ brokerOrderId: foreign.brokerOrderId });
    assert.ok(imported, 'broker order must be journaled');
    assert.equal(imported.lastSource, 'reconciliation');
    assert.equal(imported.automationSessionId, null, 'imported order is not adopted by any session');
    // Reconciliation must not have touched the order at the broker.
    const atBroker = await mock.getOrder(foreign.brokerOrderId);
    assert.equal(atBroker.status, 'PENDING_NEW');
  });

  await t.test('13. restart reconciliation does not submit duplicate orders', async () => {
    const session = await createReadySession(mods);
    const mock = new mods.MockPaperBrokerAdapter();
    const { intent } = await mods.createOrderIntent(baseIntentInput(session._id));
    const submit = await mods.submitIntent(String(intent._id), mock);
    assert.equal(submit.outcome, 'SUBMITTED');
    assert.equal(mock.submitCalls, 1);

    // Simulated process restart: runtime state gone, Mongo + broker persist.
    mods.resetAutomationRuntimeForTests();
    mods.clearReconciliationStateForTests();
    const init = await mods.initializeAutomation({ adapter: mock });
    assert.equal(init.ready, true);
    assert.equal(mock.submitCalls, 1, 'recovery must never resubmit');

    const storedIntent = await mongoose.connection.db
      .collection('automation_order_intents')
      .findOne({ _id: intent._id });
    assert.equal(storedIntent.status, 'SUBMITTED');
    assert.equal(storedIntent.brokerOrderId, submit.brokerOrder.brokerOrderId);

    // And an ambiguous SUBMITTING intent that DOES exist at the broker is
    // re-attached, not resubmitted.
    await mongoose.connection.db
      .collection('automation_order_intents')
      .updateOne({ _id: intent._id }, { $set: { status: 'SUBMITTING' } });
    mods.clearReconciliationStateForTests();
    await mods.runStartupReconciliation(mock);
    const reattached = await mongoose.connection.db
      .collection('automation_order_intents')
      .findOne({ _id: intent._id });
    assert.equal(reattached.status, 'SUBMITTED');
    assert.equal(mock.submitCalls, 1);
  });

  await t.test('14. reconciliation must finish before readiness becomes true', async () => {
    await createReadySession(mods);
    const mock = new mods.MockPaperBrokerAdapter();

    assert.equal(mods.isAutomationReady(), false, 'not ready before init');
    assert.equal(mods.getLastReconciliation(), null);

    const init = await mods.initializeAutomation({ adapter: mock });
    assert.equal(init.ready, true);
    assert.equal(mods.isAutomationReady(), true);
    const report = mods.getLastReconciliation();
    assert.ok(report, 'readiness implies a completed reconciliation report');
    assert.notEqual(report.status, 'FAILED');

    const health = await mods.getAutomationHealth(mock);
    assert.equal(health.automationReady, true);
    assert.equal(health.gates.mongodb.status, 'pass');
    assert.equal(health.gates.brokerApi.status, 'pass');
    assert.equal(health.gates.brokerMode.status, 'pass');
    assert.notEqual(health.gates.reconciliation.status, 'fail');
  });

  await t.test('readiness stays false when reconciliation fails', async () => {
    await createReadySession(mods);
    const mock = new mods.MockPaperBrokerAdapter();
    mock.failAccount(); // account probe irrelevant; break listPositions instead
    const brokenAdapter = {
      ...Object.fromEntries(
        ['describe', 'getAccount', 'getClock', 'listOpenOrders', 'getOrder', 'getOrderByClientOrderId', 'submitOrder', 'cancelOrder', 'getPosition', 'closePosition'].map(
          name => [name, mock[name].bind(mock)]
        )
      ),
      listPositions: async () => {
        throw new Error('positions endpoint down');
      },
    };

    const init = await mods.initializeAutomation({ adapter: brokenAdapter });
    assert.equal(init.ready, false);
    assert.equal(mods.isAutomationReady(), false);
    assert.equal(mods.getLastReconciliation().status, 'FAILED');
  });
});
