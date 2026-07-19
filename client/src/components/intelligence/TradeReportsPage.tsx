import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BadgeCheck,
  BarChart3,
  Clock,
  DatabaseZap,
  FileSearch,
  Gauge,
  ListTree,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { listTradeReports, type GradeBreakdown, type TradeReport } from '../../api/intelligence';
import {
  AlertBanner,
  Badge,
  EmptyState,
  EnvBadge,
  EventList,
  GradeBadge,
  GroupedTimeline,
  HeroBand,
  InsightList,
  Metric,
  MetricStrip,
  PageHeader,
  Panel,
  RecordList,
  RefreshButton,
  SectionHeader,
  StatusBadge,
  type EventItem,
  type TimelineEvent,
} from './ui';
import {
  fmtDateTime,
  fmtDecimal,
  fmtHoldTime,
  fmtNum,
  fmtPct,
  fmtSignedUsd,
  fmtUsd,
  gradeTier,
  pnlTone,
  type Tone,
} from '../../lib/intelligenceFormat';

type Props = {
  initialReports?: TradeReport[];
  loadOnMount?: boolean;
};

function gradeTone(grade: string): Tone {
  const tier = gradeTier(grade);
  return tier === 'a' ? 'pos' : tier === 'bc' ? 'warn' : tier === 'f' ? 'neg' : 'neutral';
}

const GRADE_LABELS: Array<{ key: keyof TradeReport['grades']; label: string }> = [
  { key: 'overall', label: 'Overall' },
  { key: 'entry', label: 'Entry' },
  { key: 'exit', label: 'Exit' },
  { key: 'risk', label: 'Risk' },
  { key: 'execution', label: 'Execution' },
  { key: 'market', label: 'Market' },
];

function GradeRubric({ grades }: { grades: TradeReport['grades'] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {GRADE_LABELS.map(({ key, label }) => {
        const g: GradeBreakdown = grades[key];
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
                {g.reasons.map(r => <li key={r}>{r}</li>)}
              </ul>
            )}
            {g.unavailableInputs.length > 0 && (
              <p className="mt-2 font-mono text-[11px] text-intel-warn">
                Missing: {g.unavailableInputs.join(', ')}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function recordValue(record: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function TradeReportsPage({ initialReports = [], loadOnMount = true }: Props) {
  const [reports, setReports] = useState<TradeReport[]>(initialReports);
  const [selectedId, setSelectedId] = useState<string | null>(initialReports[0]?.reportId ?? null);
  const [loading, setLoading] = useState(loadOnMount && initialReports.length === 0);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await listTradeReports(50);
      setReports(next);
      setSelectedId(current => current ?? next[0]?.reportId ?? null);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message ?? 'Trade reports unavailable.');
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
    () => reports.find(report => report.reportId === selectedId) ?? reports[0] ?? null,
    [reports, selectedId]
  );

  const hero = useMemo(() => {
    if (!selected) return null;
    const grade = selected.grades.overall.grade;
    const dir = selected.identity.direction === 'BULLISH' ? 'bullish' : 'bearish';
    const headline = `${grade === 'UNAVAILABLE' ? 'Ungraded' : `${grade}-grade`} ${dir} ${selected.identity.underlying} trade`;
    const primaryLesson =
      selected.lessons.improvementSuggestions[0] ??
      selected.lessons.strengths[0] ??
      'No primary lesson was derived from captured evidence.';
    const takeaways = selected.lessons.strengths.slice(0, 3);
    return { grade, headline, primaryLesson, takeaways };
  }, [selected]);

  return (
    <div className="flex flex-col gap-4 pb-24" data-testid="trade-reports-page">
      <PageHeader
        title="Trade Reports"
        description="Permanent post-trade reports generated from persisted automation evidence."
        actions={<RefreshButton onClick={refresh} busy={loading} />}
      />

      {error && <AlertBanner tone="error">{error}</AlertBanner>}

      {loading && reports.length === 0 ? (
        <EmptyState icon={<Activity className="h-6 w-6" />} title="Loading trade reports" hint="Fetching generated intelligence." />
      ) : reports.length === 0 ? (
        <EmptyState icon={<FileSearch className="h-6 w-6" />} title="No trade intelligence reports have been generated yet." hint="A report appears here once a position closes and finalizes." />
      ) : selected && hero ? (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <aside>
            <SectionHeader icon={<FileSearch className="h-4 w-4" />} title="Report List" />
            <RecordList
              items={reports}
              getKey={r => r.reportId}
              selectedKey={selected.reportId}
              onSelect={setSelectedId}
              label="Trade reports"
              renderItem={r => (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-intel-ink">{r.identity.underlying}</span>
                      <Badge tone={r.identity.direction === 'BULLISH' ? 'pos' : 'neg'}>{r.identity.direction}</Badge>
                    </span>
                    <GradeBadge grade={r.grades.overall.grade} />
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className={`font-mono text-xs tabular-nums ${pnlTone(r.performance.realizedPnl) === 'pos' ? 'text-intel-pos' : pnlTone(r.performance.realizedPnl) === 'neg' ? 'text-intel-neg' : 'text-intel-ink2'}`}>
                      {fmtSignedUsd(r.performance.realizedPnl)}
                    </span>
                    <span className="font-mono text-[11px] text-intel-ink3">{r.tradingDate}</span>
                  </div>
                </div>
              )}
            />
          </aside>

          <article className="flex flex-col gap-4">
            {/* HERO */}
            <HeroBand
              badge={{ value: hero.grade, label: 'Overall Grade', tone: gradeTone(hero.grade) }}
              headline={hero.headline}
              sub={selected.identity.optionSymbol}
              facts={[
                { k: 'P/L', v: fmtSignedUsd(selected.performance.realizedPnl), tone: pnlTone(selected.performance.realizedPnl) },
                { k: 'STRATEGY', v: selected.identity.strategy ?? selected.identity.contractType ?? 'Not recorded' },
                { k: 'HOLD', v: fmtHoldTime(selected.lifecycle.holdTimeMinutes) },
                { k: 'RETURN', v: fmtPct(selected.performance.returnPct, 1) },
              ]}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-label text-intel-ink3">Primary lesson</p>
                  <p className="mt-1 text-sm text-intel-ink">{hero.primaryLesson}</p>
                </div>
                <div className="sm:border-l sm:border-intel-lineSoft sm:pl-3">
                  <p className="font-mono text-[10px] uppercase tracking-label text-intel-accent">Key takeaways</p>
                  {hero.takeaways.length ? (
                    <ul className="mt-1 space-y-1 text-sm text-intel-ink">
                      {hero.takeaways.map(t => <li key={t}>{t}</li>)}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-intel-ink2">No strengths were derived from captured evidence.</p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-intel-lineSoft pt-3">
                <StatusBadge status={selected.status} />
                <EnvBadge environment={selected.environment} />
                <Badge tone="neutral">EXIT {selected.lifecycle.exitReason ?? 'Not recorded'}</Badge>
              </div>
            </HeroBand>

            {/* KEY METRICS */}
            <MetricStrip cols={6}>
              <Metric label="Realized P/L" value={fmtSignedUsd(selected.performance.realizedPnl)} tone={pnlTone(selected.performance.realizedPnl)} emphasis />
              <Metric label="Return" value={fmtPct(selected.performance.returnPct, 1)} tone={pnlTone(selected.performance.returnPct)} />
              <Metric label="Entry" value={fmtUsd(selected.performance.entryPrice)} />
              <Metric label="Exit" value={fmtUsd(selected.performance.exitPrice)} />
              <Metric label="Hold" value={fmtHoldTime(selected.lifecycle.holdTimeMinutes)} />
              <Metric label="Contracts" value={fmtNum(selected.performance.contracts)} />
            </MetricStrip>

            {/* OVERVIEW */}
            <Panel title="Overview" icon={<BadgeCheck className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={selected.tradingDate}>
              <MetricStrip cols={4}>
                <Metric label="Trading Date" value={selected.tradingDate} />
                <Metric label="Direction" value={selected.identity.direction} />
                <Metric label="Contract Type" value={selected.identity.contractType ?? 'Not recorded'} />
                <Metric label="Strike" value={fmtUsd(selected.identity.contractStrike)} />
                <Metric label="Expiration" value={selected.identity.contractExpiration ?? 'Not recorded'} />
                <Metric label="Opened" value={fmtDateTime(selected.lifecycle.openedAt)} />
                <Metric label="Closed" value={fmtDateTime(selected.lifecycle.closedAt)} />
                <Metric label="Exit Reason" value={selected.lifecycle.exitReason ?? 'Not recorded'} />
              </MetricStrip>
            </Panel>

            {/* EXECUTION */}
            <Panel title="Execution" icon={<Clock className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={selected.execution.fillQuality}>
              <MetricStrip cols={4}>
                <Metric label="Fill Quality" value={selected.execution.fillQuality} />
                <Metric label="Fills" value={fmtNum(selected.execution.fillCount)} />
                <Metric label="Partials" value={fmtNum(selected.execution.partialFillCount)} />
                <Metric label="Retries" value={fmtNum(selected.execution.retryCount)} />
                <Metric label="Cancellations" value={fmtNum(selected.execution.cancellationCount)} />
                <Metric label="Rejections" value={fmtNum(selected.execution.rejectionCount)} />
                <Metric label="Entry Slippage" value={fmtUsd(selected.execution.entrySlippage)} />
                <Metric label="Exit Slippage" value={fmtUsd(selected.execution.exitSlippage)} />
              </MetricStrip>
            </Panel>

            {/* RISK & PERFORMANCE */}
            <Panel title="Risk & Performance" icon={<ShieldCheck className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={`Risk ${selected.grades.risk.grade}`}>
              <MetricStrip cols={4}>
                <Metric label="Risk Approved" value={selected.signal.riskApproved === true ? 'Yes' : selected.signal.riskApproved === false ? 'No' : 'Not recorded'} />
                <Metric label="Risk Score" value={fmtPct(selected.signal.riskScore, 1)} />
                <Metric label="Confidence" value={fmtPct(selected.signal.confidence, 1)} />
                <Metric label="Candidate Rank" value={fmtNum(selected.signal.candidateRank)} />
                <Metric label="MFE" value={fmtSignedUsd(selected.performance.maxFavorableExcursion)} tone={pnlTone(selected.performance.maxFavorableExcursion)} />
                <Metric label="MAE" value={fmtSignedUsd(selected.performance.maxAdverseExcursion)} tone={pnlTone(selected.performance.maxAdverseExcursion)} />
                <Metric label="Drawdown" value={fmtSignedUsd(selected.performance.drawdown)} tone={pnlTone(selected.performance.drawdown)} />
                <Metric label="Fees" value={fmtUsd(selected.performance.fees)} />
              </MetricStrip>
            </Panel>

            {/* MARKET */}
            <Panel title="Market" icon={<Gauge className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={selected.marketContext.marketRegime ?? selected.marketContext.marketStatus ?? 'Not recorded'}>
              <MetricStrip cols={4}>
                <Metric label="Market Status" value={selected.marketContext.marketStatus ?? 'Not recorded'} />
                <Metric label="Regime" value={selected.marketContext.marketRegime ?? 'Not recorded'} />
                <Metric label="Trend" value={selected.marketContext.trend ?? 'Not recorded'} />
                <Metric label="Underlying @ Selection" value={fmtUsd(selected.marketContext.underlyingPriceAtSelection)} />
                <Metric label="Spread" value={fmtUsd(recordValue(selected.marketContext.liquidity, 'spreadDollars'))} />
                <Metric label="Spread %" value={fmtPct(recordValue(selected.marketContext.liquidity, 'spreadPct'), 2)} />
                <Metric label="Volume" value={fmtNum(recordValue(selected.marketContext.liquidity, 'volume'))} />
                <Metric label="Open Interest" value={fmtNum(recordValue(selected.marketContext.liquidity, 'openInterest'))} />
              </MetricStrip>
              {!selected.marketContext.spyContext && !selected.marketContext.sectorContext && !selected.marketContext.vixContext && (
                <p className="mt-3 text-sm text-intel-warn">SPY, sector, and VIX context were not captured for this trade.</p>
              )}
            </Panel>

            {/* GREEKS */}
            <Panel title="Greeks" icon={<ListTree className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={`Delta ${fmtDecimal(selected.greeks.delta, 3)}`}>
              <MetricStrip cols={5}>
                <Metric label="Delta" value={fmtDecimal(selected.greeks.delta, 3)} />
                <Metric label="Theta" value={fmtDecimal(selected.greeks.theta, 3)} />
                <Metric label="Gamma" value={fmtDecimal(selected.greeks.gamma, 3)} />
                <Metric label="Vega" value={fmtDecimal(selected.greeks.vega, 3)} />
                <Metric label="IV" value={fmtPct(selected.greeks.iv, 1)} />
              </MetricStrip>
            </Panel>

            {/* GRADE RUBRIC */}
            <Panel title="Grade Rubric" icon={<BadgeCheck className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={`Overall ${selected.grades.overall.grade}`}>
              <GradeRubric grades={selected.grades} />
            </Panel>

            {/* TIMELINE */}
            <Panel title="Timeline" icon={<BarChart3 className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={`${selected.timeline.length} events`}>
              <GroupedTimeline events={selected.timeline as TimelineEvent[]} />
            </Panel>

            {/* EVIDENCE */}
            <Panel title="Evidence" icon={<DatabaseZap className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={`${selected.evidence.eventIds.length} events`}>
              <MetricStrip cols={3}>
                <Metric label="Position" value={selected.evidence.positionId} />
                <Metric label="Session" value={selected.evidence.tradingSessionId} />
                <Metric label="Broker Orders" value={fmtNum(selected.evidence.brokerOrderIds.length)} />
                <Metric label="Order Intents" value={fmtNum(selected.evidence.orderIntentIds.length)} />
                <Metric label="Universe Evals" value={fmtNum(selected.evidence.universeEvaluationIds.length)} />
                <Metric label="Events" value={fmtNum(selected.evidence.eventIds.length)} />
              </MetricStrip>
            </Panel>

            {/* LESSONS */}
            <Panel title="Lessons" icon={<TrendingUp className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={`${selected.lessons.strengths.length + selected.lessons.weaknesses.length + selected.lessons.improvementSuggestions.length} insights`}>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-label text-intel-ink3">Strengths</p>
                  <InsightList items={selected.lessons.strengths} kind="strength" emptyNoun="strengths" />
                </div>
                <div>
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-label text-intel-ink3">Weaknesses</p>
                  <InsightList items={selected.lessons.weaknesses} kind="weakness" emptyNoun="weaknesses" />
                </div>
                <div>
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-label text-intel-ink3">Suggestions</p>
                  <InsightList items={selected.lessons.improvementSuggestions} kind="suggestion" emptyNoun="suggestions" />
                </div>
              </div>
            </Panel>

            {/* WARNINGS */}
            <Panel title="Warnings" icon={<ShieldCheck className="h-4 w-4" />} collapsible defaultOpen={false}
              summary={`${selected.warnings.length}`}>
              <EventList
                items={selected.warnings.map<EventItem>(w => ({ code: w.code, message: w.message, meta: w.source ?? null, severity: 'warning' }))}
                emptyNoun="warnings"
              />
            </Panel>
          </article>
        </div>
      ) : null}
    </div>
  );
}
