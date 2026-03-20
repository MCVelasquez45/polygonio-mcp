import assert from 'node:assert/strict';
import { buildBacktestChartSeries, generateEquityCurve } from '../src/components/lab/backtestChartData';

function assertAscendingUnique(times: string[]) {
  for (let i = 1; i < times.length; i += 1) {
    assert.ok(
      times[i] > times[i - 1],
      `times must be strictly ascending at index=${i}, time=${times[i]}, prev=${times[i - 1]}`,
    );
  }
}

const mockSeries = generateEquityCurve();
assertAscendingUnique(mockSeries.strategy.map(point => point.time));

const dstTransitionSeries = buildBacktestChartSeries([
  { timestamp: '2025-03-07T05:00:00.000Z', equity: 100000 },
  { timestamp: '2025-03-10T04:00:00.000Z', equity: 100100 },
  { timestamp: '2025-03-11T04:00:00.000Z', equity: 100200 },
]);

assert.deepEqual(
  dstTransitionSeries.strategy.map(point => point.time),
  ['2025-03-07', '2025-03-10', '2025-03-11'],
);
