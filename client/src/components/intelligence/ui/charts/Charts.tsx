import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Area,
  AreaChart,
} from 'recharts';
import { CHART, AXIS_TICK } from './chartTheme';

export type ChartDatum = { label: string; value: number };

type TooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: ChartDatum }>;
  formatter?: (v: number) => string;
};

function DarkTooltip({ active, payload, formatter }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border border-intel-line bg-intel-panel2 px-2.5 py-1.5 font-mono text-xs shadow-lg">
      <div className="text-intel-ink2">{d.label}</div>
      <div className="tabular-nums text-intel-ink">{formatter ? formatter(d.value) : d.value}</div>
    </div>
  );
}

/** Horizontal ranked bars, green above 0 / red below. Sorted by value desc. */
export function RankBarChart({
  data,
  height = 220,
  valueFormatter,
}: {
  data: ChartDatum[];
  height?: number;
  valueFormatter?: (v: number) => string;
}) {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 8 }}>
        <CartesianGrid horizontal={false} stroke={CHART.line} strokeDasharray="2 4" />
        <XAxis type="number" tick={AXIS_TICK} axisLine={{ stroke: CHART.line }} tickLine={false} />
        <YAxis
          type="category"
          dataKey="label"
          width={92}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={<DarkTooltip formatter={valueFormatter} />} />
        <Bar dataKey="value" radius={[0, 3, 3, 0]} barSize={16}>
          {sorted.map((d, i) => (
            <Cell key={i} fill={d.value >= 0 ? CHART.pos : CHART.neg} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Vertical distribution bars in the accent color (e.g. confidence buckets). */
export function DistributionChart({
  data,
  height = 200,
  valueFormatter,
}: {
  data: ChartDatum[];
  height?: number;
  valueFormatter?: (v: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART.line} strokeDasharray="2 4" />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: CHART.line }} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={32} />
        <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={<DarkTooltip formatter={valueFormatter} />} />
        <Bar dataKey="value" radius={[3, 3, 0, 0]} barSize={26} fill={CHART.accent} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Area trend line in the accent color. */
export function TrendChart({
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
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
        <defs>
          <linearGradient id="intel-trend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART.accent} stopOpacity={0.35} />
            <stop offset="100%" stopColor={CHART.accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={CHART.line} strokeDasharray="2 4" />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: CHART.line }} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} />
        <Tooltip content={<DarkTooltip formatter={valueFormatter} />} />
        <Area type="monotone" dataKey="value" stroke={CHART.accent} strokeWidth={2} fill="url(#intel-trend)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
