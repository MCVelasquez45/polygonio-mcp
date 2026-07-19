import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { startTestMongo, stopTestMongo } from './automation.helpers.mjs';

const tradingDate = '2026-07-16';
const sessionId = 'paper:2026-07-16:decision-test-session';
const automationSessionId = 'automation-session-decision';
const strategyVersionId = 'strategy-decision-v1';
const start = new Date('2026-07-16T14:00:00.000Z');
const close = new Date('2026-07-16T21:05:00.000Z');

async function loadDecisionJournalDist() {
  const [
    tradingSessionModel,
    decisionJournalModel,
    decisionJournalService,
    intelligenceRoutes,
    tradeCandidateModel,
    contractSelectionModel,
    riskDecisionModel,
    orderIntentModel,
    automationPositionModel,
    universeEvaluationModel,
    automationEventModel,
  ] = await Promise.all([
    import('../dist/features/intelligence/models/tradingSession.model.js'),
    import('../dist/features/intelligence/models/decisionJournal.model.js'),
    import('../dist/features/intelligence/services/decisionJournal.service.js'),
    import('../dist/features/intelligence/intelligence.routes.js'),
    import('../dist/features/automation/models/tradeCandidate.model.js'),
    import('../dist/features/automation/models/contractSelection.model.js'),
    import('../dist/features/automation/models/riskDecision.model.js'),
    import('../dist/features/automation/models/orderIntent.model.js'),
    import('../dist/features/automation/models/automationPosition.model.js'),
    import('../dist/features/automation/models/universeEvaluation.model.js'),
    import('../dist/features/automation/models/automationEvent.model.js'),
  ]);
  return {
    ...tradingSessionModel,
    ...decisionJournalModel,
    ...decisionJournalService,
    ...intelligenceRoutes,
    ...tradeCandidateModel,
    ...contractSelectionModel,
    ...riskDecisionModel,
    ...orderIntentModel,
    ...automationPositionModel,
    ...universeEvaluationModel,
    ...automationEventModel,
  };
}

async function resetDb(mods) {
  const db = mods.TradingSessionModel.db.db;
  const collections = await db.listCollections().toArray();
  for (const { name } of collections) {
    await db.collection(name).deleteMany({});
  }
  await mods.TradingSessionModel.syncIndexes();
  await mods.DecisionJournalModel.syncIndexes();
  await mods.TradeCandidateModel.syncIndexes();
  await mods.ContractSelectionModel.syncIndexes();
  await mods.RiskDecisionModel.syncIndexes();
  await mods.OrderIntentModel.syncIndexes();
  await mods.AutomationPositionModel.syncIndexes();
  await mods.UniverseEvaluationModel.syncIndexes();
  await mods.AutomationEventModel.syncIndexes();
}

function selectedContract(symbol, overrides = {}) {
  return {
    symbol,
    type: symbol.includes('P') ? 'put' : 'call',
    strike: overrides.strike ?? 90,
    expiration: '2026-07-17',
    dte: 1,
    bid: overrides.bid ?? 1.68,
    ask: overrides.ask ?? 1.72,
    mid: overrides.mid ?? 1.7,
    delta: overrides.delta ?? 0.48,
    iv: overrides.iv ?? 0.32,
    openInterest: overrides.openInterest ?? 850,
    volume: overrides.volume ?? 120,
    quoteTimestamp: new Date('2026-07-16T14:34:30.000Z'),
    spreadDollars: overrides.spreadDollars ?? 0.04,
    spreadPct: overrides.spreadPct ?? 0.0235,
    passed: overrides.passed ?? true,
    rejectionReasons: overrides.rejectionReasons ?? [],
    score: overrides.score ?? 88,
    scoreComponents: { delta: 20, spread: 30, liquidity: 25, dte: 13 },
  };
}

async function createTradingSession(mods) {
  return mods.TradingSessionModel.create({
    sessionId,
    tradingDate,
    timezone: 'America/New_York',
    status: 'FINALIZED',
    environment: 'PAPER',
    marketStatus: 'CLOSED',
    startedAt: start,
    finalizedAt: close,
    automationSessionId,
    watchlist: { symbols: ['XLE', 'SPY', 'QQQ'], size: 3 },
    evaluationSummary: {
      windowsEvaluated: 1,
      symbolsEvaluated: 3,
      signalsGenerated: 2,
      noSignalCount: 1,
      dataRejectCount: 0,
      riskRejectCount: 1,
      approvedCount: 1,
    },
    tradeSummary: {
      tradesOpened: 1,
      tradesClosed: 1,
      winningTrades: 1,
      losingTrades: 0,
      breakevenTrades: 0,
      realizedPnl: 2,
      unrealizedPnlAtClose: null,
      totalPnl: 2,
    },
    orderSummary: {
      intentsCreated: 2,
      ordersSubmitted: 2,
      fills: 2,
      partialFills: 0,
      cancellations: 0,
      rejections: 0,
      manualReviewCount: 0,
    },
    portfolioSnapshot: null,
    providerSummary: {
      totalRequests: 12,
      cacheHits: 6,
      cacheHitRate: 0.5,
      rateLimitCount: 0,
      providerErrors: null,
      entitlementRejects: 0,
    },
    automationHealth: {
      schedulerHealthy: true,
      monitorHealthy: true,
      reconciliationClean: true,
      brokerConnected: true,
      marketDataConnected: true,
      mongoConnected: true,
      emergencyStopActivated: false,
    },
    references: {
      candidateIds: [],
      riskDecisionIds: [],
      orderIntentIds: [],
      brokerOrderIds: [],
      positionIds: [],
      eventIds: [],
      closedTradeIds: [],
    },
    warnings: [],
    errors: [],
    generation: {
      schemaVersion: 1,
      generatorVersion: 'trading-session-capture-v1',
      generatedBy: 'server:intelligence:session-capture',
      sourceWindowStart: start,
      sourceWindowEnd: new Date('2026-07-17T04:00:00.000Z'),
      finalizedFromPersistedEvidence: true,
      lastAttemptAt: close,
      attemptCount: 1,
    },
  });
}

async function createCandidate(mods, overrides = {}) {
  return mods.TradeCandidateModel.create({
    automationSessionId,
    strategyVersionId,
    underlying: overrides.underlying ?? 'XLE',
    barTimestamp: overrides.barTimestamp ?? new Date('2026-07-16T14:31:00.000Z'),
    signalDirection: overrides.signalDirection ?? 'BULLISH',
    status: overrides.status ?? 'RISK_APPROVED',
    reasonCodes: overrides.reasonCodes ?? [],
    indicatorSnapshot: {
      close: 90,
      vwap: 89.8,
      emaFast: 90.3,
      emaSlow: 89.7,
      rsi: 58,
      atr: 1.2,
      barVolume: 250000,
      rollingVolumeAvg: 180000,
    },
    marketClockDecision: { state: 'OPEN', canEnter: true, decidedAt: start.toISOString(), reasons: [] },
    marketDataHealth: { ok: true },
    strategyConfigSnapshot: { name: 'options-flow-v1' },
    conditions: {
      confidence: overrides.confidence ?? 0.72,
      flowScore: 0.68,
      momentumScore: 0.66,
      trendScore: 0.7,
      trend: overrides.signalDirection === 'BEARISH' ? 'DOWN' : 'UP',
      regime: 'REGULAR_SESSION',
    },
  });
}

async function createIntent(mods, candidate, overrides = {}) {
  const intentType = overrides.intentType ?? 'ENTRY';
  const direction = overrides.direction ?? (intentType === 'EXIT' ? 'SELL' : 'BUY');
  return mods.OrderIntentModel.create({
    automationSessionId,
    strategyVersionId,
    underlying: overrides.underlying ?? candidate.underlying,
    optionSymbol: overrides.optionSymbol ?? 'XLE260717C00090000',
    intentType,
    direction,
    quantity: 1,
    orderType: 'limit',
    limitPrice: overrides.limitPrice ?? 1.69,
    timeInForce: 'day',
    status: overrides.status ?? 'SUBMITTED',
    idempotencyKey: overrides.idempotencyKey ?? `${intentType}:${candidate.underlying}:${candidate._id}`,
    clientOrderId: overrides.clientOrderId ?? `at2a-decision-${intentType}-${candidate.underlying}`,
    idempotencyInputs: {
      automationSessionId,
      strategyVersionId,
      underlying: candidate.underlying,
      signalDirection: direction,
      closedBarTimestamp: candidate.barTimestamp.toISOString(),
      intentType,
      idempotencyScope: overrides.idempotencyScope ?? null,
    },
    brokerOrderId: overrides.brokerOrderId ?? `broker-${intentType}-${candidate.underlying}`,
    rejectionReason: overrides.rejectionReason ?? null,
    attemptCount: overrides.attemptCount ?? 1,
    lastReconciledAt: close,
    submittedAt: overrides.submittedAt ?? new Date('2026-07-16T14:32:00.000Z'),
    completedAt: overrides.completedAt ?? close,
  });
}

async function seedDecisionEvidence(mods) {
  await createTradingSession(mods);
  const approved = await createCandidate(mods);
  const selected = selectedContract('XLE260717C00090000');
  await mods.ContractSelectionModel.create({
    tradeCandidateId: String(approved._id),
    automationSessionId,
    direction: 'BULLISH',
    optionSide: 'call',
    underlying: 'XLE',
    underlyingPrice: 90,
    chainFetchedAt: new Date('2026-07-16T14:31:30.000Z'),
    filtersSnapshot: { minOpenInterest: 100 },
    candidates: [
      selected,
      { ...selectedContract('XLE260717C00080000', { score: 42, spreadPct: 0.4, passed: false, rejectionReasons: ['HIGH_SPREAD'] }) },
    ],
    consideredCount: 2,
    passedCount: 1,
    selected,
    noSelectionReason: null,
  });
  await mods.RiskDecisionModel.create({
    tradeCandidateId: String(approved._id),
    automationSessionId,
    approved: true,
    reasonCodes: [],
    checks: [{ name: 'position-size', passed: true, detail: 'within max debit', observed: 169, limit: 500 }],
    sizing: {
      inputs: { buyingPower: 10000, openAutomationPositions: 0, clockDecision: { state: 'OPEN', canEnter: true } },
      outputs: { quantity: 1, maxLoss: 169, riskPercent: 0.0169 },
    },
    decidedAt: new Date('2026-07-16T14:32:00.000Z'),
  });
  const entryIntent = await createIntent(mods, approved);
  const exitIntent = await createIntent(mods, approved, {
    intentType: 'EXIT',
    direction: 'SELL',
    idempotencyScope: 'exit',
    limitPrice: 1.71,
    submittedAt: new Date('2026-07-16T20:58:00.000Z'),
    brokerOrderId: 'broker-EXIT-XLE',
  });
  await mods.AutomationPositionModel.create({
    source: 'AUTOMATION',
    automationSessionId,
    strategyVersionId,
    universeEvaluationId: null,
    tradeCandidateId: String(approved._id),
    contractSelectionId: null,
    riskDecisionId: null,
    underlying: 'XLE',
    optionSymbol: 'XLE260717C00090000',
    direction: 'BULLISH',
    entryIntentId: String(entryIntent._id),
    entryBrokerOrderId: entryIntent.brokerOrderId,
    entryClientOrderId: entryIntent.clientOrderId,
    orderedQuantity: 1,
    filledQty: 1,
    avgEntryPrice: 1.69,
    entryFees: null,
    openedAt: new Date('2026-07-16T14:33:00.000Z'),
    lastBrokerReconciledAt: close,
    status: 'CLOSED',
    currentMark: 1.71,
    unrealizedPnl: null,
    lastMarkAt: close,
    maxFavorableExcursion: 4,
    maxAdverseExcursion: -2,
    exitPolicy: {
      stopLossPct: 0.35,
      profitTargetPct: 0.5,
      trailingEnabled: false,
      stopPrice: 1.1,
      targetPrice: 2.54,
    },
    exitReason: 'END_OF_DAY',
    exitIntentId: String(exitIntent._id),
    exitBrokerOrderId: exitIntent.brokerOrderId,
    avgExitPrice: 1.71,
    exitFees: null,
    realizedPnl: 2,
    returnPct: 0.0118,
    closedAt: close,
    riskCounted: true,
    exitAttemptCount: 1,
    exitSubmittedAt: exitIntent.submittedAt,
    exitFilledQty: 1,
    manualReviewReason: null,
    overnightRecoveryRequired: false,
    overnightDetectedAt: null,
    overnightReason: null,
    recoveryExitEligibleAt: null,
    recoveryExitSubmittedAt: null,
  });
  const noSignal = await createCandidate(mods, {
    underlying: 'SPY',
    signalDirection: null,
    status: 'NO_TRADE',
    reasonCodes: ['NO_SIGNAL'],
    confidence: null,
    barTimestamp: new Date('2026-07-16T14:31:00.000Z'),
  });
  const rejected = await createCandidate(mods, {
    underlying: 'QQQ',
    status: 'RISK_REJECTED',
    reasonCodes: ['RISK_MAX_TRADES'],
    barTimestamp: new Date('2026-07-16T14:31:00.000Z'),
  });
  await mods.RiskDecisionModel.create({
    tradeCandidateId: String(rejected._id),
    automationSessionId,
    approved: false,
    reasonCodes: ['RISK_MAX_TRADES'],
    checks: [{ name: 'max-trades', passed: false, detail: 'max trades reached', observed: 3, limit: 3 }],
    sizing: { inputs: { buyingPower: 10000, openAutomationPositions: 1 }, outputs: {} },
    decidedAt: new Date('2026-07-16T14:32:30.000Z'),
  });
  await mods.UniverseEvaluationModel.create({
    automationSessionId,
    strategyVersionId,
    evaluatedAt: new Date('2026-07-16T14:32:45.000Z'),
    universeSource: 'watchlist',
    configuredSymbols: ['XLE', 'SPY', 'QQQ'],
    invalidSymbols: [],
    eligibleSymbols: ['XLE'],
    symbolResults: [
      { symbol: 'XLE', eligible: true, reasonCodes: [], symbolScore: 10, barCount: 40, closedBarTimestamp: start, liquidity: null, candidateId: String(approved._id), candidateStatus: 'RISK_APPROVED', direction: 'BULLISH' },
      { symbol: 'SPY', eligible: false, reasonCodes: ['NO_SIGNAL'], symbolScore: 0, barCount: 40, closedBarTimestamp: start, liquidity: null, candidateId: String(noSignal._id), candidateStatus: 'NO_TRADE', direction: null },
      { symbol: 'QQQ', eligible: false, reasonCodes: ['RISK_MAX_TRADES'], symbolScore: 8, barCount: 40, closedBarTimestamp: start, liquidity: null, candidateId: String(rejected._id), candidateStatus: 'RISK_REJECTED', direction: 'BULLISH' },
    ],
    ranking: [
      {
        rank: 1,
        symbol: 'XLE',
        direction: 'BULLISH',
        contractSymbol: 'XLE260717C00090000',
        opportunityScore: 98,
        contractScore: 88,
        symbolScore: 10,
        spreadPct: 0.0235,
        openInterest: 850,
        volume: 120,
        candidateId: String(approved._id),
      },
    ],
    selectedSymbol: 'XLE',
    selectedContractSymbol: 'XLE260717C00090000',
    selectedCandidateId: String(approved._id),
    riskApproved: true,
    riskReasonCodes: [],
    orderIntentId: String(entryIntent._id),
    outcome: 'INTENT_CREATED',
    reasonCodes: [],
    marketClockDecision: { state: 'OPEN', canEnter: true, decidedAt: start.toISOString(), reasons: [] },
    dataHealth: { ok: true },
  });
  await mods.AutomationEventModel.create({
    timestamp: new Date('2026-07-16T20:59:00.000Z'),
    service: 'automation-emergency',
    event: 'EMERGENCY_STOP_INACTIVE',
    severity: 'info',
    automationSessionId,
    intentId: null,
    brokerOrderId: null,
    symbol: null,
    payload: { reason: 'NORMAL_OPERATING_MODE' },
  });
}

test('Decision Journal', async (t) => {
  await startTestMongo();
  const mods = await loadDecisionJournalDist();
  await resetDb(mods);
  t.after(async () => stopTestMongo());

  await t.test('backfills immutable decision entries from persisted evaluation evidence', async () => {
    await seedDecisionEvidence(mods);
    const results = await mods.backfillDecisionJournalForDate(tradingDate);
    const entries = results.map(result => result.entry);

    assert.ok(entries.length >= 8);
    assert.ok(entries.some(entry => entry.decisionType === 'BUY_APPROVED' && entry.source.type === 'RiskDecision'));
    assert.ok(entries.some(entry => entry.decisionType === 'NO_SIGNAL'));
    assert.ok(entries.some(entry => entry.decisionType === 'RISK_REJECTED'));
    assert.ok(entries.some(entry => entry.decisionType === 'EXIT_TRIGGERED'));

    const approvedRisk = entries.find(entry => entry.source.type === 'RiskDecision' && entry.decisionType === 'BUY_APPROVED');
    assert.equal(approvedRisk.context.symbol, 'XLE');
    assert.equal(approvedRisk.decision.approved, true);
    assert.equal(approvedRisk.inputs.buyingPower, 10000);
    assert.equal(approvedRisk.riskSnapshot.positionSize, 1);
    assert.ok(approvedRisk.evidenceQuality.persistedFields.includes('checks'));
    assert.ok(approvedRisk.timeline.some(event => event.label === 'Risk approved'));

    const second = await mods.backfillDecisionJournalForDate(tradingDate);
    assert.equal(second.length, results.length);
    assert.equal(second.every(result => result.idempotent), true);

    approvedRisk.context.symbol = 'BAD';
    await assert.rejects(() => approvedRisk.save(), /DECISION_JOURNAL_ENTRY_IMMUTABLE/);
  });

  await t.test('read APIs expose decision journal entries and backfill fails closed without admin token', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/intelligence', mods.intelligenceRouter);
    const server = await new Promise(resolve => {
      const listener = app.listen(0, () => resolve(listener));
    });
    try {
      const address = server.address();
      const base = `http://127.0.0.1:${address.port}`;
      const list = await fetch(`${base}/api/intelligence/decisions`);
      assert.equal(list.status, 200);
      const listBody = await list.json();
      assert.ok(listBody.entries.length >= 1);

      const entry = listBody.entries[0];
      const detail = await fetch(`${base}/api/intelligence/decisions/${encodeURIComponent(entry.decisionId)}`);
      assert.equal(detail.status, 200);
      assert.equal((await detail.json()).entry.decisionId, entry.decisionId);

      const bySession = await fetch(`${base}/api/intelligence/decisions/session/${encodeURIComponent(sessionId)}`);
      assert.equal(bySession.status, 200);
      assert.ok((await bySession.json()).entries.length >= 1);

      const byTrade = await fetch(`${base}/api/intelligence/decisions/trade/${encodeURIComponent(entry.tradeId ?? 'missing')}`);
      assert.equal(byTrade.status, 200);

      const missing = await fetch(`${base}/api/intelligence/decisions/not-real`);
      assert.equal(missing.status, 404);

      const blocked = await fetch(`${base}/api/intelligence/decisions/backfill/${tradingDate}`, { method: 'POST' });
      assert.equal(blocked.status, 403);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
