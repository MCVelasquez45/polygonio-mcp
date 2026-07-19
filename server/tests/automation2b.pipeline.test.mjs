// Phase 2B — end-to-end pipeline integration.
// Requirements 14, 24, 25, 26, 27, 29 + the two required integration fixtures.
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
import {
  FIXTURE_ACCOUNT,
  FIXTURE_NOW,
  buildAllRejectChain,
  fixtureFor,
  noResetSessionFields,
} from './automation2b.fixtures.mjs';

const mods = await loadDist();

/** Wrap an adapter so ANY submitOrder call is recorded (and would fail the test). */
function guardSubmit(adapter) {
  const original = adapter.submitOrder.bind(adapter);
  let calls = 0;
  adapter.submitOrder = async (...args) => {
    calls += 1;
    return original(...args);
  };
  return () => calls;
}

test('decision pipeline integration', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  let mock;
  let session;
  let submitCallCount;
  t.beforeEach(async () => {
    await dropAutomationCollections();
    mods.clearMarketClockCache();
    mods.clearReconciliationStateForTests();
    mods.resetAutomationRuntimeForTests();
    mock = new mods.MockPaperBrokerAdapter();
    submitCallCount = guardSubmit(mock);
    const init = await mods.initializeAutomation({ adapter: mock });
    assert.equal(init.ready, true);
    session = await createReadySession(mods, noResetSessionFields());
  });

  await t.test(
    'INTEGRATION (approved): closed bar → bullish → calls ranked → contract → risk approved → ONE intent → ZERO submissions',
    async () => {
      const fixture = fixtureFor('bullish', 'call');
      const result = await mods.processClosedBar(String(session._id), mock, fixture);

      // signal
      assert.equal(result.candidate.signalDirection, 'BULLISH');
      assert.equal(result.candidate.status, 'RISK_APPROVED');
      // contracts ranked (calls) + persisted
      assert.equal(result.selection.optionSide, 'call');
      assert.ok(result.selection.candidates.length >= 9);
      assert.equal(result.selection.selected.symbol, 'SPY260724C00500000');
      // risk approved with sizing
      assert.equal(result.riskDecision.approved, true);
      assert.equal(result.riskDecision.sizing.outputs.quantity, 4);
      // one persistent approved intent
      assert.ok(result.orderIntent);
      assert.equal(result.orderIntent.status, 'APPROVED_AWAITING_EXECUTION');
      assert.equal(result.orderIntent.optionSymbol, 'SPY260724C00500000');
      assert.equal(result.orderIntent.quantity, 4);
      const intentCount = await mods.OrderIntentModel.countDocuments({});
      assert.equal(intentCount, 1);
      // 26. zero broker submissions from the signal path
      assert.equal(submitCallCount(), 0, 'signal path must NEVER call submitOrder');
      assert.equal(mock.submitCalls, 0);
    }
  );

  await t.test(
    'INTEGRATION (rejected): closed bar → signal → contract → daily loss breached → risk rejected → no broker intent submitted',
    async () => {
      session.dailyRealizedPnl = -800; // limit = 100k × 0.75% = 750
      await session.save();
      const fixture = fixtureFor('bullish', 'call');
      const result = await mods.processClosedBar(String(session._id), mock, fixture);

      assert.equal(result.candidate.status, 'RISK_REJECTED');
      assert.ok(result.candidate.reasonCodes.includes('RISK_MAX_DAILY_LOSS'));
      assert.ok(result.selection.selected, 'contract WAS selected before risk rejected');
      assert.equal(result.riskDecision.approved, false);
      assert.equal(result.orderIntent, null, 'no intent on rejection');
      assert.equal(await mods.OrderIntentModel.countDocuments({}), 0);
      assert.equal(submitCallCount(), 0);
      // The failed check is persisted with observed vs limit.
      const check = result.riskDecision.checks.find(c => c.name === 'dailyLossWithinLimit');
      assert.equal(check.passed, false);
      assert.equal(check.observed, -800);
    }
  );

  await t.test('14. full ranking persisted even when NO contract passes', async () => {
    const fixture = fixtureFor('bullish', 'call', { chain: buildAllRejectChain('call') });
    const result = await mods.processClosedBar(String(session._id), mock, fixture);
    assert.equal(result.candidate.status, 'RISK_REJECTED');
    assert.ok(result.candidate.reasonCodes.includes('RISK_NO_VALID_CONTRACT'));
    const stored = await mods.ContractSelectionModel.findOne({ tradeCandidateId: String(result.candidate._id) }).lean();
    assert.ok(stored, 'selection document persisted');
    assert.equal(stored.selected, null);
    assert.equal(stored.noSelectionReason, 'NO_CONTRACT_PASSED_FILTERS');
    assert.equal(stored.candidates.length, 2, 'every considered contract recorded');
    assert.ok(stored.candidates.every(c => c.rejectionReasons.length > 0));
  });

  await t.test('24+25. duplicate bar delivery: one candidate, one idempotent intent', async () => {
    const fixture = fixtureFor('bullish', 'call');
    const first = await mods.processClosedBar(String(session._id), mock, fixture);
    assert.equal(first.candidate.status, 'RISK_APPROVED');
    const intentId = String(first.orderIntent._id);

    const second = await mods.processClosedBar(String(session._id), mock, fixture);
    assert.equal(second.duplicate, true);
    assert.equal(String(second.candidate._id), String(first.candidate._id));

    assert.equal(await mods.TradeCandidateModel.countDocuments({}), 1);
    assert.equal(await mods.OrderIntentModel.countDocuments({}), 1);
    const intent = await mods.OrderIntentModel.findById(intentId);
    assert.equal(intent.status, 'APPROVED_AWAITING_EXECUTION', 'existing intent untouched');
    assert.equal(submitCallCount(), 0);
  });

  await t.test('26. the Phase 2B pipeline itself never submits (execution is a separate 2C step)', async () => {
    // Phase 2B invariant preserved: producing an approved intent reaches NO
    // broker. (Phase 2C wires submission as a distinct, explicitly-invoked
    // step — proven in automation2c.lifecycle.test.mjs — so the intent is now
    // submittable, but the decision pipeline still never calls the broker.)
    const fixture = fixtureFor('bullish', 'call');
    const result = await mods.processClosedBar(String(session._id), mock, fixture);
    assert.equal(result.orderIntent.status, 'APPROVED_AWAITING_EXECUTION');
    assert.equal(submitCallCount(), 0, 'the decision pipeline must never reach submitOrder');
  });

  await t.test('29. all decision records carry timestamps and reason codes', async () => {
    session.dailyRealizedPnl = -800;
    await session.save();
    const fixture = fixtureFor('bullish', 'call');
    const result = await mods.processClosedBar(String(session._id), mock, fixture);

    const candidate = await mods.TradeCandidateModel.findById(result.candidate._id).lean();
    assert.ok(candidate.createdAt instanceof Date);
    assert.ok(Array.isArray(candidate.reasonCodes) && candidate.reasonCodes.length > 0);
    assert.ok(candidate.marketClockDecision.decidedAt);

    const decision = await mods.RiskDecisionModel.findOne({ tradeCandidateId: String(candidate._id) }).lean();
    assert.ok(decision.decidedAt instanceof Date);
    assert.ok(decision.reasonCodes.length > 0);
    assert.ok(decision.checks.every(check => typeof check.name === 'string' && typeof check.passed === 'boolean'));

    const events = await mongoose.connection.db
      .collection('automation_events')
      .find({ automationSessionId: String(session._id) })
      .toArray();
    assert.ok(events.length > 0);
    assert.ok(events.every(event => event.timestamp instanceof Date));
  });
});

test('27. daily counters reset on the next EXCHANGE trading day, not local midnight', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());
  await dropAutomationCollections();

  const config = mods.getStrategyConfig();
  const session = await createReadySession(mods, {
    reconciliationStatus: 'CLEAN',
    lastResetTradingDate: '2026-07-09',
    dailyTradeCount: 2,
    dailyRealizedPnl: -500,
    consecutiveLossCount: 2,
  });
  const account = { accountIdMasked: '****T', equity: 100_000, buyingPower: 50_000, cash: null, currency: 'USD', isPaper: true };

  // 11:00 ET on 2026-07-10 → new exchange day → reset.
  const morning = { asOf: new Date('2026-07-10T15:00:00.000Z'), isOpen: true, nextOpen: null, nextClose: null, source: 'mock' };
  const first = await mods.ensureDailyReset(session, morning, account, config);
  assert.equal(first.didReset, true);
  assert.equal(first.tradingDate, '2026-07-10');
  assert.equal(session.dailyTradeCount, 0);
  assert.equal(session.dailyRealizedPnl, 0);
  assert.equal(session.consecutiveLossCount, 0);
  assert.equal(session.startingDayEquity, 100_000);
  assert.equal(session.dailyLossBudget, 750);

  // 22:00 ET the SAME exchange day = 02:00 UTC next calendar day.
  // A local/UTC-midnight implementation would reset here; ours must not.
  session.dailyTradeCount = 1;
  const lateNight = { asOf: new Date('2026-07-11T02:00:00.000Z'), isOpen: false, nextOpen: null, nextClose: null, source: 'mock' };
  const second = await mods.ensureDailyReset(session, lateNight, account, config);
  assert.equal(second.didReset, false, 'UTC date changed but exchange date did not');
  assert.equal(second.tradingDate, '2026-07-10');
  assert.equal(session.dailyTradeCount, 1, 'counters untouched');

  // Next exchange morning → reset again.
  const nextDay = { asOf: new Date('2026-07-11T14:00:00.000Z'), isOpen: false, nextOpen: null, nextClose: null, source: 'mock' };
  const third = await mods.ensureDailyReset(session, nextDay, account, config);
  assert.equal(third.didReset, true);
  assert.equal(third.tradingDate, '2026-07-11');
  assert.equal(session.dailyTradeCount, 0);

  assert.equal(mods.exchangeTradingDate(new Date('2026-07-11T02:00:00.000Z')), '2026-07-10');
});

test('FIXTURE_NOW aligns with the mock broker clock trading day', () => {
  assert.equal(mods.exchangeTradingDate(new Date(FIXTURE_NOW)), '2026-07-10');
  assert.equal(FIXTURE_ACCOUNT.equity, 100_000);
});
