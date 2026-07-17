// Ownership isolation — the load-bearing boundary between the two independent
// trading systems. Manual/external broker positions (user-owned, may originate
// outside this app, may sit overnight) must be COMPLETELY invisible to the
// autonomous engine except as read-only Portfolio data. Automation may act only
// on positions it can PROVE it created through the durable chain:
//   AutomationSession → OrderIntent → deterministic client_order_id
//   → Broker Order → AutomationPosition → Broker Position
// Ownership is NEVER inferred from symbol/underlying/strike/expiration/side/qty.
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

const ENTRY_LINKS = (sessionId, overrides = {}) => ({
  automationSessionId: sessionId,
  strategyVersionId: 'sv-test-1',
  universeEvaluationId: null,
  tradeCandidateId: null,
  contractSelectionId: null,
  riskDecisionId: null,
  underlying: 'SPY',
  optionSymbol: 'SPY260724C00500000',
  direction: 'BULLISH',
  ...overrides,
});

async function makeApprovedEntryIntent(sessionId, overrides = {}) {
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

test('automation ownership isolation', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  let mock;
  t.beforeEach(async () => {
    await dropAutomationCollections();
    mods.clearMarketClockCache();
    mods.clearReconciliationStateForTests();
    mods.resetAutomationRuntimeForTests();
    mock = new mods.MockPaperBrokerAdapter();
    mock.setClock('open');
  });

  // ---- the ownership guard itself -----------------------------------------

  await t.test('isAutomationOwned: manual/external evidence is never owned', () => {
    assert.equal(mods.isAutomationOwned(null), false);
    assert.equal(mods.isAutomationOwned(undefined), false);
    // A broker position shape has no automation evidence at all.
    assert.equal(mods.isAutomationOwned({ symbol: 'SPY260821C00450000', qty: 3 }), false);
    // Automation source but a NON-automation client_order_id (e.g. manual UI order).
    assert.equal(
      mods.isAutomationOwned({ source: 'AUTOMATION', entryIntentId: 'i', entryClientOrderId: 'manual-123' }),
      false
    );
    // Missing intent link.
    assert.equal(
      mods.isAutomationOwned({ source: 'AUTOMATION', entryIntentId: '', entryClientOrderId: 'at2a-abc' }),
      false
    );
  });

  await t.test('isAutomationOwned: full proven chain is owned; assert throws otherwise', () => {
    const owned = { source: 'AUTOMATION', entryIntentId: 'intent-1', entryClientOrderId: 'at2a-deadbeef' };
    assert.equal(mods.isAutomationOwned(owned), true);
    assert.doesNotThrow(() => mods.assertAutomationOwnership(owned, 'test'));
    assert.throws(
      () => mods.assertAutomationOwnership({ source: 'MANUAL', entryClientOrderId: null }, 'test'),
      /not provably automation-owned/
    );
  });

  // ---- reconciliation ignores manual/external positions -------------------

  for (const [label, position] of [
    ['manual OPTION position on the session underlying', { symbol: 'SPY260821C00450000', qty: 3, assetClass: 'us_option' }],
    ['manual EQUITY position', { symbol: 'SPY', qty: 100, assetClass: 'us_equity' }],
    ['external OPTION with the exact OCC symbol automation trades', { symbol: 'SPY260724C00500000', qty: 5, assetClass: 'us_option' }],
  ]) {
    await t.test(`reconciliation ignores ${label} (no adoption, no pause)`, async () => {
      const session = await createReadySession(mods, { underlying: 'SPY' });
      mock.seedPosition(position);

      const report = await mods.runStartupReconciliation(mock);
      assert.equal(report.status, 'CLEAN');
      assert.equal(report.mismatches.length, 0);
      assert.deepEqual(report.pausedSessionIds, []);
      assert.equal(report.automationPositionsReconciled, 0);

      const adopted = await mods.AutomationPositionModel.countDocuments({});
      assert.equal(adopted, 0, 'no AutomationPosition may be created from broker truth');

      const stored = await mongoose.connection.db
        .collection('automation_sessions')
        .findOne({ _id: session._id });
      assert.equal(stored.status, 'READY');
      assert.equal(stored.reconciliationStatus, 'CLEAN');
    });
  }

  // ---- manual position never enters overnight recovery --------------------

  await t.test('overnight recovery never applies to a manual/external position', async () => {
    const session = await createReadySession(mods, { underlying: 'SPY' });
    mock.seedPosition({ symbol: 'SPY260821C00450000', qty: 3, assetClass: 'us_option' });

    // No AutomationPosition exists, so nothing can be flagged for recovery.
    const count = await mods.countOvernightRecoveryPositions(String(session._id));
    assert.equal(count, 0);

    // And the pure assessment refuses a non-AUTOMATION source outright.
    const assessment = mods.assessOvernightCarry({
      status: 'OPEN',
      filledQty: 3,
      source: 'MANUAL',
      marketOpen: false,
      nextOpen: null,
      sessionOpenSkewMs: 0,
    });
    assert.equal(assessment.required, false);
  });

  // ---- scheduler ignores manual positions but still evaluates -------------

  await t.test('scheduler does not monitor a manual position and still evaluates the watchlist', async () => {
    const init = await mods.initializeAutomation({ adapter: mock });
    assert.equal(init.ready, true);
    const session = await createReadySession(mods, {
      underlying: 'SPY',
      reconciliationStatus: 'CLEAN',
      lastResetTradingDate: '2026-07-10',
      startingDayEquity: 100_000,
    });
    // A manual option position sitting at the broker on the session underlying.
    mock.seedPosition({ symbol: 'SPY260821C00450000', qty: 3, assetClass: 'us_option' });

    let evaluatorCalls = 0;
    const markedSymbols = [];
    const tick = await mods.runSchedulerTick(String(session._id), mock, {
      markProvider: async (symbol) => {
        markedSymbols.push(symbol);
        return { mark: 1.0, stale: false };
      },
      entryEvaluator: async () => {
        evaluatorCalls += 1;
        return { submitted: 0 };
      },
      now: Date.parse('2026-07-10T15:30:00.000Z'), // PRE_CUTOFF: entries allowed
    });

    assert.equal(tick.skipped, null, 'tick must run, not be skipped');
    assert.equal(tick.positionsMonitored, 0, 'manual position is never monitored');
    assert.deepEqual(markedSymbols, [], 'manual position never requests a mark');
    assert.equal(evaluatorCalls, 1, 'watchlist evaluation still runs with a manual position present');
    const adopted = await mods.AutomationPositionModel.countDocuments({});
    assert.equal(adopted, 0);
  });

  // ---- proven automation positions ARE reconciled/recovered ---------------

  await t.test('proven automation position is reconciled against its broker order', async () => {
    const init = await mods.initializeAutomation({ adapter: mock });
    assert.equal(init.ready, true);
    const session = await createReadySession(mods, { underlying: 'SPY', reconciliationStatus: 'CLEAN' });

    const intent = await makeApprovedEntryIntent(String(session._id));
    mock.scriptOrder(intent.clientOrderId, { onSubmit: 'accept' });
    const exec = await mods.executeApprovedEntry(intent, mock, ENTRY_LINKS(String(session._id)));
    assert.equal(exec.result.outcome, 'SUBMITTED');

    mods.clearReconciliationStateForTests();
    const report = await mods.runStartupReconciliation(mock);
    assert.equal(report.status, 'CLEAN');
    assert.ok(report.automationPositionsReconciled >= 1, 'the owned position is reconciled');

    const pos = await mods.AutomationPositionModel.findById(exec.positionId);
    assert.ok(pos.lastBrokerReconciledAt, 'broker-truth timestamp advanced on the owned position');
    assert.equal(pos.status, 'PENDING_ENTRY');
  });

  await t.test('owned position whose entry order vanished at broker → MANUAL_REVIEW + session paused', async () => {
    const session = await createReadySession(mods, { underlying: 'SPY' });
    // A proven automation position (prefixed client_order_id, linked intent) whose
    // broker order cannot be found — a genuine AUTOMATION ambiguity, not a manual one.
    const pos = await mods.AutomationPositionModel.create({
      source: 'AUTOMATION',
      automationSessionId: String(session._id),
      strategyVersionId: 'sv-test-1',
      underlying: 'SPY',
      optionSymbol: 'SPY260724C00500000',
      direction: 'BULLISH',
      entryIntentId: 'intent-abc',
      entryClientOrderId: 'at2a-vanished0000000000000000000000',
      entryBrokerOrderId: 'mock-order-does-not-exist',
      status: 'OPEN',
      filledQty: 2,
    });

    const report = await mods.runStartupReconciliation(mock);
    assert.equal(report.status, 'MISMATCH');
    assert.ok(report.mismatches.some(m => m.kind === 'AUTOMATION_POSITION_ORDER_MISSING'));
    assert.ok(report.pausedSessionIds.includes(String(session._id)));

    const reloaded = await mods.AutomationPositionModel.findById(pos._id);
    assert.equal(reloaded.status, 'MANUAL_REVIEW');
    assert.match(reloaded.manualReviewReason, /missing at broker/i);

    const storedSession = await mongoose.connection.db
      .collection('automation_sessions')
      .findOne({ _id: session._id });
    assert.equal(storedSession.status, 'PAUSED');
  });
});
