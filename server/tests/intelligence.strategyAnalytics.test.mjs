import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { startTestMongo, stopTestMongo } from './automation.helpers.mjs';

const tradingDate = '2026-07-16';
const sessionId = 'paper:2026-07-16:analytics-test-session';
const start = new Date('2026-07-16T14:00:00.000Z');
const close = new Date('2026-07-16T21:05:00.000Z');

async function loadStrategyAnalyticsDist() {
  const [
    tradingSessionModel,
    tradeReportModel,
    dailyReportModel,
    decisionJournalModel,
    strategyAnalyticsModel,
    strategyAnalyticsService,
    intelligenceRoutes,
  ] = await Promise.all([
    import('../dist/features/intelligence/models/tradingSession.model.js'),
    import('../dist/features/intelligence/models/tradeReport.model.js'),
    import('../dist/features/intelligence/models/dailyReport.model.js'),
    import('../dist/features/intelligence/models/decisionJournal.model.js'),
    import('../dist/features/intelligence/models/strategyAnalytics.model.js'),
    import('../dist/features/intelligence/services/strategyAnalytics.service.js'),
    import('../dist/features/intelligence/intelligence.routes.js'),
  ]);
  return {
    ...tradingSessionModel,
    ...tradeReportModel,
    ...dailyReportModel,
    ...decisionJournalModel,
    ...strategyAnalyticsModel,
    ...strategyAnalyticsService,
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
  await mods.DailyReportModel.syncIndexes();
  await mods.DecisionJournalModel.syncIndexes();
  await mods.StrategyAnalyticsModel.syncIndexes();
}

function createTradeReport({
  reportId,
  tradeId,
  underlying,
  direction,
  strategy,
  exitReason,
  realizedPnl,
  confidence,
  flowScore,
  momentumScore,
  trendScore,
  riskScore,
  candidateRank,
  marketRegime,
  positionSize,
}) {
  return {
    reportId,
    tradeId,
    sessionId,
    automationSessionId: 'automation-session-analytics',
    status: 'GENERATED',
    environment: 'PAPER',
    tradingDate,
    identity: {
      underlying,
      optionSymbol: `${underlying}260717${direction === 'BULLISH' ? 'C' : 'P'}00090000`,
      direction,
      strategyVersionId: 'sv-analytics-v1',
      strategy,
      contractType: direction === 'BULLISH' ? 'call' : 'put',
      contractStrike: 90,
      contractExpiration: '2026-07-17',
    },
    lifecycle: {
      openedAt: start,
      closedAt: close,
      holdTimeMinutes: 375,
      exitReason,
      overnightRecoveryRequired: exitReason === 'OVERNIGHT_RECOVERY',
      manualReviewReason: null,
    },
    execution: {
      entryOrder: { brokerOrderId: `${tradeId}-entry` },
      exitOrder: { brokerOrderId: `${tradeId}-exit` },
      entryIntent: { intentId: `${tradeId}-entry-intent` },
      exitIntent: { intentId: `${tradeId}-exit-intent` },
      fillCount: 2,
      partialFillCount: 0,
      cancellationCount: 0,
      rejectionCount: 0,
      retryCount: 1,
      entrySlippage: 0,
      exitSlippage: 0,
      totalEstimatedSlippage: 0,
      fillQuality: 'At or better than limit evidence',
    },
    marketContext: {
      marketStatus: 'CLOSED',
      underlyingPriceAtSelection: 90,
      spyContext: null,
      sectorContext: null,
      vixContext: null,
      trend: direction === 'BEARISH' ? 'DOWN' : 'UP',
      marketRegime,
      liquidity: { spreadPct: 0.04, volume: 120, openInterest: 800 },
    },
    greeks: { delta: 0.48, theta: -0.03, gamma: 0.04, vega: 0.12, iv: 0.32 },
    signal: {
      confidence,
      flowScore,
      momentumScore,
      trendScore,
      riskScore,
      candidateRank,
      candidateStatus: 'RISK_APPROVED',
      riskApproved: true,
      riskReasonCodes: [],
      selectedContractScore: 88,
      selectedContractRank: 1,
    },
    performance: {
      entryPrice: direction === 'BULLISH' ? 1.69 : 6.12,
      exitPrice: direction === 'BULLISH' ? 1.71 : 5.54,
      contracts: 1,
      realizedPnl,
      returnPct: direction === 'BULLISH' ? 0.0118 : -0.0948,
      maxFavorableExcursion: direction === 'BULLISH' ? 9 : 7,
      maxAdverseExcursion: direction === 'BULLISH' ? -4 : -11,
      drawdown: direction === 'BULLISH' ? -4 : -11,
      fees: null,
    },
    grades: {
      entry: { grade: 'A', score: 92, reasons: ['Deterministic entry evidence'], unavailableInputs: [] },
      exit: { grade: 'B', score: 84, reasons: ['Deterministic exit evidence'], unavailableInputs: [] },
      risk: { grade: 'A', score: 90, reasons: ['Deterministic risk evidence'], unavailableInputs: [] },
      execution: { grade: 'A', score: 94, reasons: ['Deterministic execution evidence'], unavailableInputs: [] },
      market: { grade: 'B', score: 84, reasons: ['Deterministic market evidence'], unavailableInputs: [] },
      overall: { grade: 'A', score: 90, reasons: ['Deterministic overall evidence'], unavailableInputs: [] },
    },
    lessons: {
      strengths: ['Risk approval persisted before entry.'],
      weaknesses: realizedPnl < 0 ? ['Trade closed with negative realized P/L.'] : [],
      improvementSuggestions: [],
    },
    timeline: [
      { at: start, label: 'Position opened', source: 'TradeReport', sourceId: reportId, severity: 'info', details: null },
      { at: close, label: 'Position closed', source: 'TradeReport', sourceId: reportId, severity: realizedPnl < 0 ? 'warning' : 'info', details: null },
    ],
    evidence: {
      positionId: tradeId,
      tradingSessionId: sessionId,
      brokerOrderIds: [`${tradeId}-entry`, `${tradeId}-exit`],
      orderIntentIds: [`${tradeId}-entry-intent`, `${tradeId}-exit-intent`],
      riskDecisionId: `${tradeId}-risk`,
      tradeCandidateId: `${tradeId}-candidate`,
      contractSelectionId: `${tradeId}-selection`,
      universeEvaluationIds: [`${tradeId}-evaluation`],
      eventIds: [`${tradeId}-event`],
    },
    warnings: [],
    generation: {
      schemaVersion: 1,
      generatorVersion: 'trade-report-v1',
      generatedBy: 'server:intelligence:trade-report',
      sourceWindowStart: start,
      sourceWindowEnd: close,
      generatedAt: close,
      generatedFromPersistedEvidence: true,
    },
  };
}

async function seedEvidence(mods) {
  await mods.TradingSessionModel.create({
    sessionId,
    tradingDate,
    timezone: 'America/New_York',
    status: 'FINALIZED',
    environment: 'PAPER',
    marketStatus: 'CLOSED',
    startedAt: start,
    finalizedAt: close,
    automationSessionId: 'automation-session-analytics',
    watchlist: { symbols: ['XLE', 'SPY'], size: 2 },
    evaluationSummary: {
      windowsEvaluated: 4,
      symbolsEvaluated: 8,
      signalsGenerated: 2,
      noSignalCount: 5,
      dataRejectCount: 1,
      riskRejectCount: 1,
      approvedCount: 2,
    },
    tradeSummary: {
      tradesOpened: 2,
      tradesClosed: 2,
      winningTrades: 1,
      losingTrades: 1,
      breakevenTrades: 0,
      realizedPnl: -56,
      unrealizedPnlAtClose: null,
      totalPnl: -56,
    },
    orderSummary: {
      intentsCreated: 4,
      ordersSubmitted: 4,
      fills: 4,
      partialFills: 0,
      cancellations: 0,
      rejections: 0,
      manualReviewCount: 0,
    },
    portfolioSnapshot: null,
    providerSummary: {
      totalRequests: 24,
      cacheHits: 12,
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
      candidateIds: ['candidate-xle', 'candidate-spy'],
      riskDecisionIds: ['risk-xle', 'risk-spy'],
      orderIntentIds: ['intent-xle-entry', 'intent-xle-exit', 'intent-spy-entry', 'intent-spy-exit'],
      brokerOrderIds: ['broker-xle-entry', 'broker-xle-exit', 'broker-spy-entry', 'broker-spy-exit'],
      positionIds: ['position-xle', 'position-spy'],
      eventIds: ['event-xle', 'event-spy'],
      closedTradeIds: ['position-xle', 'position-spy'],
    },
    warnings: [],
    errors: [],
    generation: {
      schemaVersion: 1,
      generatorVersion: 'trading-session-capture-v1',
      generatedBy: 'server:intelligence:session-capture',
      sourceWindowStart: start,
      sourceWindowEnd: close,
      finalizedFromPersistedEvidence: true,
      lastAttemptAt: close,
      attemptCount: 1,
    },
  });

  await mods.DailyReportModel.create({
    reportId: 'daily:analytics:2026-07-16:paper',
    sessionId,
    tradingDate,
    environment: 'PAPER',
    status: 'GENERATED',
    executiveSummary: {
      overallGrade: 'B+',
      marketSummary: 'Deterministic market summary.',
      sessionSummary: 'Two trades were captured.',
      primaryLesson: 'Overnight exposure reduced performance.',
      bestDecision: 'Energy momentum trade.',
      worstDecision: 'Holding SPY overnight.',
      highlights: ['One winner and one loser were captured.'],
      keyFindings: ['Negative net P/L came from the bearish overnight trade.'],
    },
    tradingSummary: {
      watchlistSize: 2,
      symbolsEvaluated: 8,
      signalsGenerated: 2,
      signalsApproved: 2,
      signalsRejected: 0,
      riskRejects: 0,
      dataRejects: 0,
      tradesOpened: 2,
      tradesClosed: 2,
      wins: 1,
      losses: 1,
      breakeven: 0,
    },
    performance: {
      realizedPnl: -56,
      unrealizedPnl: null,
      netPnl: -56,
      averageWinner: 2,
      averageLoser: -58,
      largestWinner: { tradeReportId: 'trade:xle', underlying: 'XLE', realizedPnl: 2 },
      largestLoser: { tradeReportId: 'trade:spy', underlying: 'SPY', realizedPnl: -58 },
      averageHoldTimeMinutes: 375,
      profitFactor: 0.0345,
      expectancy: -28,
    },
    capital: {
      equity: 10000,
      cash: 8000,
      buyingPower: 9000,
      drawdown: -72,
      capitalEfficiency: 0.0125,
    },
    execution: {
      ordersSubmitted: 4,
      fills: 4,
      partialFills: 0,
      cancelled: 0,
      rejected: 0,
      timeouts: 0,
      retryCount: 1,
      fillRate: 1,
    },
    market: {
      marketStatus: 'CLOSED',
      marketRegime: 'REGULAR_SESSION',
      spyTrend: 'UP',
      vix: 16.2,
      sectorLeadership: 'Energy',
    },
    grades: {
      execution: { grade: 'A', score: 92, reasons: ['Deterministic execution evidence'], unavailableInputs: [] },
      risk: { grade: 'B', score: 82, reasons: ['Deterministic risk evidence'], unavailableInputs: [] },
      market: { grade: 'A', score: 91, reasons: ['Deterministic market evidence'], unavailableInputs: [] },
      tradeQuality: { grade: 'B', score: 84, reasons: ['Deterministic trade evidence'], unavailableInputs: [] },
      performance: { grade: 'B', score: 83, reasons: ['Deterministic performance evidence'], unavailableInputs: [] },
      evidence: { grade: 'A', score: 90, reasons: ['Captured evidence is complete enough for aggregation.'], unavailableInputs: [] },
      overall: { grade: 'B+', score: 86, reasons: ['Deterministic overall evidence'], unavailableInputs: [] },
    },
    evidenceQuality: {
      availableEvidencePercent: 90,
      expectedClosedTrades: 2,
      generatedTradeReports: 2,
      missingEvidence: [],
      warnings: [],
    },
    tradeReports: [
      {
        reportId: 'trade:xle',
        tradeId: 'position-xle',
        underlying: 'XLE',
        direction: 'BULLISH',
        realizedPnl: 2,
        overallGrade: 'A',
        exitReason: 'END_OF_DAY',
      },
      {
        reportId: 'trade:spy',
        tradeId: 'position-spy',
        underlying: 'SPY',
        direction: 'BEARISH',
        realizedPnl: -58,
        overallGrade: 'B',
        exitReason: 'OVERNIGHT_RECOVERY',
      },
    ],
    tradeReportIds: ['trade:xle', 'trade:spy'],
    sessionReference: {
      sessionId,
      tradingDate,
      status: 'FINALIZED',
    },
    timeline: [
      { at: start, label: 'Session opened', source: 'TradingSession', sourceId: sessionId, severity: 'info' },
      { at: close, label: 'Session finalized', source: 'TradingSession', sourceId: sessionId, severity: 'info' },
    ],
    warnings: [],
    generation: {
      schemaVersion: 1,
      generatorVersion: 'daily-report-v1',
      generatedBy: 'server:intelligence:daily-report',
      generatedAt: close,
      generatedFromPersistedEvidence: true,
    },
  });

  await mods.TradeReportModel.create([
    createTradeReport({
      reportId: 'trade:xle',
      tradeId: 'position-xle',
      underlying: 'XLE',
      direction: 'BULLISH',
      strategy: 'momentum-5m-v1',
      exitReason: 'END_OF_DAY',
      realizedPnl: 2,
      confidence: 0.84,
      flowScore: 0.7,
      momentumScore: 0.68,
      trendScore: 0.71,
      riskScore: 0.9,
      candidateRank: 1,
      marketRegime: 'REGULAR_SESSION',
      positionSize: 1,
    }),
    createTradeReport({
      reportId: 'trade:spy',
      tradeId: 'position-spy',
      underlying: 'SPY',
      direction: 'BEARISH',
      strategy: 'momentum-5m-v1',
      exitReason: 'OVERNIGHT_RECOVERY',
      realizedPnl: -58,
      confidence: 0.78,
      flowScore: 0.64,
      momentumScore: 0.61,
      trendScore: 0.65,
      riskScore: 0.88,
      candidateRank: 2,
      marketRegime: 'REGULAR_SESSION',
      positionSize: 1,
    }),
  ]);

  await mods.DecisionJournalModel.create([
    {
      decisionId: 'decision:xle',
      sessionId,
      automationSessionId: 'automation-session-analytics',
      tradeId: 'position-xle',
      reportId: 'trade:xle',
      timestamp: new Date('2026-07-16T14:31:00.000Z'),
      decisionType: 'BUY_APPROVED',
      source: { type: 'tradeCandidate', id: 'candidate-xle', collection: 'trade_candidates' },
      context: {
        symbol: 'XLE',
        contract: 'XLE260717C00090000',
        strategy: 'momentum-5m-v1',
        environment: 'PAPER',
        marketRegime: 'REGULAR_SESSION',
      },
      evaluation: {
        signalStrength: 0.81,
        confidence: 0.84,
        flowScore: 0.7,
        momentumScore: 0.68,
        trendScore: 0.71,
        riskScore: 0.9,
        candidateRank: 1,
        marketRegime: 'REGULAR_SESSION',
      },
      inputs: {
        liquidity: { bid: 1.68, ask: 1.72 },
        spread: 0.04,
        volume: 120,
        iv: 0.32,
        delta: 0.48,
        theta: -0.03,
        gamma: 0.04,
        vega: 0.12,
        marketClock: { state: 'OPEN' },
        buyingPower: 9000,
        existingPositions: 0,
        watchlistRank: 1,
      },
      decision: {
        decision: 'BUY',
        approved: true,
        rejected: false,
        skipped: false,
        reasonCodes: ['LOW_SPREAD', 'HIGH_CONFIDENCE'],
        humanReadableReasons: ['Contract met spread and confidence criteria.'],
      },
      riskSnapshot: {
        positionSize: 1,
        riskPercent: 1.5,
        maxLoss: 169,
        estimatedReward: 250,
        estimatedRR: 1.48,
      },
      executionReference: {
        orderIntentId: 'intent-xle-entry',
        brokerOrderId: 'broker-xle-entry',
        positionId: 'position-xle',
      },
      evidenceQuality: { persistedFields: ['confidence', 'spread', 'riskSnapshot.positionSize'], missingFields: [], warnings: [] },
      timeline: [
        { at: new Date('2026-07-16T14:31:00.000Z'), label: 'Signal approved', source: 'DecisionJournal', sourceId: 'decision:xle', severity: 'info' },
      ],
      generation: {
        schemaVersion: 1,
        generatorVersion: 'decision-journal-v1',
        generatedBy: 'server:intelligence:decision-journal',
        generatedFromPersistedEvidence: true,
      },
    },
    {
      decisionId: 'decision:spy',
      sessionId,
      automationSessionId: 'automation-session-analytics',
      tradeId: 'position-spy',
      reportId: 'trade:spy',
      timestamp: new Date('2026-07-16T14:32:00.000Z'),
      decisionType: 'BUY_APPROVED',
      source: { type: 'tradeCandidate', id: 'candidate-spy', collection: 'trade_candidates' },
      context: {
        symbol: 'SPY',
        contract: 'SPY260717P00500000',
        strategy: 'momentum-5m-v1',
        environment: 'PAPER',
        marketRegime: 'REGULAR_SESSION',
      },
      evaluation: {
        signalStrength: 0.77,
        confidence: 0.78,
        flowScore: 0.64,
        momentumScore: 0.61,
        trendScore: 0.65,
        riskScore: 0.88,
        candidateRank: 2,
        marketRegime: 'REGULAR_SESSION',
      },
      inputs: {
        liquidity: { bid: 6.08, ask: 6.16 },
        spread: 0.08,
        volume: 140,
        iv: 0.29,
        delta: 0.52,
        theta: -0.05,
        gamma: 0.03,
        vega: 0.11,
        marketClock: { state: 'OPEN' },
        buyingPower: 9000,
        existingPositions: 1,
        watchlistRank: 2,
      },
      decision: {
        decision: 'BUY',
        approved: true,
        rejected: false,
        skipped: false,
        reasonCodes: ['LOW_SPREAD'],
        humanReadableReasons: ['SPY put met the risk and liquidity gate.'],
      },
      riskSnapshot: {
        positionSize: 1,
        riskPercent: 2.2,
        maxLoss: 612,
        estimatedReward: 420,
        estimatedRR: 0.69,
      },
      executionReference: {
        orderIntentId: 'intent-spy-entry',
        brokerOrderId: 'broker-spy-entry',
        positionId: 'position-spy',
      },
      evidenceQuality: { persistedFields: ['confidence', 'spread', 'riskSnapshot.positionSize'], missingFields: [], warnings: [] },
      timeline: [
        { at: new Date('2026-07-16T14:32:00.000Z'), label: 'Signal approved', source: 'DecisionJournal', sourceId: 'decision:spy', severity: 'info' },
      ],
      generation: {
        schemaVersion: 1,
        generatorVersion: 'decision-journal-v1',
        generatedBy: 'server:intelligence:decision-journal',
        generatedFromPersistedEvidence: true,
      },
    },
  ]);
}

test('Strategy Analytics Engine', async (t) => {
  await startTestMongo();
  const mods = await loadStrategyAnalyticsDist();
  await resetDb(mods);
  t.after(async () => stopTestMongo());

  await seedEvidence(mods);

  await t.test('generates deterministic analytics from persisted evidence', async () => {
    const first = await mods.generateStrategyAnalyticsForWindowType('DAILY', tradingDate);
    assert.equal(first.idempotent, false);
    assert.equal(first.analytics.performance.totalTrades, 2);
    assert.equal(first.analytics.performance.wins, 1);
    assert.equal(first.analytics.performance.losses, 1);
    assert.equal(first.analytics.performance.netPnl, -56);
    assert.equal(first.analytics.strategyBreakdown[0].label, 'Momentum');
    assert.ok(first.analytics.underlyingBreakdown.some((bucket) => bucket.label === 'XLE'));
    assert.ok(first.analytics.underlyingBreakdown.some((bucket) => bucket.label === 'SPY'));
    assert.ok(first.analytics.exitReasonBreakdown.some((bucket) => bucket.label === 'END_OF_DAY'));
    assert.ok(first.analytics.exitReasonBreakdown.some((bucket) => bucket.label === 'OVERNIGHT'));
    assert.ok(first.analytics.evidenceQuality.availableEvidencePercent > 0);

    const again = await mods.generateStrategyAnalyticsForWindowType('DAILY', tradingDate);
    assert.equal(again.idempotent, true);
    assert.equal(again.analytics.analyticsId, first.analytics.analyticsId);

    const weekly = await mods.generateStrategyAnalyticsForWindowType('WEEKLY', tradingDate);
    assert.equal(weekly.analytics.windowType, 'WEEKLY');
  });

  await t.test('serves analytics through read and admin-gated routes', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/intelligence', mods.intelligenceRouter);
    const server = await new Promise((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });
    const previousToken = process.env.INTELLIGENCE_ADMIN_TOKEN;
    process.env.INTELLIGENCE_ADMIN_TOKEN = 'analytics-token';
    try {
      const address = server.address();
      const base = `http://127.0.0.1:${address.port}`;
      const list = await fetch(`${base}/api/intelligence/analytics`);
      assert.equal(list.status, 200);
      const listBody = await list.json();
      assert.equal(listBody.analytics.length, 2);

      const latest = await fetch(`${base}/api/intelligence/analytics/latest`);
      assert.equal(latest.status, 200);
      const latestBody = await latest.json();
      assert.equal(latestBody.analytics.windowType, 'WEEKLY');

      const byType = await fetch(`${base}/api/intelligence/analytics/window/DAILY`);
      assert.equal(byType.status, 200);
      const byTypeBody = await byType.json();
      assert.equal(byTypeBody.analytics.length, 1);

      const byDate = await fetch(`${base}/api/intelligence/analytics/date/${tradingDate}`);
      assert.equal(byDate.status, 200);

      const blocked = await fetch(`${base}/api/intelligence/analytics/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-operator-token': 'analytics-token' },
        body: JSON.stringify({ tradingDate, windowType: 'DAILY' }),
      });
      assert.equal(blocked.status, 200);
      const blockedBody = await blocked.json();
      assert.equal(blockedBody.idempotent, true);
    } finally {
      process.env.INTELLIGENCE_ADMIN_TOKEN = previousToken;
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
