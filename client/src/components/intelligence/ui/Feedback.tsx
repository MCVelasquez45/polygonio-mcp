import type { ReactNode } from 'react';
import { fmtWholePct, ABSENT } from '../../../lib/intelligenceFormat';

/** Centered empty / loading / error state. */
export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-panel border border-intel-line bg-intel-panel px-6 py-14 text-center">
      {icon && <div className="mb-3 text-intel-ink3" aria-hidden="true">{icon}</div>}
      <p className="text-sm font-semibold text-intel-ink">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-intel-ink2">{hint}</p>}
    </div>
  );
}

/** Inline alert with a role for screen readers. */
export function AlertBanner({ tone = 'error', children }: { tone?: 'error' | 'info' | 'warn'; children: ReactNode }) {
  const cls =
    tone === 'error'
      ? 'border-intel-neg/40 bg-intel-neg/10 text-intel-neg'
      : tone === 'warn'
        ? 'border-intel-warn/40 bg-intel-warn/10 text-intel-warn'
        : 'border-intel-info/40 bg-intel-info/10 text-intel-info';
  return (
    <div role="alert" className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  );
}

/** Evidence-quality banner: a completeness bar + count of missing sources. */
export function EvidenceBanner({ percent, missingCount }: { percent: number | null; missingCount: number }) {
  const pct = typeof percent === 'number' && Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
  const tone = pct == null ? 'neutral' : pct >= 90 ? 'pos' : pct >= 70 ? 'warn' : 'neg';
  const barCls = tone === 'pos' ? 'bg-intel-pos' : tone === 'warn' ? 'bg-intel-warn' : tone === 'neg' ? 'bg-intel-neg' : 'bg-intel-ink3';
  return (
    <div className="rounded-lg border border-intel-line bg-intel-panel2 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs uppercase tracking-label text-intel-ink3">Evidence completeness</span>
        <span className="font-mono text-sm tabular-nums text-intel-ink">{pct == null ? ABSENT : fmtWholePct(pct)}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-intel-bg">
        <div className={`h-full rounded-full ${barCls}`} style={{ width: `${pct ?? 0}%` }} />
      </div>
      {missingCount > 0 && (
        <p className="mt-2 font-mono text-[11px] text-intel-ink3">{missingCount} evidence source{missingCount === 1 ? '' : 's'} missing</p>
      )}
    </div>
  );
}
