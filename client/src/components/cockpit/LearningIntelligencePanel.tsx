import { useEffect, useMemo, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { learningApi } from '../../api';
import type {
  LearningCalibrationBucket,
  LearningEvent,
  LearningRegime,
  LearningScorecard,
  LearningStatus,
  LearningTradeReview,
} from '../../api/learning';
import { Panel, Pill, Stat, statusTone } from './cockpitUi';

type Snapshot = {
  status: LearningStatus | null;
  reviews: LearningTradeReview[];
  scorecards: LearningScorecard[];
  calibration: LearningCalibrationBucket[];
  regimes: LearningRegime[];
  events: LearningEvent[];
};

const EMPTY: Snapshot = {
  status: null,
  reviews: [],
  scorecards: [],
  calibration: [],
  regimes: [],
  events: [],
};

function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${(value * 100).toFixed(0)}%`;
}

function ret(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function bestByReturn<T extends { averageReturn: number | null; totalTrades?: number }>(items: T[]): T | null {
  return items
    .filter(item => (item.totalTrades ?? 0) > 0 && item.averageReturn != null)
    .sort((a, b) => (b.averageReturn ?? -Infinity) - (a.averageReturn ?? -Infinity))[0] ?? null;
}

function worstByReturn<T extends { averageReturn: number | null; totalTrades?: number }>(items: T[]): T | null {
  return items
    .filter(item => (item.totalTrades ?? 0) > 0 && item.averageReturn != null)
    .sort((a, b) => (a.averageReturn ?? Infinity) - (b.averageReturn ?? Infinity))[0] ?? null;
}

export function LearningIntelligencePanel() {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [status, reviews, scorecards, calibration, regimes, events] = await Promise.all([
          learningApi.getStatus(),
          learningApi.getTrades(8),
          learningApi.getScorecards(),
          learningApi.getCalibration(),
          learningApi.getRegimes(),
          learningApi.getEvents(),
        ]);
        if (!cancelled) {
          setSnapshot({ status, reviews, scorecards, calibration, regimes, events });
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.response?.data?.error ?? err?.message ?? 'Learning intelligence unavailable.');
      }
    }
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const lifetimeScorecards = useMemo(
    () => snapshot.scorecards.filter(scorecard => scorecard.window === 'LIFETIME'),
    [snapshot.scorecards]
  );
  const bestStrategy = bestByReturn(lifetimeScorecards);
  const worstStrategy = worstByReturn(lifetimeScorecards);
  const topRegime = bestByReturn(snapshot.regimes);
  const confidenceAccuracy = snapshot.calibration
    .filter(bucket => bucket.historicalAccuracy != null)
    .sort((a, b) => b.totalTrades - a.totalTrades)[0] ?? null;
  const latestLesson = snapshot.reviews.find(review => review.whatCouldImprove.length || review.whyFailed.length || review.whySucceeded.length);

  return (
    <Panel
      title="Learning Intelligence"
      badge={<Pill tone={statusTone(snapshot.status?.status)}>{snapshot.status?.status ?? 'Loading'}</Pill>}
      actions={<GraduationCap className="h-4 w-4 text-intel-ink3" aria-hidden="true" />}
    >
      {error ? <p className="mb-3 text-xs text-intel-neg">{error}</p> : null}
      <p className="mb-3 text-sm leading-6 text-intel-ink2">
        {snapshot.status?.explanation ?? 'Learning intelligence is loading completed trade evidence.'}
      </p>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Today's Performance" value={ret(snapshot.reviews[0]?.actualReturn)} />
        <Stat label="Best Strategy" value={bestStrategy?.key ?? '-'} size="sm" />
        <Stat label="Worst Strategy" value={worstStrategy?.key ?? '-'} size="sm" />
        <Stat label="Confidence Accuracy" value={confidenceAccuracy ? pct(confidenceAccuracy.historicalAccuracy) : '-'} />
        <Stat label="Top Regime" value={topRegime?.key ?? '-'} size="sm" />
        <Stat label="Learning Progress" value={`${snapshot.status?.tradeReviews ?? 0}/${snapshot.status?.completedTrades ?? 0}`} />
      </div>
      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
        <div className="rounded-md border border-intel-lineSoft p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-label text-intel-ink3">Recent Lessons</div>
          {latestLesson ? (
            <div className="text-xs text-intel-ink2">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Pill tone={latestLesson.outcome === 'LOSS' ? 'bad' : 'good'}>{latestLesson.outcome}</Pill>
                <span className="font-semibold text-intel-ink">{latestLesson.symbol ?? 'Unknown'}</span>
                <span>{latestLesson.winningStrategy ?? latestLesson.entryStrategy ?? 'No strategy recorded'}</span>
              </div>
              <p>{latestLesson.whatCouldImprove[0] ?? latestLesson.whyFailed[0] ?? latestLesson.whySucceeded[0]}</p>
            </div>
          ) : (
            <p className="text-xs text-intel-ink3">No completed trade lessons have been captured yet.</p>
          )}
        </div>
        <div className="rounded-md border border-intel-lineSoft p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-label text-intel-ink3">Top Event Edge</div>
          {snapshot.events.slice(0, 3).map(event => (
            <div key={event.event} className="flex items-center justify-between gap-3 border-t border-intel-lineSoft py-1.5 text-xs first:border-t-0">
              <span className="text-intel-ink">{event.event}</span>
              <span className="font-mono text-intel-ink2">{pct(event.winRate)} - {ret(event.averageReturn)}</span>
            </div>
          ))}
          {!snapshot.events.length ? <p className="text-xs text-intel-ink3">No event analytics available.</p> : null}
        </div>
      </div>
      <details className="mt-4 rounded-md bg-intel-panel2 p-3">
        <summary className="cursor-pointer font-mono text-[10px] font-semibold uppercase tracking-label text-intel-ink3">
          Strategy Scorecards, Trade Reviews, and Calibration
        </summary>
        <div className="mt-3 grid gap-3 xl:grid-cols-3">
          <DetailTable
            title="Strategy Scorecards"
            rows={lifetimeScorecards.slice(0, 6).map(card => [card.key, `${card.totalTrades} trades`, `${pct(card.winRate)} win`, ret(card.averageReturn)])}
          />
          <DetailTable
            title="Trade Reviews"
            rows={snapshot.reviews.slice(0, 6).map(review => [review.symbol ?? '-', review.outcome, review.winningStrategy ?? '-', ret(review.actualReturn)])}
          />
          <DetailTable
            title="Calibration"
            rows={snapshot.calibration.map(bucket => [bucket.confidenceBand, `${bucket.totalTrades} trades`, pct(bucket.actualSuccessRate), bucket.verdict])}
          />
        </div>
      </details>
    </Panel>
  );
}

function DetailTable({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <div className="min-w-0 rounded-md border border-intel-lineSoft p-3">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-label text-intel-ink3">{title}</div>
      <div className="space-y-1.5">
        {rows.map((row, index) => (
          <div key={`${title}-${index}`} className="grid grid-cols-4 gap-2 text-xs">
            {row.map((cell, cellIndex) => (
              <span key={`${cell}-${cellIndex}`} className={cellIndex === 0 ? 'truncate text-intel-ink' : 'truncate text-intel-ink2'} title={cell}>
                {cell}
              </span>
            ))}
          </div>
        ))}
        {!rows.length ? <p className="text-xs text-intel-ink3">No records yet.</p> : null}
      </div>
    </div>
  );
}
