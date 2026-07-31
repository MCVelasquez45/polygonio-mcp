import type { AutomationVisibilityEvent } from '../api/portfolio';

// Grouping + categorization for the live activity feed.
//
// The automation engine emits many low-signal heartbeats (monitor ticks,
// evaluation ticks) interleaved with the events an operator actually cares
// about (orders, fills, exits, emergencies). Rendering every heartbeat buries
// the signal. This collapses consecutive repetitive events into a single
// summary row while keeping every operationally important event individual —
// and never inventing an event that the backend did not emit.

export type ActivityCategory = 'trades' | 'orders' | 'automation' | 'risk' | 'errors';
export type ActivityFilter = 'all' | ActivityCategory;

export const ACTIVITY_FILTERS: { key: ActivityFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'trades', label: 'Trades' },
  { key: 'orders', label: 'Orders' },
  { key: 'automation', label: 'Automation' },
  { key: 'risk', label: 'Risk' },
  { key: 'errors', label: 'Errors' },
];

// Event-name substrings → category. Matched case-insensitively.
const CATEGORY_RULES: { match: RegExp; category: ActivityCategory }[] = [
  { match: /(FILL|POSITION_FILLED|POSITION_CLOSED|EXIT|TRADE)/i, category: 'trades' },
  { match: /(ORDER|INTENT|SUBMIT|CANCEL)/i, category: 'orders' },
  { match: /(RISK|EMERGENCY|STOP|DRAWDOWN|LIMIT)/i, category: 'risk' },
  { match: /(ERROR|FAIL|REJECT|CONTRADICTION|DISCONNECT|MANUAL_REVIEW)/i, category: 'errors' },
];

/** Best-effort category for an event; defaults to 'automation'. */
export function categorize(event: AutomationVisibilityEvent): ActivityCategory {
  const name = `${event.event ?? ''} ${event.service ?? ''}`;
  if ((event.severity ?? '').toLowerCase() === 'critical') return 'errors';
  for (const rule of CATEGORY_RULES) {
    if (rule.match.test(name)) return rule.category;
  }
  return 'automation';
}

// Repetitive, low-signal events that should be collapsed into a count.
const GROUPABLE = /(HEARTBEAT|MARK_RECEIVED|EVALUATED|TICK|POLL|NO_SIGNAL|CACHE_)/i;

// Pure engineering telemetry — reconciliation, scheduler, lease, queue, cache.
// These belong in the Diagnostics drawer, never on the operator's timeline.
const ENGINEERING = /(HEARTBEAT|RECONCIL|SCHEDULER|LEASE|QUEUE|CACHE_|POLL|TICK|EVALUATED|MARK_RECEIVED|RENEW|DEDUP|SNAPSHOT_TAKEN|WATCHLIST_CACHE)/i;

// Events an operator acts on, even when they'd otherwise look routine. These
// always stay on the operator timeline regardless of the engineering filter.
const OPERATOR_SIGNAL =
  /(FILL|POSITION_OPENED|POSITION_CLOSED|POSITION_FILLED|EXIT|ORDER_SUBMITTED|ORDER_FILLED|CANCEL|RISK_REJECT|RISK_APPROV|RECOMMEND|EMERGENCY|BROKER_DISCONNECT|DATA_STALE|DATA_DEGRADED|SIGNAL_CHANGED|CANDIDATE)/i;

/**
 * Whether an event belongs on the OPERATOR activity timeline (a trading /
 * risk / system event a person acts on) rather than in engineering Diagnostics.
 * Critical severity is always operator-facing; explicit engineering telemetry
 * is always excluded; otherwise trade/order/risk/error categories qualify.
 */
export function isOperatorEvent(event: AutomationVisibilityEvent): boolean {
  const name = `${event.event ?? ''}`;
  if ((event.severity ?? '').toLowerCase() === 'critical') return true;
  // Engineering telemetry is checked BEFORE the operator-signal match so a
  // reconciliation event that happens to contain an operator token (e.g.
  // RECONCILE_POSITION_CLOSED) stays in Diagnostics rather than leaking onto
  // the operator timeline.
  if (ENGINEERING.test(name)) return false;
  if (OPERATOR_SIGNAL.test(name)) return true;
  const category = categorize(event);
  return category === 'trades' || category === 'orders' || category === 'risk' || category === 'errors';
}

/** Split a raw event stream into operator-facing and engineering (diagnostic)
 *  events without dropping anything — the two arrays partition the input. */
export function splitOperatorEvents(events: AutomationVisibilityEvent[]): {
  operator: AutomationVisibilityEvent[];
  engineering: AutomationVisibilityEvent[];
} {
  const operator: AutomationVisibilityEvent[] = [];
  const engineering: AutomationVisibilityEvent[] = [];
  for (const event of events) {
    if (isOperatorEvent(event)) operator.push(event);
    else engineering.push(event);
  }
  return { operator, engineering };
}

function isGroupable(event: AutomationVisibilityEvent): boolean {
  // Never group anything that failed — errors always stay individual.
  if ((event.severity ?? '').toLowerCase() === 'critical') return false;
  return GROUPABLE.test(event.event ?? '');
}

export type ActivitySingle = { kind: 'event'; event: AutomationVisibilityEvent; category: ActivityCategory };
export type ActivityGroup = {
  kind: 'group';
  label: string;
  count: number;
  fromTs: string | null;
  toTs: string | null;
  category: ActivityCategory;
  events: AutomationVisibilityEvent[];
};
export type ActivityRow = ActivitySingle | ActivityGroup;

/** 'MONITOR_HEARTBEAT' -> 'Monitor heartbeat'. */
export function humanizeEvent(raw?: string): string {
  if (!raw) return 'Event';
  const spaced = raw.replace(/[_\-.]+/g, ' ').trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Collapse consecutive groupable events that share the same event name into one
 * summary row. Events are assumed newest-first (the order the store keeps them).
 */
export function groupActivityEvents(
  events: AutomationVisibilityEvent[],
  filter: ActivityFilter = 'all'
): ActivityRow[] {
  const filtered =
    filter === 'all' ? events : events.filter((e) => categorize(e) === filter);

  const rows: ActivityRow[] = [];
  let i = 0;
  while (i < filtered.length) {
    const event = filtered[i];
    if (!isGroupable(event)) {
      rows.push({ kind: 'event', event, category: categorize(event) });
      i += 1;
      continue;
    }
    // Accumulate the run of same-named groupable events.
    const name = event.event ?? '';
    const run: AutomationVisibilityEvent[] = [];
    while (i < filtered.length && isGroupable(filtered[i]) && (filtered[i].event ?? '') === name) {
      run.push(filtered[i]);
      i += 1;
    }
    if (run.length === 1) {
      rows.push({ kind: 'event', event: run[0], category: categorize(run[0]) });
    } else {
      rows.push({
        kind: 'group',
        label: humanizeEvent(name),
        count: run.length,
        // newest-first: run[0] is latest, last is earliest.
        toTs: run[0]?.timestamp ?? null,
        fromTs: run[run.length - 1]?.timestamp ?? null,
        category: categorize(run[0]),
        events: run,
      });
    }
  }
  return rows;
}
