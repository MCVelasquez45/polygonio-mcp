import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  CalendarDays,
  Clock,
  DatabaseZap,
  Gauge,
  Layers,
  ShieldCheck,
} from 'lucide-react';
import {
  listStrategyAnalytics,
  type StrategyAnalytics,
  type StrategyAnalyticsBucket,
} from '../../api/intelligence';
import {
  AlertBanner,
  Badge,
  ChartCard,
  DistributionChart,
  EmptyState,
  EnvBadge,
  EventList,
  EvidenceBanner,
  Metric,
  MetricStrip,
  PageHeader,
  Panel,
  RankBarChart,
  RecordList,
  RefreshButton,
  SectionHeader,
  StatusBadge,
  type EventItem,
} from './ui';
import {
  fmtDecimal,
  fmtNum,
  fmtPct,
  fmtSignedUsd,
  fmtUsd,
  pnlTone,
  toneText,
} from '../../lib/intelligenceFormat';
import { bucketsToCountChart, bucketsToPnlChart } from '../../lib/intelligenceInsights';

type Props = {
  initialAnalytics?: StrategyAnalytics[];
  loadOnMount?: boolean;
};

/** Compact ranked-bucket list for the below-the-fold cohort panels. */
function BucketList({ buckets, emptyNoun }: { buckets: StrategyAnalyticsBucket[]; emptyNoun: string }) {
  if (buckets.length === 0) {
    return <p className="text-sm text-intel-ink2">No {emptyNoun} were captured for this window.</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {buckets.map(b => (
        <li
          key={b.key}
          className="flex items-center justify-between gap-3 rounded-lg border border-intel-line bg-intel-panel2 px-3 py-2"
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className="truncate text-sm text-intel-ink">{b.label}</span>
            <span className="font-mono text-[11px] text-intel-ink3">{fmtNum(b.totalTrades)} trades</span>
          </span>
          <span className="flex items-center gap-3 flex-none">
            <span className="font-mono text-[11px] text-intel-ink3">{fmtPct(b.winRate)}</span>
            <span className={`font-mono text-sm tabular-nums ${toneText(pnlTone(b.netPnl))}`}>
              {fmtSignedUsd(b.netPnl)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function StrategyAnalyticsPage({ initialAnalytics = [], loadOnMount = true }: Props) {
  const [analytics, setAnalytics] = useState<StrategyAnalytics[]>(initialAnalytics);
  const [selectedId, setSelectedId] = useState<string | null>(initialAnalytics[0]?.analyticsId ?? null);
  const [loading, setLoading] = useState(loadOnMount && initialAnalytics.length === 0);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await listStrategyAnalytics(50);
      setAnalytics(next);
      setSelectedId(current => current ?? next[0]?.analyticsId ?? null);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message ?? 'Strategy analytics unavailable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!loadOnMount || initialAnalytics.length > 0) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(
    () => analytics.find(item => item.analyticsId === selectedId) ?? analytics[0] ?? null,
    [analytics, selectedId]
  );

  const strategyPnl = useMemo(() => (selected ? bucketsToPnlChart(selected.strategyBreakdown) : []), [selected]);
  const sectorPnl = useMemo(() => (selected ? bucketsToPnlChart(selected.sectorBreakdown) : []), [selected]);
  const underlyingPnl = useMemo(() => (selected ? bucketsToPnlChart(selected.underlyingBreakdown) : []), [selected]);
  const regimePnl = useMemo(() => (selected ? bucketsToPnlChart(selected.marketRegimeBreakdown) : []), [selected]);
  const exitPnl = useMemo(() => (selected ? bucketsToPnlChart(selected.exitReasonBreakdown) : []), [selected]);
  const confidenceCounts = useMemo(
    () => (selected ? bucketsToCountChart(selected.confidenceBreakdown) : []),
    [selected]
  );

  return (
    <div className="flex flex-col gap-4 pb-24" data-testid="strategy-analytics-page">
      <PageHeader
        title="Strategy Analytics"
        description="Deterministic cohort analytics derived from sessions, trade reports, daily reports, and decision journals."
        actions={<RefreshButton onClick={refresh} busy={loading} />}
      />

      {error && <AlertBanner tone="error">{error}</AlertBanner>}

      {loading && analytics.length === 0 ? (
        <EmptyState icon={<Activity className="h-6 w-6" />} title="Loading strategy analytics" hint="Fetching generated intelligence." />
      ) : analytics.length === 0 ? (
        <EmptyState
          icon={<BarChart3 className="h-6 w-6" />}
          title="No strategy analytics snapshots have been generated yet."
          hint="A snapshot appears here once an analytics window is generated."
        />
      ) : selected ? (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <aside>
            <SectionHeader icon={<CalendarDays className="h-4 w-4" />} title="Snapshots" />
            <RecordList
              items={analytics}
              getKey={a => a.analyticsId}
              selectedKey={selected.analyticsId}
              onSelect={setSelectedId}
              label="Strategy analytics snapshots"
              renderItem={a => (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-semibold text-intel-ink">{a.tradingDate}</span>
                    <Badge tone="accent">{a.windowType}</Badge>
                  </div>
                  <p className={`mt-1 font-mono text-xs tabular-nums ${toneText(pnlTone(a.performance.netPnl))}`}>
                    {fmtSignedUsd(a.performance.netPnl)}
                  </p>
                </div>
              )}
            />
          </aside>

          <article className="flex flex-col gap-4">
            {/* SNAPSHOT HEADER */}
            <Panel title={selected.tradingDate} icon={<Gauge className="h-4 w-4" />}
              summary={<span className={toneText(pnlTone(selected.performance.netPnl))}>{fmtSignedUsd(selected.performance.netPnl)}</span>}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">{selected.windowType}</Badge>
                <EnvBadge environment={selected.environment} />
                <StatusBadge status={selected.status} />
              </div>
            </Panel>

            {/* KPI STRIP */}
            <MetricStrip cols={6}>
              <Metric label="Win Rate" value={fmtPct(selected.performance.winRate)} />
              <Metric label="Profit Factor" value={fmtDecimal(selected.performance.profitFactor)} />
              <Metric label="Expectancy" value={fmtUsd(selected.performance.expectancy)} tone={pnlTone(selected.performance.expectancy)} />
              <Metric label="Net P/L" value={fmtSignedUsd(selected.performance.netPnl)} tone={pnlTone(selected.performance.netPnl)} emphasis />
              <Metric label="Max Drawdown" value={fmtUsd(selected.performance.drawdown)} />
              <Metric label="Total Trades" value={fmtNum(selected.performance.totalTrades)} />
            </MetricStrip>

            {/* CHARTS */}
            <div className="grid gap-4 xl:grid-cols-2">
              <ChartCard
                title="Strategy Rankings"
                subtitle="Net P/L by strategy"
                hasData={strategyPnl.length > 0}
                emptyHint="No strategy buckets were captured for this window."
              >
                <RankBarChart data={strategyPnl} valueFormatter={fmtSignedUsd} />
              </ChartCard>

              <ChartCard
                title="Sector Rankings"
                subtitle="Net P/L by sector"
                hasData={sectorPnl.length > 0}
                emptyHint="No sector attribution was captured for this window."
              >
                <RankBarChart data={sectorPnl} valueFormatter={fmtSignedUsd} />
              </ChartCard>

              <ChartCard
                title="Top & Worst Symbols"
                subtitle="Net P/L by underlying"
                hasData={underlyingPnl.length > 0}
                emptyHint="No underlying buckets were captured for this window."
              >
                <RankBarChart data={underlyingPnl} valueFormatter={fmtSignedUsd} />
              </ChartCard>

              <ChartCard
                title="Market Regimes"
                subtitle="Net P/L by regime"
                hasData={regimePnl.length > 0}
                emptyHint="No market-regime attribution was captured for this window."
              >
                <RankBarChart data={regimePnl} valueFormatter={fmtSignedUsd} />
              </ChartCard>

              <ChartCard
                title="Exit Reasons"
                subtitle="Net P/L by exit reason"
                hasData={exitPnl.length > 0}
                emptyHint="No exit reasons were captured for this window."
              >
                <RankBarChart data={exitPnl} valueFormatter={fmtSignedUsd} />
              </ChartCard>

              <ChartCard
                title="Confidence Distribution"
                subtitle="Trade count by confidence band"
                hasData={confidenceCounts.length > 0}
                emptyHint="No confidence values were captured for this window."
              >
                <DistributionChart data={confidenceCounts} valueFormatter={v => fmtNum(v)} />
              </ChartCard>
            </div>

            {/* SECONDARY COHORTS (collapsed) */}
            <Panel title="DTE Cohorts" icon={<Clock className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={`${selected.dteBreakdown.length} buckets`}>
              <BucketList buckets={selected.dteBreakdown} emptyNoun="DTE buckets" />
            </Panel>

            <Panel title="Delta Cohorts" icon={<Layers className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={`${selected.deltaBreakdown.length} buckets`}>
              <BucketList buckets={selected.deltaBreakdown} emptyNoun="delta buckets" />
            </Panel>

            <Panel title="IV Cohorts" icon={<Gauge className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={`${selected.ivBreakdown.length} buckets`}>
              <BucketList buckets={selected.ivBreakdown} emptyNoun="IV buckets" />
            </Panel>

            <Panel title="Weekday Cohorts" icon={<CalendarDays className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={`${selected.weekdayBreakdown.length} buckets`}>
              <BucketList buckets={selected.weekdayBreakdown} emptyNoun="weekday buckets" />
            </Panel>

            <Panel title="Time of Day Cohorts" icon={<Clock className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={`${selected.timeOfDayBreakdown.length} buckets`}>
              <BucketList buckets={selected.timeOfDayBreakdown} emptyNoun="time-of-day buckets" />
            </Panel>

            <Panel title="Risk Profile Cohorts" icon={<ShieldCheck className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={`${selected.riskProfileBreakdown.length} buckets`}>
              <BucketList buckets={selected.riskProfileBreakdown} emptyNoun="risk-profile buckets" />
            </Panel>

            {/* EVIDENCE & WARNINGS (collapsed) */}
            <Panel title="Evidence Quality" icon={<DatabaseZap className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={fmtPct(selected.evidenceQuality.availableEvidencePercent / 100)}>
              <EvidenceBanner
                percent={selected.evidenceQuality.availableEvidencePercent}
                missingCount={selected.evidenceQuality.missingEvidence.length}
              />
              {selected.evidenceQuality.missingEvidence.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {selected.evidenceQuality.missingEvidence.slice(0, 10).map(m => (
                    <li key={m} className="font-mono text-xs text-intel-warn">{m}</li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Warnings" icon={<ShieldCheck className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={`${selected.warnings.length}`}>
              <EventList
                items={selected.warnings.map<EventItem>(w => ({ code: w.code, message: w.message, severity: 'warning' }))}
                emptyNoun="warnings"
              />
            </Panel>
          </article>
        </div>
      ) : null}
    </div>
  );
}
