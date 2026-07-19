import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpenText,
  CalendarDays,
  DatabaseZap,
  FileSearch,
  Newspaper,
  Radio,
} from 'lucide-react';
import {
  listDailyReports,
  listDecisionJournalEntries,
  listStrategyAnalytics,
  listTradingSessions,
  type DailyReport,
  type DecisionJournalEntry,
  type StrategyAnalytics,
  type TradingSession,
} from '../../api/intelligence';
import { getBrokerClock, type BrokerClockResponse } from '../../api/alpaca';
import {
  AlertBanner,
  Badge,
  EmptyState,
  GradeBadge,
  Heartbeat,
  HealthPill,
  LiveDot,
  Metric,
  MetricStrip,
  PageHeader,
  RefreshButton,
  SectionHeader,
  StatusBadge,
} from './ui';
import { ActivityFeed } from './ActivityFeed';
import { MarketDataHealthCard } from './MarketDataHealthCard';
import { useAutomationVisibility } from '../../hooks/useAutomationVisibility';
import { useLiveConnection } from '../../hooks/useLiveConnection';
import { useNow } from '../../hooks/useNow';
import { MARKET_DATA_PROVIDER } from '../../lib/marketDataStatus';
import {
  fmtNum,
  fmtSignedUsd,
  fmtWholePct,
  pnlTone,
  fmtTradeTally,
  fmtChecksAttention,
  fmtSampleGate,
  EMPTY,
} from '../../lib/intelligenceFormat';
import { deriveTomorrowFocus } from '../../lib/intelligenceInsights';
import type { IntelligenceView } from './views';

type Snapshot = {
  daily: DailyReport | null;
  session: TradingSession | null;
  analytics: StrategyAnalytics | null;
  decisions: DecisionJournalEntry[];
  clock: BrokerClockResponse | null;
};

type Props = {
  initial?: Partial<Snapshot>;
  loadOnMount?: boolean;
  onOpen?: (view: IntelligenceView) => void;
};

/** Count healthy automation flags into a single verdict. */
function healthVerdict(session: TradingSession | null): { label: string; healthy: boolean | null } {
  if (!session) return { label: 'No session', healthy: null };
  const h = session.automationHealth;
  if (h.emergencyStopActivated) return { label: 'Emergency stop', healthy: false };
  const flags = [h.schedulerHealthy, h.monitorHealthy, h.brokerConnected, h.marketDataConnected, h.mongoConnected, h.reconciliationClean];
  const known = flags.filter(f => f != null) as boolean[];
  if (known.length === 0) return { label: 'Not recorded', healthy: null };
  const bad = known.filter(f => !f).length;
  return bad === 0 ? { label: 'Healthy', healthy: true } : { label: fmtChecksAttention(bad), healthy: false };
}

function IntelCard({
  icon, title, status, summary, metricLabel, metricValue, onOpen,
}: {
  icon: ReactNode; title: string; status?: ReactNode; summary: string;
  metricLabel: string; metricValue: ReactNode; onOpen?: () => void;
}) {
  return (
    <div className="flex flex-col rounded-panel border border-intel-line bg-intel-panel p-4">
      <div className="flex items-center gap-2">
        <span className="text-intel-accent" aria-hidden="true">{icon}</span>
        <span className="text-sm font-semibold text-intel-ink">{title}</span>
        {status && <span className="ml-auto">{status}</span>}
      </div>
      <p className="mt-2 flex-1 text-sm text-intel-ink2">{summary}</p>
      <div className="mt-3 flex items-end justify-between gap-3 border-t border-intel-lineSoft pt-3">
        <div className="min-w-0">
          <p className="font-mono text-[9.5px] uppercase tracking-label text-intel-ink3">{metricLabel}</p>
          <div className="mt-0.5 max-w-full font-mono text-lg leading-tight tabular-nums text-intel-ink">{metricValue}</div>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-intel-line px-2 font-mono text-[11px] text-intel-ink2 transition hover:border-intel-accentLine hover:text-intel-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent"
        >
          Open <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function CommandCenterPage({ initial = {}, loadOnMount = true, onOpen }: Props) {
  const [snap, setSnap] = useState<Snapshot>({
    daily: initial.daily ?? null,
    session: initial.session ?? null,
    analytics: initial.analytics ?? null,
    decisions: initial.decisions ?? [],
    clock: initial.clock ?? null,
  });
  const [loading, setLoading] = useState(loadOnMount && !initial.daily && !initial.session);
  const [error, setError] = useState<string | null>(null);

  // NOW · Live Operations streams over the socket (positions, orders, P/L,
  // health, activity) instead of being fetched once. Reports (daily/session/
  // analytics/decisions) remain REST — they are finalized records, not live.
  const { visibility, events } = useAutomationVisibility();
  const conn = useLiveConnection();
  const now = useNow(1000);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [daily, sessions, analytics, decisions, clock] = await Promise.all([
        listDailyReports(1).catch(() => []),
        listTradingSessions(1).catch(() => []),
        listStrategyAnalytics(1).catch(() => []),
        listDecisionJournalEntries(200).catch(() => []),
        getBrokerClock().catch(() => null),
      ]);
      setSnap({
        daily: daily[0] ?? null,
        session: sessions[0] ?? null,
        analytics: analytics[0] ?? null,
        decisions,
        clock,
      });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? 'Command Center data unavailable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!loadOnMount || initial.daily || initial.session) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the broker market clock current without a manual refresh — market
  // open/closed changes slowly, so a light 30s REST poll is honest and cheap.
  useEffect(() => {
    if (!loadOnMount) return;
    let cancelled = false;
    const tick = async () => {
      const clock = await getBrokerClock().catch(() => null);
      if (!cancelled && clock) setSnap((prev) => ({ ...prev, clock }));
    };
    void tick();
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadOnMount]);

  const { daily, session, analytics, decisions, clock } = snap;
  const health = useMemo(() => healthVerdict(session), [session]);
  const tomorrow = useMemo(() => deriveTomorrowFocus(daily), [daily]);

  // ---- NOW · live operations (streamed over the socket; never fabricated) ----
  // The feed is "live" only when the socket is actually connected AND a
  // visibility snapshot has arrived — never merely because data was once fetched.
  const feedLive = conn.connected && visibility != null;
  const positions = visibility
    ? [
        ...(visibility.portfolioIntegration?.automationPositions ?? []),
        ...(visibility.portfolioIntegration?.manualPositions ?? []),
      ]
    : [];
  const activePositions = visibility ? positions.length : null;
  const openOrders = visibility ? (visibility.pendingOrders?.length ?? 0) : null;
  const livePnl = positions.length
    ? positions.reduce((s, p: any) => s + (typeof p.unrealizedPnl === 'number' ? p.unrealizedPnl : 0), 0)
    : null;

  // Broker link: prefer the engine's live broker state, fall back to the
  // session's recorded health, else unknown (null → no fabricated "Connected").
  const engineBrokerState = (visibility?.engineStatus as any)?.broker?.state;
  const brokerConnected =
    typeof engineBrokerState === 'string'
      ? engineBrokerState.toUpperCase() === 'CONNECTED'
      : session?.automationHealth?.brokerConnected ?? null;

  // Market open/closed: the broker clock is authoritative. When it says open we
  // NEVER render "Closed"; fall back to the engine's phase, then the session.
  const engineMarket = (visibility?.engineStatus as any)?.market;
  const marketLabel = clock
    ? clock.is_open
      ? 'Open'
      : 'Closed'
    : typeof engineMarket === 'string'
      ? engineMarket.charAt(0).toUpperCase() + engineMarket.slice(1).toLowerCase()
      : session?.marketStatus ?? 'Not recorded';

  const grade = daily?.executiveSummary.overallGrade ?? 'UNAVAILABLE';
  const netPnl = daily?.performance.netPnl ?? session?.tradeSummary.totalPnl ?? null;
  const headline = daily?.executiveSummary.sessionSummary ?? 'No trading day has been summarized yet.';
  const noReports = !daily && !session;

  return (
    <div className="flex flex-col gap-5 pb-24" data-testid="command-center-page">
      <PageHeader
        title="Command Center"
        description="The operating system for the desk — live status now, today’s result, and the record to learn from."
        actions={<RefreshButton onClick={refresh} busy={loading} />}
      />

      {error && <AlertBanner tone="error">{error}</AlertBanner>}

      {/* ---------- NOW ---------- */}
      <section>
        <SectionHeader
          icon={<Radio className="h-4 w-4" />}
          title="Now · Live Operations"
          right={
            <LiveDot
              active={feedLive}
              label={
                feedLive
                  ? 'Feed live'
                  : conn.phase === 'reconnecting'
                    ? 'Reconnecting'
                    : conn.phase === 'connecting'
                      ? 'Connecting'
                      : 'Feed offline'
              }
            />
          }
        />
        <MetricStrip cols={6}>
          <Metric label="Automation" value={<Heartbeat healthy={feedLive ? health.healthy : null} label="" />} />
          <Metric label="Market" value={marketLabel} />
          <Metric label="Open Positions" value={activePositions == null ? 'Not recorded' : fmtNum(activePositions)} />
          <Metric label="Open Orders" value={openOrders == null ? 'Not recorded' : fmtNum(openOrders)} />
          <Metric label="Live P/L" value={livePnl == null ? EMPTY.livePnl : fmtSignedUsd(livePnl)} tone={pnlTone(livePnl)} />
          <Metric label="Health" value={<HealthPill label={health.label} healthy={health.healthy} className="align-middle" />} />
        </MetricStrip>
        <div className="mt-4 grid items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <MarketDataHealthCard
            phase={conn.phase}
            brokerConnected={brokerConnected}
            provider={MARKET_DATA_PROVIDER}
            lastQuoteAt={conn.lastQuoteAt}
            nowMs={now}
          />
          <ActivityFeed events={events} />
        </div>
      </section>

      {/* ---------- TODAY + LEARNING ---------- */}
      {loading && noReports ? (
        <EmptyState icon={<Activity className="h-6 w-6" />} title="Loading intelligence" hint="Fetching the latest report, session, and analytics." />
      ) : noReports ? (
        <EmptyState
          icon={<Newspaper className="h-6 w-6" />}
          title="No intelligence generated yet"
          hint="Once a trading session finalizes, the desk summary appears here."
        />
      ) : (
        <>
          <section>
            <SectionHeader icon={<CalendarDays className="h-4 w-4" />} title="Today" />
            {/* Hero */}
            <div className="rounded-panel border border-intel-line bg-intel-panel p-5">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <div className="flex flex-none flex-col items-center justify-center rounded-panel border border-intel-line px-6 py-4 text-center">
                  <GradeBadge grade={grade} className="!text-2xl !px-4 !py-1.5" />
                  <span className="mt-2 font-mono text-[9.5px] uppercase tracking-eyebrow text-intel-ink3">Today</span>
                </div>
                <div className="min-w-0">
                  <h2 className="text-balance text-xl font-semibold tracking-tight text-intel-ink">{headline}</h2>
                  <p className="mt-2 text-sm text-intel-ink2">
                    <span className="text-intel-ink3">Primary lesson · </span>
                    {daily?.executiveSummary.primaryLesson ?? 'No primary lesson was derived from captured evidence.'}
                  </p>
                  <p className="mt-1 text-sm text-intel-ink2">
                    <span className="text-intel-ink3">Tomorrow · </span>{tomorrow}
                  </p>
                </div>
              </div>
              <MetricStrip className="mt-4" cols={4}>
                <Metric label="Net P/L" value={fmtSignedUsd(netPnl)} tone={pnlTone(netPnl)} emphasis />
                <Metric label="Best Trade" value={daily?.executiveSummary.bestDecision ? daily.executiveSummary.bestDecision.split(' ')[0] : 'Not recorded'} tone="pos" />
                <Metric label="Worst Trade" value={daily?.executiveSummary.worstDecision ? daily.executiveSummary.worstDecision.split(' ')[0] : 'Not recorded'} tone="neg" />
                <Metric label="Evidence" value={daily ? fmtWholePct(daily.evidenceQuality.availableEvidencePercent) : 'Not recorded'} />
              </MetricStrip>
            </div>
            {/* Today cards */}
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <IntelCard
                icon={<Newspaper className="h-4 w-4" />} title="Daily Report"
                status={daily ? <GradeBadge grade={grade} /> : <Badge>none</Badge>}
                summary={daily?.executiveSummary.marketSummary ?? 'No daily report generated yet.'}
                metricLabel="Net P/L" metricValue={fmtSignedUsd(netPnl)} onOpen={() => onOpen?.('daily')}
              />
              <IntelCard
                icon={<CalendarDays className="h-4 w-4" />} title="Trading Session"
                status={session ? <StatusBadge status={session.status} /> : <Badge>none</Badge>}
                summary={session ? `Automated session for ${session.tradingDate}.` : 'No session captured yet.'}
                metricLabel="Health" metricValue={<HealthPill label={health.label} healthy={health.healthy} />}
                onOpen={() => onOpen?.('sessions')}
              />
              <IntelCard
                icon={<DatabaseZap className="h-4 w-4" />} title="Evidence Health"
                status={daily ? <Badge tone={daily.evidenceQuality.availableEvidencePercent >= 90 ? 'pos' : 'warn'}>{fmtWholePct(daily.evidenceQuality.availableEvidencePercent)}</Badge> : <Badge>none</Badge>}
                summary="Completeness of the captured evidence behind today’s intelligence."
                metricLabel="Missing sources"
                metricValue={daily?.evidenceQuality.missingEvidence.length ?? 0}
                onOpen={() => onOpen?.('daily')}
              />
            </div>
          </section>

          <section>
            <SectionHeader icon={<BarChart3 className="h-4 w-4" />} title="Learning" />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <IntelCard
                icon={<FileSearch className="h-4 w-4" />} title="Trade Reports"
                status={<Badge tone="neutral">{fmtTradeTally(daily?.tradingSummary.wins, daily?.tradingSummary.losses)}</Badge>}
                summary="Per-trade execution grades, lessons, and evidence."
                metricLabel="Result"
                metricValue={<span className="text-sm">{fmtTradeTally(daily?.tradingSummary.wins, daily?.tradingSummary.losses, netPnl)}</span>}
                onOpen={() => onOpen?.('trades')}
              />
              <IntelCard
                icon={<BookOpenText className="h-4 w-4" />} title="Decision Journal"
                status={<Badge tone="neutral">{decisions.length} recent</Badge>}
                summary="Why the engine acted — approvals, rejections, and reasons."
                metricLabel="Decisions" metricValue={decisions.length}
                onOpen={() => onOpen?.('decisions')}
              />
              <IntelCard
                icon={<BarChart3 className="h-4 w-4" />} title="Strategy Analytics"
                status={analytics ? <Badge tone="accent">{analytics.windowType}</Badge> : <Badge>Awaiting trades</Badge>}
                summary={
                  analytics && analytics.performance.winRate != null
                    ? 'Which strategies, symbols, and regimes actually make money.'
                    : analytics
                      ? fmtSampleGate(analytics.performance.totalTrades)
                      : EMPTY.analytics
                }
                metricLabel="Win Rate"
                metricValue={
                  analytics && analytics.performance.winRate != null
                    ? fmtWholePct(analytics.performance.winRate * 100)
                    : <span className="text-sm text-intel-ink3">Not enough trades</span>
                }
                onOpen={() => onOpen?.('analytics')}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
