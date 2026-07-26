import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { startTestMongo, stopTestMongo } from './automation.helpers.mjs';

async function loadLifecycleDist() {
  const [
    sessionModel,
    intentModel,
    candidateModel,
    positionModel,
    lifecycleModel,
    lifecycleService,
    monitorService,
    config,
  ] = await Promise.all([
    import('../dist/features/automation/models/automationSession.model.js'),
    import('../dist/features/automation/models/orderIntent.model.js'),
    import('../dist/features/automation/models/tradeCandidate.model.js'),
    import('../dist/features/automation/models/automationPosition.model.js'),
    import('../dist/features/tradeLifecycle/storage/tradeLifecycle.model.js'),
    import('../dist/features/tradeLifecycle/positionManager/lifecycleOwner.service.js'),
    import('../dist/features/tradeLifecycle/monitor/lifecycleMonitor.service.js'),
    import('../dist/features/tradeLifecycle/types/config.js'),
  ]);
  return {
    ...sessionModel,
    ...intentModel,
    ...candidateModel,
    ...positionModel,
    ...lifecycleModel,
    ...lifecycleService,
    ...monitorService,
    ...config,
  };
}

async function resetDb() {
  const db = mongoose.connection?.db;
  const collections = await db.listCollections().toArray();
  for (const { name } of collections) await db.collection(name).deleteMany({});
}

test.before(async () => {
  await startTestMongo();
});

test.after(async () => {
  await stopTestMongo();
});

test('trade lifecycle records every intermediate state for an already-open automation position', async () => {
  const mods = await loadLifecycleDist();
  await resetDb();

  const session = await mods.AutomationSessionModel.create({
    mode: 'paper',
    strategyVersionId: 'sv-lifecycle',
    underlying: 'SPY',
    status: 'READY',
    healthStatus: 'HEALTHY',
    reconciliationStatus: 'CLEAN',
  });
  const candidate = await mods.TradeCandidateModel.create({
    automationSessionId: String(session._id),
    strategyVersionId: 'sv-lifecycle',
    underlying: 'SPY',
    barTimestamp: new Date('2026-07-24T14:35:00.000Z'),
    signalDirection: 'BULLISH',
    status: 'RISK_APPROVED',
    reasonCodes: [],
    strategyConfigSnapshot: {},
    conditions: { confidence: 0.82, trend: 'UP', regime: 'REGULAR_SESSION' },
  });
  const intent = await mods.OrderIntentModel.create({
    automationSessionId: String(session._id),
    strategyVersionId: 'sv-lifecycle',
    underlying: 'SPY',
    optionSymbol: 'SPY260821C00450000',
    intentType: 'ENTRY',
    direction: 'BUY',
    quantity: 1,
    orderType: 'limit',
    limitPrice: 5,
    timeInForce: 'day',
    status: 'SUBMITTED',
    idempotencyKey: 'tl-entry-key',
    clientOrderId: 'at2a-tl-entry',
    idempotencyInputs: {
      automationSessionId: String(session._id),
      strategyVersionId: 'sv-lifecycle',
      underlying: 'SPY',
      signalDirection: 'BUY',
      closedBarTimestamp: '2026-07-24T14:35:00.000Z',
      intentType: 'ENTRY',
      idempotencyScope: null,
    },
    brokerOrderId: 'broker-entry',
    submittedAt: new Date('2026-07-24T14:36:00.000Z'),
  });
  const position = await mods.AutomationPositionModel.create({
    source: 'AUTOMATION',
    automationSessionId: String(session._id),
    strategyVersionId: 'sv-lifecycle',
    tradeCandidateId: String(candidate._id),
    riskDecisionId: null,
    underlying: 'SPY',
    optionSymbol: 'SPY260821C00450000',
    direction: 'BULLISH',
    entryIntentId: String(intent._id),
    entryBrokerOrderId: 'broker-entry',
    entryClientOrderId: 'at2a-tl-entry',
    status: 'OPEN',
    orderedQuantity: 1,
    filledQty: 1,
    avgEntryPrice: 5,
    currentMark: 5.4,
    unrealizedPnl: 40,
    openedAt: new Date('2026-07-24T14:37:00.000Z'),
  });

  const result = await mods.syncTradeLifecycle(new Date('2026-07-24T15:00:00.000Z'));
  assert.equal(result.synced, 1);
  const record = await mods.TradeLifecycleModel.findOne({ tradeId: String(position._id) }).lean();
  assert.equal(record.state, 'MONITORING');
  assert.equal(record.confidence.entry, 82);
  const transitions = await mods.TradeLifecycleJournalModel.find({ tradeId: String(position._id), eventType: 'STATE_TRANSITION' })
    .sort({ at: 1 })
    .lean();
  assert.deepEqual(
    transitions.map(event => event.state),
    ['PENDING_ENTRY', 'ENTRY_SUBMITTED', 'ENTRY_FILLED', 'MONITORING']
  );
});

test('exit recommendation requires more than P/L alone', async () => {
  const mods = await loadLifecycleDist();
  const input = {
    tradeId: 't1',
    symbol: 'SPY260821C00450000',
    state: 'MONITORING',
    entryConfidence: 90,
    currentConfidence: 90,
    currentProfit: 0,
    currentLoss: -250,
    returnPct: -40,
    spreadPct: 5,
    liquidityScore: null,
    daysToExpiration: 10,
    timeHeldMinutes: 30,
    eventRisk: null,
    originalThesis: 'UP',
    updatedThesis: 'UP',
    strategyChanged: false,
    riskChanged: false,
    marketRegime: 'OPEN',
    volatility: null,
  };
  const pnlOnly = mods.evaluateLifecycleMonitoring(input);
  assert.notEqual(pnlOnly.action, 'EXIT');

  const thesisAndRisk = mods.evaluateLifecycleMonitoring({
    ...input,
    riskChanged: true,
  });
  assert.equal(thesisAndRisk.action, 'EXIT');
  assert.match(thesisAndRisk.exitReason, /risk profile changed/);
});

test('trade lifecycle feature flags default to paper-safe settings', async () => {
  const mods = await loadLifecycleDist();
  delete process.env.AUTONOMOUS_ENTRY_ENABLED;
  delete process.env.AUTONOMOUS_EXIT_ENABLED;
  delete process.env.TRADE_LIFECYCLE_AUTOSTART;
  const flags = mods.getTradeLifecycleFlags();
  assert.equal(flags.TRADE_LIFECYCLE_ENABLED, true);
  assert.equal(flags.TRADE_LIFECYCLE_AUTOSTART, false);
  assert.equal(flags.AUTONOMOUS_MONITORING, true);
  assert.equal(flags.AUTONOMOUS_ENTRY_ENABLED, false);
  assert.equal(flags.AUTONOMOUS_EXIT_ENABLED, false);
});
