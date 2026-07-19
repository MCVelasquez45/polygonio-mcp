// Phase 2.6 — configurable options trading universe.
// Proves: the engine is symbol-agnostic (candidates come from configuration,
// not source), one unavailable symbol never blocks the run, validation gates
// skip-and-record, ranking is deterministic, and the same strategy logic
// serves every configured symbol. Every ticker below is TEST DATA.
import test from 'node:test';
import assert from 'node:assert/strict';
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
  noResetSessionFields,
  universeFixtureFor,
} from './automation2b.fixtures.mjs';

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

// ---------------------------------------------------------------------------
// Pure configuration parsing (no Mongo needed)
// ---------------------------------------------------------------------------

test('universe configuration parsing', async (t) => {
  await t.test('parses, trims, uppercases, dedupes, and splits invalid entries', () => {
    const parsed = mods.parseUniverseSymbols(' qqq, uso ,QQQ, xle,, 123bad, toolongsymbolx ');
    assert.deepEqual(parsed.symbols, ['QQQ', 'USO', 'XLE']);
    assert.deepEqual(parsed.invalidSymbols, ['123BAD', 'TOOLONGSYMBOLX']);
  });

  await t.test('no configuration → EMPTY universe (no hardcoded default symbols)', () => {
    const priorMulti = process.env.AUTOMATION_UNDERLYINGS;
    const priorSingle = process.env.AUTOMATION_UNDERLYING;
    delete process.env.AUTOMATION_UNDERLYINGS;
    delete process.env.AUTOMATION_UNDERLYING;
    try {
      const universe = mods.getUniverseConfig();
      assert.deepEqual(universe.symbols, []);
      assert.equal(universe.source, 'unconfigured');
    } finally {
      if (priorMulti != null) process.env.AUTOMATION_UNDERLYINGS = priorMulti;
      if (priorSingle != null) process.env.AUTOMATION_UNDERLYING = priorSingle;
    }
  });

  await t.test('AUTOMATION_UNDERLYINGS is authoritative; legacy single-symbol is the fallback', () => {
    process.env.AUTOMATION_UNDERLYINGS = 'uso,xom';
    process.env.AUTOMATION_UNDERLYING = 'qqq';
    try {
      assert.deepEqual(mods.getUniverseConfig().symbols, ['USO', 'XOM']);
      delete process.env.AUTOMATION_UNDERLYINGS;
      const legacy = mods.getUniverseConfig();
      assert.deepEqual(legacy.symbols, ['QQQ']);
      assert.equal(legacy.source, 'AUTOMATION_UNDERLYING');
    } finally {
      delete process.env.AUTOMATION_UNDERLYINGS;
      delete process.env.AUTOMATION_UNDERLYING;
    }
  });

  await t.test('strategy config contains no hardcoded underlying', () => {
    delete process.env.AUTOMATION_UNDERLYINGS;
    delete process.env.AUTOMATION_UNDERLYING;
    assert.equal(mods.getStrategyConfig().underlying, '');
    assert.equal(mods.getStrategyConfig('uso').underlying, 'USO');
  });
});

// ---------------------------------------------------------------------------
// Universe tick pipeline (in-memory Mongo + mock broker)
// ---------------------------------------------------------------------------

test('universe tick pipeline', async (t) => {
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
    session = await createReadySession(mods, { underlying: null, ...noResetSessionFields() });
  });

  await t.test('evaluates EVERY configured symbol independently — no SPY anywhere', async () => {
    const fixture = universeFixtureFor({ QQQ: 'bullish', USO: 'mixed', XLE: 'mixed' });
    const { evaluation, orderIntent } = await mods.processUniverseTick(String(session._id), mock, fixture);

    assert.equal(evaluation.configuredSymbols.length, 3);
    assert.equal(evaluation.symbolResults.length, 3);
    assert.deepEqual(
      evaluation.symbolResults.map((r) => r.symbol).sort(),
      ['QQQ', 'USO', 'XLE']
    );
    // one signal (QQQ bullish), two deterministic NO_TRADEs
    assert.equal(evaluation.outcome, 'INTENT_CREATED');
    assert.equal(evaluation.selectedSymbol, 'QQQ');
    assert.equal(evaluation.selectedContractSymbol, 'QQQ260724C00500000');
    assert.ok(orderIntent);
    assert.equal(orderIntent.underlying, 'QQQ');
    assert.equal(orderIntent.status, 'APPROVED_AWAITING_EXECUTION');
    // zero broker submissions, ever
    assert.equal(submitCallCount(), 0);
  });

  await t.test('a symbol with missing data is SKIPPED with reasons; the rest keep going', async () => {
    const fixture = universeFixtureFor({
      USO: { kind: 'bullish', failFetch: true },
      CVX: 'bullish',
    });
    const { evaluation, orderIntent } = await mods.processUniverseTick(String(session._id), mock, fixture);

    const uso = evaluation.symbolResults.find((r) => r.symbol === 'USO');
    assert.equal(uso.eligible, false);
    assert.ok(uso.reasonCodes.includes('SYMBOL_DATA_UNAVAILABLE'));
    // the healthy symbol still trades — one bad symbol never blocks the run
    assert.equal(evaluation.outcome, 'INTENT_CREATED');
    assert.equal(evaluation.selectedSymbol, 'CVX');
    assert.ok(orderIntent);
  });

  await t.test('a symbol with an INCOMPLETE chain window is skipped (fail-closed)', async () => {
    const fixture = universeFixtureFor({
      XOM: { kind: 'bullish', incompleteChain: true },
      OXY: 'bullish',
    });
    const { evaluation } = await mods.processUniverseTick(String(session._id), mock, fixture);

    const xom = evaluation.symbolResults.find((r) => r.symbol === 'XOM');
    assert.equal(xom.eligible, false);
    assert.ok(xom.reasonCodes.includes('CHAIN_INCOMPLETE'));
    assert.equal(evaluation.selectedSymbol, 'OXY');
  });

  await t.test('liquidity filters: a chain with no liquid contract disqualifies the symbol', async () => {
    const fixture = universeFixtureFor({
      USO: { kind: 'bullish', illiquidChain: true },
      XLE: 'bullish',
    });
    const { evaluation } = await mods.processUniverseTick(String(session._id), mock, fixture);

    const uso = evaluation.symbolResults.find((r) => r.symbol === 'USO');
    assert.equal(uso.eligible, false);
    assert.ok(uso.reasonCodes.includes('SYMBOL_CHAIN_ILLIQUID'));
    assert.equal(evaluation.selectedSymbol, 'XLE');
  });

  await t.test('ranking is deterministic: better contract wins; loser is recorded RANKED_NOT_SELECTED', async () => {
    // XLE's winner sits exactly on the delta target (0.60) → higher score than
    // XOM's 0.65-delta winner. Identical inputs must always produce this order.
    const spec = {
      XOM: { kind: 'bullish', winnerDelta: 0.65 },
      XLE: { kind: 'bullish', winnerDelta: 0.6 },
    };
    const first = await mods.processUniverseTick(String(session._id), mock, universeFixtureFor(spec));
    assert.equal(first.evaluation.ranking.length, 2);
    assert.equal(first.evaluation.ranking[0].symbol, 'XLE');
    assert.equal(first.evaluation.ranking[1].symbol, 'XOM');
    assert.equal(first.evaluation.selectedSymbol, 'XLE');
    assert.equal(first.orderIntent.underlying, 'XLE');
    assert.ok(first.evaluation.ranking[0].opportunityScore > first.evaluation.ranking[1].opportunityScore);

    // the losing signal is persisted, never traded
    const loser = await mods.TradeCandidateModel.findOne({ underlying: 'XOM' });
    assert.equal(loser.status, 'RANKED_NOT_SELECTED');
    assert.deepEqual(loser.reasonCodes, ['OPPORTUNITY_NOT_SELECTED']);

    // identical inputs on a fresh session → identical ranking (determinism)
    const session2 = await createReadySession(mods, { underlying: null, ...noResetSessionFields() });
    const second = await mods.processUniverseTick(String(session2._id), mock, universeFixtureFor(spec));
    assert.deepEqual(
      second.evaluation.ranking.map((r) => r.symbol),
      first.evaluation.ranking.map((r) => r.symbol)
    );
  });

  await t.test('equal scores tiebreak alphabetically (absolute determinism)', async () => {
    const fixture = universeFixtureFor({ XOM: 'bullish', CVX: 'bullish' });
    const { evaluation } = await mods.processUniverseTick(String(session._id), mock, fixture);
    assert.equal(evaluation.ranking[0].symbol, 'CVX');
    assert.equal(evaluation.selectedSymbol, 'CVX');
  });

  await t.test('the SAME strategy logic runs for every symbol (bearish → puts on any ticker)', async () => {
    const fixture = universeFixtureFor({ CVX: 'bearish' });
    const { evaluation, orderIntent } = await mods.processUniverseTick(String(session._id), mock, fixture);
    assert.equal(evaluation.selectedSymbol, 'CVX');
    assert.equal(evaluation.ranking[0].direction, 'BEARISH');
    assert.equal(orderIntent.optionSymbol, 'CVX260724P00500000');
  });

  await t.test('adding a brand-new symbol needs config only — no code changes', async () => {
    const fixture = universeFixtureFor({ NEWCO: 'bullish' });
    const { evaluation, orderIntent } = await mods.processUniverseTick(String(session._id), mock, fixture);
    assert.equal(evaluation.selectedSymbol, 'NEWCO');
    assert.equal(orderIntent.underlying, 'NEWCO');
  });

  await t.test('empty universe → UNIVERSE_NOT_CONFIGURED, nothing evaluated, nothing traded', async () => {
    const { evaluation, orderIntent } = await mods.processUniverseTick(String(session._id), mock, {
      universe: [],
      symbols: {},
      account: FIXTURE_ACCOUNT,
      now: FIXTURE_NOW,
    });
    assert.equal(evaluation.outcome, 'UNIVERSE_NOT_CONFIGURED');
    assert.ok(evaluation.reasonCodes.includes('UNIVERSE_NOT_CONFIGURED'));
    assert.equal(orderIntent, null);
  });

  await t.test('session gates reject the whole tick with recorded reasons', async () => {
    session.status = 'PAUSED';
    await session.save();
    const fixture = universeFixtureFor({ QQQ: 'bullish' });
    const { evaluation, orderIntent } = await mods.processUniverseTick(String(session._id), mock, fixture);
    assert.equal(evaluation.outcome, 'GATES_REJECTED');
    assert.ok(evaluation.reasonCodes.includes('SESSION_NOT_READY'));
    assert.equal(orderIntent, null);
  });

  await t.test('session-level risk rejection stops the cascade — no intent from ANY symbol', async () => {
    session.consecutiveLossCount = 5; // ≥ pause threshold (2)
    await session.save();
    const fixture = universeFixtureFor({ QQQ: 'bullish', USO: 'bullish' });
    const { evaluation, orderIntent } = await mods.processUniverseTick(String(session._id), mock, fixture);
    assert.equal(evaluation.outcome, 'RISK_REJECTED');
    assert.ok(evaluation.riskReasonCodes.includes('RISK_CONSECUTIVE_LOSS_COOLDOWN'));
    assert.equal(orderIntent, null);
    // exactly ONE risk decision: session-level failures never cascade
    assert.equal(await mods.RiskDecisionModel.countDocuments({}), 1);
  });

  await t.test('re-processing the same bars is idempotent per symbol (no duplicate intents)', async () => {
    const fixture = universeFixtureFor({ QQQ: 'bullish', USO: 'mixed' });
    const first = await mods.processUniverseTick(String(session._id), mock, fixture);
    assert.equal(first.evaluation.outcome, 'INTENT_CREATED');

    const second = await mods.processUniverseTick(String(session._id), mock, fixture);
    assert.equal(second.orderIntent, null);
    const qqq = second.evaluation.symbolResults.find((r) => r.symbol === 'QQQ');
    assert.ok(qqq.reasonCodes.includes('BAR_NOT_NEWER_THAN_LAST_PROCESSED'));
    assert.equal(await mods.OrderIntentModel.countDocuments({}), 1);
  });

  await t.test('every persisted evaluation carries the full dashboard payload', async () => {
    const fixture = universeFixtureFor({
      QQQ: 'bullish',
      USO: { kind: 'bullish', failFetch: true },
    });
    await mods.processUniverseTick(String(session._id), mock, fixture);
    const [doc] = await mods.UniverseEvaluationModel.find({ automationSessionId: String(session._id) })
      .sort({ evaluatedAt: -1 })
      .lean();
    // current universe / eligible / rejected+reasons / ranking / selection /
    // data health / risk status — everything a dashboard needs.
    assert.deepEqual(doc.configuredSymbols, ['QQQ', 'USO']);
    assert.deepEqual(doc.eligibleSymbols, ['QQQ']);
    assert.equal(doc.symbolResults.find((r) => r.symbol === 'USO').eligible, false);
    assert.equal(doc.ranking.length, 1);
    assert.equal(doc.selectedSymbol, 'QQQ');
    assert.ok(doc.selectedContractSymbol);
    assert.equal(doc.riskApproved, true);
    assert.ok(doc.dataHealth.evaluatedSymbols === 2 && doc.dataHealth.eligibleCount === 1);
  });
});

// ---------------------------------------------------------------------------
// Pure universe service functions
// ---------------------------------------------------------------------------

test('market universe service (pure)', async (t) => {
  await t.test('rankEligibleSymbols: score desc, symbol asc tiebreak, ineligible excluded', () => {
    const entry = (symbol, eligible, score) => ({
      symbol,
      eligible,
      score,
      reasonCodes: [],
      barSummary: { ok: true, barCount: 40, closedBarTimestamp: 1, reasonCodes: [], underlyingAuthorized: true },
      liquidity: null,
    });
    const ranked = mods.rankEligibleSymbols([
      entry('XOM', true, 5),
      entry('CVX', true, 7),
      entry('USO', false, 9),
      entry('AAA', true, 5),
    ]);
    assert.deepEqual(
      ranked.map((r) => r.symbol),
      ['CVX', 'AAA', 'XOM']
    );
  });

  await t.test('resolveUniverse: session universe overrides env configuration', () => {
    process.env.AUTOMATION_UNDERLYINGS = 'qqq';
    try {
      assert.deepEqual(mods.resolveUniverse(['uso', 'xle']).symbols, ['USO', 'XLE']);
      assert.deepEqual(mods.resolveUniverse(null).symbols, ['QQQ']);
    } finally {
      delete process.env.AUTOMATION_UNDERLYINGS;
    }
  });
});
