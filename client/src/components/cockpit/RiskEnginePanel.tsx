import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { getRiskEngineSnapshot, type RiskEngineSnapshot } from '../../api/riskEngine';
import { fmtMoney, fmtPercent } from '../../lib/marketFormat';
import { Panel, Pill, Stat } from './cockpitUi';

function tone(status: string | null): 'good' | 'warn' | 'bad' | 'neutral' {
  if (status === 'APPROVE') return 'good';
  if (status === 'REJECT') return 'bad';
  return 'neutral';
}

export function RiskEnginePanel() {
  const [snapshot, setSnapshot] = useState<RiskEngineSnapshot | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    getRiskEngineSnapshot()
      .then(result => {
        if (!active) return;
        setSnapshot(result);
        setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, []);

  const topSectors = useMemo(() => {
    const exposure = snapshot?.portfolio.exposure.sectorExposure ?? {};
    return Object.entries(exposure)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [snapshot]);

  return (
    <Panel title="Enterprise risk" badge={<ShieldCheck className="h-4 w-4 text-intel-ink3" aria-hidden="true" />}>
      {status === 'loading' ? <p className="text-xs text-intel-ink3">Loading risk engine state.</p> : null}
      {status === 'error' ? <p className="text-xs text-intel-ink3">Risk engine unavailable.</p> : null}
      {status === 'ready' && snapshot ? (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Latest" value={<Pill tone={tone(snapshot.status.latestStatus)}>{snapshot.status.latestStatus ?? 'NONE'}</Pill>} />
            <Stat label="Heat" value={fmtPercent(snapshot.status.portfolioHeat * 100)} />
            <Stat label="Remaining" value={fmtMoney(snapshot.portfolio.riskBudget.remainingRiskBudget)} />
            <Stat label="Open risk" value={fmtMoney(snapshot.portfolio.riskBudget.openRisk)} />
            <Stat label="Queue" value={String(snapshot.queue.pending.length)} />
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="min-w-0">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-intel-ink3">Sector exposure</div>
              <div className="space-y-1">
                {topSectors.length ? topSectors.map(([sector, value]) => (
                  <div key={sector} className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate text-intel-ink2">{sector}</span>
                    <span className="tabular-nums text-intel-ink">{fmtMoney(value)}</span>
                  </div>
                )) : <p className="text-xs text-intel-ink3">No persisted sector exposure.</p>}
              </div>
            </div>
            <div className="min-w-0">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-intel-ink3">Greeks</div>
              <div className="grid grid-cols-2 gap-2 text-xs text-intel-ink2">
                <span>Delta {snapshot.portfolio.greeks.delta ?? 'n/a'}</span>
                <span>Gamma {snapshot.portfolio.greeks.gamma ?? 'n/a'}</span>
                <span>Theta {snapshot.portfolio.greeks.theta ?? 'n/a'}</span>
                <span>Vega {snapshot.portfolio.greeks.vega ?? 'n/a'}</span>
              </div>
            </div>
            <div className="min-w-0">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-intel-ink3">Recent rejections</div>
              <div className="space-y-1">
                {snapshot.history.flatMap(record => record.approval.reasons.slice(0, 1)).slice(0, 3).map(reason => (
                  <Pill key={`${reason.code}:${reason.explanation}`} tone="bad">{reason.code}</Pill>
                ))}
                {!snapshot.history.some(record => record.approval.reasons.length) ? (
                  <p className="text-xs text-intel-ink3">No recent risk rejections.</p>
                ) : null}
              </div>
            </div>
          </div>
          <p className="border-t border-intel-line pt-3 text-xs text-intel-ink3">
            Read only. The risk engine can approve or reject recommendations; execution remains outside this panel.
          </p>
        </div>
      ) : null}
    </Panel>
  );
}
