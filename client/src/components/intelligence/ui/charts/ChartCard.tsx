import type { ReactNode } from 'react';
import { EmptyState } from '../Feedback';

type ChartCardProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** When false, shows an empty state instead of the chart. */
  hasData?: boolean;
  emptyHint?: string;
};

/** Titled container for a chart. Handles the no-data case so charts never render blank axes. */
export function ChartCard({ title, subtitle, children, hasData = true, emptyHint }: ChartCardProps) {
  return (
    <section className="rounded-panel border border-intel-line bg-intel-panel p-4">
      <div className="mb-3">
        <h3 className="font-mono text-xs uppercase tracking-label text-intel-ink3">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-intel-ink2">{subtitle}</p>}
      </div>
      {hasData ? children : <EmptyState title="No data yet" hint={emptyHint ?? 'This cohort had no trades in the selected window.'} />}
    </section>
  );
}
