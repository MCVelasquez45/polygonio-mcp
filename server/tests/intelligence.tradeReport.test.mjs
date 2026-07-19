import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { startTestMongo, stopTestMongo } from './automation.helpers.mjs';

const tradingDate = '2026-07-16';
const start = new Date('2026-07-16T14:35:00.000Z');
const close = new Date('2026-07-16T20:55:00.000Z');
const strategyVersionId = 'sv-intel-report-1';

async function loadTradeReportDist() {
  const [
    sessionModel,
    universeModel,
    candidateModel,
    selectionModel,
    riskModel,
    intentModel,
    brokerOrderModel,
    positionModel,
    eventModel,
    tradingSessionModel,
    tradingSessionService,
    tradeReportModel,
    tradeReportService,
    intelligenceRoutes,
  ] = await Promise.all([
    import('../dist/features/automation/models/automationSession.model.js'),
    import('../dist/features/automation/models/universeEvaluation.model.js'),
    import('../dist/features/automation/models/tradeCandidate.model.js'),
    import('../dist/features/automation/models/contractSelection.model.js'),
    import('../dist/features/automation/models/riskDecision.model.js'),
    import('../dist/features/automation/models/orderIntent.model.js'),
    import('../dist/features/automation/models/brokerOrder.model.js'),
    import('../dist/features/automation/models/automationPosition.model.js'),
    import('../dist/features/automation/models/automationEvent.model.js'),
    import('../dist/features/intelligence/models/tradingSession.model.js'),
    import('../dist/features/intelligence/services/tradingSessionCapture.service.js'),
    import('../dist/features/intelligence/models/tradeReport.model.js'),
    import('../dist/features/intelligence/services/tradeReportGenerator.service.js'),
    import('../dist/features/intelligence/intelligence.routes.js'),
  ]);
  return {
    ...sessionModel,
    ...universeModel,
    ...candidateModel,
    ...selectionModel,
    ...riskModel,
    ...intentModel,
    ...brokerOrderModel,
    ...positionModel,
    ...eventModel,
    ...tradingSessionModel,
    ...tradingSessionService,
    ...tradeReportModel,
    ...tradeReportService,
    ...intelligenceRoutes,
  };
}

async function resetDb(mods) {
  const db = mods.TradingSessionModel.db.db;
  const collections = await db.listCollections().toArray();
  for (const { name } of collections) {
    await db.collection(name).deleteMany({});
  }
  await mods.TradingSessionModel.syncIndexes();
  await mods.TradeReportModel.syncIndexes();
}

async function createAutomationSession(mods) {
  return mods.AutomationSessionModel.create({
    mode: 'paper',
    strategyVersionId,
    underlying: null,
    universe: ['XLE', 'SPY'],
    status: 'READY',
    healthStatus: 'HEALTHY',
    reconciliationStatus: 'CLEAN',
    startedAt: start,
    lastResetTradingDate: tradingDate,
    emergencyStop: { active: false, reason: null, at: null },
  });
}

async function createIntent(mods, sessionId, index, overrides = {}) {
  return mods.OrderIntentModel.create({
    automationSessionId: sessionId,
    strategyVersionId,
    underlying: overrides.underlying ?? 'XLE',
    optionSymbol: overrides.optionSymbol ?? 'XLE260717C00090000',
    intentType: overrides.intentType ?? 'ENTRY',
    direction: overrides.direction ?? 'BUY',
    quantity: 1,
    orderType: 'limit',
    limitPrice: overrides.limitPrice ?? 1.69,
    timeInForce: 'day',
    status: overrides.status ?? 'COMPLETED',
    idempotencyKey: `trade-report-key-${sessionId}-${index}`,
    clientOrderId: overrides.clientOrderId ?? `at2a-report-${index}`,
    idempotencyInputs: {
      automationSessionId: sessionId,
      strategyVersionId,
      underlying: overrides.underlying ?? 'XLE',
      signalDirection: overrides.direction ?? 'BUY',
      closedBarTimestamp: start.toISOString(),
      intentType: overrides.intentType ?? 'ENTRY',
      idempotencyScope: overrides.idempotencyScope ?? null,
    },
    brokerOrderId: overrides.brokerOrderId ?? `bro-report-${index}`,
    submittedAt: overrides.submittedAt ?? start,
    completedAt: overrides.completedAt ?? close,
    ...overrides,
  });
}

async function createBrokerOrder(mods, sessionId, index, overrides = {}) {
  return mods.BrokerOrderModel.create({
    brokerOrderId: overrides.brokerOrderId ?? `bro-report-${index}`,
    clientOrderId: overrides.clientOrderId ?? `at2a-report-${index}`,
    intentId: overrides.intentId ?? null,
    automationSessionId: sessionId,
    symbol: overrides.symbol ?? 'XLE260717C00090000',
    side: overrides.side ?? 'BUY',
    qty: 1,
    filledQty: overrides.filledQty ?? 1,
    avgFillPrice: overrides.avgFillPrice ?? 1.69,
    status: overrides.status ?? 'FILLED',
    rawStatus: overrides.rawStatus ?? 'filled',
    orderType: 'limit',
    limitPrice: overrides.limitPrice ?? 1.69,
    timeInForce: 'day',
    lastSource: 'reconciliation',
    submittedAt: overrides.submittedAt ?? start,
    lastBrokerUpdateAt: overrides.lastBrokerUpdateAt ?? close,
    statusHistory: overrides.statusHistory ?? [
      {
        at: overrides.submittedAt ?? start,
        status: overrides.status ?? 'FILLED',
        rawStatus: overrides.rawStatus ?? 'filled',
        source: 'reconciliation',
      },
    ],
    ...overrides,
  });
}

function selectedContract(symbol, overrides = {}) {
  return {
    symbol,
    type: symbol.includes('P') ? 'put' : 'call',
    strike: symbol.includes('SPY') ? 500 : 90,
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
    passed: true,
    rejectionReasons: [],
    score: overrides.score ?? 88,
    scoreComponents: { delta: 20, spread: 30, liquidity: 25, dte: 13 },
  };
}

async function seedClosedTrade(mods, sessionId, config) {
  const candidate = await mods.TradeCandidateModel.create({
    automationSessionId: sessionId,
    strategyVersionId,
    underlying: config.underlying,
    barTimestamp: config.signalAt ?? start,
    signalDirection: config.direction,
    status: 'RISK_APPROVED',
    reasonCodes: [],
    indicatorSnapshot: {
      close: config.underlyingPrice,
      vwap: config.underlyingPrice - 0.1,
      emaFast: config.underlyingPrice + 0.2,
      emaSlow: config.underlyingPrice - 0.2,
      rsi: 58,
      atr: 1.2,
      barVolume: 250000,
      rollingVolumeAvg: 180000,
    },
    strategyConfigSnapshot: { name: 'options-flow-v1' },
    conditions: {
      confidence: config.confidence,
      flowScore: config.flowScore,
      momentumScore: config.momentumScore,
      trendScore: config.trendScore,
      trend: config.direction === 'BULLISH' ? 'UP' : 'DOWN',
      regime: 'REGULAR_SESSION',
    },
  });
  const selected = selectedContract(config.optionSymbol, config.contractOverrides);
  const selection = await mods.ContractSelectionModel.create({
    tradeCandidateId: String(candidate._id),
    automationSessionId: sessionId,
    direction: config.direction,
    optionSide: config.direction === 'BULLISH' ? 'call' : 'put',
    underlying: config.underlying,
    underlyingPrice: config.underlyingPrice,
    chainFetchedAt: start,
    filtersSnapshot: { minOpenInterest: 100 },
    candidates: [
      selected,
      {
        ...selectedContract(`${config.underlying}260717${config.direction === 'BULLISH' ? 'C' : 'P'}00080000`, {
          bid: 0.5,
          ask: 0.75,
          spreadPct: 0.4,
          score: 42,
        }),
        passed: false,
        rejectionReasons: ['SPREAD_TOO_WIDE'],
      },
    ],
    consideredCount: 2,
    passedCount: 1,
    selected,
    noSelectionReason: null,
  });
  const risk = await mods.RiskDecisionModel.create({
    tradeCandidateId: String(candidate._id),
    automationSessionId: sessionId,
    approved: true,
    reasonCodes: [],
    checks: [
      { name: 'position-size', passed: true, detail: 'within max debit', observed: config.entryPrice * 100, limit: 500 },
      { name: 'daily-loss', passed: true, detail: 'within budget', observed: -10, limit: -300 },
    ],
    sizing: { inputs: { buyingPower: 10000 }, outputs: { contracts: 1 } },
    decidedAt: new Date(start.getTime() + 60_000),
  });
  const entryIntent = await createIntent(mods, sessionId, `${config.underlying}-entry`, {
    underlying: config.underlying,
    optionSymbol: config.optionSymbol,
    intentType: 'ENTRY',
    direction: 'BUY',
    limitPrice: config.entryLimit,
    clientOrderId: `${config.underlying}-entry-client`,
    brokerOrderId: `${config.underlying}-entry-broker`,
    submittedAt: new Date(start.getTime() + 120_000),
  });
  const exitIntent = await createIntent(mods, sessionId, `${config.underlying}-exit`, {
    underlying: config.underlying,
    optionSymbol: config.optionSymbol,
    intentType: 'EXIT',
    direction: 'SELL',
    limitPrice: config.exitLimit,
    clientOrderId: `${config.underlying}-exit-client`,
    brokerOrderId: `${config.underlying}-exit-broker`,
    idempotencyScope: 'exit',
    submittedAt: new Date(close.getTime() - 120_000),
  });
  await createBrokerOrder(mods, sessionId, `${config.underlying}-entry`, {
    brokerOrderId: `${config.underlying}-entry-broker`,
    clientOrderId: `${config.underlying}-entry-client`,
    intentId: String(entryIntent._id),
    symbol: config.optionSymbol,
    side: 'BUY',
    avgFillPrice: config.entryPrice,
    limitPrice: config.entryLimit,
    submittedAt: new Date(start.getTime() + 120_000),
  });
  await createBrokerOrder(mods, sessionId, `${config.underlying}-exit`, {
    brokerOrderId: `${config.underlying}-exit-broker`,
    clientOrderId: `${config.underlying}-exit-client`,
    intentId: String(exitIntent._id),
    symbol: config.optionSymbol,
    side: 'SELL',
    avgFillPrice: config.exitPrice,
    limitPrice: config.exitLimit,
    submittedAt: new Date(close.getTime() - 120_000),
  });
  const position = await mods.AutomationPositionModel.create({
    source: 'AUTOMATION',
    automationSessionId: sessionId,
    strategyVersionId,
    universeEvaluationId: null,
    tradeCandidateId: String(candidate._id),
    contractSelectionId: String(selection._id),
    riskDecisionId: String(risk._id),
    underlying: config.underlying,
    optionSymbol: config.optionSymbol,
    direction: config.direction,
    entryIntentId: String(entryIntent._id),
    entryBrokerOrderId: `${config.underlying}-entry-broker`,
    entryClientOrderId: `${config.underlying}-entry-client`,
    orderedQuantity: 1,
    filledQty: 1,
    avgEntryPrice: config.entryPrice,
    entryFees: 0,
    openedAt: new Date(start.getTime() + 180_000),
    status: 'CLOSED',
    maxFavorableExcursion: config.mfe,
    maxAdverseExcursion: config.mae,
    exitReason: config.exitReason,
    exitIntentId: String(exitIntent._id),
    exitBrokerOrderId: `${config.underlying}-exit-broker`,
    avgExitPrice: config.exitPrice,
    exitFees: 0,
    realizedPnl: config.realizedPnl,
    returnPct: config.returnPct,
    closedAt: config.closedAt ?? close,
    riskCounted: true,
    exitAttemptCount: config.exitAttemptCount ?? 1,
    exitSubmittedAt: new Date(close.getTime() - 120_000),
    exitFilledQty: 1,
    overnightRecoveryRequired: config.exitReason === 'OVERNIGHT_RECOVERY',
    overnightDetectedAt: config.exitReason === 'OVERNIGHT_RECOVERY' ? new Date('2026-07-17T13:30:00.000Z') : null,
    overnightReason: config.exitReason === 'OVERNIGHT_RECOVERY' ? 'CARRIED_PAST_FLATTEN_WINDOW' : null,
    recoveryExitEligibleAt: null,
    recoveryExitSubmittedAt: config.exitReason === 'OVERNIGHT_RECOVERY' ? new Date(close.getTime() - 120_000) : null,
  });
  await mods.UniverseEvaluationModel.create({
    automationSessionId: sessionId,
    strategyVersionId,
    evaluatedAt: new Date(start.getTime() + 30_000),
    universeSource: 'WATCHLIST',
    configuredSymbols: ['XLE', 'SPY'],
    invalidSymbols: [],
    eligibleSymbols: ['XLE', 'SPY'],
    symbolResults: [
      {
        symbol: config.underlying,
        eligible: true,
        reasonCodes: [],
        symbolScore: 82,
        barCount: 78,
        closedBarTimestamp: start,
        liquidity: { relativeVolume: 1.4 },
        candidateId: String(candidate._id),
        candidateStatus: 'RISK_APPROVED',
        direction: config.direction,
      },
    ],
    ranking: [
      {
        rank: config.rank,
        symbol: config.underlying,
        direction: config.direction,
        contractSymbol: config.optionSymbol,
        opportunityScore: 90 - config.rank,
        contractScore: selected.score,
        symbolScore: 82,
        spreadPct: selected.spreadPct,
        openInterest: selected.openInterest,
        volume: selected.volume,
        candidateId: String(candidate._id),
      },
    ],
    selectedSymbol: config.underlying,
    selectedContractSymbol: config.optionSymbol,
    selectedCandidateId: String(candidate._id),
    riskApproved: true,
    riskReasonCodes: [],
    orderIntentId: String(entryIntent._id),
    outcome: 'INTENT_CREATED',
    reasonCodes: [],
    marketClockDecision: { state: 'CLOSED', canEnter: false, decidedAt: close.toISOString(), reasons: ['market closed'] },
  });
  await mods.AutomationEventModel.create([
    {
      timestamp: new Date(start.getTime() + 30_000),
      service: 'automation-options-flow',
      event: 'SIGNAL_FOUND',
      severity: 'info',
      automationSessionId: sessionId,
      intentId: null,
      brokerOrderId: null,
      symbol: config.underlying,
      payload: { direction: config.direction },
    },
    {
      timestamp: config.closedAt ?? close,
      service: 'automation-position',
      event: 'POSITION_CLOSED',
      severity: config.realizedPnl < 0 ? 'warning' : 'info',
      automationSessionId: sessionId,
      intentId: String(exitIntent._id),
      brokerOrderId: `${config.underlying}-exit-broker`,
      symbol: config.optionSymbol,
      payload: { exitReason: config.exitReason, realizedPnl: config.realizedPnl },
    },
  ]);
  return position;
}

async function seedTradeReportEvidence(mods) {
  const session = await createAutomationSession(mods);
  const sessionId = String(session._id);
  const xle = await seedClosedTrade(mods, sessionId, {
    underlying: 'XLE',
    optionSymbol: 'XLE260717C00090000',
    direction: 'BULLISH',
    underlyingPrice: 89.5,
    entryPrice: 1.69,
    exitPrice: 1.71,
    entryLimit: 1.7,
    exitLimit: 1.7,
    realizedPnl: 2,
    returnPct: 0.0118,
    exitReason: 'END_OF_DAY',
    confidence: 0.78,
    flowScore: 0.7,
    momentumScore: 0.65,
    trendScore: 0.72,
    mfe: 9,
    mae: -4,
    rank: 1,
  });
  const spy = await seedClosedTrade(mods, sessionId, {
    underlying: 'SPY',
    optionSymbol: 'SPY260717P00500000',
    direction: 'BEARISH',
    underlyingPrice: 500.25,
    entryPrice: 6.12,
    exitPrice: 5.54,
    entryLimit: 6.1,
    exitLimit: 5.6,
    realizedPnl: -58,
    returnPct: -0.0948,
    exitReason: 'OVERNIGHT_RECOVERY',
    confidence: 0.69,
    flowScore: 0.58,
    momentumScore: 0.61,
    trendScore: 0.55,
    mfe: 20,
    mae: -72,
    rank: 2,
    exitAttemptCount: 2,
    closedAt: new Date('2026-07-17T13:36:00.000Z'),
    contractOverrides: { bid: 6.05, ask: 6.25, mid: 6.15, spreadDollars: 0.2, spreadPct: 0.0325, delta: -0.42 },
  });
  await mods.AutomationEventModel.create({
    timestamp: close,
    service: 'reconciliation',
    event: 'RECONCILIATION_COMPLETE',
    severity: 'info',
    automationSessionId: sessionId,
    intentId: null,
    brokerOrderId: null,
    symbol: null,
    payload: { status: 'CLEAN' },
  });
  const captured = await mods.captureSessionProgress({ tradingDate, automationSessionId: sessionId });
  await mods.finalizeTradingSession(captured.sessionId, { allowHistoricalBackfill: true });
  return { automationSessionId: sessionId, xleTradeId: String(xle._id), spyTradeId: String(spy._id), sessionId: captured.sessionId };
}

test('Trade Intelligence Reports', async (t) => {
  await startTestMongo();
  const mods = await loadTradeReportDist();
  await resetDb(mods);
  t.after(async () => stopTestMongo());

  await t.test('generates one immutable report per closed trade from persisted evidence', async () => {
    const seeded = await seedTradeReportEvidence(mods);
    const result = await mods.generateTradeReportForTrade(seeded.xleTradeId);

    assert.equal(result.idempotent, false);
    assert.equal(result.report.tradeId, seeded.xleTradeId);
    assert.equal(result.report.sessionId, seeded.sessionId);
    assert.equal(result.report.identity.underlying, 'XLE');
    assert.equal(result.report.performance.realizedPnl, 2);
    assert.equal(result.report.lifecycle.exitReason, 'END_OF_DAY');
    assert.ok(result.report.timeline.some((event) => event.label === 'Signal evaluated'));
    assert.ok(result.report.timeline.some((event) => event.label === 'Position closed'));
    assert.notEqual(result.report.grades.overall.grade, 'UNAVAILABLE');
    assert.ok(result.report.evidence.brokerOrderIds.length >= 2);

    const duplicate = await mods.generateTradeReportForTrade(seeded.xleTradeId);
    assert.equal(duplicate.idempotent, true);
    assert.equal(duplicate.report.reportId, result.report.reportId);

    result.report.performance.realizedPnl = 999;
    await assert.rejects(() => result.report.save(), /GENERATED_TRADE_REPORT_IMMUTABLE/);
  });

  await t.test('backfills all July 16 reports from finalized session evidence', async () => {
    const results = await mods.backfillTradeReportsForDate(tradingDate);
    assert.equal(results.length, 2);
    const reports = results.map((result) => result.report);
    const xle = reports.find((report) => report.identity.underlying === 'XLE');
    const spy = reports.find((report) => report.identity.underlying === 'SPY');
    assert.equal(xle.performance.realizedPnl, 2);
    assert.equal(xle.lifecycle.exitReason, 'END_OF_DAY');
    assert.equal(spy.performance.realizedPnl, -58);
    assert.equal(spy.lifecycle.exitReason, 'OVERNIGHT_RECOVERY');
    assert.ok(spy.lessons.weaknesses.some((item) => item.includes('overnight recovery')));
  });

  await t.test('grades execution and records unavailable market evidence honestly', async () => {
    const spy = await mods.TradeReportModel.findOne({ 'identity.underlying': 'SPY' });
    assert.ok(spy);
    assert.ok(spy.grades.exit.score < 80);
    assert.ok(spy.grades.risk.reasons.some((reason) => reason.includes('overnight recovery')));
    assert.ok(spy.warnings.some((item) => item.code === 'SPY_SECTOR_VIX_CONTEXT_NOT_CAPTURED'));
    assert.equal(spy.greeks.theta, null);
    assert.equal(spy.marketContext.vixContext, null);
  });

  await t.test('read APIs expose reports and generation fails closed without admin token', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/intelligence', mods.intelligenceRouter);
    const server = await new Promise((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });
    try {
      const address = server.address();
      const base = `http://127.0.0.1:${address.port}`;
      const list = await fetch(`${base}/api/intelligence/trades`);
      assert.equal(list.status, 200);
      const listBody = await list.json();
      assert.equal(listBody.reports.length, 2);

      const first = listBody.reports[0];
      const detail = await fetch(`${base}/api/intelligence/trades/${encodeURIComponent(first.reportId)}`);
      assert.equal(detail.status, 200);
      assert.equal((await detail.json()).report.reportId, first.reportId);

      const bySession = await fetch(`${base}/api/intelligence/trades/session/${encodeURIComponent(first.sessionId)}`);
      assert.equal(bySession.status, 200);
      assert.equal((await bySession.json()).reports.length, 2);

      const missing = await fetch(`${base}/api/intelligence/trades/not-real`);
      assert.equal(missing.status, 404);

      const blocked = await fetch(`${base}/api/intelligence/trades/${first.tradeId}/generate`, { method: 'POST' });
      assert.equal(blocked.status, 403);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
