// Phase 2B — pure risk engine + position sizing.
// Requirements 15, 16, 17, 18, 19, 20, 21, 22, 23, 28.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDist } from './automation.helpers.mjs';
import { FIXTURE_NOW } from './automation2b.fixtures.mjs';

const mods = await loadDist();
const config = mods.getStrategyConfig();

/** A fully-approvable baseline; each test flips exactly one input. */
function baselineInputs(overrides = {}) {
  return {
    account: { equity: 100_000, buyingPower: 50_000, isPaper: true },
    session: {
      id: 'sess-1',
      status: 'READY',
      reconciliationStatus: 'CLEAN',
      emergencyStopActive: false,
      dailyTradeCount: 0,
      dailyRealizedPnl: 0,
      consecutiveLossCount: 0,
      startingDayEquity: 100_000,
      currentDrawdown: 0,
      ...(overrides.session ?? {}),
    },
    config,
    candidate: { id: 'cand-1', barTimestamp: FIXTURE_NOW - 10 * 60_000, isDuplicate: false, ...(overrides.candidate ?? {}) },
    selectedContract: overrides.hasOwnProperty('selectedContract')
      ? overrides.selectedContract
      : {
          symbol: 'SPY260724C00500000',
          ask: 1.2,
          bid: 1.1,
          spreadPct: 0.087,
          quoteTimestamp: new Date(FIXTURE_NOW - 30_000),
        },
    openAutomationPositions: overrides.openAutomationPositions ?? 0,
    unresolvedAutomationOrders: overrides.unresolvedAutomationOrders ?? 0,
    marketDataOk: overrides.marketDataOk ?? true,
    underlyingBarAgeMs: overrides.underlyingBarAgeMs ?? 5 * 60_000,
    clockDecision: overrides.clockDecision ?? { state: 'OPEN', canEnter: true },
    mongoConnected: overrides.mongoConnected ?? true,
    automationReady: overrides.automationReady ?? true,
    now: FIXTURE_NOW,
    ...(overrides.top ?? {}),
  };
}

function failedCheck(result, name) {
  return result.checks.find(check => check.name === name && !check.passed);
}

test('baseline inputs are approved with full check + sizing records', () => {
  const result = mods.evaluateRisk(baselineInputs());
  assert.equal(result.approved, true, JSON.stringify(result.reasonCodes));
  assert.ok(result.checks.length >= 16, 'every check must be recorded');
  assert.ok(result.checks.every(check => typeof check.detail === 'string'));
  assert.equal(result.sizing.outputs.quantity, 4, 'floor(250/60)=4, uncapped at this equity/BP');
});

test('15. daily-loss breach rejects', () => {
  const result = mods.evaluateRisk(baselineInputs({ session: { dailyRealizedPnl: -800 } })); // limit 750
  assert.equal(result.approved, false);
  assert.ok(result.reasonCodes.includes('RISK_MAX_DAILY_LOSS'));
  assert.ok(failedCheck(result, 'dailyLossWithinLimit'));
});

test('16. drawdown breach rejects', () => {
  const result = mods.evaluateRisk(baselineInputs({ session: { currentDrawdown: 2500 } })); // limit 2000
  assert.equal(result.approved, false);
  assert.ok(result.reasonCodes.includes('RISK_MAX_DRAWDOWN'));
});

test('17. max-trades breach rejects', () => {
  const result = mods.evaluateRisk(baselineInputs({ session: { dailyTradeCount: 2 } }));
  assert.equal(result.approved, false);
  assert.ok(result.reasonCodes.includes('RISK_MAX_TRADES'));
});

test('18. consecutive-loss cooldown rejects', () => {
  const result = mods.evaluateRisk(baselineInputs({ session: { consecutiveLossCount: 2 } }));
  assert.equal(result.approved, false);
  assert.ok(result.reasonCodes.includes('RISK_CONSECUTIVE_LOSS_COOLDOWN'));
});

test('19. existing automation position rejects', () => {
  const result = mods.evaluateRisk(baselineInputs({ openAutomationPositions: 1 }));
  assert.equal(result.approved, false);
  assert.ok(result.reasonCodes.includes('RISK_EXISTING_POSITION'));
});

test('20. unresolved automation order rejects', () => {
  const result = mods.evaluateRisk(baselineInputs({ unresolvedAutomationOrders: 1 }));
  assert.equal(result.approved, false);
  assert.ok(result.reasonCodes.includes('RISK_UNRESOLVED_ORDER'));
});

test('21. insufficient buying power rejects', () => {
  const result = mods.evaluateRisk(baselineInputs({ top: { account: { equity: 100_000, buyingPower: 50, isPaper: true } } }));
  assert.equal(result.approved, false);
  assert.ok(result.reasonCodes.includes('RISK_INSUFFICIENT_BUYING_POWER'));
});

test('other mandated rejections: mongo, readiness, reconciliation, e-stop, clock, stale data, spread, no contract, duplicate', () => {
  const cases = [
    [{ mongoConnected: false }, 'RISK_MONGO_UNAVAILABLE'],
    [{ automationReady: false }, 'RISK_AUTOMATION_NOT_READY'],
    [{ session: { reconciliationStatus: 'MANUAL_REVIEW' } }, 'RISK_RECONCILIATION_NOT_CLEAN'],
    [{ session: { emergencyStopActive: true } }, 'RISK_EMERGENCY_STOP'],
    [{ clockDecision: { state: 'CLOSED', canEnter: false } }, 'RISK_MARKET_NOT_OPEN'],
    [{ underlyingBarAgeMs: 60 * 60_000 }, 'RISK_STALE_UNDERLYING_BAR'],
    [{ selectedContract: { symbol: 'X', ask: 1.2, bid: 1.1, spreadPct: 0.5, quoteTimestamp: new Date(FIXTURE_NOW - 30_000) } }, 'RISK_SPREAD_TOO_WIDE'],
    [{ selectedContract: null }, 'RISK_NO_VALID_CONTRACT'],
    [{ selectedContract: { symbol: 'X', ask: 1.2, bid: 1.1, spreadPct: 0.087, quoteTimestamp: new Date(FIXTURE_NOW - 10 * 60_000) } }, 'RISK_STALE_OPTION_QUOTE'],
    [{ candidate: { id: 'cand-1', barTimestamp: 0, isDuplicate: true } }, 'RISK_DUPLICATE_CANDIDATE'],
  ];
  for (const [override, code] of cases) {
    const result = mods.evaluateRisk(baselineInputs(override));
    assert.equal(result.approved, false, code);
    assert.ok(result.reasonCodes.includes(code), `${code} expected, got ${result.reasonCodes}`);
  }
});

test('22. position sizing computes the documented quantity (exact)', () => {
  const sizing = mods.computePositionSize({
    accountEquity: 100_000,
    buyingPower: 50_000,
    selectedAsk: 1.2,
    config: config.risk,
  });
  // premium = 1.2×100 = 120; plannedLoss = 120×0.5 = 60;
  // riskBudget = 100000×0.0025 = 250; raw = floor(250/60) = 4;
  // bpCap = floor(50000/120) = 416; costCap = floor(5000/120) = 41 → qty 4.
  assert.equal(sizing.outputs.premiumCostPerContract, 120);
  assert.equal(sizing.outputs.plannedLossPerContract, 60);
  assert.equal(sizing.outputs.riskBudget, 250);
  assert.equal(sizing.outputs.rawQuantity, 4);
  assert.equal(sizing.outputs.quantity, 4);
  assert.equal(sizing.outputs.rejectedReason, null);
  // Caps engage: tiny buying power binds the quantity.
  const capped = mods.computePositionSize({
    accountEquity: 100_000,
    buyingPower: 250,
    selectedAsk: 1.2,
    config: config.risk,
  });
  assert.equal(capped.outputs.quantity, 2, 'buying-power cap floor(250/120)=2');
});

test('23. sizing rejects quantity below 1 (never hardcodes 1)', () => {
  const sizing = mods.computePositionSize({
    accountEquity: 10_000, // budget 25 < plannedLoss 60
    buyingPower: 50_000,
    selectedAsk: 1.2,
    config: config.risk,
  });
  assert.equal(sizing.outputs.quantity, 0);
  assert.ok(sizing.outputs.rejectedReason);
  const risk = mods.evaluateRisk(
    baselineInputs({ top: { account: { equity: 10_000, buyingPower: 50_000, isPaper: true } }, session: { startingDayEquity: 10_000 } })
  );
  assert.equal(risk.approved, false);
  assert.ok(risk.reasonCodes.includes('RISK_QUANTITY_BELOW_ONE'));
});

test('28. AI output cannot affect risk approval (structurally excluded)', () => {
  const approveBase = mods.evaluateRisk(baselineInputs());
  const approveWithAi = mods.evaluateRisk({
    ...baselineInputs(),
    ai: { recommendation: 'REJECT', confidence: 1 },
    aiOverride: 'REJECT',
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(approveWithAi)),
    JSON.parse(JSON.stringify(approveBase)),
    'extra AI fields must change nothing'
  );

  const rejectBase = mods.evaluateRisk(baselineInputs({ session: { dailyRealizedPnl: -800 } }));
  const rejectWithAi = mods.evaluateRisk({
    ...baselineInputs({ session: { dailyRealizedPnl: -800 } }),
    ai: { recommendation: 'APPROVE', confidence: 1 },
  });
  assert.equal(rejectWithAi.approved, false, 'AI approval cannot rescue a risk rejection');
  assert.deepEqual(rejectWithAi.reasonCodes, rejectBase.reasonCodes);
});
