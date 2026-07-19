import type { ReactNode } from 'react';
import { toneText, type Tone } from '../../../lib/intelligenceFormat';

type MetricProps = {
  label: string;
  value: ReactNode;
  tone?: Tone;
  /** Larger value type for the one or two headline numbers in a strip. */
  emphasis?: boolean;
};

/** A single read-out cell. Designed to sit inside <MetricStrip/>. */
export function Metric({ label, value, tone = 'neutral', emphasis = false }: MetricProps) {
  return (
    <div className="bg-intel-panel px-3 py-2.5">
      <p className="font-mono text-[9.5px] uppercase tracking-label text-intel-ink3">{label}</p>
      <p
        className={`mt-1.5 font-mono tabular-nums ${emphasis ? 'text-xl' : 'text-[17px]'} ${toneText(tone)}`}
      >
        {value}
      </p>
    </div>
  );
}

type MetricStripProps = {
  children: ReactNode;
  /** Fixed column count; omit for responsive auto-fit. */
  cols?: number;
  className?: string;
};

/**
 * Seamless read-out grid — a single hairline separates cells (terminal look).
 * Wrap <Metric/> children.
 */
export function MetricStrip({ children, cols, className = '' }: MetricStripProps) {
  const style = cols
    ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }
    : { gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' };
  return (
    <div
      className={`grid gap-px overflow-hidden rounded-panel border border-intel-line bg-intel-line ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}
