type ChartPoint = {
  time: string;
  value: number;
};

type EquityCurvePoint = {
  timestamp: string;
  equity: number;
};

export type BacktestChartSeries = {
  strategy: ChartPoint[];
  benchmark: ChartPoint[];
};

function sortAndDedupePoints(points: ChartPoint[]): ChartPoint[] {
  const byTime = new Map<string, number>();
  for (const point of points) {
    byTime.set(point.time, point.value);
  }

  return Array.from(byTime, ([time, value]) => ({ time, value }))
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

export function generateEquityCurve(days: number = 365): BacktestChartSeries {
  let value = 100000;
  let benchmark = 100000;
  const data: ChartPoint[] = [];
  const benchmarkData: ChartPoint[] = [];

  const date = new Date(Date.UTC(2025, 0, 1));

  for (let i = 0; i < days; i += 1) {
    const change = (Math.random() - 0.48) * 0.02;
    const benchChange = (Math.random() - 0.49) * 0.015;

    value *= 1 + change;
    benchmark *= 1 + benchChange;

    if (i % 30 === 0 && Math.random() > 0.5) {
      value *= 1.02;
    }

    const time = date.toISOString().slice(0, 10);
    data.push({ time, value });
    benchmarkData.push({ time, value: benchmark });

    date.setUTCDate(date.getUTCDate() + 1);
  }

  return {
    strategy: sortAndDedupePoints(data),
    benchmark: sortAndDedupePoints(benchmarkData),
  };
}

export function buildBacktestChartSeries(equityCurve?: EquityCurvePoint[]): BacktestChartSeries {
  if (!equityCurve?.length) {
    return generateEquityCurve();
  }

  const strategy = sortAndDedupePoints(
    equityCurve.map(point => ({
      time: point.timestamp.slice(0, 10),
      value: point.equity,
    })),
  );
  const first = strategy[0]?.value ?? 100000;
  const benchmark = strategy.map((point, index) => ({
    time: point.time,
    value: first * (1 + index * 0.0008),
  }));

  return { strategy, benchmark };
}
