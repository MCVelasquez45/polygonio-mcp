import { useEffect, useMemo, useState } from 'react';
import { Activity, ChevronDown, ChevronRight } from 'lucide-react';
import {
  getTradeLifecycleActive,
  getTradeLifecycleHistory,
  getTradeLifecyclePending,
  getTradeLifecycleStatus,
  getTradeLifecycleTimeline,
  type TradeLifecycleEvent,
  type TradeLifecycleRecord,
  type TradeLifecycleStatus,
} from '../../api/tradeLifecycle';
import { Panel, Pill, statusTone } from './cockpitUi';

function clock(value?: string | null): string {
  if (!value) return 'N/A';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 'N/A';
  return new Date(parsed).toLocaleTimeString();
}

function age(value?: string | null): string {
  if (!value) return 'N/A';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 'N/A';
  const mins = Math.max(0, Math.round((Date.now() - parsed) / 60_000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const LABEL = 'font-mono text-[10px] uppercase tracking-label text-intel-ink3';

function Detail({ trade }: { trade: TradeLifecycleRecord }) {
  return (
    <div className="mt-3 grid gap-3 border-t border-intel-lineSoft pt-3 text-xs text-intel-ink2 md:grid-cols-2 xl:grid-cols-4">
      <div>
        <div className={LABEL}>Entry</div>
        <div className="mt-1 font-mono text-intel-ink">{trade.entryIntentId ?? 'N/A'}</div>
      </div>
      <div>
        <div className={LABEL}>Confidence</div>
        <div className="mt-1 font-mono text-intel-ink">
          {trade.confidence.entry ?? 'N/A'} {'->'} {trade.confidence.current ?? 'N/A'} - {trade.confidence.trend}
        </div>
      </div>
      <div>
        <div className={LABEL}>Risk Decision</div>
        <div className="mt-1 font-mono text-intel-ink">{trade.riskDecisionId ?? 'N/A'}</div>
      </div>
      <div>
        <div className={LABEL}>Exit Recommendation</div>
        <div className="mt-1 font-mono text-intel-ink">{trade.exitReason ?? trade.currentAction}</div>
      </div>
      <div className="md:col-span-2 xl:col-span-4">
        <div className={LABEL}>Journal</div>
        <p className="mt-1 text-intel-ink2">{trade.reasoning.join(' ') || 'No lifecycle reasoning captured yet.'}</p>
      </div>
    </div>
  );
}

function TradeRows({ trades }: { trades: TradeLifecycleRecord[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!trades.length) return <p className="text-xs text-intel-ink3">No open lifecycle trades.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px]">
        <thead>
          <tr className="border-b border-intel-line">
            <th className={`py-1.5 pr-3 text-left ${LABEL} font-normal`}>Symbol</th>
            <th className={`py-1.5 pr-3 text-left ${LABEL} font-normal`}>State</th>
            <th className={`py-1.5 pr-3 text-right ${LABEL} font-normal`}>P/L</th>
            <th className={`py-1.5 pr-3 text-right ${LABEL} font-normal`}>Confidence</th>
            <th className={`py-1.5 pr-3 text-left ${LABEL} font-normal`}>AI Recommendation</th>
            <th className={`py-1.5 pr-3 text-left ${LABEL} font-normal`}>Time Held</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => {
            const selected = open === trade.tradeId;
            return (
              <tr key={trade.tradeId} className="border-b border-intel-lineSoft align-top">
                <td colSpan={6} className="p-0">
                  <button
                    type="button"
                    className="grid w-full grid-cols-[22px_1.2fr_1fr_0.8fr_0.9fr_1fr_0.8fr] items-center py-2 pr-3 text-left font-mono text-xs text-intel-ink2"
                    onClick={() => setOpen(selected ? null : trade.tradeId)}
                  >
                    {selected ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <span className="font-semibold text-intel-ink">{trade.optionSymbol}</span>
                    <span><Pill tone={statusTone(trade.state)}>{trade.state}</Pill></span>
                    <span className="text-right tabular-nums">N/A</span>
                    <span className="text-right tabular-nums text-intel-ink">{trade.confidence.current ?? 'N/A'}</span>
                    <span>{trade.currentAction}</span>
                    <span>{age(trade.createdAt)}</span>
                  </button>
                  {selected && <Detail trade={trade} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({ events }: { events: TradeLifecycleEvent[] }) {
  const rows = events.slice(0, 12);
  if (!rows.length) return <p className="text-xs text-intel-ink3">No lifecycle timeline events captured yet.</p>;
  return (
    <div className="flex flex-col">
      {rows.map((event, index) => (
        <div key={`${event.tradeId ?? event.source ?? event.service}-${event.at ?? event.timestamp}-${index}`} className="flex items-baseline gap-3 border-b border-intel-lineSoft py-1.5 last:border-b-0">
          <span className="w-[64px] shrink-0 font-mono text-[10px] tabular-nums text-intel-ink3">{clock(event.at ?? event.timestamp)}</span>
          <span className="min-w-0 truncate font-mono text-xs text-intel-ink2">{event.eventType ?? event.event ?? 'LIFECYCLE_EVENT'}</span>
          {event.state && <span className="ml-auto shrink-0 font-mono text-[10px] text-intel-ink3">{event.state}</span>}
        </div>
      ))}
    </div>
  );
}

export function TradeLifecyclePanel() {
  const [status, setStatus] = useState<TradeLifecycleStatus | null>(null);
  const [active, setActive] = useState<TradeLifecycleRecord[]>([]);
  const [pending, setPending] = useState<TradeLifecycleRecord[]>([]);
  const [history, setHistory] = useState<TradeLifecycleRecord[]>([]);
  const [timeline, setTimeline] = useState<TradeLifecycleEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [nextStatus, nextActive, nextPending, nextHistory, nextTimeline] = await Promise.all([
          getTradeLifecycleStatus(),
          getTradeLifecycleActive(),
          getTradeLifecyclePending(),
          getTradeLifecycleHistory(20),
          getTradeLifecycleTimeline(60),
        ]);
        if (cancelled) return;
        setStatus(nextStatus);
        setActive(nextActive);
        setPending(nextPending);
        setHistory(nextHistory);
        setTimeline(nextTimeline);
        setError(null);
      } catch (err: any) {
        if (!cancelled) setError(err?.response?.data?.error ?? err?.message ?? 'Trade lifecycle unavailable.');
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const rejected = useMemo(
    () => pending.filter((trade) => String(trade.reasoning.join(' ')).toUpperCase().includes('REJECT')),
    [pending]
  );

  return (
    <Panel
      title="Trade Lifecycle"
      badge={<Pill tone={status?.flags?.TRADE_LIFECYCLE_ENABLED ? 'good' : 'warn'}>{status?.aiStatus ?? 'Loading'}</Pill>}
      actions={<Activity className="h-4 w-4 text-intel-ink3" />}
    >
      {error && <p className="mb-3 text-xs text-intel-neg">{error}</p>}
      <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
        {[
          ['AI Status', status?.aiStatus],
          ['Paper Trading', status?.paperTrading ? 'PAPER' : 'OFF'],
          ['Market', status?.market],
          ['Current Strategy', status?.currentStrategy],
          ['Current Regime', status?.currentRegime],
          ['Next Evaluation', clock(status?.nextEvaluation)],
          ['Recommendation', status?.currentDecision?.recommendation],
        ].map(([label, value]) => (
          <div key={label ?? ''} className="min-w-0">
            <div className={LABEL}>{label}</div>
            <div className="mt-0.5 truncate font-mono text-sm font-semibold text-intel-ink">{value || 'N/A'}</div>
          </div>
        ))}
      </div>
      {status?.currentDecision && (
        <div className="mt-3 rounded border border-intel-lineSoft px-3 py-2">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className={LABEL}>Current AI Decision</span>
            <span className="font-mono text-intel-ink">{status.currentDecision.watching}</span>
            <span className="font-mono text-intel-accent">{status.currentDecision.recommendation}</span>
            <span className="font-mono text-intel-ink2">Confidence {status.currentDecision.confidence ?? 'N/A'}</span>
          </div>
          <p className="mt-1 text-xs text-intel-ink2">{status.currentDecision.reason}</p>
        </div>
      )}
      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className={LABEL}>Open Trades</span>
            <Pill tone={active.length ? 'good' : 'neutral'}>{active.length}</Pill>
          </div>
          <TradeRows trades={active} />
        </div>
        <div className="space-y-3">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className={LABEL}>Pending Trades</span>
              <Pill tone={pending.length ? 'warn' : 'neutral'}>{pending.length}</Pill>
            </div>
            <div className="space-y-1.5">
              {pending.slice(0, 5).map((trade) => (
                <div key={trade.tradeId} className="flex items-center justify-between gap-3 font-mono text-xs text-intel-ink2">
                  <span className="truncate">{trade.optionSymbol}</span>
                  <span className="shrink-0">{trade.state}</span>
                </div>
              ))}
              {!pending.length && <p className="text-xs text-intel-ink3">No pending lifecycle trades.</p>}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className={LABEL}>Rejected</span>
              <Pill tone={rejected.length ? 'warn' : 'neutral'}>{rejected.length}</Pill>
            </div>
            {rejected.length ? (
              rejected.slice(0, 4).map((trade) => (
                <div key={trade.tradeId} className="flex items-center justify-between gap-3 font-mono text-xs text-intel-ink2">
                  <span>{trade.underlying}</span>
                  <span className="truncate">{trade.reasoning[0] ?? 'Rejected'}</span>
                </div>
              ))
            ) : (
              <p className="text-xs text-intel-ink3">No rejected lifecycle trades.</p>
            )}
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className={LABEL}>Activity Timeline</span>
            <Pill tone="neutral">{timeline.length}</Pill>
          </div>
          <Timeline events={timeline} />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className={LABEL}>Latest Evaluations</span>
            <Pill tone="neutral">{history.length}</Pill>
          </div>
          {history.slice(0, 6).map((trade) => (
            <div key={trade.tradeId} className="flex items-center justify-between gap-3 border-b border-intel-lineSoft py-1.5 font-mono text-xs text-intel-ink2 last:border-b-0">
              <span className="truncate">{trade.optionSymbol}</span>
              <span>{trade.evaluationSummary?.winLoss ? String(trade.evaluationSummary.winLoss) : trade.state}</span>
            </div>
          ))}
          {!history.length && <p className="text-xs text-intel-ink3">No completed lifecycle evaluations.</p>}
        </div>
      </div>
    </Panel>
  );
}
