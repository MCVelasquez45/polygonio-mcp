import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Download, RefreshCw, Search } from 'lucide-react';
import { portfolioApi } from '../../api';
import type { AutomationVisibility, AutomationVisibilityEvent } from '../../api/portfolio';
import { getSharedSocket } from '../../lib/socket';

type LogFilter = 'All' | 'Scheduler' | 'Monitor' | 'Broker' | 'Risk' | 'Signals' | 'Orders' | 'Positions' | 'Errors';

const LOG_FILTERS: LogFilter[] = ['All', 'Scheduler', 'Monitor', 'Broker', 'Risk', 'Signals', 'Orders', 'Positions', 'Errors'];

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

/**
 * A value is "absent" when it is null/undefined/empty-string. This guard MUST run
 * before Number() coercion: Number(null) === 0, so without it a missing bid would
 * render as a real "$0.00" — the exact falsehood this panel used to show.
 */
function isAbsent(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function currency(value: unknown): string {
  if (isAbsent(value)) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '' : '-'}$${Math.abs(n).toFixed(2)}`;
}

function percent(value: unknown, digits = 1): string {
  if (isAbsent(value)) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

function number(value: unknown, digits = 0): string {
  if (isAbsent(value)) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function time(value?: string | null): string {
  if (!value) return '-';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return '-';
  return new Date(parsed).toLocaleString();
}

function shortTime(value?: string | null): string {
  if (!value) return '-';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return '-';
  return new Date(parsed).toLocaleTimeString();
}

function duration(ms: unknown): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '-';
  const minutes = Math.floor(n / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.floor(n / 1000)}s`;
}

function eventKey(event: AutomationVisibilityEvent): string {
  return String(event.id ?? `${event.timestamp ?? ''}:${event.service ?? ''}:${event.event ?? ''}:${event.symbol ?? ''}`);
}

function eventMatchesFilter(event: AutomationVisibilityEvent, filter: LogFilter): boolean {
  if (filter === 'All') return true;
  if (filter === 'Errors') return event.severity === 'warning' || event.severity === 'critical';
  const haystack = `${event.service ?? ''} ${event.event ?? ''}`.toLowerCase();
  const key = filter.toLowerCase();
  if (key === 'orders') return haystack.includes('order') || haystack.includes('intent') || haystack.includes('submission');
  if (key === 'positions') return haystack.includes('position') || haystack.includes('monitor_mark');
  if (key === 'signals') return haystack.includes('signal') || haystack.includes('candidate') || haystack.includes('evaluation');
  return haystack.includes(key);
}

function pillTone(value?: string | null): string {
  const normalized = String(value ?? '').toUpperCase();
  if (['CONNECTED', 'CLEAN', 'RUNNING', 'READY', 'ACTIVE', 'OPEN', 'OK', 'APPROVED', 'ORDER_SUBMITTED', 'SUBMITTED'].includes(normalized)) {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  }
  if (['PAUSED', 'PRE_CUTOFF', 'COOLDOWN', 'PENDING_NEW', 'ACCEPTED', 'PARTIALLY_FILLED'].includes(normalized)) {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  }
  if (['ERROR', 'STOPPED', 'DISCONNECTED', 'REJECTED', 'RISK_REJECTED', 'DATA_REJECTED', 'MANUAL_REVIEW'].includes(normalized)) {
    return 'border-red-500/30 bg-red-500/10 text-red-200';
  }
  return 'border-gray-800 bg-gray-900/70 text-gray-300';
}

function StatusPill({ label, value }: { label?: string; value: string | null | undefined }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${pillTone(value)}`}>
      {label ? `${label}: ` : ''}
      {display(value)}
    </span>
  );
}

function Section({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-gray-900 bg-gray-950 p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.28em] text-gray-500">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'muted' }) {
  const color = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : tone === 'muted' ? 'text-gray-400' : 'text-white';
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] uppercase tracking-widest text-gray-500">{label}</p>
      <p className={`truncate text-sm font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-900 py-1.5 text-xs last:border-b-0">
      <span className="text-gray-500">{label}</span>
      <span className="max-w-[70%] truncate text-right text-gray-200" title={value}>
        {value}
      </span>
    </div>
  );
}

export function AutomationCommandCenter() {
  const [visibility, setVisibility] = useState<AutomationVisibility | null>(null);
  const [events, setEvents] = useState<AutomationVisibilityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [logFilter, setLogFilter] = useState<LogFilter>('All');
  const [logSearch, setLogSearch] = useState('');

  const loadSnapshot = useCallback(async () => {
    try {
      const snapshot = await portfolioApi.getAutomationVisibility();
      setVisibility(snapshot);
      setEvents((snapshot.timeline ?? []).slice(0, 200));
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? 'Failed to load automation visibility');
    }
  }, []);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    const socket = getSharedSocket();
    const subscribe = () => {
      setSocketConnected(true);
      socket.emit('automation:visibility:subscribe');
    };
    const disconnect = () => setSocketConnected(false);
    const handleSnapshot = (snapshot: AutomationVisibility) => {
      setVisibility(snapshot);
      setEvents((snapshot.timeline ?? []).slice(0, 200));
      setError(null);
    };
    const handleEvent = (event: AutomationVisibilityEvent) => {
      setEvents((prev) => {
        const key = eventKey(event);
        return [event, ...prev.filter((item) => eventKey(item) !== key)].slice(0, 200);
      });
    };
    const handleError = (payload: any) => {
      setError(payload?.message ?? 'Automation visibility stream failed');
    };

    socket.on('connect', subscribe);
    socket.on('disconnect', disconnect);
    socket.on('automation:visibility', handleSnapshot);
    socket.on('automation:event', handleEvent);
    socket.on('automation:visibility:error', handleError);
    if (socket.connected) subscribe();

    return () => {
      socket.off('connect', subscribe);
      socket.off('disconnect', disconnect);
      socket.off('automation:visibility', handleSnapshot);
      socket.off('automation:event', handleEvent);
      socket.off('automation:visibility:error', handleError);
    };
  }, []);

  const session = visibility?.engineStatus?.session;
  const act = useCallback(
    async (label: string, fn: () => Promise<unknown>, confirmMsg?: string) => {
      if (confirmMsg && !window.confirm(confirmMsg)) return;
      setBusy(label);
      try {
        await fn();
        await loadSnapshot();
      } catch (err: any) {
        setError(err?.response?.data?.error ?? err?.message ?? `${label} failed`);
      } finally {
        setBusy(null);
      }
    },
    [loadSnapshot]
  );

  const filteredEvents = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    return events
      .filter((event) => eventMatchesFilter(event, logFilter))
      .filter((event) => {
        if (!q) return true;
        return JSON.stringify(event).toLowerCase().includes(q);
      })
      .slice(0, 200);
  }, [events, logFilter, logSearch]);

  const exportCsv = useCallback(() => {
    const trades = visibility?.tradeHistory ?? [];
    const columns = [
      'Underlying',
      'Contract',
      'Direction',
      'Confidence',
      'Entry',
      'Exit',
      'Hold Time',
      'Entry Reason',
      'Exit Reason',
      'Result',
      'P/L',
      'Strategy Version',
      'Automation Session',
      'Entry Broker ID',
      'Exit Broker ID',
    ];
    const rows = trades.map((trade: any) => [
      trade.underlying,
      trade.contract,
      trade.direction,
      trade.confidence ?? '',
      trade.entry?.price ?? '',
      trade.exit?.price ?? '',
      duration(trade.holdTimeMs),
      '',
      trade.exit?.reason ?? '',
      trade.result,
      trade.pnl ?? '',
      trade.strategyVersionId,
      trade.automationSessionId,
      trade.brokerIds?.entry ?? '',
      trade.brokerIds?.exit ?? '',
    ]);
    const csv = [columns, ...rows]
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'automation-trade-history.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [visibility?.tradeHistory]);

  const metrics = visibility?.metrics ?? {};
  const engine = visibility?.engineStatus ?? {};
  const scheduler = engine.scheduler ?? {};
  const monitor = engine.monitor ?? {};
  const broker = engine.broker ?? {};
  const massive = metrics.massiveRequests ?? {};

  return (
    <section className="space-y-4 rounded-lg border border-gray-900 bg-black p-4 text-gray-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.34em] text-gray-500">Automation</p>
          <h2 className="text-xl font-semibold text-white">Command Center</h2>
          <p className="mt-1 text-xs text-gray-500">Updated {time(visibility?.generatedAt)}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <StatusPill value={broker.paper ? 'PAPER' : 'LIVE'} />
          <StatusPill label="State" value={engine.automationState} />
          <StatusPill label="Market" value={engine.market} />
          <StatusPill label="Recon" value={engine.reconciliation} />
          <StatusPill label="Socket" value={socketConnected ? 'CONNECTED' : 'DISCONNECTED'} />
          <button
            type="button"
            onClick={() => void loadSnapshot()}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-800 px-2 text-xs text-gray-300 hover:bg-gray-900 disabled:opacity-40"
            title="Refresh visibility snapshot"
            disabled={busy !== null}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>}

      {session?.id && (
        <div className="flex flex-wrap gap-2 rounded-lg border border-gray-900 bg-gray-950 p-3">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => act('pause', () => portfolioApi.pauseEntries(session.id))}
            className="rounded-md border border-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-900 disabled:opacity-40"
          >
            Pause
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => act('resume', () => portfolioApi.resumeSession(session.id))}
            className="rounded-md border border-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-900 disabled:opacity-40"
          >
            Resume
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              act(
                'emergency-stop',
                () => portfolioApi.emergencyStop(session.id),
                'Emergency stop and flatten all automation positions?'
              )
            }
            className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/10 disabled:opacity-40"
          >
            Emergency Stop
          </button>
          <span className="self-center text-xs text-gray-500">Session {session.id}</span>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Section title="Engine Status">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Automation" value={display(engine.automationState)} />
            <Stat label="Market" value={display(engine.market)} />
            <Stat label="Scheduler" value={display(scheduler.state)} tone={scheduler.state === 'ACTIVE' ? 'good' : 'bad'} />
            <Stat label="Monitor" value={display(monitor.state)} tone={monitor.state === 'ACTIVE' ? 'good' : 'bad'} />
            <Stat label="Broker" value={display(broker.state)} tone={broker.state === 'CONNECTED' ? 'good' : 'bad'} />
            <Stat label="Massive" value={display(engine.massive?.state)} tone={engine.massive?.state === 'OK' ? 'good' : 'muted'} />
            <Stat label="Mongo" value={display(engine.mongo?.state)} tone={engine.mongo?.state === 'CONNECTED' ? 'good' : 'bad'} />
            <Stat label="Reconciliation" value={display(engine.reconciliation)} tone={engine.reconciliation === 'CLEAN' ? 'good' : 'bad'} />
          </div>
          <div className="mt-3">
            <KeyValue label="Scheduler last tick" value={time(scheduler.lastTick)} />
            <KeyValue label="Scheduler next tick" value={time(scheduler.nextTick)} />
            <KeyValue label="Flow window" value={`${display(scheduler.flowWindowMinutes)} min`} />
            <KeyValue label="Monitor last run" value={time(monitor.lastMonitor)} />
          </div>
          <div className="mt-3 space-y-1">
            {(engine.leases ?? []).map((lease: any) => (
              <div key={lease.scope} className="rounded-md border border-gray-900 bg-black/40 p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-gray-400">{lease.scope}</span>
                  <StatusPill value={lease.active ? 'ACTIVE' : 'EXPIRED'} />
                </div>
                <KeyValue label="Owner" value={display(lease.ownerId)} />
                <KeyValue label="Renewed" value={time(lease.renewedAt)} />
                <KeyValue label="Expires" value={time(lease.expiresAt)} />
              </div>
            ))}
          </div>
        </Section>

        <Section title="Scheduler Panel">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Current Window" value={display(visibility?.schedulerPanel?.currentFlowWindow)} />
            <Stat label="Next Window" value={time(visibility?.schedulerPanel?.nextWindow)} />
            <Stat label="Evaluation Running" value={visibility?.schedulerPanel?.evaluationRunning ? 'YES' : 'NO'} />
            <Stat label="Skip Reason" value={display(visibility?.schedulerPanel?.skipReason)} />
            <Stat label="Queue Depth" value={number(visibility?.schedulerPanel?.currentQueue)} />
            <Stat label="Symbols Evaluated" value={number(visibility?.schedulerPanel?.symbolsEvaluated)} />
            <Stat label="Symbols Remaining" value={number(visibility?.schedulerPanel?.symbolsRemaining)} />
            <Stat label="Watchlist Size" value={number(metrics.currentWatchlistSize)} />
          </div>
        </Section>

        <Section title="Automation Metrics">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Trades" value={number(metrics.todayTrades)} />
            <Stat label="Wins" value={number(metrics.wins)} tone="good" />
            <Stat label="Losses" value={number(metrics.losses)} tone="bad" />
            <Stat label="Win %" value={percent(metrics.winPct)} />
            <Stat label="Avg Win" value={currency(metrics.averageWin)} tone="good" />
            <Stat label="Avg Loss" value={currency(metrics.averageLoss)} tone="bad" />
            <Stat label="Net P/L" value={currency(metrics.netPnl)} tone={Number(metrics.netPnl ?? 0) >= 0 ? 'good' : 'bad'} />
            <Stat label="Realized" value={currency(metrics.realizedPnl)} />
            <Stat label="Unrealized" value={currency(metrics.unrealizedPnl)} />
            <Stat label="Drawdown" value={currency(metrics.currentDrawdown)} />
            <Stat label="Signals" value={number(metrics.signalsGenerated)} />
            <Stat label="Risk Rejects" value={number(metrics.riskRejections)} />
            <Stat label="Data Rejects" value={number(metrics.dataRejections)} />
            <Stat label="Orders" value={number(metrics.ordersSubmitted)} />
            <Stat label="Fills" value={number(metrics.ordersFilled)} />
            <Stat label="Cancels" value={number(metrics.ordersCancelled)} />
            <Stat label="Exit Orders" value={number(metrics.exitOrders)} />
            <Stat label="429 Count" value={number(metrics['429Count'])} tone={Number(metrics['429Count'] ?? 0) > 0 ? 'bad' : 'good'} />
            <Stat label="Cache Hit" value={percent(metrics.cacheHitRate == null ? null : Number(metrics.cacheHitRate) * 100)} />
            <Stat label="Requests" value={number((massive.cacheHits ?? 0) + (massive.cacheMisses ?? 0))} />
            <Stat label="Deduped" value={number(massive.deduplicatedRequests)} />
          </div>
        </Section>
      </div>

      <Section title="Watchlist Evaluation">
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <StatusPill label="Outcome" value={visibility?.watchlistEvaluation?.outcome} />
          <StatusPill label="Selected" value={visibility?.watchlistEvaluation?.selectedSymbol ?? 'NONE'} />
          <StatusPill label="Risk" value={visibility?.watchlistEvaluation?.riskApproved === true ? 'APPROVED' : visibility?.watchlistEvaluation?.riskApproved === false ? 'REJECTED' : 'NONE'} />
          <span className="text-gray-500">Evaluated {time(visibility?.watchlistEvaluation?.evaluatedAt)}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-gray-500">
              <tr>
                <th className="py-2 text-left">Symbol</th>
                <th className="py-2 text-left">Direction</th>
                <th className="py-2 text-right">Confidence</th>
                <th className="py-2 text-right">Score</th>
                <th className="py-2 text-right">Flow Premium</th>
                <th className="py-2 text-right">Net Delta</th>
                <th className="py-2 text-right">Contracts</th>
                <th className="py-2 text-left">Result</th>
                <th className="py-2 text-left">Contract</th>
                <th className="py-2 text-left">Reason</th>
                <th className="py-2 text-left">Time</th>
              </tr>
            </thead>
            <tbody>
              {(visibility?.watchlistEvaluation?.results ?? []).map((row: any) => (
                <tr key={row.symbol} className="border-t border-gray-900/70">
                  <td className="py-2 pr-3 font-semibold text-white">{row.symbol}</td>
                  <td className="py-2 pr-3"><StatusPill value={row.direction} /></td>
                  <td className="py-2 pr-3 text-right">{percent(row.confidence == null ? null : Number(row.confidence) * 100)}</td>
                  <td className="py-2 pr-3 text-right">{number(row.score, 3)}</td>
                  <td className="py-2 pr-3 text-right">{currency(row.flow?.netPremium)}</td>
                  <td className="py-2 pr-3 text-right">{number(row.flow?.netDelta, 2)}</td>
                  <td className="py-2 pr-3 text-right">{number(row.flow?.contracts)}</td>
                  <td className="py-2 pr-3"><StatusPill value={row.outcome} /></td>
                  <td className="py-2 pr-3 text-gray-300">{display(row.selectedContract)}</td>
                  <td className="max-w-[280px] truncate py-2 pr-3 text-gray-400" title={row.reason}>{display(row.reason)}</td>
                  <td className="py-2 pr-3 text-gray-400">{shortTime(row.evaluatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Active Automation Trade">
          {(visibility?.activeTrades ?? []).length ? (
            <div className="space-y-3">
              {visibility!.activeTrades.map((trade: any) => (
                <div key={trade.positionId} className="rounded-lg border border-gray-900 bg-black/40 p-3">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-base font-semibold text-white">{trade.underlying}</p>
                      <p className="text-xs text-gray-400">{trade.optionSymbol}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusPill value={trade.lifecycleStatus} />
                      <StatusPill value={trade.brokerStatus} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Stat label="Contracts" value={number(trade.contracts)} />
                    <Stat label="Entry" value={currency(trade.entryPrice)} />
                    <Stat label="Mark" value={currency(trade.currentMark)} />
                    <Stat label="Bid" value={currency(trade.currentBid)} />
                    <Stat label="Ask" value={currency(trade.currentAsk)} />
                    <Stat label="Spread" value={percent(trade.currentSpreadPct)} />
                    <Stat label="P/L $" value={currency(trade.unrealizedPnl)} tone={Number(trade.unrealizedPnl ?? 0) >= 0 ? 'good' : 'bad'} />
                    <Stat label="P/L %" value={percent(trade.unrealizedPnlPct)} tone={Number(trade.unrealizedPnlPct ?? 0) >= 0 ? 'good' : 'bad'} />
                    <Stat label="MFE" value={currency(trade.mfe)} />
                    <Stat label="MAE" value={currency(trade.mae)} />
                    <Stat label="Stop" value={currency(trade.stopPrice)} />
                    <Stat label="Target" value={currency(trade.targetPrice)} />
                    <Stat label="Trailing" value={trade.trailingStop ? 'ON' : 'OFF'} />
                    <Stat label="Quote Age" value={duration(trade.quoteAgeMs)} />
                    <Stat label="Quote" value={trade.quoteFresh === true ? 'FRESH' : trade.quoteFresh === false ? 'STALE' : '-'} />
                    <Stat label="Exit Reason" value={display(trade.reasonForExit)} />
                  </div>
                  <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                    <KeyValue label="Entry time" value={time(trade.entryTime)} />
                    <KeyValue label="Filled time" value={time(trade.filledTime)} />
                    <KeyValue label="Last quote" value={time(trade.lastQuoteTimestamp)} />
                    <KeyValue label="Last update" value={time(trade.lastUpdateTimestamp)} />
                    <KeyValue label="Entry broker ID" value={display(trade.brokerOrderIds?.entry)} />
                    <KeyValue label="Exit broker ID" value={display(trade.brokerOrderIds?.exit)} />
                    <KeyValue label="Automation session" value={display(trade.automationSessionId)} />
                    <KeyValue label="Intent" value={display(trade.intentId)} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No active automation trade.</p>
          )}
        </Section>

        <Section title="Pending Orders">
          {(visibility?.pendingOrders ?? []).length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-gray-500">
                  <tr>
                    <th className="py-2 text-left">Status</th>
                    <th className="py-2 text-left">Symbol</th>
                    <th className="py-2 text-left">Type</th>
                    <th className="py-2 text-right">Remaining</th>
                    <th className="py-2 text-right">Limit</th>
                    <th className="py-2 text-left">TIF</th>
                    <th className="py-2 text-left">Broker ID</th>
                    <th className="py-2 text-left">Client Order ID</th>
                    <th className="py-2 text-right">Retries</th>
                  </tr>
                </thead>
                <tbody>
                  {visibility!.pendingOrders.map((order: any) => (
                    <tr key={order.clientOrderId ?? order.intentId ?? order.brokerOrderId} className="border-t border-gray-900/70">
                      <td className="py-2 pr-3"><StatusPill value={order.brokerStatus ?? order.status} /></td>
                      <td className="py-2 pr-3 font-semibold text-white">{order.symbol}</td>
                      <td className="py-2 pr-3">{display(order.orderType)}</td>
                      <td className="py-2 pr-3 text-right">{number(order.remainingQty, 2)}</td>
                      <td className="py-2 pr-3 text-right">{currency(order.limitPrice)}</td>
                      <td className="py-2 pr-3">{display(order.timeInForce)}</td>
                      <td className="max-w-[160px] truncate py-2 pr-3 text-gray-400" title={order.brokerOrderId}>{display(order.brokerOrderId)}</td>
                      <td className="max-w-[200px] truncate py-2 pr-3 text-gray-400" title={order.clientOrderId}>{display(order.clientOrderId)}</td>
                      <td className="py-2 pr-3 text-right">{number(order.retryCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No live automation orders.</p>
          )}
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Trade Timeline">
          <div className="max-h-[420px] overflow-y-auto pr-1">
            {[...(visibility?.timeline ?? [])]
              .slice(0, 200)
              .sort((a, b) => Date.parse(a.timestamp ?? '') - Date.parse(b.timestamp ?? ''))
              .map((event) => (
                <div key={eventKey(event)} className="grid grid-cols-[70px_1fr] gap-3 border-l border-gray-800 pb-3 pl-3 text-sm">
                  <span className="text-xs text-gray-500">{shortTime(event.timestamp)}</span>
                  <div>
                    <p className="font-medium text-gray-200">{display(event.event)}</p>
                    <p className="text-xs text-gray-500">{display(event.symbol)} {display(event.intentId)}</p>
                  </div>
                </div>
              ))}
          </div>
        </Section>

        <Section title="Live Logs">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {LOG_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setLogFilter(filter)}
                className={`rounded-md border px-2 py-1 text-xs ${
                  logFilter === filter ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-gray-800 text-gray-400 hover:bg-gray-900'
                }`}
              >
                {filter}
              </button>
            ))}
            <label className="ml-auto flex min-w-[220px] items-center gap-2 rounded-md border border-gray-800 bg-black px-2 py-1 text-xs text-gray-400">
              <Search className="h-3.5 w-3.5" />
              <input
                value={logSearch}
                onChange={(event) => setLogSearch(event.target.value)}
                placeholder="Search logs"
                className="w-full bg-transparent text-gray-200 outline-none placeholder:text-gray-600"
              />
            </label>
          </div>
          <div className="max-h-[420px] overflow-y-auto rounded-md border border-gray-900">
            {filteredEvents.map((event) => (
              <div key={eventKey(event)} className="border-b border-gray-900 p-2 text-xs last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-gray-200">{display(event.event)}</span>
                  <span className="text-gray-500">{time(event.timestamp)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-gray-500">
                  <span>{display(event.service)}</span>
                  <span>{display(event.symbol)}</span>
                  <span>{display(event.brokerOrderId)}</span>
                  <StatusPill value={event.severity ?? 'info'} />
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section title="Trade History">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-xs text-gray-500">{number(visibility?.tradeHistory?.length)} closed automation trades</span>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-800 px-2 text-xs text-gray-300 hover:bg-gray-900"
            title="Export automation trade history CSV"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-widest text-gray-500">
              <tr>
                <th className="py-2 text-left">Underlying</th>
                <th className="py-2 text-left">Contract</th>
                <th className="py-2 text-left">Direction</th>
                <th className="py-2 text-right">Entry</th>
                <th className="py-2 text-right">Exit</th>
                <th className="py-2 text-left">Hold</th>
                <th className="py-2 text-left">Exit Reason</th>
                <th className="py-2 text-left">Result</th>
                <th className="py-2 text-right">P/L</th>
                <th className="py-2 text-left">Session</th>
                <th className="py-2 text-left">Broker IDs</th>
              </tr>
            </thead>
            <tbody>
              {(visibility?.tradeHistory ?? []).map((trade: any) => (
                <tr key={trade.positionId} className="border-t border-gray-900/70">
                  <td className="py-2 pr-3 font-semibold text-white">{trade.underlying}</td>
                  <td className="py-2 pr-3">{trade.contract}</td>
                  <td className="py-2 pr-3">{trade.direction}</td>
                  <td className="py-2 pr-3 text-right">{currency(trade.entry?.price)}</td>
                  <td className="py-2 pr-3 text-right">{currency(trade.exit?.price)}</td>
                  <td className="py-2 pr-3">{duration(trade.holdTimeMs)}</td>
                  <td className="py-2 pr-3">{display(trade.exit?.reason)}</td>
                  <td className="py-2 pr-3"><StatusPill value={trade.result} /></td>
                  <td className={`py-2 pr-3 text-right font-semibold ${Number(trade.pnl ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                    {currency(trade.pnl)}
                  </td>
                  <td className="max-w-[180px] truncate py-2 pr-3 text-gray-400" title={trade.automationSessionId}>{display(trade.automationSessionId)}</td>
                  <td className="max-w-[220px] truncate py-2 pr-3 text-gray-400" title={`${trade.brokerIds?.entry ?? ''} ${trade.brokerIds?.exit ?? ''}`}>
                    {display(trade.brokerIds?.entry)} / {display(trade.brokerIds?.exit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </section>
  );
}
