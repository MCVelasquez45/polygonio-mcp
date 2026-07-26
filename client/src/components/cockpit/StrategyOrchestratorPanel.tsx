import { useEffect, useState } from 'react';
import { Network } from 'lucide-react';
import { getLatestStrategyRecommendation, type StrategyOrchestratorRun } from '../../api/strategyOrchestrator';
import { fmtPercent } from '../../lib/marketFormat';
import { Panel, Pill, Stat } from './cockpitUi';

function toneForAction(action: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (action === 'BUY' || action === 'WATCH') return 'good';
  if (action === 'WAIT') return 'warn';
  if (action === 'NO_TRADE' || action === 'SKIP') return 'bad';
  return 'neutral';
}

export function StrategyOrchestratorPanel() {
  const [run, setRun] = useState<StrategyOrchestratorRun | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    getLatestStrategyRecommendation()
      .then(result => {
        if (!active) return;
        setRun(result);
        setStatus(result ? 'ready' : 'empty');
      })
      .catch(() => {
        if (!active) return;
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, []);

  const top = run?.rankings.filter(ranking => !ranking.rejected).slice(0, 5) ?? [];
  return (
    <Panel title="Strategy orchestrator" badge={<Network className="h-4 w-4 text-intel-ink3" aria-hidden="true" />}>
      {status === 'loading' ? <p className="text-xs text-intel-ink3">Loading strategy recommendation.</p> : null}
      {status === 'error' ? <p className="text-xs text-intel-ink3">Strategy orchestrator unavailable.</p> : null}
      {status === 'empty' ? <p className="text-xs text-intel-ink3">No strategy recommendation has been journaled yet.</p> : null}
      {status === 'ready' && run ? (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Recommendation" value={<Pill tone={toneForAction(run.recommendation.action)}>{run.recommendation.action}</Pill>} />
            <Stat label="Winner" value={run.winner?.name ?? 'None'} size="sm" />
            <Stat label="Evidence" value={run.evidence.score.toFixed(1)} />
            <Stat label="Confidence" value={fmtPercent(run.recommendation.confidence * 100)} />
            <Stat label="Regime" value={run.marketContext.regime.current} size="sm" />
          </div>
          <p className="border-t border-intel-line pt-3 text-xs text-intel-ink3">{run.recommendation.explanation}</p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="overflow-x-auto">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-intel-ink3">Active strategies</div>
              <table className="min-w-[460px] w-full text-sm">
                <tbody>
                  {top.map(strategy => (
                    <tr key={strategy.strategyId} className="border-t border-intel-lineSoft">
                      <td className="py-1 text-intel-ink">{strategy.name}</td>
                      <td className="py-1 text-right tabular-nums text-intel-ink2">{strategy.score.toFixed(1)}</td>
                      <td className="py-1 text-right tabular-nums text-intel-ink2">{fmtPercent(strategy.confidence * 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="min-w-0">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-intel-ink3">Conflicts and portfolio impact</div>
              <p className="text-xs text-intel-ink3">{run.conflicts.explanation}</p>
              <p className="mt-2 text-xs text-intel-ink3">{run.portfolioContext.adjustmentExplanation}</p>
              <Pill tone={run.recommendation.riskHandoff.allowedForRiskReview ? 'warn' : 'neutral'}>
                Risk handoff only
              </Pill>
            </div>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
