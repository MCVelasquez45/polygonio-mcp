import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Binary,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  DatabaseZap,
  FileSearch,
  Gauge,
  ListChecks,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { listDecisionJournalEntries, type DecisionJournalEntry, type DecisionType } from '../../api/intelligence';
import {
  AlertBanner,
  Badge,
  EmptyState,
  EnvBadge,
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
  type TimelineEvent,
} from './ui';
import {
  fmtDateTime,
  fmtDecimal,
  fmtNum,
  fmtPct,
  fmtUsd,
  type Tone,
} from '../../lib/intelligenceFormat';
import { DECISION_BUCKETS, decisionDistribution } from '../../lib/intelligenceInsights';

type Props = {
  initialEntries?: DecisionJournalEntry[];
  loadOnMount?: boolean;
};

// List is paginated so 500+ captured decisions stay performant — we render one
// page at a time (never a flat dump) with a visible "showing X of Y" affordance.
const PAGE_SIZE = 25;

/** Outcome label + tone derived from the decision's persisted boolean flags. */
function outcome(entry: DecisionJournalEntry): { label: string; tone: Tone } {
  if (entry.decision.approved) return { label: 'Approved', tone: 'pos' };
  if (entry.decision.rejected) return { label: 'Rejected', tone: 'neg' };
  if (entry.decision.skipped) return { label: 'Skipped', tone: 'warn' };
  return { label: 'Recorded', tone: 'neutral' };
}

function display(value: string | null | undefined): string {
  return value && value.trim() ? value : 'Unavailable';
}

type Availability = 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_APPLICABLE' | 'NOT_RECORDED';

function availabilityCopy(status?: Availability | null): string {
  switch (status) {
    case 'NOT_APPLICABLE':
      return 'Not Applicable';
    case 'NOT_RECORDED':
      return 'Not Recorded';
    case 'UNAVAILABLE':
    default:
      return 'Unavailable';
  }
}

function fieldStatus(entry: DecisionJournalEntry, field: string): Availability | null {
  return entry.dataAvailability?.fields?.[field] ?? null;
}

function metricValue(
  entry: DecisionJournalEntry,
  field: string,
  value: number | string | null | undefined,
  formatter: (value: any) => string = String
): string {
  if (value == null || value === '') return availabilityCopy(fieldStatus(entry, field));
  return formatter(value);
}

function refValue(value: string | null | undefined): string {
  return value && value.trim() ? value : 'Pending';
}

function completeness(entry: DecisionJournalEntry): { captured: number; total: number; pct: number } {
  const captured = entry.evidenceQuality.persistedFields.length;
  const missing = entry.evidenceQuality.missingFields.length;
  const total = captured + missing;
  return { captured, total, pct: total > 0 ? Math.round((captured / total) * 100) : 0 };
}

export function DecisionJournalPage({ initialEntries = [], loadOnMount = true }: Props) {
  const [entries, setEntries] = useState<DecisionJournalEntry[]>(initialEntries);
  const [selectedId, setSelectedId] = useState<string | null>(initialEntries[0]?.decisionId ?? null);
  const [loading, setLoading] = useState(loadOnMount && initialEntries.length === 0);
  const [error, setError] = useState<string | null>(null);

  // Filter + pagination state (presentation-only; never touches the backend).
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<DecisionType | 'ALL'>('ALL');
  const [page, setPage] = useState(1);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await listDecisionJournalEntries(100);
      setEntries(next);
      setSelectedId(current => current ?? next[0]?.decisionId ?? null);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message ?? 'Decision Journal unavailable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!loadOnMount || initialEntries.length > 0) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const distribution = useMemo(() => decisionDistribution(entries), [entries]);

  // Which decision types are actually present — drives the type filter buttons.
  const presentTypes = useMemo(() => {
    const set = new Set<DecisionType>();
    for (const e of entries) set.add(e.decisionType);
    return Array.from(set);
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(e => {
      if (typeFilter !== 'ALL' && e.decisionType !== typeFilter) return false;
      if (!q) return true;
      const haystack = [
        e.context.symbol,
        e.context.strategy,
        e.decisionType,
        ...e.decision.reasonCodes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [entries, query, typeFilter]);

  // Reset to first page whenever the filtered set changes shape.
  useEffect(() => {
    setPage(1);
  }, [query, typeFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const visible = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const selected = useMemo(() => {
    const match = entries.find(e => e.decisionId === selectedId);
    if (match) return match;
    return filtered[0] ?? entries[0] ?? null;
  }, [entries, filtered, selectedId]);

  const selectedOutcome = selected ? outcome(selected) : null;
  const selectedCompleteness = selected ? completeness(selected) : null;

  return (
    <div className="flex flex-col gap-4 pb-24" data-testid="decision-journal-page">
      <PageHeader
        title="Decision Journal"
        description="Deterministic records of automation decisions captured from persisted evaluation evidence."
        actions={<RefreshButton onClick={refresh} busy={loading} />}
      />

      {error && <AlertBanner tone="error">{error}</AlertBanner>}

      {loading && entries.length === 0 ? (
        <EmptyState icon={<Activity className="h-6 w-6" />} title="Loading decision journal entries" hint="Fetching captured automation decisions." />
      ) : entries.length === 0 ? (
        <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No decision journal entries have been captured yet." hint="A decision appears here once automation evaluates a candidate." />
      ) : (
        <>
          {/* SUMMARY TILES — one per DECISION_BUCKETS, colored by bucket tone. */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-intel-line bg-intel-line sm:grid-cols-3 xl:grid-cols-6">
            {DECISION_BUCKETS.map(bucket => (
              <div key={bucket.key} className="bg-intel-panel px-3 py-2.5">
                <p className="font-mono text-[9.5px] uppercase tracking-label text-intel-ink3">{bucket.label}</p>
                <p
                  className={`mt-1.5 font-mono text-xl tabular-nums ${
                    bucket.tone === 'pos'
                      ? 'text-intel-pos'
                      : bucket.tone === 'neg'
                        ? 'text-intel-neg'
                        : bucket.tone === 'warn'
                          ? 'text-intel-warn'
                          : 'text-intel-ink'
                  }`}
                >
                  {fmtNum(distribution[bucket.key])}
                </p>
              </div>
            ))}
          </div>

          {/* FILTER BAR — search + decision-type filter (both wired to state). */}
          <div className="flex flex-col gap-3 rounded-panel border border-intel-line bg-intel-panel p-3 sm:p-4">
            <label className="relative flex items-center">
              <Search className="pointer-events-none absolute left-3 h-4 w-4 text-intel-ink3" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search symbol, reason code, or strategy"
                aria-label="Search decisions by symbol, reason code, or strategy"
                className="w-full rounded-lg border border-intel-line bg-intel-bg py-2 pl-9 pr-3 text-sm text-intel-ink placeholder:text-intel-ink3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent"
              />
            </label>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by decision type">
              <button
                type="button"
                onClick={() => setTypeFilter('ALL')}
                aria-pressed={typeFilter === 'ALL'}
                className={`rounded-md border px-2.5 py-1 font-mono text-[11px] uppercase tracking-label transition ${
                  typeFilter === 'ALL'
                    ? 'border-intel-accentLine bg-intel-accentSoft text-intel-accent'
                    : 'border-intel-line bg-intel-panel2 text-intel-ink2 hover:border-intel-ink3'
                }`}
              >
                All ({entries.length})
              </button>
              {presentTypes.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypeFilter(t)}
                  aria-pressed={typeFilter === t}
                  className={`rounded-md border px-2.5 py-1 font-mono text-[11px] uppercase tracking-label transition ${
                    typeFilter === t
                      ? 'border-intel-accentLine bg-intel-accentSoft text-intel-accent'
                      : 'border-intel-line bg-intel-panel2 text-intel-ink2 hover:border-intel-ink3'
                  }`}
                >
                  {t.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
            {/* LEFT — paginated, filtered list. */}
            <aside>
              <SectionHeader
                icon={<ListChecks className="h-4 w-4" />}
                title="Decisions"
                right={
                  <span className="font-mono text-[11px] text-intel-ink3">
                    {filtered.length === 0
                      ? '0 matches'
                      : `${pageStart + 1}–${pageStart + visible.length} of ${filtered.length}`}
                  </span>
                }
              />
              {filtered.length === 0 ? (
                <div className="rounded-panel border border-intel-line bg-intel-panel px-4 py-8 text-sm text-intel-ink2">
                  No decisions match the current filters.
                </div>
              ) : (
                <>
                  <RecordList
                    items={visible}
                    getKey={e => e.decisionId}
                    selectedKey={selected?.decisionId ?? null}
                    onSelect={setSelectedId}
                    label="Captured decisions"
                    max={PAGE_SIZE}
                    renderItem={entry => {
                      const o = outcome(entry);
                      return (
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-mono text-sm font-semibold text-intel-ink">{entry.decisionType.replace(/_/g, ' ')}</span>
                            <Badge tone={o.tone}>{o.label}</Badge>
                          </div>
                          <p className="mt-1 font-mono text-xs text-intel-ink2">
                            {display(entry.context.symbol)} · {display(entry.context.strategy)}
                          </p>
                          <p className="mt-1 font-mono text-[11px] text-intel-ink3">{fmtDateTime(entry.timestamp)}</p>
                          <p className="mt-1 truncate font-mono text-[11px] text-intel-ink3">
                            {entry.decision.reasonCodes[0] ?? 'No reason code captured'}
                          </p>
                        </div>
                      );
                    }}
                  />
                  {pageCount > 1 && (
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={currentPage <= 1}
                        className="rounded-lg border border-intel-line px-3 py-1.5 font-mono text-xs text-intel-ink2 transition hover:border-intel-accentLine hover:text-intel-ink disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent"
                      >
                        Previous
                      </button>
                      <span className="font-mono text-[11px] text-intel-ink3">
                        Page {currentPage} of {pageCount}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                        disabled={currentPage >= pageCount}
                        className="rounded-lg border border-intel-line px-3 py-1.5 font-mono text-xs text-intel-ink2 transition hover:border-intel-accentLine hover:text-intel-ink disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent"
                      >
                        Show more
                      </button>
                    </div>
                  )}
                </>
              )}
            </aside>

            {/* RIGHT — selected decision detail. */}
            {selected && selectedOutcome && (
              <article className="flex flex-col gap-4">
                <HeroBand
                  badge={{ value: selected.context.symbol?.trim() || 'No sym', label: 'Symbol', tone: selectedOutcome.tone }}
                  headline={
                    <span className="flex flex-wrap items-center gap-2">
                      <span>{selected.decisionType.replace(/_/g, ' ')}</span>
                      <Badge tone={selectedOutcome.tone}>{selectedOutcome.label}</Badge>
                    </span>
                  }
                  sub={fmtDateTime(selected.timestamp)}
                  facts={[
                    { k: 'DECISION', v: selected.decision.decision.replace(/_/g, ' ') },
                    { k: 'SOURCE', v: selected.source.type },
                    { k: 'STRATEGY', v: display(selected.context.strategy) },
                  ]}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <EnvBadge environment={selected.context.environment} />
                    <StatusBadge status={selected.source.type} />
                    {selected.context.contract && (
                      <span className="font-mono text-xs text-intel-ink2">{selected.context.contract}</span>
                    )}
                  </div>
                </HeroBand>

                {/* KEY METRICS — confidence, signal scores, risk snapshot. */}
                <MetricStrip cols={6}>
                  <Metric label="Signal" value={metricValue(selected, 'signal', selected.evaluation.signal)} emphasis />
                  <Metric label="Confidence" value={metricValue(selected, 'confidence', selected.evaluation.confidence, v => fmtPct(v, 1))} />
                  <Metric label="Flow" value={metricValue(selected, 'flowScore', selected.evaluation.flowScore, fmtDecimal)} />
                  <Metric label="Momentum" value={metricValue(selected, 'momentumScore', selected.evaluation.momentumScore, fmtDecimal)} />
                  <Metric label="Trend" value={metricValue(selected, 'trendScore', selected.evaluation.trendScore, fmtDecimal)} />
                  <Metric label="Risk Score" value={metricValue(selected, 'riskScore', selected.evaluation.riskScore, fmtDecimal)} />
                </MetricStrip>

                <MetricStrip cols={5}>
                  <Metric label="Position Size" value={metricValue(selected, 'positionSize', selected.riskSnapshot.positionSize, fmtNum)} />
                  <Metric label="Risk %" value={metricValue(selected, 'riskPercent', selected.riskSnapshot.riskPercent, v => fmtPct(v, 2))} />
                  <Metric label="Max Loss" value={metricValue(selected, 'maxLoss', selected.riskSnapshot.maxLoss, fmtUsd)} />
                  <Metric label="Buying Power Used" value={metricValue(selected, 'buyingPowerUsed', selected.riskSnapshot.buyingPowerUsed, fmtUsd)} />
                  <Metric label="Reward / Risk" value={metricValue(selected, 'estimatedRR', selected.riskSnapshot.estimatedRR, fmtDecimal)} />
                </MetricStrip>

                {/* REASONS — collapsed, opens by default so the "why" is visible. */}
                <Panel title="Reason Codes & Reasons" icon={<CheckCircle2 className="h-4 w-4" />}
                  summary={`${selected.decision.reasonCodes.length} code${selected.decision.reasonCodes.length === 1 ? '' : 's'}`}>
                  <div className="mb-4 rounded-panel border border-intel-line bg-intel-panel2 p-3">
                    <p className="font-mono text-[10px] uppercase tracking-label text-intel-ink3">Primary Reason</p>
                    <p className="mt-1 text-sm font-semibold text-intel-ink">{display(selected.reasonSummary?.primaryReason)}</p>
                    {selected.reasonSummary?.humanSummary && (
                      <p className="mt-1 text-sm text-intel-ink2">{selected.reasonSummary.humanSummary}</p>
                    )}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <p className="mb-2 font-mono text-[10px] uppercase tracking-label text-intel-ink3">Supporting Reasons</p>
                      {selected.reasonSummary?.supportingReasons?.length ? (
                        <ul className="space-y-1.5 text-sm text-intel-ink2">
                          {selected.reasonSummary.supportingReasons.map(r => <li key={r}>{r}</li>)}
                        </ul>
                      ) : (
                        <p className="text-sm text-intel-ink2">Unavailable</p>
                      )}
                    </div>
                    <div>
                      <p className="mb-2 font-mono text-[10px] uppercase tracking-label text-intel-ink3">Reason codes</p>
                      {selected.decision.reasonCodes.length ? (
                        <div className="flex flex-wrap gap-2">
                          {selected.decision.reasonCodes.map(code => (
                            <Badge key={code} tone="info">{code}</Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-intel-ink2">No reason codes were captured.</p>
                      )}
                    </div>
                    <div>
                      <p className="mb-2 font-mono text-[10px] uppercase tracking-label text-intel-ink3">Explanation</p>
                      {selected.decision.humanReadableReasons.length ? (
                        <ul className="space-y-1.5 text-sm text-intel-ink2">
                          {selected.decision.humanReadableReasons.map(r => <li key={r}>{r}</li>)}
                        </ul>
                      ) : (
                        <p className="text-sm text-intel-ink2">No explanatory reasons were captured.</p>
                      )}
                    </div>
                  </div>
                </Panel>

                <Panel title="Market & Inputs" icon={<Gauge className="h-4 w-4" />} collapsible defaultOpen={false}
                  summary={display(selected.context.marketRegime ?? selected.evaluation.marketRegime)}>
                  <MetricStrip cols={4}>
                    <Metric label="Regime" value={display(selected.context.marketRegime ?? selected.evaluation.marketRegime)} />
                    <Metric label="Spread" value={metricValue(selected, 'spread', selected.inputs.spread, v => fmtDecimal(v, 4))} />
                    <Metric label="Volume" value={metricValue(selected, 'volume', selected.inputs.volume, fmtNum)} />
                    <Metric label="IV" value={metricValue(selected, 'iv', selected.inputs.iv, v => fmtPct(v, 1))} />
                    <Metric label="Delta" value={metricValue(selected, 'delta', selected.inputs.delta, fmtDecimal)} />
                    <Metric label="Buying Power" value={metricValue(selected, 'buyingPower', selected.inputs.buyingPower, fmtUsd)} />
                    <Metric label="Existing Positions" value={metricValue(selected, 'existingPositions', selected.inputs.existingPositions, fmtNum)} />
                    <Metric label="Watchlist Rank" value={metricValue(selected, 'watchlistRank', selected.inputs.watchlistRank, fmtNum)} />
                  </MetricStrip>
                  {!selected.inputs.marketClock && (
                    <p className="mt-3 text-sm text-intel-ink2">Market clock evidence is {availabilityCopy(fieldStatus(selected, 'marketClockDecision'))} for this decision.</p>
                  )}
                </Panel>

                <Panel title="Market Snapshot" icon={<Gauge className="h-4 w-4" />} collapsible defaultOpen={false}
                  summary={display(selected.marketSnapshot?.underlying ?? selected.context.symbol)}>
                  <MetricStrip cols={4}>
                    <Metric label="Underlying" value={display(selected.marketSnapshot?.underlying ?? selected.context.symbol)} />
                    <Metric label="Underlying Price" value={metricValue(selected, 'marketSnapshot', selected.marketSnapshot?.underlyingPrice, fmtUsd)} />
                    <Metric label="Bid" value={metricValue(selected, 'marketSnapshot', selected.marketSnapshot?.bid, fmtUsd)} />
                    <Metric label="Ask" value={metricValue(selected, 'marketSnapshot', selected.marketSnapshot?.ask, fmtUsd)} />
                    <Metric label="Mark" value={metricValue(selected, 'marketSnapshot', selected.marketSnapshot?.mark, fmtUsd)} />
                    <Metric label="Spread" value={metricValue(selected, 'marketSnapshot', selected.marketSnapshot?.spread, v => fmtDecimal(v, 4))} />
                    <Metric label="Volume" value={metricValue(selected, 'marketSnapshot', selected.marketSnapshot?.volume, fmtNum)} />
                    <Metric label="Open Interest" value={metricValue(selected, 'marketSnapshot', selected.marketSnapshot?.openInterest, fmtNum)} />
                    <Metric label="DTE" value={metricValue(selected, 'marketSnapshot', selected.marketSnapshot?.dte, fmtNum)} />
                    <Metric label="Session" value={display(selected.marketSnapshot?.marketSession)} />
                    <Metric label="Quote Time" value={selected.marketSnapshot?.quoteTimestamp ? fmtDateTime(selected.marketSnapshot.quoteTimestamp) : availabilityCopy(fieldStatus(selected, 'marketSnapshot'))} />
                  </MetricStrip>
                </Panel>

                <Panel title="Contract Snapshot" icon={<Binary className="h-4 w-4" />} collapsible defaultOpen={false}
                  summary={display(selected.contractSnapshot?.contractSymbol ?? selected.context.contract)}>
                  <MetricStrip cols={4}>
                    <Metric label="Contract" value={display(selected.contractSnapshot?.contractSymbol ?? selected.context.contract)} />
                    <Metric label="Type" value={display(selected.contractSnapshot?.type)} />
                    <Metric label="Strike" value={metricValue(selected, 'contractSnapshot', selected.contractSnapshot?.strike, fmtNum)} />
                    <Metric label="Expiration" value={display(selected.contractSnapshot?.expiration)} />
                    <Metric label="Contract Score" value={metricValue(selected, 'contractSnapshot', selected.contractSnapshot?.contractScore, fmtDecimal)} />
                    <Metric label="Liquidity Score" value={metricValue(selected, 'contractSnapshot', selected.contractSnapshot?.liquidityScore, fmtDecimal)} />
                    <Metric label="Spread %" value={metricValue(selected, 'contractSnapshot', selected.contractSnapshot?.spreadPct, v => fmtPct(v, 2))} />
                  </MetricStrip>
                </Panel>

                <Panel title="Risk Checks" icon={<ShieldAlert className="h-4 w-4" />} collapsible defaultOpen={false}
                  summary={selected.riskChecks?.length ? `${selected.riskChecks.length} checks` : 'Not Applicable'}>
                  {selected.riskChecks?.length ? (
                    <div className="grid gap-px overflow-hidden rounded-panel border border-intel-line bg-intel-line">
                      {selected.riskChecks.map(check => (
                        <div key={`${check.name}-${check.detail}`} className="grid gap-2 bg-intel-panel p-3 sm:grid-cols-[1.1fr_0.5fr_1fr_1fr_1.4fr]">
                          <span className="font-mono text-[11px] text-intel-ink">{check.name}</span>
                          <Badge tone={check.passed ? 'pos' : 'neg'}>{check.passed ? 'PASS' : 'FAIL'}</Badge>
                          <span className="text-xs text-intel-ink2">Observed {check.observed ?? 'Unavailable'}</span>
                          <span className="text-xs text-intel-ink2">Limit {check.limit ?? 'Unavailable'}</span>
                          <span className="text-xs text-intel-ink2">{check.reason ?? check.detail ?? 'Unavailable'}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-intel-ink2">Risk checks are {availabilityCopy(fieldStatus(selected, 'riskChecks'))} for this decision.</p>
                  )}
                </Panel>

                <Panel title="AI Context" icon={<Binary className="h-4 w-4" />} collapsible defaultOpen={false}
                  summary={selected.aiContext?.status === 'AI_NOT_USED' ? 'AI Not Used' : display(selected.aiContext?.status)}>
                  <MetricStrip cols={3}>
                    <Metric label="AI Status" value={selected.aiContext?.status === 'AI_NOT_USED' ? 'AI Not Used' : display(selected.aiContext?.status)} />
                    <Metric label="Recommendation" value={display(selected.aiContext?.recommendation)} />
                    <Metric label="Model" value={display(selected.aiContext?.modelUsed)} />
                  </MetricStrip>
                </Panel>

                <Panel title="Execution Reference" icon={<FileSearch className="h-4 w-4" />} collapsible defaultOpen={false}
                  summary={refValue(selected.executionReference.orderIntentId)}>
                  <MetricStrip cols={2}>
                    <Metric label="Order Intent" value={refValue(selected.executionReference.orderIntentId)} />
                    <Metric label="Broker Order" value={refValue(selected.executionReference.brokerOrderId)} />
                    <Metric label="Position" value={refValue(selected.executionReference.positionId)} />
                    <Metric label="Trade Report" value={refValue(selected.reportId)} />
                    <Metric label="Quantity" value={metricValue(selected, 'quantity', selected.riskSnapshot.quantity, fmtNum)} />
                    <Metric label="Limit Price" value={metricValue(selected, 'limitPrice', selected.riskSnapshot.limitPrice, fmtUsd)} />
                    <Metric label="Order Type" value={display(selected.riskSnapshot.orderType)} />
                    <Metric label="TIF" value={display(selected.riskSnapshot.timeInForce)} />
                  </MetricStrip>
                </Panel>

                <Panel title="Data Completeness" icon={<DatabaseZap className="h-4 w-4" />} collapsible defaultOpen={false}
                  summary={selectedCompleteness ? `${selectedCompleteness.captured} / ${selectedCompleteness.total} fields · ${selectedCompleteness.pct}%` : 'Unavailable'}>
                  <MetricStrip cols={2}>
                    <Metric label="Fields Captured" value={selectedCompleteness ? `${selectedCompleteness.captured} / ${selectedCompleteness.total}` : 'Unavailable'} />
                    <Metric label="Completeness" value={selectedCompleteness ? `${selectedCompleteness.pct}%` : 'Unavailable'} tone={selected.evidenceQuality.missingFields.length ? 'warn' : 'pos'} />
                  </MetricStrip>
                  {selected.evidenceQuality.missingFields.length > 0 && (
                    <div className="mt-3">
                      <p className="mb-2 font-mono text-[10px] uppercase tracking-label text-intel-warn">Missing evidence</p>
                      <div className="flex flex-wrap gap-2">
                        {selected.evidenceQuality.missingFields.slice(0, 12).map(f => (
                          <Badge key={f} tone="warn">{f}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {selected.evidenceQuality.warnings.length > 0 && (
                    <div className="mt-3">
                      <p className="mb-2 font-mono text-[10px] uppercase tracking-label text-intel-ink3">Warnings</p>
                      <InsightList
                        items={selected.evidenceQuality.warnings.map(w => `${w.code}: ${w.message}`)}
                        kind="weakness"
                        emptyNoun="warnings"
                      />
                    </div>
                  )}
                </Panel>

                <Panel title="Timeline" icon={<CalendarClock className="h-4 w-4" />} collapsible defaultOpen={false}
                  summary={selected.timeline.length ? `${selected.timeline.length} events` : 'No events captured'}>
                  {selected.timeline.length === 0 ? (
                    <p className="text-sm text-intel-ink2">No journal timeline events were captured.</p>
                  ) : (
                    <GroupedTimeline events={selected.timeline as TimelineEvent[]} />
                  )}
                </Panel>
              </article>
            )}
          </div>
        </>
      )}
    </div>
  );
}
