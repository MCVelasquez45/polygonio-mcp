import type { ReactNode } from 'react';
import { RefreshCcw } from 'lucide-react';

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
};

/**
 * Consistent page masthead across the workspace — a slim terminal toolbar, not
 * a hero band. The title reads as a workspace label; the description survives
 * only as a hover title so the first visible row of every page is data.
 */
export function PageHeader({ eyebrow = 'Trading Intelligence', title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-2" title={description}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-mono text-xs font-semibold uppercase tracking-eyebrow text-intel-ink">{title}</h1>
        <p className="font-mono text-[10px] uppercase tracking-label text-intel-ink3">{eyebrow}</p>
      </div>
      {actions && <div className="flex flex-none items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Standard refresh control. */
export function RefreshButton({ onClick, busy = false, label = 'Refresh' }: { onClick: () => void; busy?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-intel-line px-3 font-mono text-xs tracking-wide text-intel-ink2 transition hover:border-intel-accentLine hover:text-intel-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent disabled:opacity-50"
    >
      <RefreshCcw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
      {label}
    </button>
  );
}
