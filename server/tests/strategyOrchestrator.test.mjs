import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { startTestMongo, stopTestMongo } from './automation.helpers.mjs';

async function loadStrategyDist() {
  const modules = await Promise.all([
    import('../dist/features/strategyOrchestrator/strategies/strategyRegistry.service.js'),
    import('../dist/features/strategyOrchestrator/scheduler/strategyScheduler.service.js'),
    import('../dist/features/strategyOrchestrator/scheduler/marketRegime.service.js'),
    import('../dist/features/strategyOrchestrator/ranking/evidence.service.js'),
    import('../dist/features/strategyOrchestrator/ranking/ranking.service.js'),
    import('../dist/features/strategyOrchestrator/ranking/recommendation.service.js'),
    import('../dist/features/strategyOrchestrator/controllers/orchestrator.service.js'),
    import('../dist/features/strategyOrchestrator/storage/strategyJournal.service.js'),
    import('../dist/features/strategyOrchestrator/storage/strategyOrchestrator.model.js'),
    import('../dist/features/strategyOrchestrator/routes/strategyOrchestrator.routes.js'),
  ]);
  return Object.assign({}, ...modules);
}

function context(overrides = {}) {
  return {
    timestamp: '2026-07-25T14:00:00.000Z',
    eventContext: {
      latestEvents: overrides.events ?? [{
        id: 'event:oil',
        title: 'Iran ceasefire sends crude oil lower',
        category: 'Oil',
        importance: 95,
        sentiment: 0.91,
        affectedSymbols: ['OXY', 'CVX'],
        affectedEtfs: ['USO', 'XLE'],
        affectedSectors: ['Energy'],
      }],
    },
    decisionContext: {
      latestScanId: 'scan:1',
      bestOpportunity: { symbol: 'OXY', score: 82, confidence: 0.8, recommendation: 'BUY_CALL' },
      rejectedCount: 2,
      noTradeReason: null,
    },
    marketData: { marketStatus: 'open', trendScore: 74, momentumScore: 80, volatilityScore: 62 },
    portfolio: {
      currentPositions: [],
      buyingPower: null,
      sectorExposure: overrides.sectorExposure ?? {},
      openRisk: null,
      greeks: { delta: null, gamma: null, theta: null, vega: null },
      availableCapital: null,
      maximumDailyLoss: null,
      adjustmentExplanation: 'No open automation portfolio exposure was found in persisted records.',
    },
    watchlist: ['OXY', 'CVX', 'SPY'],
    news: ['Iran ceasefire sends crude oil lower'],
    sentiment: { bullish: 1, bearish: 0, neutral: 0 },
    technicalAnalysis: { trendScore: 74, momentumScore: 80, volatilityScore: 62 },
    marketRegime: {
      current: 'NEWS_DRIVEN',
      historical: ['SECTOR_ROTATION'],
      confidence: 0.78,
      explanation: 'News driven test regime.',
    },
  };
}

test('strategy registry exposes all initial strategies with evaluate contracts', async () => {
  const mods = await loadStrategyDist();
  const strategies = mods.listRegisteredStrategies();
  assert.equal(strategies.length, 15);
  for (const strategy of strategies) {
    assert.ok(strategy.id);
    assert.ok(strategy.requiredInputs.includes('eventContext'));
    const result = strategy.evaluate(context());
    assert.equal(result.strategyId, strategy.id);
    assert.equal(typeof result.confidence, 'number');
    assert.ok(Array.isArray(result.reasoning));
  }
});

test('scheduler selects oil strategies and skips unrelated fed strategy', async () => {
  const mods = await loadStrategyDist();
  const scheduled = mods.scheduleStrategies(mods.listRegisteredStrategies(), context());
  const selectedIds = scheduled.selected.map(strategy => strategy.id);
  assert.ok(selectedIds.includes('oil-commodity'));
  assert.ok(selectedIds.includes('sector-rotation'));
  assert.equal(selectedIds.includes('fed-reaction'), false);
});

test('evidence, ranking, conflict resolution, and recommendation are explainable', async () => {
  const mods = await loadStrategyDist();
  const ctx = context();
  const evidence = mods.buildEvidenceScore(ctx);
  const evals = [
    { strategyId: 'a', name: 'Momentum', direction: 'BULLISH', confidence: 0.9, risk: 0.2, expectedReturn: 0.6, positionSize: 0.05, evidenceScore: 90, reasoning: [], rejected: false, rejectionReason: null },
    { strategyId: 'b', name: 'Macro', direction: 'BEARISH', confidence: 0.75, risk: 0.25, expectedReturn: 0.55, positionSize: 0.04, evidenceScore: 85, reasoning: [], rejected: false, rejectionReason: null },
  ];
  const rankings = mods.rankStrategies(evals);
  const conflicts = mods.resolveStrategyConflicts(evals);
  const recommendation = mods.buildRecommendationPackage({ rankings, conflicts, evidence });
  assert.ok(evidence.score > 50);
  assert.equal(conflicts.hasConflict, true);
  assert.equal(recommendation.action, 'WAIT');
  assert.ok(recommendation.explanation.includes('Conflict'));
});

test('portfolio sector concentration reduces oil strategy confidence', async () => {
  const mods = await loadStrategyDist();
  const oil = mods.listRegisteredStrategies().find(strategy => strategy.id === 'oil-commodity');
  const normal = oil.evaluate(context());
  const heavyEnergy = oil.evaluate(context({ sectorExposure: { Energy: 100000, Technology: 10000 } }));
  assert.ok(heavyEnergy.confidence < normal.confidence);
  assert.ok(heavyEnergy.reasoning.some(line => line.includes('reduced confidence')));
});

test('orchestrator journal is append-only and read-only API exposes state', async () => {
  const mongod = await startTestMongo();
  let server;
  try {
    const mods = await loadStrategyDist();
    await mods.StrategyOrchestratorModel.deleteMany({});
    const first = await mods.runStrategyOrchestrator();
    const second = await mods.runStrategyOrchestrator();
    assert.notEqual(first.runId, second.runId);
    const history = await mods.listStrategyRuns(10);
    assert.equal(history.length, 2);
    assert.equal(history[0].runId, second.runId);

    const app = express();
    app.use('/api/strategy-orchestrator', mods.strategyOrchestratorRouter);
    server = await new Promise(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const [status, recommendations, strategies, evidence] = await Promise.all([
      fetch(`${base}/api/strategy-orchestrator/status`),
      fetch(`${base}/api/strategy-orchestrator/recommendations`),
      fetch(`${base}/api/strategy-orchestrator/strategies`),
      fetch(`${base}/api/strategy-orchestrator/evidence`),
    ]);
    assert.equal(status.status, 200);
    assert.equal(recommendations.status, 200);
    assert.equal(strategies.status, 200);
    assert.equal(evidence.status, 200);
    const rec = await recommendations.json();
    assert.ok(rec.recommendation.riskHandoff.message.includes('Risk Engine'));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await stopTestMongo(mongod);
  }
});
