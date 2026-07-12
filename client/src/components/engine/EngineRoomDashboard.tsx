import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { futuresApi } from '../../api';
import { getApiBaseUrl } from '../../api/http';
import { getSocketAuth } from '../../api/auth';
import { ReconciliationView } from './ReconciliationView';
import type { FuturesEngineState } from '../../types/futures';

type Props = {
  sessionId?: string;
  strategyId?: string;
  canAdmin?: boolean;
};

export function EngineRoomDashboard({ sessionId, canAdmin = false }: Props) {
  const [showReconciliation, setShowReconciliation] = useState(false);
  const [engineStatus, setEngineStatus] = useState<FuturesEngineState | null>(null);
  const [sessionStatus, setSessionStatus] = useState<'running' | 'paused' | 'stopped' | null>(null);

  useEffect(() => {
    let cancelled = false;
    futuresApi
      .getFuturesEngineStatus()
      .then(payload => {
        if (!cancelled) setEngineStatus(payload);
      })
      .catch(() => {
        if (!cancelled) setEngineStatus(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const socket = io(getApiBaseUrl(), { transports: ['websocket', 'polling'], auth: getSocketAuth() });

    const handleEngineUpdate = () => {
      futuresApi.getFuturesEngineStatus().then(setEngineStatus).catch(() => undefined);
    };

    const handleRiskUpdate = (payload: any) => {
      if (!sessionId || payload?.sessionId !== sessionId) return;
      if (payload?.status === 'paused') setSessionStatus('paused');
    };

    socket.on('futures:engine:update', handleEngineUpdate);
    socket.on('futures:risk:update', handleRiskUpdate);

    return () => {
      socket.off('futures:engine:update', handleEngineUpdate);
      socket.off('futures:risk:update', handleRiskUpdate);
      socket.disconnect();
    };
  }, [sessionId]);

  const aggregate = engineStatus?.aggregate ?? { todayPnl: 0, riskUtilizationPct: 0 };

  const topSessions = useMemo(() => engineStatus?.sessions?.slice(0, 5) ?? [], [engineStatus]);

  return (
    <div className="engine-room">
      <div className="dashboard-header">
        <div className="header-left">
          <h2>🔥 ENGINE ROOM</h2>
          <div className="live-indicator">
            <span className="dot"></span>
            <span>{sessionStatus === 'paused' ? 'PAUSED' : 'LIVE'}</span>
          </div>
          <span className="time">{new Date().toLocaleTimeString()}</span>
        </div>
        <div className="header-right">
          <button className="btn-secondary" onClick={() => setShowReconciliation(true)}>📋 EOD Recon</button>
          <button
            className="btn-emergency"
            disabled={!canAdmin || !sessionId}
            onClick={() => sessionId && futuresApi.controlFuturesPaperSession(sessionId, 'emergency_stop').then(() => setSessionStatus('stopped'))}
          >
            EMERGENCY STOP
          </button>
        </div>
      </div>

      <ReconciliationView isOpen={showReconciliation} onClose={() => setShowReconciliation(false)} />

      <div className="metrics-grid">
        <div className="metric-card">
          <label>TODAY P&L</label>
          <span className={`value ${aggregate.todayPnl >= 0 ? 'positive' : 'negative'}`}>{aggregate.todayPnl.toFixed(2)}</span>
          <span className="sub-value">Aggregated futures paper deployment</span>
        </div>
        <div className="metric-card">
          <label>ACTIVE DEPLOYMENTS</label>
          <span className="value">{engineStatus?.active ?? 0}</span>
          <span className="sub-value">{engineStatus?.count ?? 0} total sessions</span>
        </div>
        <div className="metric-card risk-card">
          <label>RISK UTILIZATION</label>
          <span className="value">{(aggregate.riskUtilizationPct ?? 0).toFixed(1)}%</span>
          <div className="progress-bar">
            <div className="fill" style={{ width: `${Math.min(100, aggregate.riskUtilizationPct ?? 0)}%` }}></div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-header">
          <h3>LIVE FUTURES STRATEGIES</h3>
        </div>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Session</th>
                <th>Status</th>
                <th>Symbol</th>
                <th>Today P&L</th>
                <th>MTD P&L</th>
                <th>YTD P&L</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {topSessions.map(s => (
                <tr key={s._id}>
                  <td className="font-medium">{s.sessionId.slice(-8)}</td>
                  <td>{s.status.toUpperCase()}</td>
                  <td>{s.symbol}</td>
                  <td className={s.summary.todayPnl >= 0 ? 'positive' : 'negative'}>{s.summary.todayPnl.toFixed(2)}</td>
                  <td>{s.summary.mtdPnl.toFixed(2)}</td>
                  <td>{s.summary.ytdPnl.toFixed(2)}</td>
                  <td>{s.summary.riskUtilizationPct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .engine-room {
    padding: 1.5rem;
    color: #e5e5e5;
    background: #0a0a0f;
    min-height: 100%;
  }
  .dashboard-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.25rem;
    border-bottom: 2px solid #ef4444;
    padding-bottom: 0.8rem;
  }
  .header-left { display: flex; align-items: center; gap: 1rem; }
  .header-left h2 { margin: 0; font-size: 1.3rem; }
  .live-indicator {
    display: flex; align-items: center; gap: 0.4rem;
    background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.25);
    color: #ef4444; border-radius: 999px; padding: 0.2rem 0.6rem; font-size: 0.75rem;
  }
  .dot { width: 8px; height: 8px; background: #ef4444; border-radius: 50%; }
  .time { color: #9ca3af; font-family: monospace; }
  .header-right { display: flex; gap: 0.6rem; }
  .btn-secondary, .btn-emergency {
    border: none; border-radius: 6px; padding: 0.5rem 0.8rem; cursor: pointer; font-size: 0.8rem;
  }
  .btn-secondary { background: #334155; color: #fff; }
  .btn-emergency { background: #ef4444; color: #fff; }
  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .metric-card { background: #15151a; border: 1px solid #333; border-radius: 8px; padding: 0.8rem; }
  .metric-card label { color: #9ca3af; font-size: 0.72rem; display: block; }
  .metric-card .value { color: #fff; font-size: 1.4rem; font-weight: 700; }
  .metric-card .value.positive { color: #10b981; }
  .metric-card .value.negative { color: #ef4444; }
  .sub-value { color: #6b7280; font-size: 0.75rem; }
  .progress-bar { width: 100%; height: 6px; background: #222; border-radius: 999px; margin-top: 0.5rem; }
  .fill { height: 100%; background: #f59e0b; border-radius: 999px; }
  .section { margin-top: 1rem; }
  .section-header h3 { margin: 0 0 0.5rem 0; color: #9ca3af; font-size: 0.9rem; }
  .table-container { border: 1px solid #333; border-radius: 8px; overflow: hidden; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 0.65rem; border-bottom: 1px solid #24242d; text-align: left; font-size: 0.8rem; }
  th { color: #9ca3af; }
  .positive { color: #10b981; }
  .negative { color: #ef4444; }
  @media (max-width: 980px) {
    .metrics-grid { grid-template-columns: 1fr; }
  }
`;
