import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { startTestMongo, stopTestMongo } from './automation.helpers.mjs';

const tradingDate = '2026-07-16';
const start = new Date('2026-07-16T14:00:00.000Z');
const close = new Date('2026-07-16T21:05:00.000Z');

async function loadIntelligenceDist() {
  const [
    sessionModel,
    universeModel,
    candidateModel,
    riskModel,
    intentModel,
    brokerOrderModel,
    positionModel,
    eventModel,
    intelligenceModel,
    intelligenceService,
    intelligenceRoutes,
  ] = await Promise.all([
    import('../dist/features/automation/models/automationSession.model.js'),
    import('../dist/features/automation/models/universeEvaluation.model.js'),
    import('../dist/features/automation/models/tradeCandidate.model.js'),
    import('../dist/features/automation/models/riskDecision.model.js'),
    import('../dist/features/automation/models/orderIntent.model.js'),
    import('../dist/features/automation/models/brokerOrder.model.js'),
    import('../dist/features/automation/models/automationPosition.model.js'),
    import('../dist/features/automation/models/automationEvent.model.js'),
    import('../dist/features/intelligence/models/tradingSession.model.js'),
    import('../dist/features/intelligence/services/tradingSessionCapture.service.js'),
    import('../dist/features/intelligence/intelligence.routes.js'),
  ]);
  return {
    ...sessionModel,
    ...universeModel,
    ...candidateModel,
    ...riskModel,
    ...intentModel,
    ...brokerOrderModel,
    ...positionModel,
    ...eventModel,
    ...intelligenceModel,
    ...intelligenceService,
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
}

async function createAutomationSession(mods, overrides = {}) {
  return mods.AutomationSessionModel.create({
    mode: 'paper',
    strategyVersionId: 'sv-intel-1',
    underlying: null,
    universe: [],
    status: 'READY',
    healthStatus: 'HEALTHY',
    reconciliationStatus: 'CLEAN',
    startedAt: start,
    lastResetTradingDate: tradingDate,
    emergencyStop: { active: false, reason: null, at: null },
    ...overrides,
  });
}

function intentDoc(sessionId, index, overrides = {}) {
  return {
    automationSessionId: sessionId,
    strategyVersionId: 'sv-intel-1',
    underlying: overrides.underlying ?? 'SPY',
    optionSymbol: overrides.optionSymbol ?? `SPY260717P0050000${index}`,
    intentType: overrides.intentType ?? 'ENTRY',
    direction: overrides.direction ?? 'BUY',
    quantity: 1,
    orderType: 'limit',
    limitPrice: overrides.limitPrice ?? 1.25,
    timeInForce: 'day',
    status: overrides.status ?? 'COMPLETED',
    idempotencyKey: `intel-key-${sessionId}-${index}`,
    clientOrderId: `at2a-intel-${index}`,
    idempotencyInputs: {
      automationSessionId: sessionId,
      strategyVersionId: 'sv-intel-1',
      underlying: overrides.underlying ?? 'SPY',
      signalDirection: overrides.direction ?? 'BUY',
      closedBarTimestamp: start.toISOString(),
      intentType: overrides.intentType ?? 'ENTRY',
      idempotencyScope: null,
    },
    brokerOrderId: `bo-${index}`,
    submittedAt: start,
    completedAt: close,
    ...overrides,
  };
}

async function seedVerifiedSessionEvidence(mods) {
  const session = await createAutomationSession(mods);
  const sessionId = String(session._id);
  const candidate = await mods.TradeCandidateModel.create({
    automationSessionId: sessionId,
    strategyVersionId: 'sv-intel-1',
    underlying: 'SPY',
    barTimestamp: new Date('2026-07-16T15:00:00.000Z'),
    signalDirection: 'BEARISH',
    status: 'RISK_APPROVED',
    reasonCodes: [],
    strategyConfigSnapshot: {},
  });
  await mods.UniverseEvaluationModel.create({
    automationSessionId: sessionId,
    strategyVersionId: 'sv-intel-1',
    evaluatedAt: new Date('2026-07-16T20:55:00.000Z'),
    universeSource: 'WATCHLIST',
    configuredSymbols: ['XLE', 'SPY'],
    invalidSymbols: [],
    eligibleSymbols: ['XLE', 'SPY'],
    symbolResults: [
      { symbol: 'XLE', eligible: true, reasonCodes: [], candidateId: String(candidate._id), candidateStatus: 'RISK_APPROVED' },
      { symbol: 'SPY', eligible: true, reasonCodes: [], candidateId: String(candidate._id), candidateStatus: 'RISK_APPROVED' },
    ],
    ranking: [],
    selectedSymbol: 'SPY',
    selectedContractSymbol: 'SPY260717P00500000',
    selectedCandidateId: String(candidate._id),
    riskApproved: true,
    riskReasonCodes: [],
    orderIntentId: null,
    outcome: 'INTENT_CREATED',
    reasonCodes: [],
    marketClockDecision: { state: 'CLOSED', canEnter: false, decidedAt: close.toISOString(), reasons: ['market closed'] },
  });
  await mods.RiskDecisionModel.create({
    tradeCandidateId: String(candidate._id),
    automationSessionId: sessionId,
    approved: true,
    reasonCodes: [],
    checks: [{ name: 'position-size', passed: true, detail: 'ok' }],
    decidedAt: start,
  });
  await mods.OrderIntentModel.create([
    intentDoc(sessionId, 1, { underlying: 'XLE', optionSymbol: 'XLE260717C00090000' }),
    intentDoc(sessionId, 2, { underlying: 'SPY', optionSymbol: 'SPY260717P00500000' }),
  ]);
  await mods.BrokerOrderModel.create([
    {
      brokerOrderId: 'bo-1',
      clientOrderId: 'at2a-intel-1',
      intentId: null,
      automationSessionId: sessionId,
      symbol: 'XLE260717C00090000',
      side: 'BUY',
      qty: 1,
      filledQty: 1,
      avgFillPrice: 1.69,
      status: 'FILLED',
      rawStatus: 'filled',
      orderType: 'limit',
      limitPrice: 1.69,
      timeInForce: 'day',
      lastSource: 'reconciliation',
      submittedAt: start,
      lastBrokerUpdateAt: close,
      statusHistory: [],
    },
    {
      brokerOrderId: 'bo-2',
      clientOrderId: 'at2a-intel-2',
      intentId: null,
      automationSessionId: sessionId,
      symbol: 'SPY260717P00500000',
      side: 'BUY',
      qty: 1,
      filledQty: 1,
      avgFillPrice: 6.12,
      status: 'FILLED',
      rawStatus: 'filled',
      orderType: 'limit',
      limitPrice: 6.12,
      timeInForce: 'day',
      lastSource: 'reconciliation',
      submittedAt: start,
      lastBrokerUpdateAt: close,
      statusHistory: [],
    },
  ]);
  await mods.AutomationPositionModel.create([
    {
      source: 'AUTOMATION',
      automationSessionId: sessionId,
      strategyVersionId: 'sv-intel-1',
      underlying: 'XLE',
      optionSymbol: 'XLE260717C00090000',
      direction: 'BULLISH',
      entryIntentId: 'intent-xle',
      entryClientOrderId: 'at2a-intel-1',
      filledQty: 1,
      avgEntryPrice: 1.69,
      openedAt: start,
      status: 'CLOSED',
      exitReason: 'END_OF_DAY',
      avgExitPrice: 1.71,
      realizedPnl: 2,
      returnPct: 0.0118,
      closedAt: close,
    },
    {
      source: 'AUTOMATION',
      automationSessionId: sessionId,
      strategyVersionId: 'sv-intel-1',
      underlying: 'SPY',
      optionSymbol: 'SPY260717P00500000',
      direction: 'BEARISH',
      entryIntentId: 'intent-spy',
      entryClientOrderId: 'at2a-intel-2',
      filledQty: 1,
      avgEntryPrice: 6.12,
      openedAt: start,
      status: 'CLOSED',
      exitReason: 'OVERNIGHT_RECOVERY',
      avgExitPrice: 5.54,
      realizedPnl: -58,
      returnPct: -0.0948,
      closedAt: close,
    },
  ]);
  await mods.AutomationEventModel.create({
    timestamp: close,
    service: 'reconciliation',
    event: 'RECONCILIATION_COMPLETE',
    severity: 'info',
    automationSessionId: sessionId,
    payload: { status: 'CLEAN' },
  });
  return { session, sessionId };
}

test('Trading Session Capture', async (t) => {
  await startTestMongo();
  const mods = await loadIntelligenceDist();
  await resetDb(mods);
  t.after(async () => stopTestMongo());

  await t.test('creates idempotent sessions and captures summaries from persisted V1 evidence', async () => {
    const { sessionId } = await seedVerifiedSessionEvidence(mods);
    const first = await mods.getOrCreateTradingSession({ tradingDate, automationSessionId: sessionId });
    const duplicate = await mods.getOrCreateTradingSession({ tradingDate, automationSessionId: sessionId });
    assert.equal(first.sessionId, duplicate.sessionId);

    const captured = await mods.captureSessionProgress({ tradingDate, automationSessionId: sessionId });
    assert.equal(captured.tradeSummary.tradesOpened, 2);
    assert.equal(captured.tradeSummary.tradesClosed, 2);
    assert.equal(captured.tradeSummary.winningTrades, 1);
    assert.equal(captured.tradeSummary.losingTrades, 1);
    assert.equal(captured.tradeSummary.realizedPnl, -56);
    assert.equal(captured.evaluationSummary.windowsEvaluated, 1);
    assert.equal(captured.evaluationSummary.symbolsEvaluated, 2);
    assert.equal(captured.orderSummary.fills, 2);
    assert.ok(captured.references.positionIds.length >= 2);
    assert.ok(captured.warnings.some((item) => item.code === 'PORTFOLIO_SNAPSHOT_NOT_CAPTURED'));
  });

  await t.test('finalizes deterministically and prevents silent mutation', async () => {
    const session = await mods.getLatestTradingSession();
    const result = await mods.finalizeTradingSession(session.sessionId);
    assert.equal(result.finalized, true);
    assert.equal(result.session.status, 'FINALIZED');

    result.session.marketStatus = 'OPEN';
    await assert.rejects(() => result.session.save(), /FINALIZED_TRADING_SESSION_IMMUTABLE/);

    const again = await mods.finalizeTradingSession(session.sessionId);
    assert.equal(again.idempotent, true);
    assert.equal(again.session.tradeSummary.realizedPnl, -56);

    const backfilled = await mods.backfillTradingSession(tradingDate);
    assert.equal(backfilled.finalized, true);
    assert.equal(backfilled.session.sessionId, session.sessionId);
    assert.equal(backfilled.session.tradeSummary.realizedPnl, -56);
  });

  await t.test('handles no-trade sessions and missing provider metrics honestly', async () => {
    const noTrade = await createAutomationSession(mods, {
      startedAt: new Date('2026-07-17T14:00:00.000Z'),
      lastResetTradingDate: '2026-07-17',
    });
    const captured = await mods.captureSessionProgress({
      tradingDate: '2026-07-17',
      automationSessionId: String(noTrade._id),
    });
    assert.equal(captured.tradeSummary.tradesOpened, 0);
    assert.equal(captured.tradeSummary.tradesClosed, 0);
    assert.equal(captured.providerSummary.providerErrors, null);
    assert.ok(captured.warnings.some((item) => item.code === 'NO_EVALUATION_EVIDENCE'));
  });

  await t.test('blocks finalization while market evidence is open or reconciliation is unresolved', async () => {
    const openSession = await createAutomationSession(mods, {
      startedAt: new Date('2026-07-20T14:00:00.000Z'),
      lastResetTradingDate: '2026-07-20',
      reconciliationStatus: 'PENDING',
    });
    await mods.UniverseEvaluationModel.create({
      automationSessionId: String(openSession._id),
      strategyVersionId: 'sv-intel-1',
      evaluatedAt: new Date('2026-07-20T15:00:00.000Z'),
      universeSource: 'WATCHLIST',
      configuredSymbols: ['SPY'],
      invalidSymbols: [],
      eligibleSymbols: [],
      symbolResults: [],
      ranking: [],
      selectedSymbol: null,
      selectedContractSymbol: null,
      selectedCandidateId: null,
      riskApproved: null,
      riskReasonCodes: [],
      orderIntentId: null,
      outcome: 'NO_TRADE',
      reasonCodes: [],
      marketClockDecision: { state: 'OPEN', canEnter: true, decidedAt: new Date().toISOString(), reasons: [] },
    });
    const captured = await mods.captureSessionProgress({
      tradingDate: '2026-07-20',
      automationSessionId: String(openSession._id),
    });
    const result = await mods.finalizeTradingSession(captured.sessionId);
    assert.equal(result.finalized, false);
    assert.equal(result.session.status, 'FINALIZATION_FAILED');
    assert.ok(result.gate.reasons.some((reason) => reason.includes('market status is OPEN')));
    assert.ok(result.gate.reasons.some((reason) => reason.includes('reconciliation')));
  });

  await t.test('read APIs list sessions and admin endpoints fail closed without a token', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/intelligence', mods.intelligenceRouter);
    const server = await new Promise((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });
    try {
      const address = server.address();
      const base = `http://127.0.0.1:${address.port}`;
      const list = await fetch(`${base}/api/intelligence/sessions`);
      assert.equal(list.status, 200);
      assert.ok((await list.json()).sessions.length >= 1);

      const latest = await fetch(`${base}/api/intelligence/sessions/latest`);
      assert.equal(latest.status, 200);
      const latestBody = await latest.json();
      assert.ok(latestBody.session.sessionId);

      const byDate = await fetch(`${base}/api/intelligence/sessions/date/${tradingDate}`);
      assert.equal(byDate.status, 200);

      const malformed = await fetch(`${base}/api/intelligence/sessions/date/20260716`);
      assert.equal(malformed.status, 400);

      const missing = await fetch(`${base}/api/intelligence/sessions/not-real`);
      assert.equal(missing.status, 404);

      const blocked = await fetch(`${base}/api/intelligence/sessions/${latestBody.session.sessionId}/finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(blocked.status, 403);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
