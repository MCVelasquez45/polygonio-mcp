import assert from 'node:assert/strict';
import test from 'node:test';

const studies = await import('../dist/features/assistant/orchestrator/studies.js');
const { AI_AGENTS, getAgentById } = await import('../dist/features/assistant/orchestrator/agents.js');
const { timeframeToAggregates, CONTEXT_BUILDERS } = await import(
  '../dist/features/assistant/orchestrator/contextBuilders.js'
);

function bar(i, c, v = 1000) {
  return { t: Date.UTC(2026, 0, 2, 14, 30) + i * 60_000, o: c - 0.5, h: c + 1, l: c - 1, c, v };
}

test('studies: EMA converges toward a constant series', () => {
  const values = Array.from({ length: 60 }, () => 100);
  const series = studies.ema(values, 20);
  assert.equal(series.length, 60);
  assert.ok(Math.abs(series[59] - 100) < 1e-9);
});

test('studies: RSI is 100 for a monotonically rising series and ~0 for a falling one', () => {
  const rising = Array.from({ length: 30 }, (_, i) => 100 + i);
  const falling = Array.from({ length: 30 }, (_, i) => 100 - i);
  assert.equal(studies.rsi(rising, 14), 100);
  assert.ok(studies.rsi(falling, 14) < 1);
  assert.equal(studies.rsi([1, 2, 3], 14), null); // insufficient data
});

test('studies: bollinger bands bracket the mean symmetrically', () => {
  const closes = Array.from({ length: 25 }, (_, i) => 100 + (i % 2 ? 1 : -1));
  const bands = studies.bollinger(closes, 20, 2);
  assert.ok(bands.middle > 99 && bands.middle < 101);
  assert.ok(Math.abs(bands.upper + bands.lower - 2 * bands.middle) < 1e-9);
});

test('studies: MACD null on short series, defined on long series', () => {
  assert.equal(studies.macd(Array.from({ length: 10 }, (_, i) => 100 + i)).macd, null);
  const long = Array.from({ length: 60 }, (_, i) => 100 + i * 0.3);
  const result = studies.macd(long);
  assert.ok(Number.isFinite(result.macd));
  assert.ok(Number.isFinite(result.histogram));
});

test('studies: ATR and VWAP compute on bars, summary carries all fields', () => {
  const bars = Array.from({ length: 60 }, (_, i) => bar(i, 100 + Math.sin(i / 5) * 3));
  assert.ok(studies.atr(bars, 14) > 0);
  assert.ok(studies.vwap(bars) > 95 && studies.vwap(bars) < 105);
  const summary = studies.summarizeTechnicals(bars);
  assert.equal(summary.barCount, 60);
  assert.ok(Number.isFinite(summary.lastClose));
  assert.ok(Number.isFinite(summary.rsi14));
  assert.ok(Array.isArray(summary.support));
  assert.ok(Array.isArray(summary.resistance));
});

test('agent registry: 10 agents, unique ids, mandatory provenance sections', () => {
  assert.equal(AI_AGENTS.length, 10);
  const ids = new Set(AI_AGENTS.map(agent => agent.id));
  assert.equal(ids.size, 10);
  for (const agent of AI_AGENTS) {
    assert.ok(agent.contexts.length > 0, `${agent.id} declares contexts`);
    assert.ok(agent.sections.includes('Sources Used'), `${agent.id} discloses sources used`);
    assert.ok(agent.sections.includes('Sources Unavailable'), `${agent.id} discloses gaps`);
    assert.ok(agent.sections.includes('Confidence'), `${agent.id} reports confidence`);
    for (const context of agent.contexts) {
      assert.ok(CONTEXT_BUILDERS[context], `${agent.id} context '${context}' has a builder`);
    }
  }
  assert.equal(getAgentById('technical-analyst')?.label, 'Technical Analyst');
  assert.equal(getAgentById('nope'), undefined);
});

test('timeframe mapping: client keys map to aggregate params with safe fallback', () => {
  assert.deepEqual(timeframeToAggregates('15/min'), { multiplier: 15, timespan: 'minute', window: 150 });
  assert.deepEqual(timeframeToAggregates('1/hour'), { multiplier: 1, timespan: 'hour', window: 120 });
  assert.deepEqual(timeframeToAggregates('1/day'), { multiplier: 1, timespan: 'day', window: 120 });
  assert.deepEqual(timeframeToAggregates(undefined), { multiplier: 15, timespan: 'minute', window: 120 });
  assert.deepEqual(timeframeToAggregates('garbage'), { multiplier: 15, timespan: 'minute', window: 120 });
});

test('context builders degrade to error/unavailable instead of throwing', async () => {
  // No Mongo/Alpaca/Massive configured in the test env — every builder must
  // resolve with a non-ok status rather than reject (one provider failing
  // never fails the report).
  for (const [name, builder] of Object.entries(CONTEXT_BUILDERS)) {
    const section = await builder({ symbol: 'SPY', timeframe: '15/min', contract: null });
    assert.ok(section.source, `${name} has a source`);
    assert.ok(['ok', 'unavailable', 'error'].includes(section.status), `${name} status valid`);
  }
});
