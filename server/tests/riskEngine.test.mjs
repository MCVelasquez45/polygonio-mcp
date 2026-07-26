import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { startTestMongo, stopTestMongo } from './automation.helpers.mjs';

async function loadRiskDist() {
  const modules = await Promise.all([
    import('../dist/features/riskEngine/approval/riskApproval.service.js'),
    import('../dist/features/riskEngine/controllers/riskEngine.service.js'),
    import('../dist/features/riskEngine/correlation/correlation.service.js'),
    import('../dist/features/riskEngine/greeks/greeks.service.js'),
    import('../dist/features/riskEngine/journal/riskJournal.service.js'),
    import('../dist/features/riskEngine/limits/riskRules.service.js'),
    import('../dist/features/riskEngine/positionSizing/positionSizing.service.js'),
    import('../dist/features/riskEngine/routes/riskEngine.routes.js'),
    import('../dist/features/riskEngine/storage/riskApproval.model.js'),
  ]);
  return Object.assign({}, ...modules);
}

function recommendation(overrides = {}) {
  return {
    recommendationId: overrides.recommendationId ?? 'risk-package:test',
    strategyRunId: 'strategy-run:test',
    recommendation: {
      action: overrides.action ?? 'BUY',
      explanation: 'Strategy orchestrator selected a risk-reviewable opportunity.',
      supportingStrategies: [],
      rejectedStrategies: [],
      confidence: overrides.confidence ?? 0.82,
      evidence: { score: 86, explanation: 'Strong evidence.', components: {} },
      riskHandoff: { allowedForRiskReview: true, message: 'Risk Engine must independently approve.', packageId: 'risk-package:test' },
    },
    symbol: overrides.symbol ?? 'OXY',
    sector: overrides.sector ?? 'Energy',
    strategyId: overrides.strategyId ?? 'oil-commodity',
    direction: overrides.direction ?? 'BULLISH',
    confidence: overrides.confidence ?? 0.82,
    expectedReturn: overrides.expectedReturn ?? 0.42,
    contract: {
      symbol: 'O:OXY260821C00065000',
      estimatedUnitRisk: overrides.estimatedUnitRisk ?? 175,
      liquidity: {
        bid: overrides.bid ?? 1.65,
        ask: overrides.ask ?? 1.75,
        spreadPct: overrides.spreadPct ?? 0.058,
        volume: overrides.volume ?? 1800,
        openInterest: overrides.openInterest ?? 6400,
        impliedVolatility: overrides.impliedVolatility ?? 0.56,
      },
      greeks: {
        delta: overrides.delta ?? 0.42,
        gamma: overrides.gamma ?? 0.04,
        theta: overrides.theta ?? -4,
        vega: overrides.vega ?? 8,
        rho: overrides.rho ?? 0.02,
      },
    },
    marketRegime: {
      current: overrides.regime ?? 'NEWS_DRIVEN',
      historical: ['SECTOR_ROTATION'],
      confidence: 0.74,
      explanation: 'Test market regime.',
    },
    marketStatus: overrides.marketStatus ?? 'open',
    eventContext: {
      latestEvents: [{
        id: 'event:test',
        title: 'Oil supply event affects energy equities',
        category: 'Oil',
        importance: overrides.eventImportance ?? 88,
        sentiment: 0.7,
        affectedSymbols: ['OXY', 'CVX'],
        affectedEtfs: ['XLE', 'USO'],
        affectedSectors: ['Energy'],
      }],
    },
    raw: {},
  };
}

function portfolio(overrides = {}) {
  return {
    timestamp: '2026-07-25T14:00:00.000Z',
    portfolioSize: overrides.portfolioSize ?? 100000,
    buyingPower: overrides.buyingPower ?? null,
    availableCapital: null,
    currentPositions: overrides.currentPositions ?? [],
    exposure: {
      sectorExposure: overrides.sectorExposure ?? {},
      tickerExposure: overrides.tickerExposure ?? {},
      strategyExposure: {},
      macroExposure: {},
      longExposure: 0,
      shortExposure: 0,
      cashAllocation: null,
      maximumConcurrentTrades: 8,
      currentOpenTrades: overrides.currentOpenTrades ?? 0,
      historicalMaximum: {},
      recommended: {},
    },
    greeks: overrides.greeks ?? { delta: null, gamma: null, theta: null, vega: null, rho: null },
    riskBudget: {
      dailyRealizedLoss: overrides.dailyRealizedLoss ?? 0,
      dailyUnrealizedLoss: overrides.dailyUnrealizedLoss ?? 0,
      riskConsumed: overrides.riskConsumed ?? 0,
      remainingRiskBudget: overrides.remainingRiskBudget ?? 1500,
      maximumConsecutiveLosses: 3,
      consecutiveLosses: 0,
      maximumOpenRisk: 6000,
      openRisk: overrides.openRisk ?? 0,
    },
  };
}

test('position sizing scales by confidence, market regime, and portfolio heat', async () => {
  const mods = await loadRiskDist();
  const rules = mods.getRiskRuleSet(new Date('2026-07-25T14:00:00.000Z'));
  const calm = mods.calculatePositionSize(recommendation({ regime: 'TRENDING' }), portfolio(), rules);
  const stressed = mods.calculatePositionSize(recommendation({ regime: 'HIGH_VOLATILITY' }), portfolio({ openRisk: 5000 }), rules);
  assert.ok(calm.suggestedContracts > stressed.suggestedContracts);
  assert.ok(calm.explanation.includes('confidence'));
});

test('greeks aggregation and correlation explain portfolio risk', async () => {
  const mods = await loadRiskDist();
  const positions = [
    {
      symbol: 'O:XLE260821C00090000',
      underlying: 'XLE',
      sector: 'Energy',
      strategyId: 'oil-commodity',
      direction: 'LONG',
      quantity: 2,
      marketValue: 1200,
      unrealizedPnl: 0,
      greeks: { delta: 0.8, gamma: 0.05, theta: -9, vega: 18, rho: 0.01 },
    },
  ];
  const greeks = mods.aggregateGreeks(positions);
  const corr = mods.estimateCorrelationRisk(
    recommendation({ symbol: 'OXY', sector: 'Energy' }),
    portfolio({ currentPositions: positions, tickerExposure: { XLE: 1200 } })
  );
  assert.equal(greeks.delta, 0.8);
  assert.ok(corr.score > 0);
  assert.ok(corr.correlatedSymbols.includes('XLE'));
});

test('risk approval approves clean actionable recommendations without execution', async () => {
  const mods = await loadRiskDist();
  const approval = mods.evaluateRiskApproval(recommendation(), portfolio(), new Date('2026-07-25T14:00:00.000Z'));
  assert.equal(approval.status, 'APPROVE');
  assert.equal(approval.approved, true);
  assert.ok(approval.suggestedPositionSize.suggestedContracts > 1);
  assert.equal(approval.reasons.length, 0);
});

test('risk approval rejects liquidity, confidence, daily loss, and market violations with reason codes', async () => {
  const mods = await loadRiskDist();
  const approval = mods.evaluateRiskApproval(
    recommendation({ confidence: 0.3, spreadPct: 0.4, marketStatus: 'closed' }),
    portfolio({ remainingRiskBudget: 50 }),
    new Date('2026-07-25T14:00:00.000Z')
  );
  const codes = approval.reasons.map(reason => reason.code);
  assert.equal(approval.status, 'REJECT');
  assert.ok(codes.includes('LOW_CONFIDENCE'));
  assert.ok(codes.includes('HIGH_SPREAD'));
  assert.ok(codes.includes('MARKET_CLOSED'));
  assert.ok(codes.includes('MAX_DAILY_LOSS'));
  assert.ok(approval.reasons.every(reason => reason.explanation && reason.suggestedImprovement));
});

test('risk journal is append-only and read-only API exposes risk state', async () => {
  const mongod = await startTestMongo();
  let server;
  try {
    const mods = await loadRiskDist();
    await mods.RiskApprovalModel.deleteMany({});
    const first = await mods.runRiskReview({ recommendation: recommendation({ recommendationId: 'risk:1' }) });
    const second = await mods.runRiskReview({ recommendation: recommendation({ recommendationId: 'risk:2', marketStatus: 'closed' }) });
    assert.notEqual(first.approval.approvalId, second.approval.approvalId);
    const history = await mods.listRiskApprovals(10);
    assert.equal(history.length, 2);
    assert.equal(history[0].approvalId, second.approval.approvalId);

    const app = express();
    app.use('/api/risk-engine', mods.riskEngineRouter);
    server = await new Promise(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const paths = ['status', 'portfolio', 'exposure', 'greeks', 'risk-budget', 'rules', 'history', 'approval-queue'];
    const responses = await Promise.all(paths.map(path => fetch(`${base}/api/risk-engine/${path}`)));
    assert.deepEqual(responses.map(response => response.status), Array(paths.length).fill(200));
    const status = await responses[0].json();
    assert.equal(status.status.latestApprovalId, second.approval.approvalId);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await stopTestMongo(mongod);
  }
});
