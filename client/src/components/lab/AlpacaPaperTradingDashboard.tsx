import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { alpacaApi } from '../../api';
import { getApiBaseUrl } from '../../api/http';
import type { AlpacaPaperSession } from '../../api/alpaca';

type Props = {
  sessionId: string;
  strategyId?: string;
  strategyName?: string;
  onBack?: () => void;
};

export function AlpacaPaperTradingDashboard({ sessionId, strategyId, strategyName, onBack }: Props) {
  const [session, setSession] = useState<AlpacaPaperSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch session on mount
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setLoading(true);
    alpacaApi
      .getAlpacaPaperSession(sessionId)
      .then(payload => {
        if (!cancelled) setSession(payload);
      })
      .catch(err => {
        if (!cancelled) setError(err?.message ?? 'Failed to load Alpaca paper session');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  // Real-time updates via Socket.IO
  useEffect(() => {
    const socket = io(getApiBaseUrl(), { transports: ['websocket', 'polling'] });

    const handleUpdate = (payload: any) => {
      if (payload?.sessionId !== sessionId) return;
      setSession(prev =>
        prev ? { ...prev, state: payload.state, status: payload.status } : prev,
      );
    };

    const handleOrder = (payload: any) => {
      if (payload?.sessionId !== sessionId) return;
      // Refresh full session to get updated orders list
      alpacaApi.getAlpacaPaperSession(sessionId).then(setSession).catch(() => {});
    };

    const handleRisk = (payload: any) => {
      if (payload?.sessionId !== sessionId) return;
      setSession(prev =>
        prev ? { ...prev, status: payload.status ?? prev.status } : prev,
      );
    };

    socket.on('alpaca:paper:update', handleUpdate);
    socket.on('alpaca:paper:order', handleOrder);
    socket.on('alpaca:paper:risk', handleRisk);

    return () => {
      socket.off('alpaca:paper:update', handleUpdate);
      socket.off('alpaca:paper:order', handleOrder);
      socket.off('alpaca:paper:risk', handleRisk);
      socket.disconnect();
    };
  }, [sessionId]);

  const handleControl = async (action: 'pause' | 'resume' | 'stop') => {
    try {
      const updated = await alpacaApi.controlAlpacaPaperSession(sessionId, action);
      setSession(updated);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to control session');
    }
  };

  const pnlColor = useMemo(() => {
    const pnl = session?.state.dailyPnl ?? 0;
    return pnl >= 0 ? '#10b981' : '#ef4444';
  }, [session?.state.dailyPnl]);

  const posColor = useMemo(() => {
    const side = session?.state.positionSide;
    if (side === 'long') return '#10b981';
    if (side === 'short') return '#ef4444';
    return '#9ca3af';
  }, [session?.state.positionSide]);

  const recentOrders = useMemo(() => {
    return (session?.orders ?? []).slice(-10).reverse();
  }, [session?.orders]);

  const controlsDisabled = !session;
  const isRunning = session?.status === 'running';
  const isPaused = session?.status === 'paused';

  return (
    <div className="alpaca-paper-dashboard">
      <div className="dashboard-header">
        <div className="header-left">
          <h2>ALPACA PAPER: {strategyName || session?.strategyName || 'Strategy'}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.35rem' }}>
            <span className="alpaca-badge">ALPACA PAPER</span>
            <span className={`status-badge status-${session?.status ?? 'stopped'}`}>
              {session?.status?.toUpperCase() ?? 'NOT STARTED'}
            </span>
            {session?.symbol && <span className="symbol-badge">{session.symbol}</span>}
          </div>
        </div>
        <div className="header-right">
          {onBack && <button className="btn-secondary" onClick={onBack}>Back</button>}
          {isRunning && (
            <button className="btn-warning" disabled={controlsDisabled} onClick={() => handleControl('pause')}>
              Pause
            </button>
          )}
          {isPaused && (
            <button className="btn-secondary" disabled={controlsDisabled} onClick={() => handleControl('resume')}>
              Resume
            </button>
          )}
          <button
            className="btn-danger"
            disabled={controlsDisabled || session?.status === 'stopped'}
            onClick={() => {
              if (confirm('Stop this paper trading session? Any open position will be closed on Alpaca.')) {
                handleControl('stop');
              }
            }}
          >
            Stop Session
          </button>
        </div>
      </div>

      {loading && <div className="notice">Loading Alpaca paper session...</div>}
      {error && <div className="notice error">{error}</div>}

      <div className="metrics-grid">
        <div className="metric-card">
          <span className="metric-label">DAILY P&L</span>
          <span className="metric-value" style={{ color: pnlColor }}>
            ${(session?.state.dailyPnl ?? 0).toFixed(2)}
          </span>
          <span className="metric-sub">
            Realized: ${(session?.state.realizedPnl ?? 0).toFixed(2)}
          </span>
        </div>
        <div className="metric-card">
          <span className="metric-label">EQUITY</span>
          <span className="metric-value">${(session?.state.equity ?? 0).toFixed(2)}</span>
          <span className="metric-sub">Cash: ${(session?.state.cash ?? 0).toFixed(2)}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">LAST PRICE</span>
          <span className="metric-value">${(session?.state.lastPrice ?? 0).toFixed(2)}</span>
          <span className="metric-sub">{session?.symbol ?? '-'}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">POSITION</span>
          <span className="metric-value" style={{ color: posColor }}>
            {session?.state.positionSide?.toUpperCase() ?? 'FLAT'}
            {session?.state.positionQty ? ` x${session.state.positionQty}` : ''}
          </span>
          <span className="metric-sub">
            {session?.state.positionAvgEntry
              ? `Entry: $${session.state.positionAvgEntry.toFixed(2)}`
              : 'No position'}
          </span>
        </div>
        <div className="metric-card">
          <span className="metric-label">SIGNAL</span>
          <span className="metric-value">{session?.state.lastSignal || 'WAITING'}</span>
          <span className="metric-sub" title={session?.state.lastSignalReason}>
            {session?.state.lastSignalReason
              ? session.state.lastSignalReason.length > 40
                ? session.state.lastSignalReason.slice(0, 40) + '...'
                : session.state.lastSignalReason
              : 'No signal yet'}
          </span>
        </div>
        <div className="metric-card">
          <span className="metric-label">UNREALIZED P&L</span>
          <span
            className="metric-value"
            style={{ color: (session?.state.unrealizedPnl ?? 0) >= 0 ? '#10b981' : '#ef4444' }}
          >
            ${(session?.state.unrealizedPnl ?? 0).toFixed(2)}
          </span>
          <span className="metric-sub">
            Risk: {(session?.state.riskUtilizationPct ?? 0).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Configuration */}
      <div className="section">
        <h3>SESSION CONFIG</h3>
        <div className="config-grid">
          <div className="config-item">
            <span className="config-label">Symbol</span>
            <span className="config-value">{session?.symbol ?? '-'}</span>
          </div>
          <div className="config-item">
            <span className="config-label">Qty per trade</span>
            <span className="config-value">{session?.config.qty ?? '-'}</span>
          </div>
          <div className="config-item">
            <span className="config-label">Check interval</span>
            <span className="config-value">{session?.config.intervalSeconds ?? '-'}s</span>
          </div>
          <div className="config-item">
            <span className="config-label">Max daily loss</span>
            <span className="config-value">${session?.config.maxDailyLoss ?? '-'}</span>
          </div>
          <div className="config-item">
            <span className="config-label">Started</span>
            <span className="config-value">
              {session?.startedAt ? new Date(session.startedAt).toLocaleString() : '-'}
            </span>
          </div>
          <div className="config-item">
            <span className="config-label">Last update</span>
            <span className="config-value">
              {session?.state.lastUpdatedAt
                ? new Date(session.state.lastUpdatedAt).toLocaleTimeString()
                : '-'}
            </span>
          </div>
        </div>
      </div>

      {/* Recent orders */}
      <div className="section">
        <h3>RECENT ALPACA ORDERS ({session?.orders?.length ?? 0} total)</h3>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Side</th>
                <th>Qty</th>
                <th>Fill Price</th>
                <th>Reason</th>
                <th>Alpaca Order ID</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: '#6b7280' }}>
                    No orders yet — waiting for strategy signals
                  </td>
                </tr>
              ) : (
                recentOrders.map((order, i) => (
                  <tr key={i}>
                    <td>{order.createdAt ? new Date(order.createdAt).toLocaleTimeString() : '-'}</td>
                    <td style={{ color: order.side === 'buy' ? '#10b981' : '#ef4444' }}>
                      {order.side?.toUpperCase()}
                    </td>
                    <td>{order.qty}</td>
                    <td>{order.filledPrice != null ? `$${order.filledPrice.toFixed(2)}` : '-'}</td>
                    <td className="reason-cell">{order.reason}</td>
                    <td className="font-mono order-id">{order.alpacaOrderId?.slice(0, 12)}...</td>
                    <td>{order.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .alpaca-paper-dashboard {
    padding: 1.5rem;
    color: #e5e5e5;
    background: #0a0a0f;
    height: 100%;
    overflow-y: auto;
  }

  .dashboard-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1.25rem;
    border-bottom: 1px solid #333;
    padding-bottom: 1rem;
    gap: 1rem;
  }

  .header-left h2 {
    margin: 0;
    font-size: 1.1rem;
  }

  .alpaca-badge {
    font-size: 0.7rem;
    color: #fbbf24;
    background: rgba(251, 191, 36, 0.15);
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  .status-badge {
    font-size: 0.7rem;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
  }

  .status-running {
    color: #10b981;
    background: rgba(16, 185, 129, 0.15);
  }

  .status-paused {
    color: #fbbf24;
    background: rgba(251, 191, 36, 0.15);
  }

  .status-stopped {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.15);
  }

  .symbol-badge {
    font-size: 0.75rem;
    color: #60a5fa;
    background: rgba(96, 165, 250, 0.12);
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-family: monospace;
    font-weight: 600;
  }

  .header-right {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .btn-primary, .btn-secondary, .btn-danger, .btn-warning {
    border: none;
    padding: 0.45rem 0.8rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.8rem;
  }

  .btn-primary { background: #10b981; color: #fff; }
  .btn-secondary { background: #374151; color: #fff; }
  .btn-danger { background: #ef4444; color: #fff; }
  .btn-warning { background: #f59e0b; color: #000; }
  .btn-primary:disabled, .btn-secondary:disabled, .btn-danger:disabled, .btn-warning:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .notice {
    margin-bottom: 1rem;
    font-size: 0.85rem;
    color: #9ca3af;
  }

  .notice.error {
    color: #fca5a5;
    background: rgba(239, 68, 68, 0.08);
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    border: 1px solid rgba(239, 68, 68, 0.2);
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
    margin-bottom: 1.25rem;
  }

  .metric-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
  }

  .metric-label {
    color: #9ca3af;
    font-size: 0.7rem;
    letter-spacing: 0.5px;
  }

  .metric-value {
    color: #e5e5e5;
    font-size: 1.2rem;
    font-weight: 600;
    margin-top: 0.2rem;
  }

  .metric-sub {
    color: #6b7280;
    font-size: 0.72rem;
    margin-top: 0.15rem;
  }

  .section {
    margin-bottom: 1.25rem;
  }

  .section h3 {
    font-size: 0.85rem;
    color: #9ca3af;
    margin-bottom: 0.5rem;
    letter-spacing: 0.5px;
  }

  .config-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .config-item {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
  }

  .config-label {
    color: #6b7280;
    font-size: 0.7rem;
    display: block;
  }

  .config-value {
    color: #e5e5e5;
    font-size: 0.85rem;
    font-weight: 500;
  }

  .table-container {
    border: 1px solid #333;
    border-radius: 10px;
    overflow: hidden;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th, td {
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid #23232a;
    text-align: left;
  }

  th {
    color: #9ca3af;
    font-size: 0.72rem;
    letter-spacing: 0.3px;
  }

  td {
    color: #e5e5e5;
    font-size: 0.8rem;
  }

  .font-mono {
    font-family: monospace;
  }

  .reason-cell {
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .order-id {
    color: #6b7280;
    font-size: 0.72rem;
  }

  @media (max-width: 1200px) {
    .metrics-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .config-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
`;
