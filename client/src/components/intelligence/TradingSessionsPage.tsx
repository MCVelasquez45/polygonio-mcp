import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BriefcaseBusiness,
  CalendarDays,
  Cpu,
  Gauge,
  ShieldAlert,
  ShieldCheck,
  Siren,
} from 'lucide-react';
import { listTradingSessions, type TradingSession } from '../../api/intelligence';
import {
  AlertBanner,
  EmptyState,
  EnvBadge,
  EventList,
  HealthPill,
  HeroBand,
  Metric,
  MetricStrip,
  PageHeader,
  Panel,
  RecordList,
  RefreshButton,
  SectionHeader,
  StatusBadge,
  type EventItem,
} from './ui';
import {
  fmtDateTime,
  fmtNum,
  fmtSignedUsd,
  fmtUsd,
  fmtWholePct,
  pnlTone,
} from '../../lib/intelligenceFormat';

type Props = {
  initialSessions?: TradingSession[];
  loadOnMount?: boolean;
};

/** Net result for a session: prefer total P/L, fall back to realized. */
function netPnl(session: TradingSession): number | null {
  return session.tradeSummary.totalPnl ?? session.tradeSummary.realizedPnl;
}

/** Honest market-status copy: UNAVAILABLE spells itself out. */
function marketStatusLabel(value: string): string {
  if (!value || value === 'UNAVAILABLE') return 'Market status unavailable from captured evidence';
  return value;
}

const HEALTH_CHECKS: Array<{ key: keyof TradingSession['automationHealth']; label: string }> = [
  { key: 'schedulerHealthy', label: 'Scheduler' },
  { key: 'monitorHealthy', label: 'Monitor' },
  { key: 'brokerConnected', label: 'Broker' },
  { key: 'marketDataConnected', label: 'Market Data' },
  { key: 'mongoConnected', label: 'Mongo' },
  { key: 'reconciliationClean', label: 'Reconciliation' },
];

export function TradingSessionsPage({ initialSessions = [], loadOnMount = true }: Props) {
  const [sessions, setSessions] = useState<TradingSession[]>(initialSessions);
  const [selectedId, setSelectedId] = useState<string | null>(initialSessions[0]?.sessionId ?? null);
  const [loading, setLoading] = useState(loadOnMount && initialSessions.length === 0);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await listTradingSessions(25);
      setSessions(next);
      setSelectedId(current => current ?? next[0]?.sessionId ?? null);
    } catch (err: any) {
      setError(
        err?.response?.data?.message ??
          err?.response?.data?.error ??
          err?.message ??
          'Trading sessions unavailable.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!loadOnMount || initialSessions.length > 0) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(
    () => sessions.find(s => s.sessionId === selectedId) ?? sessions[0] ?? null,
    [sessions, selectedId]
  );

  return (
    <div className="flex flex-col gap-4 pb-24" data-testid="trading-sessions-page">
      <PageHeader
        title="Trading Sessions"
        description="Immutable daily trading-day briefings captured from automation evidence."
        actions={<RefreshButton onClick={refresh} busy={loading} />}
      />

      {error && <AlertBanner tone="error">{error}</AlertBanner>}

      {loading && sessions.length === 0 ? (
        <EmptyState icon={<Activity className="h-6 w-6" />} title="Loading captured trading sessions" hint="Fetching finalized session evidence." />
      ) : sessions.length === 0 ? (
        <EmptyState icon={<CalendarDays className="h-6 w-6" />} title="No finalized trading sessions yet." hint="A briefing appears here once a trading session finalizes." />
      ) : selected ? (
        <SessionDetail
          sessions={sessions}
          selected={selected}
          onSelect={setSelectedId}
        />
      ) : null}
    </div>
  );
}

function SessionDetail({
  sessions,
  selected,
  onSelect,
}: {
  sessions: TradingSession[];
  selected: TradingSession;
  onSelect: (id: string) => void;
}) {
  const net = netPnl(selected);
  const { winningTrades, losingTrades, tradesOpened, tradesClosed, realizedPnl } = selected.tradeSummary;
  const evalSummary = selected.evaluationSummary;
  const orders = selected.orderSummary;
  const health = selected.automationHealth;
  const provider = selected.providerSummary;
  const isCollecting = selected.status !== 'FINALIZED' && selected.status !== 'FINALIZATION_FAILED';

  const warningItems = selected.warnings.map<EventItem>(w => ({
    code: w.code,
    message: w.message,
    meta: typeof w.count === 'number' ? `×${w.count}` : null,
    severity: 'warning',
  }));
  const errorItems = selected.errors.map<EventItem>(e => ({
    code: e.code,
    message: e.message,
    meta: e.component ?? null,
    severity: 'critical',
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <aside>
        <SectionHeader icon={<CalendarDays className="h-4 w-4" />} title="Session History" />
        <RecordList
          items={sessions}
          getKey={s => s.sessionId}
          selectedKey={selected.sessionId}
          onSelect={onSelect}
          label="Trading sessions"
          renderItem={s => {
            const n = netPnl(s);
            const tone = pnlTone(n);
            return (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold text-intel-ink">{s.tradingDate}</span>
                  <StatusBadge status={s.status} />
                </div>
                <p
                  className={`mt-1 font-mono text-xs tabular-nums ${
                    tone === 'pos' ? 'text-intel-pos' : tone === 'neg' ? 'text-intel-neg' : 'text-intel-ink2'
                  }`}
                >
                  {fmtSignedUsd(n)}
                </p>
              </div>
            );
          }}
        />
      </aside>

      <article className="flex flex-col gap-4">
        {isCollecting && (
          <AlertBanner tone="warn">This session is still collecting evidence.</AlertBanner>
        )}

        {/* HERO */}
        <HeroBand
          badge={{ value: fmtSignedUsd(net), label: `Net · ${selected.status.replace(/_/g, ' ')}`, tone: pnlTone(net) }}
          headline={`${selected.environment} session · ${fmtNum(winningTrades)}W / ${fmtNum(losingTrades)}L`}
          sub={marketStatusLabel(selected.marketStatus)}
          facts={[
            { k: 'DATE', v: selected.tradingDate },
            { k: 'CLOSED', v: fmtNum(tradesClosed) },
            { k: 'W/L', v: `${fmtNum(winningTrades)} / ${fmtNum(losingTrades)}` },
          ]}
        >
          <div className="flex flex-wrap items-center gap-2">
            <HealthPill
              label={net == null ? 'Net result not captured' : net > 0 ? 'Net positive day' : net < 0 ? 'Net negative day' : 'Flat day'}
              healthy={net == null ? null : net >= 0}
            />
            <span className="font-mono text-[11px] uppercase tracking-label text-intel-ink3">
              Status {selected.status}
            </span>
            <EnvBadge environment={selected.environment} />
          </div>
        </HeroBand>

        {/* HEALTH ROW */}
        <Panel title="Automation Health" icon={<Gauge className="h-4 w-4" />}>
          <div className="flex flex-wrap gap-2">
            {HEALTH_CHECKS.map(({ key, label }) => (
              <HealthPill key={key} label={label} healthy={health[key] as boolean | null | undefined ?? null} />
            ))}
            {health.emergencyStopActivated && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-intel-neg/40 bg-intel-neg/10 px-2.5 py-1 font-mono text-[11px] tracking-wide text-intel-neg">
                <Siren className="h-3.5 w-3.5" aria-hidden="true" />
                Emergency stop activated
              </span>
            )}
          </div>
        </Panel>

        {/* KEY METRICS */}
        <MetricStrip cols={6}>
          <Metric label="Net P/L" value={fmtSignedUsd(net)} tone={pnlTone(net)} emphasis />
          <Metric label="Realized" value={fmtSignedUsd(realizedPnl)} tone={pnlTone(realizedPnl)} />
          <Metric label="Opened / Closed" value={`${fmtNum(tradesOpened)} / ${fmtNum(tradesClosed)}`} />
          <Metric label="Wins" value={fmtNum(winningTrades)} tone="pos" />
          <Metric label="Losses" value={fmtNum(losingTrades)} tone="neg" />
          <Metric label="Fills" value={fmtNum(orders.fills)} />
        </MetricStrip>

        {/* EVALUATION & ORDER FLOW */}
        <Panel
          title="Evaluation & Order Flow"
          icon={<Activity className="h-4 w-4" />}
          collapsible
          defaultOpen={false}
          summary={`${fmtNum(evalSummary.signalsGenerated)} signals · ${fmtNum(orders.ordersSubmitted)} orders`}
        >
          <MetricStrip cols={4}>
            <Metric label="Watchlist" value={fmtNum(selected.watchlist.size)} />
            <Metric label="Windows" value={fmtNum(evalSummary.windowsEvaluated)} />
            <Metric label="Evaluated" value={fmtNum(evalSummary.symbolsEvaluated)} />
            <Metric label="Signals" value={fmtNum(evalSummary.signalsGenerated)} />
            <Metric label="No Signal" value={fmtNum(evalSummary.noSignalCount)} />
            <Metric label="Approved" value={fmtNum(evalSummary.approvedCount)} />
            <Metric label="Data Rejects" value={fmtNum(evalSummary.dataRejectCount)} />
            <Metric label="Risk Rejects" value={fmtNum(evalSummary.riskRejectCount)} />
            <Metric label="Intents" value={fmtNum(orders.intentsCreated)} />
            <Metric label="Submitted" value={fmtNum(orders.ordersSubmitted)} />
            <Metric label="Fills" value={fmtNum(orders.fills)} />
            <Metric label="Partial Fills" value={fmtNum(orders.partialFills)} />
            <Metric label="Cancellations" value={fmtNum(orders.cancellations)} />
            <Metric label="Rejections" value={fmtNum(orders.rejections)} />
            <Metric label="Manual Review" value={fmtNum(orders.manualReviewCount)} />
          </MetricStrip>
        </Panel>

        {/* PROVIDER & AUTOMATION */}
        <Panel
          title="Provider & Automation"
          icon={<Cpu className="h-4 w-4" />}
          collapsible
          defaultOpen={false}
          summary={`${fmtNum(provider.totalRequests)} requests`}
        >
          <MetricStrip cols={4}>
            <Metric label="Requests" value={fmtNum(provider.totalRequests)} />
            <Metric label="Cache Hits" value={fmtNum(provider.cacheHits)} />
            <Metric label="Cache Hit Rate" value={fmtWholePct(provider.cacheHitRate == null ? null : provider.cacheHitRate * 100)} />
            <Metric label="Rate Limits" value={fmtNum(provider.rateLimitCount)} />
            <Metric label="Provider Errors" value={fmtNum(provider.providerErrors)} />
            <Metric label="Entitlement Rejects" value={fmtNum(provider.entitlementRejects)} />
            <Metric label="Started" value={fmtDateTime(selected.startedAt)} />
            <Metric label="Finalized" value={fmtDateTime(selected.finalizedAt)} />
          </MetricStrip>
        </Panel>

        {/* PORTFOLIO SNAPSHOT */}
        <Panel
          title="Portfolio Snapshot"
          icon={<BriefcaseBusiness className="h-4 w-4" />}
          collapsible
          defaultOpen={false}
          summary={selected.portfolioSnapshot ? fmtUsd(selected.portfolioSnapshot.equity) : 'Not captured'}
        >
          {selected.portfolioSnapshot ? (
            <MetricStrip cols={4}>
              <Metric label="Equity" value={fmtUsd(selected.portfolioSnapshot.equity)} />
              <Metric label="Cash" value={fmtUsd(selected.portfolioSnapshot.cash)} />
              <Metric label="Buying Power" value={fmtUsd(selected.portfolioSnapshot.buyingPower)} />
              <Metric
                label="Net Unrealized"
                value={fmtSignedUsd(selected.portfolioSnapshot.netUnrealizedPnl)}
                tone={pnlTone(selected.portfolioSnapshot.netUnrealizedPnl)}
              />
              <Metric label="Source" value={selected.portfolioSnapshot.source} />
              <Metric label="Captured" value={fmtDateTime(selected.portfolioSnapshot.capturedAt)} />
            </MetricStrip>
          ) : (
            <p className="text-sm text-intel-ink2">Portfolio snapshot was not captured for this session.</p>
          )}
        </Panel>

        {/* WARNINGS */}
        <Panel
          title="Warnings"
          icon={<ShieldAlert className="h-4 w-4" />}
          collapsible
          defaultOpen={false}
          summary={fmtNum(warningItems.length)}
        >
          <EventList items={warningItems} emptyNoun="warnings" />
        </Panel>

        {/* ERRORS */}
        <Panel
          title="Errors"
          icon={health.emergencyStopActivated || errorItems.length > 0 ? <ShieldAlert className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
          collapsible
          defaultOpen={false}
          summary={fmtNum(errorItems.length)}
        >
          <EventList items={errorItems} emptyNoun="critical automation events" />
        </Panel>
      </article>
    </div>
  );
}
