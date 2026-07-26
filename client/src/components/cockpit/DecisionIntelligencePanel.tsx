import { useEffect, useState } from 'react';
import { BrainCircuit } from 'lucide-react';
import { getLatestDecisionEngineScan, type DecisionEngineCandidate, type DecisionEngineScan } from '../../api/decisionEngine';
import { fmtPercent } from '../../lib/marketFormat';
import { Panel, Pill, Stat } from './cockpitUi';
import { contractLabel } from './occSymbol';
import { greekOrReason, numberOrReason, percentOrReason } from './cockpitDisplay';

function scoreTone(score: number): 'good' | 'warn' | 'bad' | 'neutral' {
  if (score >= 75) return 'good';
  if (score >= 55) return 'warn';
  return 'bad';
}

function OpportunityRow({ candidate, rank }: { candidate: DecisionEngineCandidate; rank: number }) {
  return (
    <tr className="border-t border-intel-lineSoft">
      <td className="py-1 pr-2 text-[11px] text-intel-ink3">{rank}</td>
      <td className="py-1">
        <div className="font-medium text-intel-ink">{candidate.symbol}</div>
        <div className="truncate text-[11px] text-intel-ink3" title={candidate.contract.symbol}>
          {contractLabel(candidate.contract.symbol)}
        </div>
      </td>
      <td className="py-1 text-right tabular-nums text-intel-ink2">{candidate.overallScore.toFixed(1)}</td>
      <td className="py-1 text-right tabular-nums text-intel-ink2">{fmtPercent(candidate.confidence * 100)}</td>
      <td className="py-1 pl-2 text-right"><Pill tone={scoreTone(candidate.overallScore)}>{candidate.recommendation}</Pill></td>
    </tr>
  );
}

function RejectionRow({ rejection }: { rejection: DecisionEngineScan['rejections'][number] }) {
  return (
    <tr className="border-t border-intel-lineSoft">
      <td className="py-1">
        <div className="font-medium text-intel-ink2">{rejection.candidate.symbol}</div>
        <div className="truncate text-[11px] text-intel-ink3" title={rejection.candidate.contract.symbol}>
          {contractLabel(rejection.candidate.contract.symbol)}
        </div>
      </td>
      <td className="py-1 pl-2"><Pill tone="bad">{rejection.reasonCode}</Pill></td>
      <td className="py-1 pl-2 text-[11px] text-intel-ink3">{rejection.explanation}</td>
    </tr>
  );
}

export function DecisionIntelligencePanel() {
  const [scan, setScan] = useState<DecisionEngineScan | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    getLatestDecisionEngineScan()
      .then(result => {
        if (!active) return;
        setScan(result);
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

  const winner = scan?.winner ?? null;
  const top = scan?.ranking.top10 ?? [];
  const rejections = scan?.rejections.slice(0, 8) ?? [];

  return (
    <Panel
      title="Decision intelligence"
      badge={<BrainCircuit className="h-4 w-4 text-intel-ink3" aria-hidden="true" />}
    >
      {status === 'loading' ? <p className="text-xs text-intel-ink3">Loading latest decision scan.</p> : null}
      {status === 'error' ? <p className="text-xs text-intel-ink3">Decision scan unavailable.</p> : null}
      {status === 'empty' ? <p className="text-xs text-intel-ink3">No decision scan has been journaled yet.</p> : null}
      {status === 'ready' && scan ? (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Watchlist" value={scan.watchlist.length} />
            <Stat label="Candidates" value={scan.candidates.length} />
            <Stat label="Accepted" value={top.length} tone={top.length ? 'good' : 'muted'} />
            <Stat label="Rejected" value={scan.rejections.length} tone={scan.rejections.length ? 'bad' : 'muted'} />
          </div>

          {winner ? (
            <div className="border-t border-intel-line pt-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-widest text-intel-ink3">Best opportunity</div>
                  <div className="mt-1 truncate text-base font-semibold text-intel-ink">{contractLabel(winner.contract.symbol)}</div>
                  <p className="mt-1 text-xs text-intel-ink3">{winner.thesis}</p>
                </div>
                <Pill tone={scoreTone(winner.overallScore)}>{winner.recommendation}</Pill>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Stat label="Overall" value={winner.overallScore.toFixed(1)} />
                <Stat label="Confidence" value={fmtPercent(winner.confidence * 100)} />
                <Stat label="Delta" value={greekOrReason(winner.contract.delta, 'Not supplied')} />
                <Stat label="OI" value={numberOrReason(winner.contract.openInterest, 'Not supplied')} />
                <Stat label="Spread" value={percentOrReason(winner.contract.spreadPct, 'Not supplied')} />
              </div>
            </div>
          ) : (
            <p className="border-t border-intel-line pt-3 text-xs text-intel-ink3">{scan.noTradeReason}</p>
          )}

          {top.length ? (
            <div className="overflow-x-auto border-t border-intel-line pt-3">
              <table className="min-w-[620px] w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest text-intel-ink3">
                    <th className="py-1 pr-2 text-left font-normal">Rank</th>
                    <th className="py-1 text-left font-normal">Opportunity</th>
                    <th className="py-1 text-right font-normal">Score</th>
                    <th className="py-1 text-right font-normal">Confidence</th>
                    <th className="py-1 pl-2 text-right font-normal">Recommendation</th>
                  </tr>
                </thead>
                <tbody>{top.slice(0, 5).map((candidate, index) => <OpportunityRow key={candidate.id} candidate={candidate} rank={index + 1} />)}</tbody>
              </table>
            </div>
          ) : null}

          {rejections.length ? (
            <div className="overflow-x-auto border-t border-intel-line pt-3">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-intel-ink3">Rejected opportunities</div>
              <table className="min-w-[760px] w-full text-sm">
                <tbody>{rejections.map(rejection => <RejectionRow key={`${rejection.candidate.id}-${rejection.reasonCode}`} rejection={rejection} />)}</tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
