import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardList,
  DatabaseZap,
  Gauge,
  Newspaper,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { listDailyReports, type DailyGradeBreakdown, type DailyReport } from '../../api/intelligence';
import {
  AlertBanner,
  Badge,
  EmptyState,
  EnvBadge,
  EvidenceBanner,
  EventList,
  GradeBadge,
  GroupedTimeline,
  HeroBand,
  Metric,
  MetricStrip,
  PageHeader,
  Panel,
  RecordList,
  RefreshButton,
  SectionHeader,
  type EventItem,
  type TimelineEvent,
} from './ui';
import {
  fmtDecimal,
  fmtHoldTime,
  fmtNum,
  fmtSignedUsd,
  fmtUsd,
  fmtWholePct,
  gradeTier,
  pnlTone,
  type Tone,
} from '../../lib/intelligenceFormat';
import { deriveTomorrowFocus } from '../../lib/intelligenceInsights';

type Props = {
  initialReports?: DailyReport[];
  loadOnMount?: boolean;
};

function gradeTone(grade: string): Tone {
  const tier = gradeTier(grade);
  return tier === 'a' ? 'pos' : tier === 'bc' ? 'warn' : tier === 'f' ? 'neg' : 'neutral';
}

const GRADE_LABELS: Array<{ key: keyof DailyReport['grades']; label: string }> = [
  { key: 'overall', label: 'Overall' },
  { key: 'execution', label: 'Execution' },
  { key: 'risk', label: 'Risk' },
  { key: 'market', label: 'Market' },
  { key: 'tradeQuality', label: 'Trade Quality' },
  { key: 'performance', label: 'Performance' },
  { key: 'evidence', label: 'Evidence' },
];

function GradeRubric({ grades }: { grades: DailyReport['grades'] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
      {GRADE_LABELS.map(({ key, label }) => {
        const g: DailyGradeBreakdown = grades[key];
        return (
          <div key={key} className="rounded-lg border border-intel-line bg-intel-panel2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-intel-ink2">{label}</span>
              <GradeBadge grade={g.grade} />
            </div>
            <p className="mt-1 font-mono text-[11px] text-intel-ink3">
              Score {g.score == null ? 'Not recorded' : g.score}
            </p>
            {g.reasons.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-intel-ink2">
                {g.reasons.slice(0, 3).map(r => <li key={r}>{r}</li>)}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function DailyReportsPage({ initialReports = [], loadOnMount = true }: Props) {
  const [reports, setReports] = useState<DailyReport[]>(initialReports);
  const [selectedId, setSelectedId] = useState<string | null>(initialReports[0]?.reportId ?? null);
  const [loading, setLoading] = useState(loadOnMount && initialReports.length === 0);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await listDailyReports(50);
      setReports(next);
      setSelectedId(current => current ?? next[0]?.reportId ?? null);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message ?? 'Daily reports unavailable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!loadOnMount || initialReports.length > 0) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(
    () => reports.find(r => r.reportId === selectedId) ?? reports[0] ?? null,
    [reports, selectedId]
  );

  const tomorrow = useMemo(() => deriveTomorrowFocus(selected), [selected]);

  return (
    <div className="flex flex-col gap-4 pb-24" data-testid="daily-reports-page">
      <PageHeader
        title="Daily Reports"
        description="Executive trading-day briefings generated from sessions and trade reports."
        actions={<RefreshButton onClick={refresh} busy={loading} />}
      />

      {error && <AlertBanner tone="error">{error}</AlertBanner>}

      {loading && reports.length === 0 ? (
        <EmptyState icon={<Activity className="h-6 w-6" />} title="Loading daily reports" hint="Fetching generated intelligence." />
      ) : reports.length === 0 ? (
        <EmptyState icon={<Newspaper className="h-6 w-6" />} title="No daily intelligence reports have been generated yet." hint="A briefing appears here once a session finalizes." />
      ) : selected ? (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <aside>
            <SectionHeader icon={<CalendarDays className="h-4 w-4" />} title="Report History" />
            <RecordList
              items={reports}
              getKey={r => r.reportId}
              selectedKey={selected.reportId}
              onSelect={setSelectedId}
              label="Daily reports"
              renderItem={r => (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-semibold text-intel-ink">{r.tradingDate}</span>
                    <GradeBadge grade={r.executiveSummary.overallGrade} />
                  </div>
                  <p className={`mt-1 font-mono text-xs tabular-nums ${pnlTone(r.performance.netPnl) === 'pos' ? 'text-intel-pos' : pnlTone(r.performance.netPnl) === 'neg' ? 'text-intel-neg' : 'text-intel-ink2'}`}>
                    {fmtSignedUsd(r.performance.netPnl)}
                  </p>
                </div>
              )}
            />
          </aside>

          <article className="flex flex-col gap-4">
            {/* HERO */}
            <HeroBand
              badge={{ value: selected.executiveSummary.overallGrade, label: 'Daily Grade', tone: gradeTone(selected.executiveSummary.overallGrade) }}
              headline={selected.executiveSummary.sessionSummary}
              sub={selected.executiveSummary.marketSummary}
              facts={[
                { k: 'DATE', v: selected.tradingDate },
                { k: 'NET', v: fmtSignedUsd(selected.performance.netPnl), tone: pnlTone(selected.performance.netPnl) },
                { k: 'W/L', v: `${selected.tradingSummary.wins} / ${selected.tradingSummary.losses}` },
              ]}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-label text-intel-ink3">Primary lesson</p>
                  <p className="mt-1 text-sm text-intel-ink">{selected.executiveSummary.primaryLesson ?? 'No primary lesson was derived from captured evidence.'}</p>
                </div>
                <div className="sm:border-l sm:border-intel-lineSoft sm:pl-3">
                  <p className="font-mono text-[10px] uppercase tracking-label text-intel-accent">Tomorrow focus</p>
                  <p className="mt-1 text-sm text-intel-ink">{tomorrow}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-intel-lineSoft pt-3">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-intel-pos/30 bg-intel-pos/5 px-2.5 py-1 font-mono text-xs">
                  <span className="text-intel-ink3">BEST</span>
                  <span className="text-intel-pos">{selected.executiveSummary.bestDecision ?? 'No profitable decision captured.'}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-intel-neg/30 bg-intel-neg/5 px-2.5 py-1 font-mono text-xs">
                  <span className="text-intel-ink3">WORST</span>
                  <span className="text-intel-neg">{selected.executiveSummary.worstDecision ?? 'No losing decision captured.'}</span>
                </span>
                <EnvBadge environment={selected.environment} />
              </div>
            </HeroBand>

            {/* KEY METRICS */}
            <MetricStrip cols={6}>
              <Metric label="Net P/L" value={fmtSignedUsd(selected.performance.netPnl)} tone={pnlTone(selected.performance.netPnl)} emphasis />
              <Metric label="Win Rate" value={fmtWholePct((selected.tradingSummary.wins / Math.max(1, selected.tradingSummary.tradesClosed)) * 100)} />
              <Metric label="Profit Factor" value={fmtDecimal(selected.performance.profitFactor)} />
              <Metric label="Expectancy" value={fmtUsd(selected.performance.expectancy)} tone={pnlTone(selected.performance.expectancy)} />
              <Metric label="Trades" value={fmtNum(selected.tradingSummary.tradesClosed)} />
              <Metric label="Avg Hold" value={fmtHoldTime(selected.performance.averageHoldTimeMinutes)} />
            </MetricStrip>

            {/* INSIGHTS */}
            <Panel title="Executive Summary" icon={<Newspaper className="h-4 w-4" />}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-label text-intel-ink3">Highlights</p>
                  {selected.executiveSummary.highlights.length ? (
                    <ul className="space-y-1.5 text-sm text-intel-ink2">
                      {selected.executiveSummary.highlights.map(h => <li key={h}>{h}</li>)}
                    </ul>
                  ) : <p className="text-sm text-intel-ink2">No highlights were derived from captured evidence.</p>}
                </div>
                <div>
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-label text-intel-ink3">Key findings</p>
                  {selected.executiveSummary.keyFindings.length ? (
                    <ul className="space-y-1.5 text-sm text-intel-ink2">
                      {selected.executiveSummary.keyFindings.map(k => <li key={k}>{k}</li>)}
                    </ul>
                  ) : <p className="text-sm text-intel-ink2">No findings were derived from captured evidence.</p>}
                </div>
              </div>
            </Panel>

            {/* EVIDENCE / DETAIL (collapsed) */}
            <Panel title="Trading & Performance" icon={<TrendingUp className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={`${selected.tradingSummary.tradesClosed} trades · ${fmtSignedUsd(selected.performance.netPnl)}`}>
              <MetricStrip cols={4}>
                <Metric label="Watchlist" value={fmtNum(selected.tradingSummary.watchlistSize)} />
                <Metric label="Evaluated" value={fmtNum(selected.tradingSummary.symbolsEvaluated)} />
                <Metric label="Signals" value={fmtNum(selected.tradingSummary.signalsGenerated)} />
                <Metric label="Approved" value={fmtNum(selected.tradingSummary.signalsApproved)} />
                <Metric label="Risk Rejects" value={fmtNum(selected.tradingSummary.riskRejects)} />
                <Metric label="Data Rejects" value={fmtNum(selected.tradingSummary.dataRejects)} />
                <Metric label="Realized" value={fmtSignedUsd(selected.performance.realizedPnl)} tone={pnlTone(selected.performance.realizedPnl)} />
                <Metric label="Avg Winner" value={fmtUsd(selected.performance.averageWinner)} />
              </MetricStrip>
            </Panel>

            <Panel title="Capital & Execution" icon={<BriefcaseBusiness className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={`Fill rate ${fmtWholePct((selected.execution.fillRate ?? 0) * 100)}`}>
              <MetricStrip cols={4}>
                <Metric label="Equity" value={fmtUsd(selected.capital.equity)} />
                <Metric label="Cash" value={fmtUsd(selected.capital.cash)} />
                <Metric label="Buying Power" value={fmtUsd(selected.capital.buyingPower)} />
                <Metric label="Drawdown" value={fmtUsd(selected.capital.drawdown)} />
                <Metric label="Orders" value={fmtNum(selected.execution.ordersSubmitted)} />
                <Metric label="Fills" value={fmtNum(selected.execution.fills)} />
                <Metric label="Cancelled" value={fmtNum(selected.execution.cancelled)} />
                <Metric label="Rejected" value={fmtNum(selected.execution.rejected)} />
              </MetricStrip>
            </Panel>

            <Panel title="Market Context" icon={<Gauge className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={selected.market.marketRegime ?? selected.market.marketStatus ?? 'Not recorded'}>
              <MetricStrip cols={5}>
                <Metric label="Status" value={selected.market.marketStatus ?? 'Not recorded'} />
                <Metric label="Regime" value={selected.market.marketRegime ?? 'Not recorded'} />
                <Metric label="SPY Trend" value={selected.market.spyTrend ?? 'Not recorded'} />
                <Metric label="VIX" value={fmtDecimal(selected.market.vix)} />
                <Metric label="Sector" value={selected.market.sectorLeadership ?? 'Not recorded'} />
              </MetricStrip>
            </Panel>

            <Panel title="Grade Rubric" icon={<ShieldCheck className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={`Overall ${selected.grades.overall.grade}`}>
              <GradeRubric grades={selected.grades} />
            </Panel>

            <Panel title="Linked Trades" icon={<ClipboardList className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={`${selected.tradeReports.length} trades`}>
              {selected.tradeReports.length ? (
                <ul className="flex flex-col gap-2">
                  {selected.tradeReports.map(t => (
                    <li key={t.reportId} className="flex items-center justify-between gap-3 rounded-lg border border-intel-line bg-intel-panel2 px-3 py-2">
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-sm text-intel-ink">{t.underlying}</span>
                        <Badge tone={t.direction === 'BULLISH' ? 'pos' : 'neg'}>{t.direction}</Badge>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className={`font-mono text-sm tabular-nums ${pnlTone(t.realizedPnl) === 'pos' ? 'text-intel-pos' : pnlTone(t.realizedPnl) === 'neg' ? 'text-intel-neg' : 'text-intel-ink2'}`}>{fmtSignedUsd(t.realizedPnl)}</span>
                        <GradeBadge grade={t.overallGrade} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-intel-ink2">No trade reports were linked to this daily report.</p>}
            </Panel>

            <Panel title="Evidence Quality" icon={<DatabaseZap className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={fmtWholePct(selected.evidenceQuality.availableEvidencePercent)}>
              <EvidenceBanner percent={selected.evidenceQuality.availableEvidencePercent} missingCount={selected.evidenceQuality.missingEvidence.length} />
              {selected.evidenceQuality.missingEvidence.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {selected.evidenceQuality.missingEvidence.slice(0, 10).map(m => (
                    <li key={m} className="font-mono text-xs text-intel-warn">{m}</li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Timeline" icon={<BarChart3 className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={`${selected.timeline.length} events`}>
              <GroupedTimeline events={selected.timeline as TimelineEvent[]} />
            </Panel>

            {selected.warnings.length > 0 && (
              <Panel title="Warnings" icon={<ShieldCheck className="h-4 w-4" />} collapsible defaultOpen={false}
                summary={`${selected.warnings.length}`}>
                <EventList
                  items={selected.warnings.map<EventItem>(w => ({ code: w.code, message: w.message, severity: 'warning' }))}
                  emptyNoun="warnings"
                />
              </Panel>
            )}
          </article>
        </div>
      ) : null}
    </div>
  );
}
