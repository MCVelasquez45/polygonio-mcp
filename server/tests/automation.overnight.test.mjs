// Critical overnight-position recovery + option-mark freshness repair.
//
// Proves: an automation-owned position discovered OPEN while the options market
// is CLOSED is detected as an overnight carry, durably persisted, blocks new
// entries, waits for the earliest valid session, then flattens with exactly one
// deterministic recovery exit and releases the slot only after a broker-confirmed
// close — and that mark freshness is judged on the provider quote timestamp, so
// a mandatory (EOD / overnight) exit is never blocked by a stale mark.
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
const overnight = await import(
  '../dist/features/automation/services/overnightRecovery.service.js'
);
const marketData = await import(
  '../dist/features/automation/services/automationMarketData.service.js'
);
const massive = await import('../dist/shared/data/massive.js');

const OPTION = 'SPY260724P00756000';
const ENTRY_LINKS = (sessionId) => ({
  automationSessionId: sessionId,
  strategyVersionId: 'sv-test-1',
  universeEvaluationId: null,
  tradeCandidateId: null,
  contractSelectionId: null,
  riskDecisionId: null,
  underlying: 'SPY',
  optionSymbol: OPTION,
  direction: 'BEARISH',
});

const STUB_MARK = async () => ({ mark: 6.1, stale: false });
const THROWING_MARK = async () => {
  throw new Error('mark provider unavailable');
};

async function openPosition(mock, sessionId, { qty = 1, entryPrice = 6.12 } = {}) {
  const { intent } = await mods.createOrderIntent({
    automationSessionId: sessionId,
    strategyVersionId: 'sv-test-1',
    underlying: 'SPY',
    signalDirection: 'BUY',
    closedBarTimestamp: new Date('2026-07-10T15:00:00.000Z'),
    intentType: 'ENTRY',
    optionSymbol: OPTION,
    quantity: qty,
    orderType: 'limit',
    limitPrice: entryPrice,
    timeInForce: 'day',
  });
  intent.status = 'APPROVED_AWAITING_EXECUTION';
  await intent.save();
  mock.scriptOrder(intent.clientOrderId, {
    onSubmit: 'accept',
    pollSequence: [{ rawStatus: 'filled', filledQty: qty, avgFillPrice: entryPrice }],
  });
  const exec = await mods.executeApprovedEntry(intent, mock, ENTRY_LINKS(sessionId));
  await mods.runSchedulerTick(sessionId, mock, {
    markProvider: STUB_MARK,
    now: Date.parse('2026-07-10T18:00:00.000Z'), // PRE_CUTOFF (mock close is 20:00Z)
  });
  const pos = await mods.AutomationPositionModel.findById(exec.positionId);
  assert.equal(pos.status, 'OPEN');
  return pos;
}

// Times anchored to the mock clock (nextClose 2026-07-10T20:00Z, nextOpen 2026-07-13T13:30Z).
const CLOSED_TICK = Date.parse('2026-07-10T22:00:00.000Z'); // clock 'closed' → phase CLOSED
const OPEN_TICK = Date.parse('2026-07-13T14:00:00.000Z'); // next session, after next_open + skew

test('overnight recovery + mark freshness', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  let mock;
  let session;
  t.beforeEach(async () => {
    await dropAutomationCollections();
    mods.clearMarketClockCache();
    mods.clearReconciliationStateForTests();
    mods.resetAutomationRuntimeForTests();
    mods.resetMonitorControllerForTests();
    mock = new mods.MockPaperBrokerAdapter();
    mock.setClock('open');
    session = await createReadySession(mods, {
      underlying: 'SPY',
      reconciliationStatus: 'CLEAN',
      lastResetTradingDate: '2026-07-15',
      startingDayEquity: 100_000,
    });
  });

  // ---- pure detection --------------------------------------------------------
  await t.test('assessOvernightCarry: open + market CLOSED is a carry', () => {
    const a = overnight.assessOvernightCarry({
      status: 'OPEN', filledQty: 1, source: 'AUTOMATION', marketOpen: false,
      nextOpen: new Date('2026-07-16T13:30:00.000Z'), sessionOpenSkewMs: 60_000,
    });
    assert.equal(a.required, true);
    assert.equal(a.reason, 'CARRIED_PAST_FLATTEN_WINDOW');
    assert.equal(a.eligibleAt.toISOString(), '2026-07-16T13:31:00.000Z');
  });

  await t.test('assessOvernightCarry: market OPEN is NOT a carry', () => {
    const a = overnight.assessOvernightCarry({
      status: 'OPEN', filledQty: 1, source: 'AUTOMATION', marketOpen: true,
      nextOpen: null, sessionOpenSkewMs: 60_000,
    });
    assert.equal(a.required, false);
  });

  await t.test('assessOvernightCarry: non-automation source is never a carry', () => {
    const a = overnight.assessOvernightCarry({
      status: 'OPEN', filledQty: 100, source: 'MANUAL', marketOpen: false,
      nextOpen: new Date('2026-07-16T13:30:00.000Z'), sessionOpenSkewMs: 0,
    });
    assert.equal(a.required, false);
  });

  await t.test('isRecoveryExitEligible: closed market is never eligible', () => {
    const pos = { overnightRecoveryRequired: true, recoveryExitEligibleAt: new Date(0) };
    assert.equal(overnight.isRecoveryExitEligible(pos, false, new Date(OPEN_TICK)), false);
    assert.equal(overnight.isRecoveryExitEligible(pos, true, new Date(OPEN_TICK)), true);
  });

  // ---- detection through the scheduler tick ---------------------------------
  await t.test('startup with no positions: nothing flagged', async () => {
    mock.setClock('closed');
    const r = await mods.runSchedulerTick(String(session._id), mock, { markProvider: STUB_MARK, now: CLOSED_TICK });
    assert.equal(r.positionsMonitored, 0);
    assert.equal(await overnight.countOvernightRecoveryPositions(String(session._id)), 0);
  });

  await t.test('open position while market OPEN is NOT flagged overnight', async () => {
    const pos = await openPosition(mock, String(session._id));
    await mods.runSchedulerTick(String(session._id), mock, { markProvider: STUB_MARK, now: Date.parse('2026-07-10T18:05:00.000Z') });
    const fresh = await mods.AutomationPositionModel.findById(pos._id);
    assert.equal(fresh.overnightRecoveryRequired, false);
  });

  await t.test('open position while market CLOSED is flagged + persisted (no exit)', async () => {
    const pos = await openPosition(mock, String(session._id));
    mock.setClock('closed');
    const r = await mods.runSchedulerTick(String(session._id), mock, { markProvider: THROWING_MARK, now: CLOSED_TICK });
    assert.equal(r.exitsTriggered, 0);
    const fresh = await mods.AutomationPositionModel.findById(pos._id);
    assert.equal(fresh.status, 'OPEN'); // broker truth preserved
    assert.equal(fresh.overnightRecoveryRequired, true);
    assert.ok(fresh.overnightDetectedAt);
    assert.equal(fresh.overnightReason, 'CARRIED_PAST_FLATTEN_WINDOW');
    // eligibility = mock next_open (2026-07-13T13:30Z) + 60s skew.
    assert.equal(fresh.recoveryExitEligibleAt.toISOString(), '2026-07-13T13:31:00.000Z');
    // durable across "restart": flag survives a fresh read.
    assert.equal(await overnight.countOvernightRecoveryPositions(String(session._id)), 1);
  });

  // ---- entry blocking --------------------------------------------------------
  await t.test('overnight carry blocks candidate approval with its own reason', () => {
    const base = {
      account: { equity: 100_000, buyingPower: 100_000, isPaper: true },
      session: {
        id: 's', status: 'READY', reconciliationStatus: 'CLEAN', emergencyStopActive: false,
        dailyTradeCount: 0, dailyRealizedPnl: 0, consecutiveLossCount: 0, startingDayEquity: 100_000, currentDrawdown: 0,
      },
      config: mods.getStrategyConfig('SPY'),
      candidate: { id: 'c', barTimestamp: OPEN_TICK, isDuplicate: false },
      selectedContract: { symbol: OPTION, ask: 6.2, bid: 6.0, spreadPct: 0.03, quoteTimestamp: OPEN_TICK },
      openAutomationPositions: 0,
      unresolvedAutomationOrders: 0,
      overnightRecoveryPositions: 1,
      marketDataOk: true, underlyingBarAgeMs: 1000,
      clockDecision: { state: 'OPEN', canEnter: true },
      mongoConnected: true, automationReady: true, now: OPEN_TICK,
    };
    const res = mods.evaluateRisk(base);
    assert.equal(res.approved, false);
    assert.ok(res.reasonCodes.includes('OVERNIGHT_POSITION_BLOCKS_ENTRY'));
    // and it clears when there is no carry.
    const ok = mods.evaluateRisk({ ...base, overnightRecoveryPositions: 0 });
    assert.ok(!ok.reasonCodes.includes('OVERNIGHT_POSITION_BLOCKS_ENTRY'));
  });

  // ---- earliest-session recovery exit ---------------------------------------
  await t.test('first open-session tick submits exactly one recovery exit → CLOSED', async () => {
    const pos = await openPosition(mock, String(session._id));
    mock.setClock('closed');
    await mods.runSchedulerTick(String(session._id), mock, { markProvider: THROWING_MARK, now: CLOSED_TICK });

    // Earliest valid session: market opens, recovery exit fills.
    mock.setClock('open');
    mock.setDefaultScript({ onSubmit: 'fill' });
    mock.setMarketFillPrice(5.4);
    const r = await mods.runSchedulerTick(String(session._id), mock, { markProvider: THROWING_MARK, now: OPEN_TICK });
    assert.equal(r.exitsTriggered, 1);

    const fresh = await mods.AutomationPositionModel.findById(pos._id);
    assert.equal(fresh.status, 'CLOSED');
    assert.equal(fresh.exitReason, 'OVERNIGHT_RECOVERY');
    assert.ok(fresh.recoveryExitSubmittedAt);
    assert.equal(fresh.exitAttemptCount, 1);

    // Exactly one EXIT intent exists.
    const exits = await mods.OrderIntentModel.countDocuments({ automationSessionId: String(session._id), intentType: 'EXIT' });
    assert.equal(exits, 1);
  });

  await t.test('duplicate ticks / restart do not duplicate the recovery exit', async () => {
    await openPosition(mock, String(session._id));
    mock.setClock('closed');
    await mods.runSchedulerTick(String(session._id), mock, { markProvider: THROWING_MARK, now: CLOSED_TICK });
    mock.setClock('open');
    mock.setDefaultScript({ onSubmit: 'fill' });
    mock.setMarketFillPrice(5.4);
    await mods.runSchedulerTick(String(session._id), mock, { markProvider: THROWING_MARK, now: OPEN_TICK });
    // Simulate a second tick / a restart re-running the monitor.
    await mods.runSchedulerTick(String(session._id), mock, { markProvider: THROWING_MARK, now: OPEN_TICK + 30_000 });
    const exits = await mods.OrderIntentModel.countDocuments({ automationSessionId: String(session._id), intentType: 'EXIT' });
    assert.equal(exits, 1);
  });

  await t.test('stale/failed mark does NOT suppress the overnight recovery exit', async () => {
    const pos = await openPosition(mock, String(session._id));
    mock.setClock('closed');
    await mods.runSchedulerTick(String(session._id), mock, { markProvider: THROWING_MARK, now: CLOSED_TICK });
    mock.setClock('open');
    mock.setDefaultScript({ onSubmit: 'fill' });
    mock.setMarketFillPrice(5.4);
    // A throwing mark provider must not prevent the mandatory flatten.
    const r = await mods.runSchedulerTick(String(session._id), mock, { markProvider: THROWING_MARK, now: OPEN_TICK });
    assert.equal(r.exitsTriggered, 1);
    const fresh = await mods.AutomationPositionModel.findById(pos._id);
    assert.equal(fresh.status, 'CLOSED');
    assert.equal(fresh.exitReason, 'OVERNIGHT_RECOVERY');
  });

  await t.test('closed recovery releases the entry slot (intents COMPLETED)', async () => {
    await openPosition(mock, String(session._id));
    mock.setClock('closed');
    await mods.runSchedulerTick(String(session._id), mock, { markProvider: THROWING_MARK, now: CLOSED_TICK });
    mock.setClock('open');
    mock.setDefaultScript({ onSubmit: 'fill' });
    mock.setMarketFillPrice(5.4);
    await mods.runSchedulerTick(String(session._id), mock, { markProvider: THROWING_MARK, now: OPEN_TICK });

    const submitted = await mods.OrderIntentModel.countDocuments({ automationSessionId: String(session._id), status: 'SUBMITTED' });
    assert.equal(submitted, 0, 'no SUBMITTED intents remain → slot released');
    assert.equal(await overnight.countOvernightRecoveryPositions(String(session._id)), 0, 'closed carry no longer counts');
  });

  // ---- stale-mark semantics --------------------------------------------------
  await t.test('applyMark stamps the provider quote timestamp, not the loop tick', () => {
    const providerTs = Date.parse('2026-07-16T11:33:18.000Z');
    const tickNow = new Date('2026-07-16T11:33:30.000Z'); // 12s later (slow pagination)
    const pos = { avgEntryPrice: 6.12, filledQty: 1, currentMark: null, lastMarkAt: null, maxFavorableExcursion: null, maxAdverseExcursion: null };
    mods.applyMark(pos, 5.4, tickNow, providerTs);
    assert.equal(pos.lastMarkAt.getTime(), providerTs, 'lastMarkAt = provider quote time');
    assert.notEqual(pos.lastMarkAt.getTime(), tickNow.getTime());
  });

  await t.test('applyMark falls back to now only when no provider timestamp', () => {
    const tickNow = new Date('2026-07-16T11:33:30.000Z');
    const pos = { avgEntryPrice: 6.12, filledQty: 1, currentMark: null, lastMarkAt: null, maxFavorableExcursion: null, maxAdverseExcursion: null };
    mods.applyMark(pos, 5.4, tickNow, null);
    assert.equal(pos.lastMarkAt.getTime(), tickNow.getTime());
  });

  await t.test('isMarkStale: fresh provider quote survives slow pagination; old/missing/null are stale', () => {
    const threshold = 120_000;
    // Fresh quote, but the request itself took 12s — still FRESH (age from quote ts).
    assert.equal(marketData.isMarkStale({ mark: 5.4, providerQuoteTimestamp: 1_000_000, computedAgeMs: 12_000 }, threshold), false);
    // Old quote (market closed) — STALE.
    assert.equal(marketData.isMarkStale({ mark: 5.4, providerQuoteTimestamp: 1, computedAgeMs: 5_000_000 }, threshold), true);
    // Missing provider timestamp — STALE (never trust an untimed quote).
    assert.equal(marketData.isMarkStale({ mark: 5.4, providerQuoteTimestamp: null, computedAgeMs: null }, threshold), true);
    // No usable mark — STALE.
    assert.equal(marketData.isMarkStale({ mark: null, providerQuoteTimestamp: 1_000_000, computedAgeMs: 0 }, threshold), true);
  });

  await t.test('stale mark suppresses a price stop but NOT the EOD flatten', async () => {
    const pos = await openPosition(mock, String(session._id)); // entry 6.12, stop 4.59
    // Stale mark below the stop → HARD_STOP must NOT fire.
    const outcome = await mods.monitorAndMaybeExit(
      await mods.AutomationPositionModel.findById(pos._id),
      mock,
      { emergencyStop: false, flatten: false, brokerClosed: false, strategyInvalidated: false, currentMark: 1.0, quoteStale: true },
      new Date('2026-07-10T18:30:00.000Z')
    );
    assert.equal(outcome.exited, false, 'stale mark suppresses the price stop');

    // FLATTEN window with a throwing mark provider → END_OF_DAY still fires.
    mock.setDefaultScript({ onSubmit: 'fill' });
    mock.setMarketFillPrice(1.0);
    const r = await mods.runSchedulerTick(String(session._id), mock, {
      markProvider: THROWING_MARK,
      now: Date.parse('2026-07-10T19:50:00.000Z'), // FLATTEN (10m to 20:00Z close)
    });
    assert.equal(r.exitsTriggered, 1);
    const fresh = await mods.AutomationPositionModel.findById(pos._id);
    assert.equal(fresh.status, 'CLOSED');
    assert.equal(fresh.exitReason, 'END_OF_DAY');
  });

  // ---- request efficiency ----------------------------------------------------
  await t.test('held-position monitoring outranks watchlist research in the request queue', () => {
    assert.ok(
      massive.REQUEST_PRIORITY.OPEN_POSITION < massive.REQUEST_PRIORITY.WATCHLIST,
      'OPEN_POSITION priority must drain before WATCHLIST'
    );
    assert.ok(massive.REQUEST_PRIORITY.CRITICAL_EXIT <= massive.REQUEST_PRIORITY.OPEN_POSITION);
  });
});
