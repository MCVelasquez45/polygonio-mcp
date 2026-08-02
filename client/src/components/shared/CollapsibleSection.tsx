import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

// Progressive-disclosure wrapper for advanced / secondary panels. Built on the
// native <details> element so it is keyboard- and screen-reader-accessible with
// no extra state. Collapsed by default keeps the primary workflow calm while
// the capability stays one click away — nothing is removed.

type Props = {
  title: string;
  hint?: string;
  /** Start expanded. Advanced tools should stay collapsed (the default). */
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
};

export function CollapsibleSection({ title, hint, defaultOpen = false, children, className = '' }: Props) {
  return (
    <details
      open={defaultOpen}
      className={`group rounded-panel border border-intel-line bg-intel-panel ${className}`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent">
        <ChevronRight className="h-4 w-4 text-intel-ink3 transition-transform group-open:rotate-90" aria-hidden="true" />
        <span className="font-mono text-xs font-semibold uppercase tracking-eyebrow text-intel-ink">{title}</span>
        {hint && <span className="font-mono text-[10px] text-intel-ink3">· {hint}</span>}
        <span className="ml-auto font-mono text-[10px] uppercase tracking-label text-intel-ink3 group-open:hidden">
          Show
        </span>
      </summary>
      <div className="border-t border-intel-line p-4">{children}</div>
    </details>
  );
}
