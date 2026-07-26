import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Info, Pause, Play, ShieldAlert, Square, XCircle } from 'lucide-react';
import {
  getAutonomousTradingActive,
  getAutonomousTradingCurrent,
  getAutonomousTradingHealth,
  getAutonomousTradingPending,
  getAutonomousTradingRecentDecisions,
  getAutonomousTradingStatus,
  getAutonomousTradingTimeline,
  type AutonomousActiveResponse,
  type AutonomousHealthResponse,
  type AutonomousOperatorStatus,
  type AutonomousPendingResponse,
  type AutonomousPipeline,
  type AutonomousRecentDecision,
  type AutonomousTimelineEvent,
} from '../../api/autonomousTrading';
import { trackOperatorEvent, trackOperatorEventOnce } from '../../lib/operatorAnalytics';
import { Panel, Pill } from './cockpitUi';

type Snapshot = {
  status: AutonomousOperatorStatus | null;
  current: AutonomousPipeline | null;
  active: AutonomousActiveResponse;
  pending: AutonomousPendingResponse;
  recent: AutonomousRecentDecision[];
  timeline: AutonomousTimelineEvent[];
  health: AutonomousHealthResponse | null;
};

const EMPTY: Snapshot = {
  status: null,
  current: null,
  active: { trades: [], positions: [] },
  pending: { trades: [], intents: [], current: null },
  recent: [],
  timeline: [],
  health: null,
};

function toneFor(value: string | null | undefined): 'good' | 'warn' | 'bad' | 'neutral' {
  const normalized = String(value ?? '').toUpperCase();
  if (['RUNNING', 'OPEN', 'OWNED', 'LIVE', 'INACTIVE', 'HEALTHY', 'APPROVED'].includes(normalized)) return 'good';
  if (['SHADOW', 'PAUSED', 'CLOSED', 'PRE-MARKET', 'AFTER-HOURS', 'STALE', 'DEGRADED', 'WAITING', 'PENDING'].includes(normalized)) return 'warn';
  if (['STOPPED', 'BLOCKED', 'ACTIVE', 'UNAVAILABLE', 'REJECTED'].includes(normalized)) return 'bad';
  return 'neutral';
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function asText(value: unknown): string {
  if (value == null || value === '') return 'Not available';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export function AutonomousTraderPanel() {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [status, current, active, pending, recent, timeline, health] = await Promise.all([
          getAutonomousTradingStatus(),
          getAutonomousTradingCurrent(),
          getAutonomousTradingActive(),
          getAutonomousTradingPending(),
          getAutonomousTradingRecentDecisions(6),
          getAutonomousTradingTimeline(8),
          getAutonomousTradingHealth(),
        ]);
        if (!cancelled) {
          setSnapshot({ status, current, active, pending, recent, timeline, health });
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) setError(String(err?.response?.data?.error ?? err?.message ?? err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const id = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const status = snapshot.status;
  const current = snapshot.current;
  const pendingCurrent = snapshot.pending.current;
  const activeTrades = snapshot.active.trades;

  useEffect(() => {
    const mode = status?.mode?.toUpperCase();
    if (mode === 'SHADOW') trackOperatorEventOnce('Shadow Mode Enabled');
    if (mode === 'AUTONOMOUS PAPER' || mode === 'AUTONOMOUS_PAPER') trackOperatorEventOnce('Paper Mode Enabled');
  }, [status?.mode]);

  return (
    <Panel
      title="Autonomous Trader"
      badge={status ? <Pill tone={toneFor(status.status)} dot>{status.status}</Pill> : <Pill tone="neutral">Loading</Pill>}
      className="bg-intel-panel"
    >
      <div data-testid="autonomous-trader-panel" className="flex min-w-0 flex-col gap-4">
        {error ? (
          <div className="flex items-center gap-2 rounded-md bg-intel-neg/10 px-3 py-2 text-xs text-intel-neg">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Autonomous status is unavailable: {error}
          </div>
        ) : null}

        <div className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          <StatusTile label="Status" value={status?.status ?? (loading ? 'Loading' : 'Unavailable')} />
          <StatusTile label="Mode" value={status?.mode ?? 'Unknown'} />
          <StatusTile label="Market" value={status?.market ?? 'Unknown'} />
          <StatusTile label="Broker" value={status?.broker ?? 'Alpaca Paper'} />
          <StatusTile label="Owner" value={status?.automationOwner ?? 'Unknown'} />
          <StatusTile label="Market Data" value={status?.marketData ?? 'Unavailable'} />
          <StatusTile label="Next Evaluation" value={formatDate(status?.nextEvaluationAt)} />
          <StatusTile label="Emergency Stop" value={status?.emergencyStop ?? 'Unknown'} />
        </div>

        <div className="rounded-md bg-intel-panel2 px-3 py-2 text-xs font-semibold uppercase tracking-label text-intel-ink">
          {status?.modeBanner ?? 'SHADOW MODE - No broker orders will be submitted.'}
        </div>

        <section className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <div className="min-w-0">
            <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-label text-intel-ink3">Current AI Activity</h4>
            <p className="text-sm leading-6 text-intel-ink2">
              {status?.currentActivity ?? 'No current autonomous activity is available. The system is waiting for the next Decision Intelligence scan.'}
            </p>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            <SummaryBlock label="Watching" value={status?.watching?.length ? status.watching.join(', ') : 'No configured symbols'} />
            <SummaryBlock label="Leading Strategy" value={asText(current?.strategyContext?.winningStrategy)} />
            <SummaryBlock label="Risk Review" value={asText(pendingCurrent?.riskStatus ?? current?.riskContext?.approved)} />
            <SummaryBlock label="Entry Status" value={asText(pendingCurrent?.entryStatus ?? current?.executionContext?.status)} />
          </div>
        </section>

        <section className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
          <FeedPanel title="Active Trades" empty="No active autonomous trades are being managed.">
            {activeTrades.slice(0, 4).map((trade, index) => (
              <TradeRow key={String(trade.tradeId ?? trade.contract ?? index)} trade={trade} />
            ))}
          </FeedPanel>
          <FeedPanel title="Pending Trades" empty={pendingCurrent ? null : 'No pending autonomous entry is available.'}>
            {pendingCurrent ? (
              <div className="rounded-md bg-intel-panel2 p-3 text-xs text-intel-ink2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-intel-ink">{pendingCurrent.contract ?? pendingCurrent.symbol ?? 'Current opportunity'}</span>
                  <Pill tone={toneFor(pendingCurrent.riskStatus)}>{pendingCurrent.riskStatus}</Pill>
                  <Pill tone={toneFor(pendingCurrent.entryStatus)}>{pendingCurrent.entryStatus}</Pill>
                </div>
                <p className="mt-2">{pendingCurrent.blockingReason ?? pendingCurrent.winningStrategy ?? 'Waiting for the next pipeline handoff.'}</p>
              </div>
            ) : null}
          </FeedPanel>
        </section>

        <section className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
          <FeedPanel title="Recent Decisions" empty="No recent decisions have been journaled.">
            {snapshot.recent.map((item, index) => (
              <div key={`${item.time}-${index}`} className="rounded-md bg-intel-panel2 p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-intel-ink3">{formatDate(item.time)}</span>
                  <Pill tone={toneFor(item.action)}>{item.action}</Pill>
                  <span className="font-semibold text-intel-ink">{item.symbol ?? item.subsystem}</span>
                </div>
                <p className="mt-1 text-intel-ink2">{item.reason}</p>
              </div>
            ))}
          </FeedPanel>
          <FeedPanel title="System Activity Timeline" empty="No autonomous activity timeline is available.">
            {snapshot.timeline.map((item, index) => (
              <div key={`${item.at}-${index}`} className="border-l border-intel-divider pl-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-intel-ink3">{formatDate(item.at)}</span>
                  <span className="font-semibold text-intel-ink">{item.event}</span>
                </div>
                <p className="mt-1 text-intel-ink2">{item.reason}</p>
              </div>
            ))}
          </FeedPanel>
        </section>

        <details
          className="group rounded-md bg-intel-panel2 p-3"
          data-testid="autonomous-details"
          onToggle={event => {
            if (event.currentTarget.open) {
              trackOperatorEvent('Operator Expanded Advanced Details', { section: 'Autonomous Trader' });
            }
          }}
        >
          <summary className="cursor-pointer font-mono text-[10px] font-semibold uppercase tracking-label text-intel-ink3">
            Expandable Intelligence Details
          </summary>
          <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-3">
            <DetailBlock title="Why this decision?" data={current?.decisionContext} />
            <DetailBlock title="Event evidence" data={current?.eventContext} />
            <DetailBlock title="Strategy rankings" data={current?.strategyContext} />
            <DetailBlock title="Risk review" data={current?.riskContext} />
            <DetailBlock title="Lifecycle timeline" data={current?.lifecycleContext} />
            <DetailBlock title="Execution details" data={current?.executionContext} />
          </div>
        </details>

        <section className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div>
            <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-label text-intel-ink3">Controls and Safety (reference)</h4>
            <div className="flex flex-wrap gap-2">
              <ControlHint icon={<Pause className="h-3.5 w-3.5" />} label="Pause Evaluations" />
              <ControlHint icon={<Play className="h-3.5 w-3.5" />} label="Resume Evaluations" />
              <ControlHint icon={<Square className="h-3.5 w-3.5" />} label="Shadow Mode" />
              <ControlHint icon={<ShieldAlert className="h-3.5 w-3.5" />} label="Paper Entry requires confirmation" />
              <ControlHint icon={<XCircle className="h-3.5 w-3.5" />} label="Emergency Stop" />
            </div>
            <p className="mt-2 text-xs text-intel-ink3">
              These are read-only indicators. Live actions (Pause, Resume, Emergency Stop) are operated from Mission Control at the top of the cockpit. Live-money controls are not available.
            </p>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            <Help label="Shadow Mode" text="The AI runs the complete trading process but does not submit broker orders." />
            <Help label="Evidence Score" text="A combined score from events, market data, strategy agreement, and technical context." />
            <Help label="Risk Approval" text="The Risk Engine confirms whether the recommendation fits your portfolio limits." />
            <Help label="Lifecycle Action" text="The current action recommended for an open position, such as HOLD or EXIT." />
          </div>
        </section>

        {snapshot.health ? (
          <div className="rounded-md bg-intel-panel2 p-3 text-xs text-intel-ink2">
            <div className="mb-2 flex items-center gap-2">
              <Pill tone={toneFor(snapshot.health.overall)}>{snapshot.health.overall}</Pill>
              <span>{snapshot.health.explanation}</span>
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-4">
              {snapshot.health.services.slice(0, 12).map((service) => (
                <div key={service.name} className="flex items-center justify-between gap-2">
                  <span className="truncate">{service.name}</span>
                  <Pill tone={toneFor(service.status)}>{service.status}</Pill>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-intel-panel2 p-2">
      <div className="truncate text-[10px] uppercase tracking-widest text-intel-ink3">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-intel-ink">{value}</div>
    </div>
  );
}

function SummaryBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-intel-panel2 p-3">
      <div className="text-[10px] uppercase tracking-widest text-intel-ink3">{label}</div>
      <div className="mt-1 text-sm font-semibold text-intel-ink">{value}</div>
    </div>
  );
}

function FeedPanel({ title, empty, children }: { title: string; empty: string | null; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.some(Boolean) : Boolean(children);
  return (
    <div className="min-w-0 rounded-md bg-intel-panel/60 p-3">
      <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-label text-intel-ink3">{title}</h4>
      <div className="flex min-w-0 flex-col gap-2">{hasChildren ? children : empty ? <p className="text-xs text-intel-ink3">{empty}</p> : null}</div>
    </div>
  );
}

function TradeRow({ trade }: { trade: Record<string, unknown> }) {
  return (
    <div className="rounded-md bg-intel-panel2 p-3 text-xs text-intel-ink2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-intel-ink">{asText(trade.contract ?? trade.optionSymbol ?? trade.symbol)}</span>
        <Pill tone={toneFor(String(trade.lifecycleAction ?? trade.currentAction ?? trade.lifecycleState ?? trade.state))}>
          {asText(trade.lifecycleAction ?? trade.currentAction ?? trade.lifecycleState ?? trade.state)}
        </Pill>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <span>Entry: {asText(trade.entry)}</span>
        <span>Mark: {asText(trade.currentMark)}</span>
        <span>P/L: {asText(trade.pnl)}</span>
        <span>Next: {formatDate(String(trade.nextEvaluationAt ?? ''))}</span>
      </div>
    </div>
  );
}

function DetailBlock({ title, data }: { title: string; data: Record<string, unknown> | undefined }) {
  return (
    <div className="min-w-0 rounded-md bg-intel-panel p-3">
      <h5 className="mb-2 text-xs font-semibold text-intel-ink">{title}</h5>
      <dl className="space-y-1 text-xs">
        {Object.entries(data ?? {}).slice(0, 8).map(([key, value]) => (
          <div key={key} className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
            <dt className="truncate text-intel-ink3">{key}</dt>
            <dd className="truncate text-intel-ink2">{Array.isArray(value) ? value.join(', ') || 'None' : asText(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ControlHint({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span
      className="inline-flex cursor-default items-center gap-1.5 rounded-md border border-dashed border-intel-line px-2 py-1 text-xs font-medium text-intel-ink3"
      aria-disabled="true"
    >
      {icon}
      {label}
    </span>
  );
}

function Help({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-md bg-intel-panel2 p-3 text-xs">
      <div className="mb-1 flex items-center gap-1 font-semibold text-intel-ink">
        <Info className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="text-intel-ink3">{text}</p>
    </div>
  );
}
