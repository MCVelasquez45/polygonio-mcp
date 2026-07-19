import { useMemo, useState } from 'react';
import { fmtDateTime, EMPTY } from '../../../lib/intelligenceFormat';

export type TimelineEvent = {
  at: string;
  label: string;
  source: string;
  severity?: 'info' | 'warning' | 'critical';
};

type Group = { label: string; source: string; severity: TimelineEvent['severity']; count: number; firstAt: string; lastAt: string };

const SEV_DOT: Record<NonNullable<TimelineEvent['severity']>, string> = {
  info: 'bg-intel-info',
  warning: 'bg-intel-warn',
  critical: 'bg-intel-neg',
};

/** Collapse consecutive identical-label events into one summary row. */
function collapse(events: TimelineEvent[]): Group[] {
  const groups: Group[] = [];
  for (const ev of events) {
    const last = groups[groups.length - 1];
    if (last && last.label === ev.label) {
      last.count += 1;
      last.lastAt = ev.at;
      continue;
    }
    groups.push({ label: ev.label, source: ev.source, severity: ev.severity, count: 1, firstAt: ev.at, lastAt: ev.at });
  }
  return groups;
}

/**
 * Timeline that collapses repetitive runs — the fix for "100
 * WATCHLIST_SYMBOL_EVALUATED rows". Repeated labels render as one "label ×N"
 * summary; the list itself is bounded with a show-all toggle.
 */
export function GroupedTimeline({ events, limit = 12 }: { events: TimelineEvent[]; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const groups = useMemo(() => collapse(events), [events]);

  if (groups.length === 0) {
    return <p className="text-sm text-intel-ink2">{EMPTY.panel('timeline events')}</p>;
  }

  const shown = expanded ? groups : groups.slice(0, limit);

  return (
    <div>
      <ol className="flex flex-col gap-2">
        {shown.map((g, i) => (
          <li key={`${g.label}-${i}`} className="flex items-center gap-3 rounded-lg border border-intel-line bg-intel-panel2 px-3 py-2">
            <span className={`h-2 w-2 flex-none rounded-full ${SEV_DOT[g.severity ?? 'info']}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <span className="font-mono text-[13px] text-intel-ink">{g.label.replace(/_/g, ' ').toLowerCase()}</span>
              {g.count > 1 && <span className="ml-2 font-mono text-xs text-intel-accent">×{g.count}</span>}
            </div>
            <span className="flex-none font-mono text-[11px] tabular-nums text-intel-ink3">
              {g.count > 1 ? `${fmtDateTime(g.firstAt)}` : fmtDateTime(g.firstAt)}
            </span>
          </li>
        ))}
      </ol>
      {groups.length > limit && (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="mt-2 font-mono text-xs text-intel-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent"
        >
          {expanded ? 'Show fewer' : `Showing ${shown.length} of ${groups.length} groups · show all`}
        </button>
      )}
    </div>
  );
}
