import { memo, useEffect, useId, useRef, useState } from 'react';
import { useSystemStatus, type SystemStatus } from '../../hooks/useSystemStatus';

// Compact, single-glance production status control. Replaces the permanent row
// of seven individual technical badges (Backend / Socket / Options / Equity /
// Chart / AI / Automation) with ONE summary — "System · HEALTHY" or
// "System · DEGRADED — Options feed delayed" — that expands, on click, to the
// full per-subsystem breakdown plus an operator-friendly alert summary.
//
// The seven domains are NOT deleted: every one is still shown, with the same
// independent tone logic, inside the popover. Low-level engineering telemetry
// (lease owners, heartbeat counters, request IDs, etc.) belongs in the
// Diagnostics drawer, not here.

type Tone = 'good' | 'warn' | 'bad' | 'neutral';

const TONE_TEXT: Record<Tone, string> = {
  good: 'text-intel-pos',
  warn: 'text-intel-warn',
  bad: 'text-intel-neg',
  neutral: 'text-intel-ink3',
};
const TONE_DOT: Record<Tone, string> = {
  good: 'bg-intel-pos',
  warn: 'bg-intel-warn',
  bad: 'bg-intel-neg',
  neutral: 'bg-intel-ink3',
};

type SubsystemRow = { label: string; value: string; tone: Tone; note?: string };

export type SystemSummary = {
  /** Overall roll-up tone across every subsystem. */
  tone: Tone;
  /** Operator headline: HEALTHY | DEGRADED | OFFLINE. */
  headline: string;
  /** Short reason shown next to the headline when not fully healthy. */
  reason: string | null;
  /** Every subsystem, for the expanded popover. */
  rows: SubsystemRow[];
  /** Operator-friendly alerts: what's wrong, impact, recommended action. */
  alerts: { title: string; impact: string; action: string }[];
};

function backendTone(s: string): Tone {
  return s === 'ONLINE' ? 'good' : s === 'DEGRADED' ? 'warn' : 'bad';
}
function socketTone(s: string): Tone {
  return s === 'CONNECTED' ? 'good' : s === 'CONNECTING' ? 'warn' : 'bad';
}
function optionsTone(s: string): Tone {
  return s === 'LIVE' ? 'good' : s === 'CONNECTING' ? 'neutral' : 'warn';
}
function equityTone(s: string): Tone {
  if (s === 'REALTIME') return 'good';
  if (s === 'DELAYED' || s === 'SNAPSHOT') return 'warn';
  return 'neutral';
}
function chartTone(s: string): Tone {
  if (s === 'LIVE') return 'good';
  if (s === 'SNAPSHOT') return 'warn';
  if (s === 'STALE') return 'bad';
  return 'neutral';
}
function aiTone(s: string): Tone {
  return s === 'ready' ? 'good' : s === 'busy' ? 'warn' : 'bad';
}
function automationTone(s: string): Tone {
  return s === 'RUNNING' ? 'good' : s === 'PAUSED' ? 'warn' : s === 'ERROR' ? 'bad' : 'neutral';
}

const WORST: Tone[] = ['good', 'neutral', 'warn', 'bad'];
function worst(a: Tone, b: Tone): Tone {
  return WORST.indexOf(a) >= WORST.indexOf(b) ? a : b;
}

/**
 * Pure roll-up of the independent subsystem states into one operator summary.
 * Exported for unit testing — it holds all the "what matters" judgement, with
 * no React or DOM dependency.
 */
export function summarizeSystemStatus(status: SystemStatus): SystemSummary {
  const rows: SubsystemRow[] = [
    { label: 'Backend', value: status.backend, tone: backendTone(status.backend) },
    { label: 'Broker', value: 'PAPER', tone: 'neutral', note: 'Paper trading only' },
    { label: 'Massive REST', value: status.backend === 'OFFLINE' ? 'UNKNOWN' : 'OK', tone: status.backend === 'OFFLINE' ? 'bad' : 'good' },
    { label: 'Options WebSocket', value: status.optionsFeed, tone: optionsTone(status.optionsFeed) },
    { label: 'Stocks WebSocket', value: status.socket, tone: socketTone(status.socket) },
    { label: 'Equity Data', value: status.equityFeed, tone: equityTone(status.equityFeed) },
    { label: 'Chart', value: status.chart.status, tone: chartTone(status.chart.status) },
    { label: 'MongoDB', value: status.backend === 'OFFLINE' ? 'UNKNOWN' : 'OK', tone: status.backend === 'OFFLINE' ? 'bad' : 'good' },
    { label: 'AI', value: status.ai.toUpperCase(), tone: aiTone(status.ai) },
    { label: 'Automation', value: status.automation, tone: automationTone(status.automation) },
  ];

  // Overall tone excludes the intentionally-neutral rows (Broker=PAPER,
  // Automation=UNKNOWN when idle) so a resting system still reads HEALTHY.
  const overall = rows
    .filter(r => !(r.label === 'Broker') && !(r.label === 'Automation' && r.value === 'UNKNOWN'))
    .reduce<Tone>((acc, r) => worst(acc, r.tone), 'good');

  const alerts: SystemSummary['alerts'] = [];
  if (status.backend === 'OFFLINE') {
    alerts.push({
      title: 'Backend unreachable',
      impact: 'Quotes, orders, and automation are unavailable',
      action: 'Check the Render service and retry in a moment',
    });
  } else if (status.backend === 'DEGRADED') {
    alerts.push({
      title: 'Backend responding slowly',
      impact: 'Data may lag; actions may take longer to confirm',
      action: 'Monitor; open Diagnostics if it persists',
    });
  }
  if (status.optionsFeed === 'STALE') {
    alerts.push({
      title: 'Options feed delayed',
      impact: 'Options quotes may be stale',
      action: 'Check Massive entitlement and the Options WebSocket owner',
    });
  }
  if (status.socket === 'DISCONNECTED') {
    alerts.push({
      title: 'Realtime stream disconnected',
      impact: 'Live prices are not updating',
      action: 'The client will auto-reconnect; reload if it does not recover',
    });
  }
  if (status.chart.status === 'STALE') {
    alerts.push({
      title: 'Chart data stale',
      impact: 'The chart is showing last-known bars',
      action: 'Reselect the symbol or check the data feed in Diagnostics',
    });
  }
  if (status.ai === 'error') {
    alerts.push({
      title: 'AI engine unreachable',
      impact: 'AI analysis and chat are unavailable',
      action: 'Check the agent service; retry shortly',
    });
  }

  const headline = overall === 'good' ? 'HEALTHY' : overall === 'bad' ? 'OFFLINE' : 'DEGRADED';
  const reason = alerts.length ? alerts[0].title : null;

  return { tone: overall, headline, reason, rows, alerts };
}

type Props = {
  marketClosed?: boolean;
  chartErrored?: boolean;
  /** Opens the full Diagnostics surface (System Ops) from the popover footer. */
  onOpenDiagnostics?: () => void;
};

export const SystemStatusControl = memo(function SystemStatusControl({
  marketClosed,
  chartErrored,
  onOpenDiagnostics,
}: Props) {
  const status = useSystemStatus({ marketClosed, chartErrored });
  const summary = summarizeSystemStatus(status);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popId = useId();

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative flex items-center border-b border-intel-line bg-intel-bg px-4 py-1.5"
    >
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={popId}
        aria-label={`System status: ${summary.headline}${summary.reason ? ` — ${summary.reason}` : ''}`}
        className="inline-flex items-center gap-2 rounded-panel border border-transparent px-1.5 py-0.5 transition-colors hover:border-intel-line focus:outline-none focus-visible:border-intel-accentLine"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[summary.tone]}`} />
        <span className="font-mono text-[9.5px] uppercase tracking-label text-intel-ink3">System</span>
        <span className={`font-mono text-[10px] font-semibold uppercase tracking-label ${TONE_TEXT[summary.tone]}`}>
          {summary.headline}
        </span>
        {summary.reason && (
          <span className="hidden font-mono text-[10px] text-intel-ink3 sm:inline">· {summary.reason}</span>
        )}
      </button>

      {open && (
        <div
          id={popId}
          role="dialog"
          aria-label="System status detail"
          className="absolute left-2 top-full z-50 mt-1 w-[320px] rounded-panel border border-intel-line bg-intel-panel p-3 shadow-2xl"
        >
          {summary.alerts.length > 0 && (
            <div className="mb-3 flex flex-col gap-2">
              {summary.alerts.map(a => (
                <div key={a.title} className="rounded-panel border border-intel-warn/40 bg-intel-warn/10 px-2.5 py-2">
                  <div className="font-mono text-[11px] font-semibold text-intel-warn">{a.title}</div>
                  <div className="mt-0.5 text-[11px] text-intel-ink2">Impact: {a.impact}</div>
                  <div className="text-[11px] text-intel-ink3">Recommended: {a.action}</div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1">
            {summary.rows.map(row => (
              <div key={row.label} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[row.tone]}`} />
                  <span className="font-mono text-[10px] uppercase tracking-label text-intel-ink3">{row.label}</span>
                </span>
                <span className={`font-mono text-[10.5px] font-semibold uppercase tracking-label ${TONE_TEXT[row.tone]}`}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-intel-line pt-2">
            <span className="font-mono text-[9.5px] uppercase tracking-label text-intel-ink3">
              {status.chart.ageSeconds != null ? `Chart updated ${status.chart.ageSeconds}s ago` : 'Live'}
            </span>
            {onOpenDiagnostics && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenDiagnostics();
                }}
                className="font-mono text-[10px] font-semibold uppercase tracking-label text-intel-accent hover:underline"
              >
                Diagnostics →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
