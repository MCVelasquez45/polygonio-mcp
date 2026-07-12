import { useEffect, useState } from 'react';
import { futuresApi } from '../../api';
import type { FuturesPromotionReport } from '../../types/futures';

type Props = {
  sessionId?: string;
  strategyId?: string;
  symbol?: string;
  canAdmin?: boolean;
  onPromote?: () => void;
};

export function PromotionGatePanel({ sessionId, strategyId, symbol = 'ES', canAdmin = false, onPromote }: Props) {
  const [report, setReport] = useState<FuturesPromotionReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);

  useEffect(() => {
    if (!sessionId || !strategyId) return;
    if (!canAdmin) {
      setReport(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    futuresApi
      .runFuturesPromotionCheck(sessionId, strategyId)
      .then(payload => {
        if (!cancelled) {
          setReport(payload);
          setError(null);
        }
      })
      .catch(err => {
        if (!cancelled) setError(err?.message ?? 'Failed to calculate promotion checks');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canAdmin, sessionId, strategyId]);

  const handlePromote = async () => {
    if (!sessionId || !strategyId || !report || report.status !== 'eligible') return;
    if (!canAdmin) {
      setError('Promotion requires admin access.');
      return;
    }
    setDeploying(true);
    try {
      await futuresApi.deployFuturesSession({ sessionId, strategyId, symbol });
      setError(null);
      onPromote?.();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to deploy session');
    } finally {
      setDeploying(false);
    }
  };

  const handleRecheck = async () => {
    if (!sessionId || !strategyId) return;
    if (!canAdmin) {
      setError('Promotion checks require admin access.');
      return;
    }
    setLoading(true);
    try {
      const nextReport = await futuresApi.runFuturesPromotionCheck(sessionId, strategyId);
      setReport(nextReport);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to recalculate promotion checks');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="promotion-gate">
      <div className="gate-header">
        <div className="header-content">
          <h2>🚀 PROMOTION GATE: {strategyId ? `Strategy ${strategyId.slice(-6)}` : 'Futures Strategy'}</h2>
          <div className="promotion-path">
            <span className="path-node">Paper Trading</span>
            <span className="arrow">→</span>
            <span className="path-node live">Engine Room</span>
          </div>
        </div>
        <div className="header-actions">
          <button className="btn-recheck" disabled={!canAdmin || !sessionId || !strategyId || loading} onClick={handleRecheck}>
            {loading ? 'Rechecking…' : 'Recheck'}
          </button>
          <button className="btn-promote" disabled={!canAdmin || !report || report.status !== 'eligible' || deploying} onClick={handlePromote}>
            {deploying ? 'Deploying…' : 'Promote to Engine'}
          </button>
        </div>
      </div>

      {(!sessionId || !strategyId) && <div className="notice">Start a paper session before running promotion checks.</div>}
      {!canAdmin && <div className="notice">Promotion actions require admin access.</div>}
      {error && <div className="notice error">⚠ {error}</div>}

      <div className="section">
        <div className="section-header">
          <h3>AUTOMATED CHECKS</h3>
          <span className={`status-label ${report?.status === 'eligible' ? 'passed' : 'failed'}`}>
            {report ? `${report.status.toUpperCase()} (${report.score}/100)` : 'PENDING'}
          </span>
        </div>
        <div className="checks-list">
          {(report?.checks ?? []).map(check => (
            <div key={check.key} className="check-item">
              <span className="check-icon">{check.passed ? '✓' : '✕'}</span>
              <span className="check-label">{check.label}</span>
              <span className={`check-value ${check.passed ? 'passed' : 'failed'}`}>{check.value}</span>
              <span className="threshold">{check.threshold}</span>
            </div>
          ))}
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .promotion-gate {
    padding: 1.5rem;
    color: #e5e5e5;
    background: #0a0a0f;
    height: 100%;
    overflow-y: auto;
  }
  .gate-header {
    margin-bottom: 1.2rem;
    border-bottom: 1px solid #333;
    padding-bottom: 1rem;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
  }
  .header-content h2 { margin: 0 0 0.7rem; font-size: 1.2rem; }
  .promotion-path { display: flex; align-items: center; gap: 0.5rem; color: #9ca3af; }
  .path-node { background: #1f2937; padding: 0.25rem 0.7rem; border-radius: 6px; }
  .path-node.live { background: rgba(16,185,129,0.12); color: #10b981; }
  .header-actions { display: flex; gap: 0.5rem; }
  .btn-recheck, .btn-promote {
    border: none;
    border-radius: 6px;
    padding: 0.45rem 0.8rem;
    cursor: pointer;
    font-size: 0.8rem;
  }
  .btn-recheck { background: #334155; color: #fff; }
  .btn-promote { background: #10b981; color: #fff; }
  .btn-recheck:disabled, .btn-promote:disabled { opacity: 0.45; cursor: not-allowed; }
  .notice { margin-bottom: 1rem; color: #9ca3af; font-size: 0.85rem; }
  .notice.error { color: #fca5a5; }
  .section { background: #15151a; border: 1px solid #333; border-radius: 10px; padding: 1rem; }
  .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem; }
  .section h3 { margin: 0; color: #9ca3af; font-size: 0.85rem; }
  .status-label { font-size: 0.75rem; padding: 0.2rem 0.5rem; border-radius: 999px; }
  .status-label.passed { color: #10b981; background: rgba(16,185,129,0.15); }
  .status-label.failed { color: #ef4444; background: rgba(239,68,68,0.15); }
  .checks-list { display: grid; gap: 0.6rem; }
  .check-item {
    display: grid;
    grid-template-columns: 24px 1fr auto auto;
    gap: 0.6rem;
    align-items: center;
    background: rgba(255,255,255,0.02);
    border-radius: 6px;
    padding: 0.55rem;
  }
  .check-icon { font-weight: 700; color: #10b981; }
  .check-label { color: #d1d5db; font-size: 0.85rem; }
  .check-value { font-family: monospace; font-size: 0.8rem; }
  .check-value.passed { color: #10b981; }
  .check-value.failed { color: #ef4444; }
  .threshold { color: #6b7280; font-size: 0.75rem; }
`;
