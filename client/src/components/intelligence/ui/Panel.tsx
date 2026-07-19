import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

type PanelProps = {
  title: string;
  icon?: ReactNode;
  /** Right-aligned header preview (shown whether open or closed). */
  summary?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
};

/**
 * Titled section card. When `collapsible`, the body is demoted behind a
 * disclosure — the mechanism that pushes Evidence / Timeline / Raw Data below
 * the fold on every intelligence page. Accessible: real <button aria-expanded>.
 */
export function Panel({
  title,
  icon,
  summary,
  collapsible = false,
  defaultOpen = true,
  children,
}: PanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = `panel-${title.replace(/\s+/g, '-').toLowerCase()}`;

  const header = (
    <>
      {icon && <span className="text-intel-accent" aria-hidden="true">{icon}</span>}
      <span className="text-sm font-semibold text-intel-ink">{title}</span>
      {summary && (
        <span className="ml-auto font-mono text-xs tabular-nums text-intel-ink2">{summary}</span>
      )}
      {collapsible && (
        <ChevronDown
          className={`h-4 w-4 flex-none text-intel-ink3 transition-transform ${open ? 'rotate-180' : ''} ${summary ? 'ml-2' : 'ml-auto'}`}
          aria-hidden="true"
        />
      )}
    </>
  );

  if (!collapsible) {
    return (
      <section className="rounded-panel border border-intel-line bg-intel-panel p-4">
        <div className="mb-3 flex items-center gap-2">{header}</div>
        {children}
      </section>
    );
  }

  return (
    <section className="rounded-panel border border-intel-line bg-intel-panel">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-2 px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent"
      >
        {header}
      </button>
      {open && (
        <div id={bodyId} className="px-4 pb-4">
          {children}
        </div>
      )}
    </section>
  );
}
