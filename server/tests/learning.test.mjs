import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { startTestMongo, stopTestMongo } from './automation.helpers.mjs';

function grade(score = 80, reason = 'Captured from persisted evidence') {
  return { grade: 'B', score, reasons: [reason], unavailableInputs: [] };
}

function report(overrides = {}) {
  const now = new Date('2026-07-16T15:00:00.000Z');
  const close = new Date('2026-07-16T15:42:00.000Z');
  const realizedPnl = overrides.realizedPnl ?? 120;
  const returnPct = overrides.returnPct ?? 4.2;
  const strategy = overrides.strategy ?? 'Momentum';
  const tradeId = overrides.tradeId ?? 'trade-learning-1';
  const reportId = overrides.reportId ?? `report:${tradeId}`;
  return {
    reportId,
    tradeId,
    sessionId: 'session-learning',
    automationSessionId: 'automation-learning',
    status: 'GENERATED',
    environment: 'PAPER',
    tradingDate: '2026-07-16',
    identity: {
      underlying: overrides.underlying ?? 'SPY',
      optionSymbol: overrides.optionSymbol ?? 'SPY260821C00450000',
      direction: overrides.direction ?? 'BULLISH',
      strategyVersionId: `${strategy.toLowerCase().replace(/\s+/g, '-')}-v1`,
      strategy,
      contractType: 'call',
      contractStrike: 450,
      contractExpiration: '2026-08-21',
    },
    lifecycle: {
      openedAt: now,
      closedAt: close,
      holdTimeMinutes: 42,
      exitReason: overrides.exitReason ?? 'PROFIT_TARGET',
      overnightRecoveryRequired: false,
      manualReviewReason: null,
    },
    execution: {
      entryOrder: null,
      exitOrder: null,
      entryIntent: { estimatedReward: 180 },
      exitIntent: null,
      fillCount: 2,
      partialFillCount: 0,
      cancellationCount: 0,
      rejectionCount: 0,
      retryCount: 0,
      entrySlippage: 0.01,
      exitSlippage: 0.02,
      totalEstimatedSlippage: 0.03,
      fillQuality: 'Good',
    },
    marketContext: {
      marketStatus: 'OPEN',
      underlyingPriceAtSelection: 450,
      spyContext: null,
      sectorContext: { sector: overrides.sector ?? 'Technology' },
      vixContext: null,
      trend: overrides.trend ?? 'TRENDING',
      marketRegime: overrides.marketRegime ?? 'TRENDING',
      liquidity: { spreadPct: 0.08 },
    },
    greeks: { delta: 0.42, theta: -0.08, gamma: 0.03, vega: 0.11, iv: 0.22 },
    signal: {
      confidence: overrides.confidence ?? 0.72,
      flowScore: 0.8,
      momentumScore: 0.84,
      trendScore: 0.78,
      riskScore: 0.7,
      candidateRank: 1,
      candidateStatus: 'APPROVED',
      riskApproved: true,
      riskReasonCodes: [],
      selectedContractScore: 0.82,
      selectedContractRank: 1,
    },
    performance: {
      entryPrice: 1.25,
      exitPrice: 1.78,
      contracts: 1,
      realizedPnl,
      returnPct,
      maxFavorableExcursion: 5.1,
      maxAdverseExcursion: -1.2,
      drawdown: -1.2,
      fees: 1.3,
    },
    grades: {
      entry: grade(85, 'Entry followed the winning setup.'),
      exit: grade(82, 'Exit followed lifecycle plan.'),
      risk: grade(80, 'Risk package was approved.'),
      execution: grade(81, 'Paper fill quality was acceptable.'),
      market: grade(84, 'Market regime supported the thesis.'),
      overall: grade(83, 'Trade followed the plan.'),
    },
    lessons: {
      strengths: realizedPnl > 0 ? ['Trend continued after entry.'] : [],
      weaknesses: realizedPnl < 0 ? ['Entry was late after the signal.'] : [],
      improvementSuggestions: ['Compare confidence against realized event performance.'],
    },
    timeline: [
      { at: now, label: 'Position opened', source: 'TradeReport', sourceId: reportId, severity: 'info', details: null },
      { at: close, label: 'Position closed', source: 'TradeReport', sourceId: reportId, severity: realizedPnl < 0 ? 'warning' : 'info', details: null },
    ],
    evidence: {
      positionId: `position:${tradeId}`,
      tradingSessionId: 'session-learning',
      brokerOrderIds: [],
      orderIntentIds: [],
      riskDecisionId: `risk:${tradeId}`,
      tradeCandidateId: `candidate:${tradeId}`,
      contractSelectionId: `selection:${tradeId}`,
      universeEvaluationIds: [`universe:${tradeId}`],
      eventIds: overrides.eventIds ?? ['fed:fomc'],
    },
    warnings: [],
    generation: {
      schemaVersion: 1,
      generatorVersion: 'test',
      generatedBy: 'test',
      sourceWindowStart: now,
      sourceWindowEnd: close,
      generatedAt: close,
      generatedFromPersistedEvidence: true,
    },
  };
}

test('learning intelligence creates append-only artifacts and exposes read-only APIs', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  const [
    { learningRouter, synchronizeLearningArtifacts },
    { LearningTradeReviewModel },
    { LearningDatasetModel },
    { TradeReportModel },
  ] = await Promise.all([
    import('../dist/features/learning/index.js'),
    import('../dist/features/learning/storage/learningTradeReview.model.js'),
    import('../dist/features/learning/storage/learningDataset.model.js'),
    import('../dist/features/intelligence/models/tradeReport.model.js'),
  ]);

  await Promise.all([
    TradeReportModel.syncIndexes(),
    LearningTradeReviewModel.syncIndexes(),
    LearningDatasetModel.syncIndexes(),
  ]);

  await TradeReportModel.create([
    report(),
    report({
      tradeId: 'trade-learning-2',
      reportId: 'report:trade-learning-2',
      strategy: 'Fed Reaction',
      underlying: 'XLE',
      optionSymbol: 'XLE260821C00095000',
      sector: 'Energy',
      marketRegime: 'NEWS_DRIVEN',
      realizedPnl: -65,
      returnPct: -2.4,
      confidence: 0.9,
      eventIds: ['oil:inventory', 'fed:fomc'],
      exitReason: 'STRATEGY_INVALIDATION',
    }),
  ]);

  const first = await synchronizeLearningArtifacts(50);
  const second = await synchronizeLearningArtifacts(50);
  assert.equal(first.scanned, 2);
  assert.equal(first.reviewsCreated, 2);
  assert.equal(first.datasetsCreated, 2);
  assert.equal(second.reviewsCreated, 0);
  assert.equal(second.datasetsCreated, 0);
  assert.equal(await LearningTradeReviewModel.countDocuments({}), 2);
  assert.equal(await LearningDatasetModel.countDocuments({}), 2);

  const saved = await LearningTradeReviewModel.findOne({ sourceTradeId: 'trade-learning-1' });
  assert.ok(saved);
  saved.actualReturn = 99;
  await assert.rejects(() => saved.save(), /LEARNING_TRADE_REVIEW_APPEND_ONLY/);

  const app = express();
  app.use('/api/learning', learningRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/learning`;
  for (const path of ['status', 'trades', 'scorecards', 'calibration', 'regimes', 'events', 'datasets']) {
    const response = await fetch(`${base}/${path}`);
    assert.equal(response.status, 200, path);
    const payload = await response.json();
    assert.equal(typeof payload.generatedAt, 'string', path);
  }

  const scorecards = await (await fetch(`${base}/scorecards`)).json();
  assert.ok(scorecards.scorecards.some(card => card.key === 'Momentum'));
  const events = await (await fetch(`${base}/events`)).json();
  assert.ok(events.events.some(event => event.event === 'Fed'));
});
