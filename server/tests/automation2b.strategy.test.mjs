// Phase 2B — indicators + strategy + closed-bar gates.
// Requirements 1, 2, 3, 4, 5, 6, 7, 8 (+ indicator exactness).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadDist,
  startTestMongo,
  stopTestMongo,
  dropAutomationCollections,
  createReadySession,
} from './automation.helpers.mjs';
import {
  BAR_MS,
  FIXTURE_NOW,
  buildBars,
  fixtureFor,
  noResetSessionFields,
} from './automation2b.fixtures.mjs';

const mods = await loadDist();

test('indicator adapter — fixed fixtures, exact/tolerance-bounded values', async (t) => {
  const config = mods.getStrategyConfig();

  await t.test('session VWAP exact on a hand-computed 3-bar series', () => {
    const bars = [
      { timestamp: 0, open: 10, high: 12, low: 8, close: 10, volume: 100 }, // typical 10
      { timestamp: BAR_MS, open: 10, high: 14, low: 10, close: 12, volume: 200 }, // typical 12
      { timestamp: 2 * BAR_MS, open: 12, high: 16, low: 12, close: 14, volume: 100 }, // typical 14
    ];
    // (10*100 + 12*200 + 14*100) / 400 = 4800/400 = 12
    assert.equal(mods.computeSessionVwap(bars, config.sessionGapMs), 12);
  });

  await t.test('VWAP anchors to the session after a gap', () => {
    const gap = config.sessionGapMs + 60_000;
    const bars = [
      { timestamp: 0, open: 1, high: 1, low: 1, close: 1, volume: 1_000_000 }, // previous session
      { timestamp: gap, open: 10, high: 12, low: 8, close: 10, volume: 100 },
      { timestamp: gap + BAR_MS, open: 10, high: 14, low: 10, close: 12, volume: 200 },
      { timestamp: gap + 2 * BAR_MS, open: 12, high: 16, low: 12, close: 14, volume: 100 },
    ];
    assert.equal(mods.computeSessionVwap(bars, config.sessionGapMs), 12, 'previous-session bar must be excluded');
  });

  await t.test('rolling volume average excludes the current bar (exact)', () => {
    const bars = Array.from({ length: 6 }, (_, i) => ({
      timestamp: i * BAR_MS,
      open: 1, high: 1, low: 1, close: 1,
      volume: i === 5 ? 9999 : 100 + i * 10, // prior: 100,110,120,130,140
    }));
    assert.equal(mods.computeRollingVolumeAvg(bars, 5), 120);
  });

  await t.test('EMA/RSI reuse the canonical signal-engine math (hand-verified)', () => {
    const mk = (closes) =>
      closes.map((close, i) => ({ timestamp: i * BAR_MS, open: close, high: close, low: close, close, volume: 1 }));
    const snapUp = mods.computeIndicatorSnapshot(mk(Array.from({ length: 20 }, (_, i) => 100 + i)), config);
    assert.equal(snapUp.rsi, 100, 'monotonic rise → RSI exactly 100');
    // EMA(3) over [1,2,3]: k=0.5 → 1 → 1.5 → 2.25 (exact, matches computeEMA seeding)
    const tinyConfig = { ...config, indicators: { ...config.indicators, emaFast: 3, emaSlow: 3 } };
    const snapTiny = mods.computeIndicatorSnapshot(mk([1, 2, 3]), tinyConfig);
    assert.ok(Math.abs(snapTiny.emaFast - 2.25) < 1e-9);
  });
});

test('strategy evaluator + closed-bar pipeline gates', async (t) => {
  await startTestMongo();
  t.after(async () => stopTestMongo());

  let mock;
  let session;
  t.beforeEach(async () => {
    await dropAutomationCollections();
    mods.clearMarketClockCache();
    mods.clearReconciliationStateForTests();
    mods.resetAutomationRuntimeForTests();
    mock = new mods.MockPaperBrokerAdapter();
    const init = await mods.initializeAutomation({ adapter: mock });
    assert.equal(init.ready, true);
    session = await createReadySession(mods, noResetSessionFields());
  });

  await t.test('1. bullish fixture produces a bullish candidate', async () => {
    const fixture = fixtureFor('bullish', 'call');
    // Self-check the fixture actually satisfies each bullish condition.
    const config = mods.getStrategyConfig();
    const snapshot = mods.computeIndicatorSnapshot(
      mods.validateClosedBars(fixture.bars, config, fixture.now).closedBars,
      config
    );
    assert.ok(snapshot.close > snapshot.vwap, `close ${snapshot.close} must exceed vwap ${snapshot.vwap}`);
    assert.ok(snapshot.emaFast > snapshot.emaSlow, 'EMA9 above EMA21');
    assert.ok(snapshot.rsi >= 50 && snapshot.rsi <= 70, `RSI ${snapshot.rsi} in [50,70]`);
    assert.ok(snapshot.barVolume > snapshot.rollingVolumeAvg, 'volume above rolling average');

    const result = await mods.processClosedBar(String(session._id), mock, fixture);
    assert.equal(result.candidate.signalDirection, 'BULLISH');
    assert.ok(['SIGNAL_FOUND', 'RISK_APPROVED', 'RISK_REJECTED'].includes(result.candidate.status));
    assert.deepEqual(result.candidate.indicatorSnapshot.close, snapshot.close);
    assert.ok(result.candidate.strategyConfigSnapshot, 'config snapshot persisted');
  });

  await t.test('2. bearish fixture produces a bearish candidate ranking puts', async () => {
    const fixture = fixtureFor('bearish', 'put');
    const result = await mods.processClosedBar(String(session._id), mock, fixture);
    assert.equal(result.candidate.signalDirection, 'BEARISH');
    assert.equal(result.selection.optionSide, 'put');
  });

  await t.test('3. mixed/incomplete conditions produce NO_TRADE with reasons', async () => {
    const fixture = fixtureFor('mixed', 'call');
    const result = await mods.processClosedBar(String(session._id), mock, fixture);
    assert.equal(result.candidate.status, 'NO_TRADE');
    assert.ok(result.candidate.reasonCodes.length > 0, 'explicit reason codes required');
    assert.equal(result.selection, null, 'no chain fetch on NO_TRADE');
    assert.equal(result.orderIntent, null);
  });

  await t.test('4. unmatched conditions are NO_TRADE — never a silent fallback', async () => {
    // Straight-up series: trend conditions pass but RSI=100 is outside [50,70].
    const fixture = fixtureFor('overbought', 'call');
    const result = await mods.processClosedBar(String(session._id), mock, fixture);
    assert.equal(result.candidate.status, 'NO_TRADE');
    assert.ok(result.candidate.reasonCodes.includes('BULL_RSI_OUT_OF_RANGE'));
    // Nothing downstream ran: no selection, no risk decision, no intent.
    assert.equal(await mods.ContractSelectionModel.countDocuments({}), 0);
    assert.equal(await mods.RiskDecisionModel.countDocuments({}), 0);
  });

  await t.test('5. the same closed bar is processed exactly once', async () => {
    const fixture = fixtureFor('bullish', 'call');
    const first = await mods.processClosedBar(String(session._id), mock, fixture);
    assert.equal(first.duplicate, false);
    const second = await mods.processClosedBar(String(session._id), mock, fixture);
    assert.equal(second.duplicate, true);
    assert.equal(String(second.candidate._id), String(first.candidate._id));
    const count = await mods.TradeCandidateModel.countDocuments({
      automationSessionId: String(session._id),
    });
    assert.equal(count, 1);
  });

  await t.test('6. a stale bar is rejected (DATA_REJECTED / STALE_BAR)', async () => {
    const staleNow = FIXTURE_NOW + 60 * 60_000; // bars are now an hour old
    const fixture = { ...fixtureFor('bullish', 'call'), now: staleNow };
    const result = await mods.processClosedBar(String(session._id), mock, fixture);
    assert.equal(result.candidate.status, 'DATA_REJECTED');
    assert.ok(result.candidate.reasonCodes.includes('STALE_BAR'));
  });

  await t.test('7. missing bar history is rejected', async () => {
    const fixture = fixtureFor('bullish', 'call');
    fixture.bars = fixture.bars.slice(-5); // far below minBarHistory
    const result = await mods.processClosedBar(String(session._id), mock, fixture);
    assert.equal(result.candidate.status, 'DATA_REJECTED');
    assert.ok(result.candidate.reasonCodes.includes('INSUFFICIENT_BAR_HISTORY'));
  });

  await t.test('bar gap inside the session is rejected', async () => {
    const fixture = fixtureFor('bullish', 'call');
    fixture.bars = fixture.bars.filter((_, i) => i !== fixture.bars.length - 10); // hole in lookback
    const result = await mods.processClosedBar(String(session._id), mock, fixture);
    assert.equal(result.candidate.status, 'DATA_REJECTED');
    assert.ok(result.candidate.reasonCodes.includes('BAR_GAP_DETECTED'));
  });

  await t.test('8. unknown market clock rejects evaluation', async () => {
    mock.setClock('unknown');
    mods.clearMarketClockCache();
    const fixture = fixtureFor('bullish', 'call');
    const result = await mods.processClosedBar(String(session._id), mock, fixture);
    assert.equal(result.candidate.status, 'CLOCK_REJECTED');
    assert.ok(result.candidate.reasonCodes.includes('MARKET_CLOCK_UNKNOWN'));
  });

  await t.test('closed market rejects evaluation', async () => {
    mock.setClock('closed');
    mods.clearMarketClockCache();
    const fixture = fixtureFor('bullish', 'call');
    const result = await mods.processClosedBar(String(session._id), mock, fixture);
    assert.equal(result.candidate.status, 'CLOCK_REJECTED');
    assert.ok(result.candidate.reasonCodes.includes('MARKET_CLOSED'));
  });
});

test('buildBars fixtures are grid-aligned and closed', () => {
  const bars = buildBars('bullish');
  for (let i = 1; i < bars.length; i += 1) {
    assert.equal(bars[i].timestamp - bars[i - 1].timestamp, BAR_MS);
  }
  const last = bars[bars.length - 1];
  assert.ok(last.timestamp + BAR_MS <= FIXTURE_NOW, 'final bar must be closed at FIXTURE_NOW');
});
