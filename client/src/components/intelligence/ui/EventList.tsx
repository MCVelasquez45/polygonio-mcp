import { useState } from 'react';
import { EMPTY } from '../../../lib/intelligenceFormat';

export type EventItem = {
  code: string;
  message: string;
  meta?: string | null;
  severity?: 'info' | 'warning' | 'critical';
};

const SEV_DOT: Record<NonNullable<EventItem['severity']>, string> = {
  info: 'bg-intel-info',
  warning: 'bg-intel-warn',
  critical: 'bg-intel-neg',
};

type EventListProps = {
  items: EventItem[];
  /** How many to show before the "show all" affordance. */
  limit?: number;
  /** Noun for the empty state, e.g. "warnings". */
  emptyNoun: string;
};

/**
 * Renders a bounded list that NEVER truncates silently — the fix for the
 * `slice(0, N)` calls scattered across the pages. Shows "X of Y" and a
 * "Show all" toggle whenever there is more.
 */
export function EventList({ items, limit = 6, emptyNoun }: EventListProps) {
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) {
    return <p className="text-sm text-intel-ink2">{EMPTY.panel(emptyNoun)}</p>;
  }

  const shown = expanded ? items : items.slice(0, limit);
  const hidden = items.length - shown.length;

  return (
    <div>
      <ul className="flex flex-col gap-2">
        {shown.map((it, i) => (
          <li
            key={`${it.code}-${i}`}
            className="flex gap-3 rounded-lg border border-intel-line bg-intel-panel2 px-3 py-2"
          >
            <span
              className={`mt-1.5 h-2 w-2 flex-none rounded-full ${SEV_DOT[it.severity ?? 'info']}`}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="font-mono text-xs text-intel-ink2">{it.code}</p>
              <p className="text-sm text-intel-ink">{it.message}</p>
              {it.meta && <p className="mt-0.5 font-mono text-[11px] text-intel-ink3">{it.meta}</p>}
            </div>
          </li>
        ))}
      </ul>
      {items.length > limit && (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="mt-2 font-mono text-xs text-intel-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent"
        >
          {expanded ? 'Show fewer' : `Showing ${shown.length} of ${items.length} · show all (${hidden} more)`}
        </button>
      )}
    </div>
  );
}
