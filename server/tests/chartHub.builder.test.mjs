import assert from 'node:assert/strict';
import test from 'node:test';

const { ingestAggregateEvent } = await import('../dist/features/market/services/chartHub/builder.js');

test('chart hub builds hourly candles from minute aggregate events', () => {
  const timeframe = { key: '1/hour', multiplier: 1, timespan: 'hour', window: 200 };
  const first = Date.UTC(2026, 0, 2, 14, 30);
  const last = Date.UTC(2026, 0, 2, 14, 59);

  const firstResult = ingestAggregateEvent({
    key: 'SPY:1/hour:test',
    symbol: 'SPY',
    timeframe,
    maxMinuteBars: 720,
    event: { sym: 'SPY', ev: 'AM', s: first, o: 100, h: 102, l: 99, c: 101, v: 10 }
  });

  const finalResult = ingestAggregateEvent({
    key: 'SPY:1/hour:test',
    symbol: 'SPY',
    timeframe,
    maxMinuteBars: 720,
    event: { sym: 'SPY', ev: 'AM', s: last, o: 101, h: 104, l: 100, c: 103, v: 20 }
  });

  assert.equal(firstResult.candle.t, Date.UTC(2026, 0, 2, 14, 0));
  assert.equal(firstResult.candle.isFinal, false);
  assert.equal(finalResult.candle.t, Date.UTC(2026, 0, 2, 14, 0));
  assert.equal(finalResult.candle.o, 100);
  assert.equal(finalResult.candle.h, 104);
  assert.equal(finalResult.candle.l, 99);
  assert.equal(finalResult.candle.c, 103);
  assert.equal(finalResult.candle.v, 30);
  assert.equal(finalResult.candle.isFinal, true);
});

test('chart hub still builds multi-minute candles from minute aggregate events', () => {
  const timeframe = { key: '5/minute', multiplier: 5, timespan: 'minute', window: 780 };
  const first = Date.UTC(2026, 0, 2, 14, 30);
  const last = Date.UTC(2026, 0, 2, 14, 34);

  const firstResult = ingestAggregateEvent({
    key: 'SPY:5/minute:test',
    symbol: 'SPY',
    timeframe,
    maxMinuteBars: 720,
    event: { sym: 'SPY', ev: 'AM', s: first, o: 200, h: 201, l: 199, c: 200.5, v: 5 }
  });

  const finalResult = ingestAggregateEvent({
    key: 'SPY:5/minute:test',
    symbol: 'SPY',
    timeframe,
    maxMinuteBars: 720,
    event: { sym: 'SPY', ev: 'AM', s: last, o: 200.5, h: 203, l: 200, c: 202, v: 7 }
  });

  assert.equal(firstResult.candle.t, Date.UTC(2026, 0, 2, 14, 30));
  assert.equal(firstResult.candle.isFinal, false);
  assert.equal(finalResult.candle.t, Date.UTC(2026, 0, 2, 14, 30));
  assert.equal(finalResult.candle.o, 200);
  assert.equal(finalResult.candle.h, 203);
  assert.equal(finalResult.candle.l, 199);
  assert.equal(finalResult.candle.c, 202);
  assert.equal(finalResult.candle.v, 12);
  assert.equal(finalResult.candle.isFinal, true);
});
