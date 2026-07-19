// Phase 2C — broker-truth risk accounting (the mandatory feedback loop).
// Realized P&L and counter updates from confirmed closes; updated counters
// constrain the next risk decision.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadDist,
  startTestMongo,
  stopTestMongo,
  dropAutomationCollections,
  createReadySession,
} from './automation.helpers.mjs';

const mods = await loadDist();

test('realized P&L math (pure)', async (t) => {
  await t.test('winning long option: exit above entry', () => {
    const o = mods.computeRealizedTrade({ quantity: 2, avgEntryPrice: 1.0, avgExitPrice: 1.5 });
    // (1.5-1.0)*2*100 = 100
    assert.equal(o.realizedPnl, 100);
    assert.equal(o.result, 'WIN');
    assert.equal(o.returnPct, 0.5);
  });

  await t.test('losing trade: exit below entry, fees included', () => {
    const o = mods.computeRealizedTrade({ quantity: 1, avgEntryPrice: 2.0, avgExitPrice: 1.5, entryFees: 1, exitFees: 1 });
    // proceeds 150-1=149, cost 200+1=201 → -52
    assert.equal(o.realizedPnl, -52);
    assert.equal(o.result, 'LOSS');
  });

  await t.test('break-even is explicit', () => {
    const o = mods.computeRealizedTrade({ quantity: 1, avgEntryPrice: 1.0, avgExitPrice: 1.0 });
    assert.equal(o.realizedPnl, 0);
    assert.equal(o.result, 'BREAKEVEN');
  });

  await t.test('counters: win resets consecutive losses, drawdown from peak', () => {
    const next = mods.applyRealizedTradeToCounters(
      { dailyRealizedPnl: -50, dailyTradeCount: 1, consecutiveLossCount: 2, peakEquity: 100_000, maxDrawdown: 60 },
      { realizedPnl: 100, result: 'WIN', entryCost: 200, exitProceeds: 300, returnPct: 0.5 },
      100_050
    );
    assert.equal(next.consecutiveLossCount, 0);
    assert.equal(next.dailyTradeCount, 2);
    assert.equal(next.dailyRealizedPnl, 50);
    assert.equal(next.peakEquity, 100_050);
    assert.equal(next.currentDrawdown, 0);
  });

  await t.test('counters: loss increments consecutive losses and drawdown', () => {
    const next = mods.applyRealizedTradeToCounters(
      { dailyRealizedPnl: 0, dailyTradeCount: 0, consecutiveLossCount: 0, peakEquity: 100_000, maxDrawdown: 0 },
      { realizedPnl: -200, result: 'LOSS', entryCost: 200, exitProceeds: 0, returnPct: -1 },
      99_800
    );
    assert.equal(next.consecutiveLossCount, 1);
    assert.equal(next.currentDrawdown, 200);
    assert.equal(next.maxDrawdown, 200);
  });
});

test('risk accounting persistence + idempotency', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  let session;
  t.beforeEach(async () => {
    await dropAutomationCollections();
    session = await createReadySession(mods, {
      underlying: 'SPY',
      reconciliationStatus: 'CLEAN',
      dailyRealizedPnl: 0,
      dailyTradeCount: 0,
      consecutiveLossCount: 0,
    });
  });

  async function makeClosedPosition(fields = {}) {
    return mods.AutomationPositionModel.create({
      source: 'AUTOMATION',
      automationSessionId: String(session._id),
      strategyVersionId: 'sv-test-1',
      underlying: 'SPY',
      optionSymbol: 'SPY260724C00500000',
      direction: 'BULLISH',
      entryIntentId: 'intent-1',
      entryClientOrderId: `at2a-${Math.abs(fields.seed ?? 1)}`,
      filledQty: 2,
      avgEntryPrice: 1.0,
      avgExitPrice: 1.5,
      status: 'CLOSED',
      closedAt: new Date(),
      ...fields,
    });
  }

  await t.test('winning trade updates realized P&L, trade count, resets losses', async () => {
    session.consecutiveLossCount = 2;
    await session.save();
    const pos = await makeClosedPosition({ seed: 1 });
    const res = await mods.recordClosedTradeRisk(String(pos._id), 100_100);
    assert.equal(res.counted, true);
    const s = await mods.AutomationSessionModel.findById(session._id);
    assert.equal(s.dailyRealizedPnl, 100);
    assert.equal(s.dailyTradeCount, 1);
    assert.equal(s.consecutiveLossCount, 0);
    assert.equal(s.lastTradeResult, 'WIN');
  });

  await t.test('losing trade increments consecutive losses', async () => {
    const pos = await makeClosedPosition({ seed: 2, avgExitPrice: 0.5 });
    await mods.recordClosedTradeRisk(String(pos._id), 99_900);
    const s = await mods.AutomationSessionModel.findById(session._id);
    assert.equal(s.dailyRealizedPnl, -100);
    assert.equal(s.consecutiveLossCount, 1);
    assert.equal(s.lastTradeResult, 'LOSS');
  });

  await t.test('idempotent: recording the same close twice does not double-count', async () => {
    const pos = await makeClosedPosition({ seed: 3 });
    await mods.recordClosedTradeRisk(String(pos._id), 100_100);
    const second = await mods.recordClosedTradeRisk(String(pos._id), 100_100);
    assert.equal(second.counted, false);
    const s = await mods.AutomationSessionModel.findById(session._id);
    assert.equal(s.dailyTradeCount, 1);
    assert.equal(s.dailyRealizedPnl, 100);
  });

  await t.test('updated counters flow into the next risk decision', async () => {
    // Two losses recorded → consecutiveLossCount 2 ≥ pause threshold → risk blocks.
    await mods.recordClosedTradeRisk(String((await makeClosedPosition({ seed: 4, avgExitPrice: 0.5 }))._id), 99_900);
    await mods.recordClosedTradeRisk(String((await makeClosedPosition({ seed: 5, avgExitPrice: 0.5 }))._id), 99_800);
    const s = await mods.AutomationSessionModel.findById(session._id);
    const config = mods.getStrategyConfig('SPY');
    const risk = mods.evaluateRisk({
      account: { equity: 99_800, buyingPower: 50_000, isPaper: true },
      session: {
        id: String(s._id),
        status: s.status,
        reconciliationStatus: s.reconciliationStatus,
        emergencyStopActive: false,
        dailyTradeCount: s.dailyTradeCount,
        dailyRealizedPnl: s.dailyRealizedPnl,
        consecutiveLossCount: s.consecutiveLossCount,
        startingDayEquity: 100_000,
        currentDrawdown: s.currentDrawdown,
      },
      config,
      candidate: { id: 'c1', barTimestamp: Date.now(), isDuplicate: false },
      selectedContract: { symbol: 'SPY260724C00500000', ask: 1.2, bid: 1.1, spreadPct: 0.05, quoteTimestamp: new Date() },
      openAutomationPositions: 0,
      unresolvedAutomationOrders: 0,
      marketDataOk: true,
      underlyingBarAgeMs: 1000,
      clockDecision: { state: 'OPEN', canEnter: true },
      mongoConnected: true,
      automationReady: true,
      now: Date.now(),
    });
    assert.equal(risk.approved, false);
    assert.ok(risk.reasonCodes.includes('RISK_CONSECUTIVE_LOSS_COOLDOWN'));
  });
});
