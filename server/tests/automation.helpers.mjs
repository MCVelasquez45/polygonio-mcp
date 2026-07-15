// Shared helpers for automation Phase 2A tests.
// Tests run against the compiled dist/ output (same convention as
// tests/massive.*.test.mjs) with an in-memory MongoDB and the deterministic
// mock broker — never the real Alpaca API, never the network.

// Keep Massive traffic off the network: point at an unroutable local port with
// a tiny timeout BEFORE any dist module loads.
process.env.MASSIVE_BASE_URL = 'http://127.0.0.1:9';
process.env.MASSIVE_TIMEOUT_MS = '150';
process.env.MASSIVE_MAX_RETRIES = '0';
process.env.AUTOMATION_BROKER_TIMEOUT_MS = '500';
process.env.AUTOMATION_CLOCK_TTL_MS = '0'; // no clock-decision caching in tests

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongod = null;

export async function startTestMongo() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'automation-test' });
  // Unique constraints are load-bearing; make index builds deterministic in
  // tests exactly like initializeAutomation does in production.
  const { ensureAutomationIndexes } = await import(
    '../dist/features/automation/services/sessionRecovery.service.js'
  );
  await ensureAutomationIndexes();
  return mongod;
}

export async function stopTestMongo() {
  await mongoose.disconnect().catch(() => undefined);
  if (mongod) {
    await mongod.stop();
    mongod = null;
  }
}

export async function dropAutomationCollections() {
  const db = mongoose.connection?.db;
  if (!db) return;
  const collections = await db.listCollections().toArray();
  for (const { name } of collections) {
    if (name.startsWith('automation_')) {
      await db.collection(name).deleteMany({});
    }
  }
}

export async function loadDist() {
  const [
    sessionModel,
    intentModel,
    brokerOrderModel,
    intentService,
    reconciliation,
    recovery,
    marketClock,
    audit,
    health,
    mockBroker,
    alpacaAdapter,
    errors,
    // Phase 2B
    config2b,
    candidateModel,
    selectionModel,
    riskModel,
    indicators2b,
    marketData2b,
    strategy2b,
    selector2b,
    risk2b,
    sizing2b,
    reset2b,
    processor2b,
    // Phase 2.6
    universeModel26,
    universeService26,
    universeProcessor26,
    // Phase 2C
    config2c,
    signal2c,
    positionModel2c,
    leaseModel2c,
    riskAccounting2c,
    marketSession2c,
    exitEngine2c,
    positionManager2c,
    entryExec2c,
    scheduler2c,
    portfolioSvc2c,
    schedulerCtrl2c,
    orderSubmission2c,
    brokerIngestion2c,
    orderReconciliation2c,
    monitorCtrl2c,
    // Sprint 2D — options-native flow evaluator + baseline snapshot
    optionsFlowEval2d,
    optionsFlowSnapshotModel2d,
    // Sprint 2E — watchlist-driven automation universe
    watchlistModel2e,
    watchlistService2e,
    watchlistProvider2e,
  ] = await Promise.all([
    import('../dist/features/automation/models/automationSession.model.js'),
    import('../dist/features/automation/models/orderIntent.model.js'),
    import('../dist/features/automation/models/brokerOrder.model.js'),
    import('../dist/features/automation/services/orderIntent.service.js'),
    import('../dist/features/automation/services/reconciliation.service.js'),
    import('../dist/features/automation/services/sessionRecovery.service.js'),
    import('../dist/features/automation/services/marketClock.service.js'),
    import('../dist/features/automation/services/automationAudit.service.js'),
    import('../dist/features/automation/services/automationHealth.service.js'),
    import('../dist/features/automation/services/mockPaperBrokerAdapter.service.js'),
    import('../dist/features/automation/services/alpacaPaperBrokerAdapter.service.js'),
    import('../dist/features/automation/automation.errors.js'),
    import('../dist/features/automation/automation.config.js'),
    import('../dist/features/automation/models/tradeCandidate.model.js'),
    import('../dist/features/automation/models/contractSelection.model.js'),
    import('../dist/features/automation/models/riskDecision.model.js'),
    import('../dist/features/automation/services/indicatorAdapter.service.js'),
    import('../dist/features/automation/services/automationMarketData.service.js'),
    import('../dist/features/automation/services/strategyEvaluator.service.js'),
    import('../dist/features/automation/services/optionSelector.service.js'),
    import('../dist/features/automation/services/riskEngine.service.js'),
    import('../dist/features/automation/services/positionSizing.service.js'),
    import('../dist/features/automation/services/sessionDailyReset.service.js'),
    import('../dist/features/automation/services/closedBarProcessor.service.js'),
    import('../dist/features/automation/models/universeEvaluation.model.js'),
    import('../dist/features/automation/services/marketUniverse.service.js'),
    import('../dist/features/automation/services/universeTickProcessor.service.js'),
    import('../dist/features/automation/automation.config.js'),
    import('../dist/features/automation/services/optionsFlowSignal.service.js'),
    import('../dist/features/automation/models/automationPosition.model.js'),
    import('../dist/features/automation/models/schedulerLease.model.js'),
    import('../dist/features/automation/services/riskAccounting.service.js'),
    import('../dist/features/automation/services/marketSession.service.js'),
    import('../dist/features/automation/services/exitEngine.service.js'),
    import('../dist/features/automation/services/positionManager.service.js'),
    import('../dist/features/automation/services/entryExecution.service.js'),
    import('../dist/features/automation/automation.scheduler.js'),
    import('../dist/features/portfolio/portfolio.service.js'),
    import('../dist/features/automation/services/schedulerController.service.js'),
    import('../dist/features/automation/services/orderSubmission.service.js'),
    import('../dist/features/automation/services/brokerUpdateIngestion.service.js'),
    import('../dist/features/automation/services/orderReconciliation.service.js'),
    import('../dist/features/automation/services/monitorController.service.js'),
    import('../dist/features/automation/services/optionsFlowUniverseEvaluator.service.js'),
    import('../dist/features/automation/models/optionsFlowSnapshot.model.js'),
    import('../dist/features/watchlist/watchlist.model.js'),
    import('../dist/features/watchlist/watchlist.service.js'),
    import('../dist/features/watchlist/automationUniverseProvider.service.js'),
  ]);
  return {
    ...sessionModel,
    ...intentModel,
    ...brokerOrderModel,
    ...intentService,
    ...reconciliation,
    ...recovery,
    ...marketClock,
    ...audit,
    ...health,
    ...mockBroker,
    ...alpacaAdapter,
    ...errors,
    ...config2b,
    ...candidateModel,
    ...selectionModel,
    ...riskModel,
    ...indicators2b,
    ...marketData2b,
    ...strategy2b,
    ...selector2b,
    ...risk2b,
    ...sizing2b,
    ...reset2b,
    ...processor2b,
    ...universeModel26,
    ...universeService26,
    ...universeProcessor26,
    ...config2c,
    ...signal2c,
    ...positionModel2c,
    ...leaseModel2c,
    ...riskAccounting2c,
    ...marketSession2c,
    ...exitEngine2c,
    ...positionManager2c,
    ...entryExec2c,
    ...scheduler2c,
    ...portfolioSvc2c,
    ...schedulerCtrl2c,
    ...orderSubmission2c,
    ...brokerIngestion2c,
    ...orderReconciliation2c,
    ...monitorCtrl2c,
    ...optionsFlowEval2d,
    ...optionsFlowSnapshotModel2d,
    ...watchlistModel2e,
    ...watchlistService2e,
    ...watchlistProvider2e,
  };
}

export async function createReadySession(mods, overrides = {}) {
  return mods.AutomationSessionModel.create({
    mode: 'paper',
    strategyVersionId: overrides.strategyVersionId ?? 'sv-test-1',
    underlying: overrides.underlying ?? 'SPY',
    status: overrides.status ?? 'READY',
    healthStatus: 'HEALTHY',
    reconciliationStatus: 'PENDING',
    ...overrides,
  });
}

export function baseIntentInput(sessionId, overrides = {}) {
  return {
    automationSessionId: String(sessionId),
    strategyVersionId: 'sv-test-1',
    underlying: 'SPY',
    signalDirection: 'BUY',
    closedBarTimestamp: '2026-07-10T14:35:00.000Z',
    intentType: 'ENTRY',
    optionSymbol: 'SPY260821C00450000',
    quantity: 2,
    orderType: 'limit',
    limitPrice: 5.2,
    timeInForce: 'day',
    ...overrides,
  };
}
