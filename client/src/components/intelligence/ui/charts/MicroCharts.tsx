import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { CHART } from './chartTheme';
import type { ChartDatum } from './Charts';

type SparkTone = 'accent' | 'pos' | 'neg' | 'auto';

/**
 * Tiny inline trend line, hand-built SVG (no axes, no sizing quirks at small
 * scale). `auto` colors by the net direction of the series.
 */
export function Sparkline({
  values,
  width = 104,
  height = 28,
  tone = 'auto',
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: SparkTone;
}) {
  if (!values || values.length < 2) {
    return <span className="font-mono text-[11px] text-intel-ink3">Not recorded</span>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = (i / (n - 1)) * (width - 2) + 1;
    const y = height - 1 - ((v - min) / range) * (height - 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const color =
    tone === 'pos' ? CHART.pos
    : tone === 'neg' ? CHART.neg
    : tone === 'auto' ? (values[n - 1] >= values[0] ? CHART.pos : CHART.neg)
    : CHART.accent;
  const [lastX, lastY] = pts[pts.length - 1].split(',');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="overflow-visible">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={2.2} fill={color} />
    </svg>
  );
}

const DONUT_PALETTE = [CHART.accent, CHART.info, CHART.pos, CHART.warn, CHART.neg, '#a78bfa', '#f0abfc', CHART.ink3];

/** Allocation donut (positions by value, exposure split, etc.). */
export function DonutChart({
  data,
  height = 180,
  valueFormatter,
}: {
  data: ChartDatum[];
  height?: number;
  valueFormatter?: (v: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="label" innerRadius="58%" outerRadius="82%" paddingAngle={2} stroke="none">
          {data.map((_, i) => (
            <Cell key={i} fill={DONUT_PALETTE[i % DONUT_PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip
          content={({ active, payload }: any) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as ChartDatum;
            return (
              <div className="rounded-md border border-intel-line bg-intel-panel2 px-2.5 py-1.5 font-mono text-xs shadow-lg">
                <div className="text-intel-ink2">{d.label}</div>
                <div className="tabular-nums text-intel-ink">{valueFormatter ? valueFormatter(d.value) : d.value}</div>
              </div>
            );
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
