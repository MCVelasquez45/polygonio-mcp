// Sprint 2E launch — watchlist position-size enforcement, broker-truth
// telemetry projection, and legacy-universe isolation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDist, startTestMongo, stopTestMongo, dropAutomationCollections } from './automation.helpers.mjs';

const mods = await loadDist();
const RISK = { riskPerTradePct: 0.0025, stopLossPct: 0.25, maxPositionCostPct: 0.05 };
const SIZE = { accountEquity: 100_000, buyingPower: 50_000, selectedAsk: 1.2, config: RISK };
// Without a watchlist cap: rawQty=floor(250/30)=8, bpCap=416, costCap=41 → 8.

test('watchlist position sizing (maxPositionSize enforcement)', async (t) => {
  await t.test('no watchlist cap → global deterministic sizing (8)', () => {
    const r = mods.computePositionSize({ ...SIZE });
    assert.equal(r.outputs.quantity, 8);
    assert.equal(r.outputs.watchlistCap, Infinity);
  });

  await t.test('watchlist cap smaller than global caps the quantity', () => {
    const r = mods.computePositionSize({ ...SIZE, maxContracts: 1 });
    assert.equal(r.outputs.quantity, 1, 'most-restrictive limit wins');
    assert.equal(r.outputs.watchlistCap, 1);
  });

  await t.test('global smaller than watchlist cap → global wins', () => {
    const r = mods.computePositionSize({ ...SIZE, maxContracts: 100 });
    assert.equal(r.outputs.quantity, 8);
  });

  await t.test('watchlist cap of 0 → rejection (quantity below one)', () => {
    const r = mods.computePositionSize({ ...SIZE, maxContracts: 0 });
    assert.equal(r.outputs.quantity, 0);
    assert.match(r.outputs.rejectedReason, /watchlist maxPositionSize below one contract/);
  });

  await t.test('sizing is deterministic across repeated runs', () => {
    const a = mods.computePositionSize({ ...SIZE, maxContracts: 3 });
    const b = mods.computePositionSize({ ...SIZE, maxContracts: 3 });
    assert.deepEqual(a.outputs, b.outputs);
  });

  await t.test('risk engine applies the watchlist cap (quantity capped at maxContracts)', () => {
    const contract = { symbol: 'SPY260724C00500000', ask: 1.2, bid: 1.1, spreadPct: 0.08, quoteTimestamp: 1000 };
    const base = {
      account: { equity: 100_000, buyingPower: 50_000, isPaper: true },
      session: { id: 's', status: 'READY', reconciliationStatus: 'CLEAN', emergencyStopActive: false, dailyTradeCount: 0, dailyRealizedPnl: 0, consecutiveLossCount: 0, startingDayEquity: 100_000, currentDrawdown: 0 },
      config: mods.getStrategyConfig('SPY'),
      candidate: { id: 'c', barTimestamp: 1000, isDuplicate: false },
      selectedContract: contract,
      openAutomationPositions: 0,
      unresolvedAutomationOrders: 0,
      marketDataOk: true,
      underlyingBarAgeMs: 0,
      clockDecision: { state: 'OPEN', canEnter: true },
      mongoConnected: true,
      automationReady: true,
      now: 1000,
    };
    const capped = mods.evaluateRisk({ ...base, maxContracts: 1 });
    assert.equal(capped.sizing.outputs.quantity, 1);
    const uncapped = mods.evaluateRisk({ ...base });
    assert.ok(uncapped.sizing.outputs.quantity >= 1);
  });
});

test('broker-truth telemetry + legacy-universe isolation', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  t.beforeEach(async () => {
    await dropAutomationCollections();
    mods.resetAutomationUniverseProviderForTests();
    delete process.env.AUTOMATION_UNDERLYINGS;
  });

  const makePosition = (underlying, status, filledQty = 1) =>
    mods.AutomationPositionModel.create({
      source: 'AUTOMATION',
      automationSessionId: 'sess-1',
      strategyVersionId: 'sv-1',
      underlying,
      optionSymbol: `${underlying}260724C00500000`,
      direction: 'BULLISH',
      entryIntentId: `intent-${underlying}-${status}`,
      entryClientOrderId: `coid-${underlying}-${status}-${filledQty}`,
      status,
      filledQty,
      plan: { stopLossPct: 0.25, profitTargetPct: 0.3, trailingEnabled: false },
    });

  await t.test('live status is derived from AutomationPosition, never from intent', async () => {
    await mods.upsertWatchlistItem({ symbol: 'SPY', enabled: true, automationEnabled: true });
    await mods.upsertWatchlistItem({ symbol: 'QQQ', enabled: true, automationEnabled: true });
    await mods.upsertWatchlistItem({ symbol: 'IWM', enabled: true, automationEnabled: true });
    // Stored telemetry says INTENT_APPROVED, but there is NO position → stays INTENT_APPROVED.
    await mods.recordWatchlistEvaluation('SPY', { at: new Date(), status: 'INTENT_APPROVED', signal: 'BULLISH' });
    // QQQ has a real OPEN position → POSITION_OPEN. IWM has a PENDING_ENTRY → ORDER_SUBMITTED.
    await makePosition('QQQ', 'OPEN');
    await makePosition('IWM', 'PENDING_ENTRY', 0);

    const view = await mods.listWatchlistWithLiveStatus();
    const byId = Object.fromEntries(view.map((v) => [v.symbol, v]));
    assert.equal(byId.SPY.automationStatus, 'INTENT_APPROVED', 'approval is NOT reported as a position');
    assert.equal(byId.SPY.position, null);
    assert.equal(byId.QQQ.automationStatus, 'POSITION_OPEN');
    assert.equal(byId.QQQ.position.status, 'OPEN');
    assert.equal(byId.IWM.automationStatus, 'ORDER_SUBMITTED');
  });

  await t.test('EXITING and PARTIALLY_FILLED are derived from broker truth', async () => {
    await mods.upsertWatchlistItem({ symbol: 'SPY', enabled: true, automationEnabled: true });
    await mods.upsertWatchlistItem({ symbol: 'QQQ', enabled: true, automationEnabled: true });
    await makePosition('SPY', 'EXITING');
    await makePosition('QQQ', 'PENDING_ENTRY', 1); // partial fill
    const view = await mods.listWatchlistWithLiveStatus();
    const byId = Object.fromEntries(view.map((v) => [v.symbol, v]));
    assert.equal(byId.SPY.automationStatus, 'EXITING');
    assert.equal(byId.QQQ.automationStatus, 'PARTIALLY_FILLED');
  });

  await t.test('legacy AUTOMATION_UNDERLYINGS cannot override or merge with the watchlist', async () => {
    process.env.AUTOMATION_UNDERLYINGS = 'TSLA,NVDA,AMD';
    await mods.upsertWatchlistItem({ symbol: 'SPY', enabled: true, automationEnabled: true });
    mods.resetAutomationUniverseProviderForTests();
    const universe = await mods.getAutomationUniverse(Date.now());
    assert.deepEqual(universe.symbols, ['SPY'], 'env symbols are ignored; watchlist is authoritative');
    assert.equal(universe.source, 'watchlist');
    delete process.env.AUTOMATION_UNDERLYINGS;
  });
});
