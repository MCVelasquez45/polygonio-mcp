import { useCallback, useState } from 'react';
import { portfolioApi } from '../../api';
import type { AutomationVisibility, AutomationVisibilityEvent } from '../../api/portfolio';
import { useAutomationVisibility } from '../../hooks/useAutomationVisibility';
import { CockpitWorkspace } from './CockpitWorkspace';
import { Panel, Pill, selectActiveTrade, statusTone } from './cockpitUi';
import { statusOrReason } from './cockpitDisplay';

function HealthItem({ label, value, healthy }: { label: string; value: string; healthy: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-intel-ink2">
      <span className={`h-1.5 w-1.5 rounded-full ${healthy ? 'bg-intel-pos' : 'bg-intel-ink3'}`} />
      <span className="text-intel-ink3">{label}</span>
      <span className="font-medium text-intel-ink">{value}</span>
    </span>
  );
}

function titleStatus(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isAbsent(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function num(value: unknown, digits = 0): string {
  if (isAbsent(value)) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function usd(value: unknown): string {
  if (isAbsent(value)) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
}

function pct(value: unknown, digits = 0): string {
  if (isAbsent(value)) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

function clockTime(value?: string | null): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return '—';
  return new Date(parsed).toLocaleTimeString();
}

const MC_LABEL = 'font-mono text-[10px] uppercase tracking-label text-intel-ink3';

/**
 * Compact status + operator controls bar. Health reads left-to-right; the
 * pause / resume / emergency-stop controls live on the right so the operator
 * can always reach them without hunting through System Ops.
 */
function MissionControlBar({
  visibility,
  connected,
  onActed,
}: {
  visibility: AutomationVisibility | null;
  connected: boolean;
  onActed: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const engine = (visibility?.engineStatus ?? {}) as any;
  const sessionId: string | null = engine.session?.id ?? null;

  const automationRaw = statusOrReason(engine.automationState, 'status unavailable');
  const brokerRaw = statusOrReason(engine.broker?.state, 'status unavailable');
  const marketRaw = statusOrReason(engine.market, 'status unavailable');
  const dataRaw = statusOrReason(engine.massive?.state, 'provider status unavailable');
  const visibilityRaw = connected ? 'connected' : 'visibility stream disconnected';

  const act = useCallback(
    async (label: string, fn: () => Promise<unknown>, confirmMsg?: string) => {
      if (confirmMsg && !window.confirm(confirmMsg)) return;
      setBusy(label);
      setActionError(null);
      try {
        await fn();
        onActed();
      } catch (err: any) {
        setActionError(err?.response?.data?.error ?? err?.message ?? `${label} failed`);
      } finally {
        setBusy(null);
      }
    },
    [onActed]
  );

  const controlCls =
    'rounded border border-intel-line px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide text-intel-ink2 transition hover:border-intel-accentLine hover:text-intel-accent disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="rounded-panel bg-intel-panel px-4 py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <HealthItem label="Automation" value={titleStatus(automationRaw)} healthy={['RUNNING', 'READY'].includes(automationRaw.toUpperCase())} />
          <HealthItem label="Broker" value={titleStatus(brokerRaw)} healthy={brokerRaw.toUpperCase() === 'CONNECTED'} />
          <HealthItem label="Market" value={titleStatus(marketRaw)} healthy={marketRaw.toUpperCase() === 'OPEN'} />
          <HealthItem label="Data" value={titleStatus(dataRaw)} healthy={['CONNECTED', 'ACTIVE', 'READY', 'OK'].includes(dataRaw.toUpperCase())} />
          <HealthItem label="Cockpit" value={titleStatus(visibilityRaw)} healthy={connected} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sessionId && (
            <span className="font-mono text-[10px] text-intel-ink3" title={`Session ${sessionId}`}>
              Session {sessionId.slice(0, 8)}
            </span>
          )}
          <button
            type="button"
            className={controlCls}
            disabled={!sessionId || !!busy}
            onClick={() => sessionId && act('pause', () => portfolioApi.pauseEntries(sessionId))}
          >
            {busy === 'pause' ? '…' : 'Pause'}
          </button>
          <button
            type="button"
            className={controlCls}
            disabled={!sessionId || !!busy}
            onClick={() => sessionId && act('resume', () => portfolioApi.resumeSession(sessionId))}
          >
            {busy === 'resume' ? '…' : 'Resume'}
          </button>
          <button
            type="button"
            className="rounded border border-intel-neg/40 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide text-intel-neg transition hover:bg-intel-neg/10 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!sessionId || !!busy}
            onClick={() =>
              sessionId &&
              act(
                'emergency-stop',
                () => portfolioApi.emergencyStop(sessionId),
                'Emergency stop and flatten all automation positions?'
              )
            }
          >
            {busy === 'emergency-stop' ? '…' : 'Emergency Stop'}
          </button>
        </div>
      </div>
      {actionError && <p className="mt-2 text-xs text-intel-neg">{actionError}</p>}
    </div>
  );
}

/**
 * The automation's latest decision: what it evaluated, what it picked (or why
 * it passed), and whether risk signed off. This is the answer to "what is the
 * automation doing right now?" — always visible, trade or no trade.
 */
function DecisionPanel({ visibility }: { visibility: AutomationVisibility | null }) {
  const evaluation = visibility?.watchlistEvaluation;
  const results: any[] = evaluation?.results ?? [];
  const reasonCodes = evaluation?.reasonCodes ?? [];
  return (
    <Panel
      title="Latest Decision"
      badge={<Pill tone={statusTone(evaluation?.outcome)}>{evaluation?.outcome ?? 'No evaluation captured'}</Pill>}
      actions={
        evaluation?.evaluatedAt ? (
          <span className="font-mono text-[10px] text-intel-ink3">{clockTime(evaluation.evaluatedAt)}</span>
        ) : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <span className="text-xs text-intel-ink2">
          <span className={MC_LABEL}>Selected </span>
          <span className="font-mono font-semibold text-intel-ink">
            {evaluation?.selectedSymbol ?? 'None'}
          </span>
        </span>
        {evaluation?.selectedContract && (
          <span className="font-mono text-xs text-intel-ink2">{evaluation.selectedContract}</span>
        )}
        <span className="text-xs">
          <span className={MC_LABEL}>Risk </span>
          <span
            className={
              evaluation?.riskApproved === true
                ? 'font-mono font-semibold text-intel-pos'
                : evaluation?.riskApproved === false
                  ? 'font-mono font-semibold text-intel-neg'
                  : 'font-mono text-intel-ink3'
            }
          >
            {evaluation?.riskApproved === true ? 'APPROVED' : evaluation?.riskApproved === false ? 'REJECTED' : '—'}
          </span>
        </span>
        <span className="text-xs">
          <span className={MC_LABEL}>Symbols </span>
          <span className="font-mono text-intel-ink2">{evaluation?.symbolCount ?? '—'}</span>
        </span>
      </div>
      {reasonCodes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {reasonCodes.map((code) => (
            <span key={code} className="rounded bg-intel-panel2 px-1.5 py-0.5 font-mono text-[10px] text-intel-ink2">
              {code}
            </span>
          ))}
        </div>
      )}
      {results.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-intel-line">
                <th className={`py-1.5 pr-3 text-left ${MC_LABEL} font-normal`}>Symbol</th>
                <th className={`py-1.5 pr-3 text-left ${MC_LABEL} font-normal`}>Dir</th>
                <th className={`py-1.5 pr-3 text-right ${MC_LABEL} font-normal`}>Conf</th>
                <th className={`py-1.5 pr-3 text-right ${MC_LABEL} font-normal`}>Score</th>
                <th className={`py-1.5 pr-3 text-left ${MC_LABEL} font-normal`}>Result</th>
                <th className={`py-1.5 pr-3 text-left ${MC_LABEL} font-normal`}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {results.slice(0, 8).map((row: any) => (
                <tr key={row.symbol} className="border-b border-intel-lineSoft font-mono text-xs text-intel-ink2">
                  <td className="py-1.5 pr-3 font-semibold text-intel-ink">{row.symbol}</td>
                  <td className={`py-1.5 pr-3 ${row.direction === 'BULLISH' ? 'text-intel-pos' : row.direction === 'BEARISH' ? 'text-intel-neg' : ''}`}>
                    {row.direction ?? '—'}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {pct(row.confidence == null ? null : Number(row.confidence) * 100)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{num(row.score, 3)}</td>
                  <td className="py-1.5 pr-3">
                    <Pill tone={statusTone(row.outcome)}>{row.outcome ?? '—'}</Pill>
                  </td>
                  <td className="max-w-[260px] truncate py-1.5 pr-3" title={row.reason}>
                    {row.reason ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-xs text-intel-ink3">
          No per-symbol results captured for the latest evaluation yet.
        </p>
      )}
    </Panel>
  );
}

/** Today's automation results + the next evaluation, at a glance. */
function TodayPanel({ visibility }: { visibility: AutomationVisibility | null }) {
  const metrics = (visibility?.metrics ?? {}) as any;
  const engine = (visibility?.engineStatus ?? {}) as any;
  const nextTick: string | null = engine.scheduler?.nextTick ?? null;
  const netPnl = Number(metrics.netPnl);
  const stats: Array<{ label: string; value: string; cls?: string }> = [
    { label: 'Trades', value: num(metrics.todayTrades) },
    { label: 'Wins', value: num(metrics.wins), cls: 'text-intel-pos' },
    { label: 'Losses', value: num(metrics.losses), cls: 'text-intel-neg' },
    { label: 'Win %', value: pct(metrics.winPct) },
    {
      label: 'Net P/L',
      value: usd(metrics.netPnl),
      cls: Number.isFinite(netPnl) ? (netPnl >= 0 ? 'text-intel-pos' : 'text-intel-neg') : undefined,
    },
    { label: 'Signals', value: num(metrics.signalsGenerated) },
    { label: 'Risk Rejects', value: num(metrics.riskRejections), cls: Number(metrics.riskRejections) > 0 ? 'text-intel-warn' : undefined },
    { label: 'Orders', value: num(metrics.ordersSubmitted) },
    { label: 'Fills', value: num(metrics.ordersFilled) },
    { label: 'Exit Orders', value: num(metrics.exitOrders) },
    { label: 'Drawdown', value: usd(metrics.currentDrawdown) },
    { label: 'Next Eval', value: clockTime(nextTick) },
  ];
  return (
    <Panel title="Today">
      <div className="grid grid-cols-3 gap-x-4 gap-y-3">
        {stats.map(({ label, value, cls }) => (
          <div key={label} className="min-w-0">
            <div className={MC_LABEL}>{label}</div>
            <div className={`mt-0.5 truncate font-mono text-sm font-semibold tabular-nums ${cls ?? 'text-intel-ink'}`}>
              {value}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** Live automation orders at the broker (working entries/exits). */
function PendingOrdersPanel({ visibility }: { visibility: AutomationVisibility | null }) {
  const orders: any[] = visibility?.pendingOrders ?? [];
  return (
    <Panel title="Pending Orders" badge={<Pill tone={orders.length ? 'warn' : 'neutral'}>{orders.length}</Pill>}>
      {orders.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <thead>
              <tr className="border-b border-intel-line">
                <th className={`py-1.5 pr-3 text-left ${MC_LABEL} font-normal`}>Status</th>
                <th className={`py-1.5 pr-3 text-left ${MC_LABEL} font-normal`}>Symbol</th>
                <th className={`py-1.5 pr-3 text-left ${MC_LABEL} font-normal`}>Type</th>
                <th className={`py-1.5 pr-3 text-right ${MC_LABEL} font-normal`}>Remaining</th>
                <th className={`py-1.5 pr-3 text-right ${MC_LABEL} font-normal`}>Limit</th>
                <th className={`py-1.5 pr-3 text-left ${MC_LABEL} font-normal`}>TIF</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order: any) => (
                <tr
                  key={order.clientOrderId ?? order.intentId ?? order.brokerOrderId}
                  className="border-b border-intel-lineSoft font-mono text-xs text-intel-ink2"
                >
                  <td className="py-1.5 pr-3">
                    <Pill tone={statusTone(order.brokerStatus ?? order.status)}>{order.brokerStatus ?? order.status ?? '—'}</Pill>
                  </td>
                  <td className="py-1.5 pr-3 font-semibold text-intel-ink">{order.symbol}</td>
                  <td className="py-1.5 pr-3">{order.orderType ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{num(order.remainingQty)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{usd(order.limitPrice)}</td>
                  <td className="py-1.5 pr-3">{order.timeInForce ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-intel-ink3">No working automation orders at the broker.</p>
      )}
    </Panel>
  );
}

/** The most recent automation actions, newest first. */
function RecentActionsPanel({ events }: { events: AutomationVisibilityEvent[] }) {
  const rows = events.slice(0, 14);
  return (
    <Panel title="Recent Actions" badge={<Pill tone="neutral">{events.length}</Pill>}>
      {rows.length ? (
        <div className="flex flex-col">
          {rows.map((event) => {
            const key = String(
              event.id ?? `${event.timestamp ?? ''}:${event.service ?? ''}:${event.event ?? ''}:${event.symbol ?? ''}`
            );
            const critical = event.severity === 'critical' || event.severity === 'warning';
            return (
              <div key={key} className="flex items-baseline gap-3 border-b border-intel-lineSoft py-1.5 last:border-b-0">
                <span className="w-[64px] shrink-0 font-mono text-[10px] tabular-nums text-intel-ink3">
                  {clockTime(event.timestamp)}
                </span>
                <span className={`min-w-0 truncate font-mono text-xs ${critical ? 'text-intel-warn' : 'text-intel-ink2'}`}>
                  {event.event ?? '—'}
                </span>
                {event.symbol && <span className="ml-auto shrink-0 font-mono text-[10px] text-intel-ink3">{event.symbol}</span>}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-intel-ink3">No automation activity captured yet.</p>
      )}
    </Panel>
  );
}

export function CockpitLayout() {
  const { visibility, events = [], connected, error, refresh } = useAutomationVisibility();
  const trade = selectActiveTrade(visibility);
  const buyingPower = Number((visibility?.engineStatus as any)?.broker?.account?.buyingPower) || null;
  const nextEvaluationAt = (visibility?.engineStatus as any)?.scheduler?.nextTick ?? null;
  const sessionId =
    (visibility?.engineStatus as any)?.session?.id ?? trade?.automationSessionId ?? null;

  return (
    <div className="flex h-full min-w-0 flex-col gap-3">
      <MissionControlBar visibility={visibility} connected={connected} onActed={() => void refresh()} />
      {error && (
        <Panel title="Cockpit">
          <p className="text-sm text-intel-neg">{error}</p>
        </Panel>
      )}
      {trade ? (
        <CockpitWorkspace
          trade={trade}
          buyingPower={buyingPower}
          nextEvaluationAt={nextEvaluationAt}
          sessionId={sessionId}
          onActed={() => void refresh()}
        />
      ) : (
        <div className="rounded-panel bg-intel-panel px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className={MC_LABEL}>Active Trade</span>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-intel-pos motion-safe:animate-pulse' : 'bg-intel-ink3'}`} />
            <span className="font-mono text-xs text-intel-ink2">
              None open — the trade cockpit populates when automation opens or reconciles a position.
            </span>
          </div>
        </div>
      )}
      {/* Mission control is always on: the operator sees decisions, orders,
          results, and actions whether or not a trade is currently open. */}
      <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
        <DecisionPanel visibility={visibility} />
        <TodayPanel visibility={visibility} />
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
        <PendingOrdersPanel visibility={visibility} />
        <RecentActionsPanel events={events} />
      </div>
    </div>
  );
}
