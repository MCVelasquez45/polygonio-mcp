import { memo, type ComponentProps } from 'react';
import { ChartPanel } from '../trading/ChartPanel';

type Props = {
  panelProps: ComponentProps<typeof ChartPanel>;
};

export const ChartContainer = memo(function ChartContainer({ panelProps }: Props) {
  const sessionMeta = panelProps.sessionMeta;

  return (
    <div className="lg:col-span-2 flex flex-col gap-4 min-h-[26rem] min-w-0">
      {sessionMeta && (sessionMeta.marketClosed || sessionMeta.afterHours) && (
        <div
          className={`rounded-2xl border px-4 py-3 ${sessionMeta.marketClosed
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
            : 'border-sky-500/40 bg-sky-500/10 text-sky-100'
            }`}
        >
          <p className="text-sm font-semibold flex items-center gap-2">
            {sessionMeta.marketClosed ? 'Market Closed' : 'After-Hours'}
            {sessionMeta.usingLastSession && (
              <span className="text-[10px] uppercase tracking-[0.3em] opacity-80">Last Session</span>
            )}
          </p>
          <p className="text-xs mt-1">
            {sessionMeta.marketClosed
              ? 'Data reflects the last completed trading session.'
              : 'Prices are updating slower during the extended session.'}{' '}
            {sessionMeta.nextOpen && `Next session ${formatRelativeTime(sessionMeta.nextOpen) ?? ''}.`}
          </p>
          {sessionMeta.note && <p className="text-[11px] mt-1 opacity-80">{sessionMeta.note}</p>}
        </div>
      )}
      <ChartPanel {...panelProps} />
    </div>
  );
}, (prev, next) => prev.panelProps === next.panelProps);

function formatRelativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const deltaMs = timestamp - Date.now();
  const abs = Math.abs(deltaMs);
  if (abs < 60_000) return deltaMs >= 0 ? 'in under a minute' : 'less than a minute ago';
  const minutes = Math.round(abs / 60_000);
  if (minutes < 60) return deltaMs >= 0 ? `in ${minutes}m` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return deltaMs >= 0 ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return deltaMs >= 0 ? `in ${days}d` : `${days}d ago`;
}
