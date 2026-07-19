import { useMemo, useState } from 'react';
import { Radio } from 'lucide-react';
import type { AutomationVisibilityEvent } from '../../api/portfolio';
import { EmptyState } from './ui';
import {
  ACTIVITY_FILTERS,
  groupActivityEvents,
  humanizeEvent,
  type ActivityFilter,
} from '../../lib/activityFeed';

// A compact live activity feed. Renders ONLY real backend automation events
// (order acks, fills, monitor heartbeats, exit evaluations) as they stream in —
// never fabricated. Repetitive heartbeats collapse into a single counted row so
// the operationally important events (orders, fills, exits, errors) stand out.

function timeLabel(timestamp?: string | null): string {
  if (!timestamp) return '--:--:--';
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return '--:--:--';
  return new Date(ms).toLocaleTimeString([], { hour12: false });
}

function severityTone(severity?: string): string {
  switch ((severity ?? '').toLowerCase()) {
    case 'critical':
      return 'text-intel-neg';
    case 'warning':
      return 'text-intel-warn';
    default:
      return 'text-intel-ink2';
  }
}

export function ActivityFeed({
  events,
  max = 60,
  className = '',
}: {
  events: AutomationVisibilityEvent[];
  max?: number;
  className?: string;
}) {
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const rows = useMemo(
    () => groupActivityEvents(events, filter).slice(0, max),
    [events, filter, max]
  );

  return (
    <div className={`flex flex-col rounded-panel border border-intel-line bg-intel-panel p-4 ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        <Radio className="h-4 w-4 text-intel-accent" aria-hidden="true" />
        <span className="text-sm font-semibold text-intel-ink">Activity</span>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-label text-intel-ink3">
          {events.length ? `${events.length} event${events.length === 1 ? '' : 's'}` : 'live'}
        </span>
      </div>

      <div className="mb-2 flex flex-wrap gap-1" role="tablist" aria-label="Activity filter">
        {ACTIVITY_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent ${
              filter === f.key
                ? 'border-intel-accentLine bg-intel-accentSoft text-intel-accent'
                : 'border-intel-line text-intel-ink3 hover:text-intel-ink2'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Radio className="h-5 w-5" />}
          title="No activity yet"
          hint="Automation events appear here the moment the engine emits them."
        />
      ) : (
        <ul className="max-h-72 flex-1 space-y-1 overflow-y-auto" data-testid="activity-feed-list">
          {rows.map((row, index) =>
            row.kind === 'group' ? (
              <li
                key={`g-${row.label}-${index}`}
                className="flex items-baseline gap-3 border-b border-intel-lineSoft py-1 last:border-b-0"
                data-row="group"
              >
                <span className="font-mono text-[11px] tabular-nums text-intel-ink3">
                  {timeLabel(row.fromTs)}–{timeLabel(row.toTs)}
                </span>
                <span className="flex-1 truncate text-sm text-intel-ink2">
                  {row.label}
                  <span className="text-intel-ink3"> · ×{row.count}</span>
                </span>
              </li>
            ) : (
              <li
                key={row.event.id ?? `e-${index}`}
                className="flex items-baseline gap-3 border-b border-intel-lineSoft py-1 last:border-b-0"
                data-row="event"
              >
                <span className="font-mono text-[11px] tabular-nums text-intel-ink3">
                  {timeLabel(row.event.timestamp)}
                </span>
                <span className={`flex-1 truncate text-sm ${severityTone(row.event.severity)}`}>
                  {humanizeEvent(row.event.event)}
                  {row.event.symbol ? <span className="text-intel-ink3"> · {row.event.symbol}</span> : null}
                </span>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}
