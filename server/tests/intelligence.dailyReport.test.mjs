import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { startTestMongo, stopTestMongo } from './automation.helpers.mjs';

const tradingDate = '2026-07-16';
const sessionId = 'paper:2026-07-16:daily-test-session';
const start = new Date('2026-07-16T14:00:00.000Z');
const close = new Date('2026-07-16T21:05:00.000Z');

async function loadDailyReportDist() {
  const [tradingSessionModel, tradeReportModel, dailyReportModel, dailyReportService, intelligenceRoutes] =
    await Promise.all([
      import('../dist/features/intelligence/models/tradingSession.model.js'),
      import('../dist/features/intelligence/models/tradeReport.model.js'),
      import('../dist/features/intelligence/models/dailyReport.model.js'),
      import('../dist/features/intelligence/services/dailyReportGenerator.service.js'),
      import('../dist/features/intelligence/intelligence.routes.js'),
    ]);
  return {
    ...tradingSessionModel,
    ...tradeReportModel,
    ...dailyReportModel,
    ...dailyReportService,
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
}

function grade(value, score, reasons = ['deterministic grade']) {
  return {
    grade: value,
    score,
    reasons,
    unavailableInputs: [],
  };
}

async function createTradingSession(mods, overrides = {}) {
  return mods.TradingSessionModel.create({
    sessionId: overrides.sessionId ?? sessionId,
    tradingDate: overrides.tradingDate ?? tradingDate,
    timezone: 'America/New_York',
    status: 'FINALIZED',
    environment: 'PAPER',
    marketStatus: 'CLOSED',
    startedAt: start,
    finalizedAt: close,
    automationSessionId: 'automation-session-daily',
    watchlist: { symbols: ['XLE', 'SPY'], size: 2 },
    evaluationSummary: {
      windowsEvaluated: 5,
      symbolsEvaluated: 12,
      signalsGenerated: 2,
      noSignalCount: 7,
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
      totalRequests: 40,
      cacheHits: 20,
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
      orderIntentIds: ['intent-1', 'intent-2', 'intent-3', 'intent-4'],
      brokerOrderIds: ['order-1', 'order-2', 'order-3', 'order-4'],
      positionIds: ['position-xle', 'position-spy'],
      eventIds: ['event-1'],
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
    ...overrides,
  });
}

function tradeReportDoc(overrides = {}) {
  const underlying = overrides.underlying ?? 'XLE';
  const pnl = overrides.realizedPnl ?? 2;
  const reportId = overrides.reportId ?? `trade:position-${underlying.toLowerCase()}`;
  const tradeId = overrides.tradeId ?? `position-${underlying.toLowerCase()}`;
  return {
    reportId,
    tradeId,
    sessionId: overrides.sessionId ?? sessionId,
    automationSessionId: 'automation-session-daily',
    status: 'GENERATED',
    environment: 'PAPER',
    tradingDate,
    identity: {
      underlying,
      optionSymbol: overrides.optionSymbol ?? `${underlying}260717C00090000`,
      direction: overrides.direction ?? 'BULLISH',
      strategyVersionId: 'sv-daily-test',
      strategy: 'sv-daily-test',
      contractType: overrides.direction === 'BEARISH' ? 'put' : 'call',
      contractStrike: 90,
      contractExpiration: '2026-07-17',
    },
    lifecycle: {
      openedAt: start,
      closedAt: overrides.closedAt ?? close,
      holdTimeMinutes: overrides.holdTimeMinutes ?? 380,
      exitReason: overrides.exitReason ?? 'END_OF_DAY',
      overnightRecoveryRequired: overrides.exitReason === 'OVERNIGHT_RECOVERY',
      manualReviewReason: null,
    },
    execution: {
      entryOrder: { brokerOrderId: `${underlying}-entry` },
      exitOrder: { brokerOrderId: `${underlying}-exit` },
      entryIntent: { intentId: `${underlying}-entry-intent` },
      exitIntent: { intentId: `${underlying}-exit-intent` },
      fillCount: 2,
      partialFillCount: 0,
      cancellationCount: 0,
      rejectionCount: 0,
      retryCount: overrides.retryCount ?? 1,
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
      trend: overrides.direction === 'BEARISH' ? 'DOWN' : 'UP',
      marketRegime: 'REGULAR_SESSION',
      liquidity: { spreadPct: 0.04, volume: 100, openInterest: 500 },
    },
    greeks: { delta: 0.45, theta: null, gamma: null, vega: null, iv: 0.32 },
    signal: {
      confidence: 0.72,
      flowScore: 0.68,
      momentumScore: 0.66,
      trendScore: 0.7,
      riskScore: 1,
      candidateRank: 1,
      candidateStatus: 'RISK_APPROVED',
      riskApproved: true,
      riskReasonCodes: [],
      selectedContractScore: 88,
      selectedContractRank: 1,
    },
    performance: {
      entryPrice: overrides.entryPrice ?? 1.69,
      exitPrice: overrides.exitPrice ?? 1.71,
      contracts: 1,
      realizedPnl: pnl,
      returnPct: overrides.returnPct ?? 0.0118,
      maxFavorableExcursion: overrides.mfe ?? 9,
      maxAdverseExcursion: overrides.mae ?? -4,
      drawdown: overrides.mae ?? -4,
      fees: null,
    },
    grades: {
      entry: grade('A', 92),
      exit: grade(overrides.exitGrade ?? 'B', overrides.exitScore ?? 84),
      risk: grade(overrides.riskGrade ?? 'A', overrides.riskScore ?? 90),
      execution: grade('A', 94),
      market: grade('B', 84),
      overall: grade(overrides.overallGrade ?? 'A', overrides.overallScore ?? 90),
    },
    lessons: {
      strengths: ['Risk approval was persisted before entry.'],
      weaknesses: pnl < 0 ? ['Trade closed with negative realized P/L.'] : [],
      improvementSuggestions:
        overrides.exitReason === 'OVERNIGHT_RECOVERY'
          ? ['Review overnight recovery cases separately before changing exit rules.']
          : [],
    },
    timeline: [
      {
        at: start,
        label: 'Position opened',
        source: 'TradeReport',
        sourceId: reportId,
        severity: 'info',
        details: null,
      },
      {
        at: overrides.closedAt ?? close,
        label: 'Position closed',
        source: 'TradeReport',
        sourceId: reportId,
        severity: pnl < 0 ? 'warning' : 'info',
        details: null,
      },
    ],
    evidence: {
      positionId: tradeId,
      tradingSessionId: sessionId,
      brokerOrderIds: [`${underlying}-entry`, `${underlying}-exit`],
      orderIntentIds: [`${underlying}-entry-intent`, `${underlying}-exit-intent`],
      riskDecisionId: `${underlying}-risk`,
      tradeCandidateId: `${underlying}-candidate`,
      contractSelectionId: `${underlying}-selection`,
      universeEvaluationIds: [`${underlying}-evaluation`],
      eventIds: [`${underlying}-event`],
    },
    warnings: overrides.warnings ?? [
      {
        code: 'THETA_GAMMA_VEGA_NOT_CAPTURED',
        message: 'Theta, gamma, and vega are not persisted by V1 contract selection evidence.',
        source: 'ContractSelection',
      },
    ],
    generation: {
      schemaVersion: 1,
      generatorVersion: 'trade-report-generator-v1',
      generatedBy: 'server:intelligence:trade-report-generator',
      sourceWindowStart: start,
      sourceWindowEnd: close,
      generatedAt: close,
      generatedFromPersistedEvidence: true,
    },
  };
}

async function seedDailyEvidence(mods) {
  await createTradingSession(mods);
  await mods.TradeReportModel.create([
    tradeReportDoc(),
    tradeReportDoc({
      underlying: 'SPY',
      optionSymbol: 'SPY260717P00500000',
      direction: 'BEARISH',
      realizedPnl: -58,
      returnPct: -0.0948,
      exitReason: 'OVERNIGHT_RECOVERY',
      closedAt: new Date('2026-07-17T13:36:00.000Z'),
      holdTimeMinutes: 1381,
      retryCount: 2,
      mfe: 20,
      mae: -72,
      exitGrade: 'D',
      exitScore: 62,
      riskGrade: 'C',
      riskScore: 72,
      overallGrade: 'C',
      overallScore: 74,
    }),
  ]);
}

test('Daily Intelligence Reports', async (t) => {
  await startTestMongo();
  const mods = await loadDailyReportDist();
  await resetDb(mods);
  t.after(async () => stopTestMongo());

  await t.test('aggregates TradingSession and TradeReports into one immutable daily report', async () => {
    await seedDailyEvidence(mods);
    const result = await mods.generateDailyReportForSession(sessionId);

    assert.equal(result.idempotent, false);
    assert.equal(result.report.sessionId, sessionId);
    assert.equal(result.report.tradingSummary.tradesClosed, 2);
    assert.equal(result.report.tradingSummary.wins, 1);
    assert.equal(result.report.tradingSummary.losses, 1);
    assert.equal(result.report.performance.netPnl, -56);
    assert.equal(result.report.performance.averageWinner, 2);
    assert.equal(result.report.performance.averageLoser, -58);
    assert.equal(result.report.performance.largestWinner.underlying, 'XLE');
    assert.equal(result.report.performance.largestLoser.underlying, 'SPY');
    assert.equal(result.report.performance.expectancy, -28);
    assert.ok(result.report.performance.profitFactor > 0);
    assert.equal(result.report.executiveSummary.primaryLesson, 'Overnight exposure reduced performance.');
    assert.ok(result.report.executiveSummary.bestDecision.includes('XLE'));
    assert.ok(result.report.executiveSummary.worstDecision.includes('SPY'));
    assert.ok(result.report.grades.overall.score != null);
    assert.equal(result.report.tradeReportIds.length, 2);
    assert.ok(result.report.timeline.some((event) => event.label.includes('SPY closed')));

    const duplicate = await mods.generateDailyReportForSession(sessionId);
    assert.equal(duplicate.idempotent, true);
    assert.equal(duplicate.report.reportId, result.report.reportId);

    result.report.performance.netPnl = 1000;
    await assert.rejects(() => result.report.save(), /GENERATED_DAILY_REPORT_IMMUTABLE/);
  });

  await t.test('backfill by date is idempotent and returns existing report', async () => {
    const results = await mods.backfillDailyReportsForDate(tradingDate);
    assert.equal(results.length, 1);
    assert.equal(results[0].idempotent, true);
    assert.equal(results[0].report.performance.netPnl, -56);
  });

  await t.test('captures missing trade reports and capital evidence honestly', async () => {
    const missingSessionId = 'paper:2026-07-17:missing-daily';
    await createTradingSession(mods, {
      sessionId: missingSessionId,
      tradingDate: '2026-07-17',
      references: {
        candidateIds: [],
        riskDecisionIds: [],
        orderIntentIds: [],
        brokerOrderIds: [],
        positionIds: ['missing-position'],
        eventIds: [],
        closedTradeIds: ['missing-position'],
      },
      tradeSummary: {
        tradesOpened: 1,
        tradesClosed: 1,
        winningTrades: 0,
        losingTrades: 1,
        breakevenTrades: 0,
        realizedPnl: -25,
        unrealizedPnlAtClose: null,
        totalPnl: -25,
      },
    });
    const result = await mods.generateDailyReportForSession(missingSessionId);
    assert.equal(result.report.tradeReportIds.length, 0);
    assert.ok(result.report.evidenceQuality.availableEvidencePercent < 100);
    assert.ok(result.report.evidenceQuality.missingEvidence.includes('complete trade reports for closed trades'));
    assert.ok(result.report.warnings.some((item) => item.code === 'TRADE_REPORT_COUNT_MISMATCH'));
    assert.ok(result.report.warnings.some((item) => item.code === 'PORTFOLIO_SNAPSHOT_NOT_CAPTURED'));
  });

  await t.test('read APIs expose daily reports and generation fails closed without admin token', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/intelligence', mods.intelligenceRouter);
    const server = await new Promise((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });
    try {
      const address = server.address();
      const base = `http://127.0.0.1:${address.port}`;
      const list = await fetch(`${base}/api/intelligence/daily`);
      assert.equal(list.status, 200);
      const listBody = await list.json();
      assert.ok(listBody.reports.length >= 1);

      const latest = await fetch(`${base}/api/intelligence/daily/latest`);
      assert.equal(latest.status, 200);

      const byDate = await fetch(`${base}/api/intelligence/daily/date/${tradingDate}`);
      assert.equal(byDate.status, 200);

      const detail = await fetch(`${base}/api/intelligence/daily/${encodeURIComponent(sessionId)}`);
      assert.equal(detail.status, 200);
      assert.equal((await detail.json()).report.sessionId, sessionId);

      const missing = await fetch(`${base}/api/intelligence/daily/not-real`);
      assert.equal(missing.status, 404);

      const blocked = await fetch(`${base}/api/intelligence/daily/${encodeURIComponent(sessionId)}/generate`, {
        method: 'POST',
      });
      assert.equal(blocked.status, 403);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
