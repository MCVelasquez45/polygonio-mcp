import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { futuresApi } from '../../api';
import { getApiBaseUrl } from '../../api/http';
import { getSocketAuth } from '../../api/auth';
import type { FuturesPaperSession } from '../../types/futures';

type Props = {
  sessionId?: string;
  strategyId?: string;
  strategyName?: string;
  canTrade?: boolean;
  onRequestPromotion?: () => void;
};

export function PaperTradingDashboard({ sessionId, strategyId, strategyName, canTrade = false, onRequestPromotion }: Props) {
  const [session, setSession] = useState<FuturesPaperSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setLoading(true);
    futuresApi
      .getFuturesPaperSession(sessionId)
      .then(payload => {
        if (!cancelled) setSession(payload);
      })
      .catch(err => {
        if (!cancelled) setError(err?.message ?? 'Failed to load paper session');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    const socket = io(getApiBaseUrl(), { transports: ['websocket', 'polling'], auth: getSocketAuth() });
    const handleMarketUpdate = (payload: any) => {
      if (!sessionId || payload?.sessionId !== sessionId) return;
      setSession(prev => (prev ? { ...prev, state: payload.state, status: payload.status } : prev));
    };
    const handlePositionUpdate = (payload: any) => {
      if (!sessionId || payload?.sessionId !== sessionId) return;
      setSession(prev =>
        prev
          ? {
              ...prev,
              state: {
                ...prev.state,
                position: payload.position,
                unrealizedPnl: payload.pnl?.unrealized ?? prev.state.unrealizedPnl,
                realizedPnl: payload.pnl?.realized ?? prev.state.realizedPnl,
                dailyPnl: payload.pnl?.daily ?? prev.state.dailyPnl
              }
            }
          : prev
      );
    };

    socket.on('futures:market:update', handleMarketUpdate);
    socket.on('futures:position:update', handlePositionUpdate);

    return () => {
      socket.off('futures:market:update', handleMarketUpdate);
      socket.off('futures:position:update', handlePositionUpdate);
      socket.disconnect();
    };
  }, [sessionId]);

  const controlsDisabled = !canTrade || !sessionId || !session;

  const handleControl = async (action: 'pause' | 'resume' | 'stop' | 'emergency_stop') => {
    if (!sessionId) return;
    if (!canTrade) {
      setError('Paper trading controls require trader access.');
      return;
    }
    try {
      const updated = await futuresApi.controlFuturesPaperSession(sessionId, action);
      setSession(updated);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update paper session');
    }
  };

  const pnlColor = useMemo(() => {
    const dailyPnl = session?.state.dailyPnl ?? 0;
    return dailyPnl >= 0 ? '#10b981' : '#ef4444';
  }, [session]);

  return (
    <div className="paper-dashboard">
      <div className="dashboard-header">
        <div className="header-left">
          <h2>📝 PAPER TRADING: {strategyName || session?.strategyName || 'Futures Strategy'}</h2>
          <span className="status-badge">{session?.status?.toUpperCase() ?? 'NOT STARTED'}</span>
        </div>
        <div className="header-right">
          <button className="btn-danger" disabled={controlsDisabled} onClick={() => handleControl('pause')}>Pause Trading</button>
          <button className="btn-secondary" disabled={controlsDisabled} onClick={() => handleControl('resume')}>Resume</button>
          <button className="btn-danger" disabled={controlsDisabled} onClick={() => handleControl('emergency_stop')}>Emergency Stop</button>
          <button className="btn-primary" disabled={controlsDisabled} onClick={onRequestPromotion}>Request Promotion →</button>
        </div>
      </div>

      {loading && <div className="notice">Loading paper session...</div>}
      {!sessionId && <div className="notice">Run a futures backtest to initialize a paper session.</div>}
      {!canTrade && <div className="notice">Paper trading controls require trader access.</div>}
      {error && <div className="notice error">⚠ {error}</div>}

      <div className="metrics-grid">
        <div className="metric-card">
          <span className="metric-label">TODAY P&L</span>
          <span className="metric-value" style={{ color: pnlColor }}>{(session?.state.dailyPnl ?? 0).toFixed(2)}</span>
          <span className="metric-sub">Mark: {(session?.state.markPrice ?? 0).toFixed(2)}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">EQUITY</span>
          <span className="metric-value">${(session?.state.equity ?? 0).toFixed(0)}</span>
          <span className="metric-sub">Cash ${(session?.state.cash ?? 0).toFixed(0)}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">MARGIN USED</span>
          <span className="metric-value">${(session?.state.marginUsed ?? 0).toFixed(0)}</span>
          <span className="metric-sub">{(session?.state.marginUtilizationPct ?? 0).toFixed(1)}% utilization</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">RISK UTILIZATION</span>
          <span className="metric-value">{(session?.state.riskUtilizationPct ?? 0).toFixed(1)}%</span>
          <span className="metric-sub">Limit ${(session?.config.maxDailyLoss ?? 0).toFixed(0)}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">READINESS</span>
          <span className="metric-value">{session?.state.readinessScore ?? 0}/100</span>
          <span className="metric-sub">{(session?.status ?? 'stopped').toUpperCase()}</span>
        </div>
      </div>

      <div className="section">
        <h3>CURRENT POSITION</h3>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Side</th>
                <th>Contracts</th>
                <th>Avg Entry</th>
                <th>Mark</th>
                <th>Unrealized</th>
                <th>Contract</th>
                <th>Opened</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-mono">{session?.symbol ?? '-'}</td>
                <td>{session?.state.position.side?.toUpperCase() ?? 'FLAT'}</td>
                <td>{session?.state.position.contracts ?? 0}</td>
                <td>{(session?.state.position.avgEntryPrice ?? 0).toFixed(2)}</td>
                <td>{(session?.state.markPrice ?? 0).toFixed(2)}</td>
                <td style={{ color: (session?.state.unrealizedPnl ?? 0) >= 0 ? '#10b981' : '#ef4444' }}>
                  {(session?.state.unrealizedPnl ?? 0).toFixed(2)}
                </td>
                <td>{session?.state.position.currentContract ?? '-'}</td>
                <td>{session?.state.position.openedAt ? new Date(session.state.position.openedAt).toLocaleTimeString() : '-'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .paper-dashboard {
    padding: 1.5rem;
    color: #e5e5e5;
    background: #0a0a0f;
    height: 100%;
    overflow-y: auto;
  }
  .dashboard-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    border-bottom: 1px solid #333;
    padding-bottom: 1rem;
    gap: 1rem;
  }
  .header-left h2 { margin: 0; font-size: 1.1rem; }
  .status-badge {
    margin-top: 0.5rem;
    display: inline-block;
    font-size: 0.8rem;
    color: #10b981;
    background: rgba(16,185,129,0.15);
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
  }
  .header-right { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .btn-primary, .btn-secondary, .btn-danger {
    border: none;
    padding: 0.45rem 0.8rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.8rem;
  }
  .btn-primary { background: #10b981; color: #fff; }
  .btn-secondary { background: #374151; color: #fff; }
  .btn-danger { background: #ef4444; color: #fff; }
  .btn-primary:disabled, .btn-secondary:disabled, .btn-danger:disabled { opacity: 0.45; cursor: not-allowed; }
  .notice { margin-bottom: 1rem; font-size: 0.85rem; color: #9ca3af; }
  .notice.error { color: #fca5a5; }
  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.75rem;
    margin-bottom: 1.25rem;
  }
  .metric-card {
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 10px;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
  }
  .metric-label { color: #9ca3af; font-size: 0.7rem; }
  .metric-value { color: #e5e5e5; font-size: 1.3rem; font-weight: 600; margin-top: 0.25rem; }
  .metric-sub { color: #6b7280; font-size: 0.75rem; }
  .section h3 { font-size: 0.9rem; color: #9ca3af; margin-bottom: 0.5rem; }
  .table-container { border: 1px solid #333; border-radius: 10px; overflow: hidden; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 0.75rem; border-bottom: 1px solid #23232a; text-align: left; }
  th { color: #9ca3af; font-size: 0.75rem; }
  td { color: #e5e5e5; font-size: 0.85rem; }
  @media (max-width: 1200px) {
    .metrics-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
`;
