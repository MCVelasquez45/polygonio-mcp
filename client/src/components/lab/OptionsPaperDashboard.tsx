import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { alpacaApi } from '../../api';
import { getApiBaseUrl } from '../../api/http';
import { getSocketAuth } from '../../api/auth';
import type { OptionsPaperSession } from '../../api/alpaca';

type Props = {
  sessionId: string;
  strategyId?: string;
  strategyName?: string;
  canTrade?: boolean;
  onBack?: () => void;
};

const PHASES = ['pre_analysis', 'analyzing', 'entry_window', 'in_trade', 'monitoring', 'closing', 'done'] as const;

const PHASE_LABELS: Record<string, string> = {
  pre_analysis: 'Pre-Analysis',
  analyzing: 'Analyzing',
  entry_window: 'Entry Window',
  in_trade: 'In Trade',
  monitoring: 'Monitoring',
  closing: 'Closing',
  done: 'Done',
};

function regimeColor(regime: string): string {
  if (regime === 'risk_on') return '#10b981';
  if (regime === 'risk_off') return '#ef4444';
  if (regime === 'mixed') return '#f59e0b';
  return '#6b7280';
}

function tickerColor(changePct: number): string {
  if (changePct > 0.5) return '#10b981';
  if (changePct > 0) return '#6ee7b7';
  if (changePct > -0.5) return '#fca5a5';
  return '#ef4444';
}

export function OptionsPaperDashboard({ sessionId, strategyId, strategyName, canTrade = false, onBack }: Props) {
  const [session, setSession] = useState<OptionsPaperSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitingInfo, setWaitingInfo] = useState<{
    currentTimeET: string;
    analysisStartsAt: string;
    entryWindowStart: string;
    entryWindowEnd: string;
    marketOpen: boolean;
    message: string;
  } | null>(null);

  // Fetch session on mount
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setLoading(true);
    alpacaApi
      .getOptionsPaperSession(sessionId)
      .then(payload => {
        if (!cancelled) setSession(payload);
      })
      .catch(err => {
        if (!cancelled) setError(err?.message ?? 'Failed to load options paper session');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  // Real-time updates via Socket.IO
  useEffect(() => {
    const socket = io(getApiBaseUrl(), { transports: ['websocket', 'polling'], auth: getSocketAuth() });

    const handleUpdate = (payload: any) => {
      if (payload?.sessionId !== sessionId) return;
      setSession(prev =>
        prev
          ? { ...prev, state: payload.state ?? prev.state, status: payload.status ?? prev.status, spread: payload.spread ?? prev.spread }
          : prev,
      );
    };

    const handleRegime = (payload: any) => {
      if (payload?.sessionId !== sessionId) return;
      setSession(prev =>
        prev ? { ...prev, regime: payload.regime ?? prev.regime } : prev,
      );
    };

    const handleOrder = (payload: any) => {
      if (payload?.sessionId !== sessionId) return;
      // Refresh full session to get updated orders list
      alpacaApi.getOptionsPaperSession(sessionId).then(setSession).catch(() => {});
    };

    const handleWaiting = (payload: any) => {
      if (payload?.sessionId !== sessionId) return;
      setWaitingInfo(payload);
    };

    socket.on('options:paper:update', handleUpdate);
    socket.on('options:paper:regime', handleRegime);
    socket.on('options:paper:order', handleOrder);
    socket.on('options:paper:waiting', handleWaiting);

    return () => {
      socket.off('options:paper:update', handleUpdate);
      socket.off('options:paper:regime', handleRegime);
      socket.off('options:paper:order', handleOrder);
      socket.off('options:paper:waiting', handleWaiting);
      socket.disconnect();
    };
  }, [sessionId]);

  const handleControl = async (action: 'pause' | 'resume' | 'stop') => {
    if (!canTrade) {
      setError('Options paper controls require trader access.');
      return;
    }
    try {
      const updated = await alpacaApi.controlOptionsPaperSession(sessionId, action);
      setSession(updated);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to control session');
    }
  };

  const pnlColor = useMemo(() => {
    const pnl = session?.state?.dailyPnl ?? 0;
    return pnl >= 0 ? '#10b981' : '#ef4444';
  }, [session?.state?.dailyPnl]);

  const recentOrders = useMemo(() => {
    return (session?.orders ?? []).slice(-10).reverse();
  }, [session?.orders]);

  const currentPhaseIdx = PHASES.indexOf(session?.state?.phase ?? 'pre_analysis');

  const controlsDisabled = !canTrade || !session;
  const isRunning = session?.status === 'running';
  const isPaused = session?.status === 'paused';
  const isStopped = session?.status === 'stopped' || session?.status === 'expired';
  const spread = session?.spread;
  const regime = session?.regime;

  return (
    <div className="opts-paper-dashboard">
      {/* ── Header ── */}
      <div className="dashboard-header">
        <div className="header-left">
          <h2>OPTIONS PAPER: {strategyName || session?.strategyName || 'Strategy'}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
            <span className="opts-badge">0DTE CREDIT SPREAD</span>
            <span className={`status-badge status-${session?.status ?? 'stopped'}`}>
              {session?.status?.toUpperCase() ?? 'NOT STARTED'}
            </span>
            {session?.underlying && <span className="symbol-badge">{session.underlying}</span>}
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
            disabled={controlsDisabled || isStopped}
            onClick={() => {
              if (confirm('Stop this options paper session? Any open spread will be closed on Alpaca.')) {
                handleControl('stop');
              }
            }}
          >
            Stop Session
          </button>
        </div>
      </div>

      {loading && <div className="notice">Loading options paper session...</div>}
      {!canTrade && <div className="notice">Options paper controls require trader access.</div>}
      {error && <div className="notice error">{error}</div>}

      {/* ── Phase Indicator ── */}
      <div className="section">
        <h3>LIFECYCLE PHASE</h3>
        <div className="phase-bar">
          {PHASES.map((phase, idx) => (
            <div
              key={phase}
              className={`phase-step ${idx < currentPhaseIdx ? 'phase-complete' : ''} ${idx === currentPhaseIdx ? 'phase-active' : ''}`}
            >
              <div className="phase-dot" />
              <span className="phase-label">{PHASE_LABELS[phase]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Waiting Status (shown during pre_analysis) ── */}
      {session?.state?.phase === 'pre_analysis' && (
        <div className="waiting-card">
          <div className="waiting-icon">&#9202;</div>
          <div className="waiting-content">
            <h4>Session Active — Waiting for Analysis Window</h4>
            {waitingInfo ? (
              <>
                <p className="waiting-message">{waitingInfo.message}</p>
                <div className="waiting-details">
                  <div className="waiting-detail">
                    <span className="waiting-label">Current Time (ET)</span>
                    <span className="waiting-value">{waitingInfo.currentTimeET}</span>
                  </div>
                  <div className="waiting-detail">
                    <span className="waiting-label">Analysis Begins</span>
                    <span className="waiting-value">{waitingInfo.analysisStartsAt} ET</span>
                  </div>
                  <div className="waiting-detail">
                    <span className="waiting-label">Entry Window</span>
                    <span className="waiting-value">{waitingInfo.entryWindowStart} - {waitingInfo.entryWindowEnd} ET</span>
                  </div>
                  <div className="waiting-detail">
                    <span className="waiting-label">Market</span>
                    <span className="waiting-value" style={{ color: waitingInfo.marketOpen ? '#10b981' : '#ef4444' }}>
                      {waitingInfo.marketOpen ? 'OPEN' : 'CLOSED'}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <p className="waiting-message">
                The strategy will begin analyzing market regime at {session?.config?.analysisWindowStart ?? '12:30'} ET
                and look for entry between {session?.config?.entryWindowStart ?? '14:00'} - {session?.config?.entryWindowEnd ?? '14:30'} ET.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Regime ── */}
      <div className="section">
        <h3>REGIME</h3>
        <div className="regime-header">
          <span className="regime-current" style={{ color: regimeColor(regime?.current ?? 'unknown') }}>
            {(regime?.current ?? 'unknown').toUpperCase().replace('_', ' ')}
          </span>
          <span className="regime-confidence">
            Confidence: {((regime?.confidence ?? 0) * 100).toFixed(0)}%
          </span>
          <span className="regime-action">{regime?.action ?? '-'}</span>
        </div>
        {regime?.tickerChanges && regime.tickerChanges.length > 0 && (
          <div className="ticker-grid">
            {regime.tickerChanges.map(t => (
              <div key={t.symbol} className="ticker-cell" style={{ borderColor: tickerColor(t.changePct) }}>
                <span className="ticker-sym">{t.symbol}</span>
                <span className="ticker-pct" style={{ color: tickerColor(t.changePct) }}>
                  {t.changePct >= 0 ? '+' : ''}{t.changePct.toFixed(2)}%
                </span>
                <span className="ticker-group">{t.group}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Spread ── */}
      <div className="section">
        <h3>SPREAD</h3>
        {spread?.active ? (
          <div className="spread-container">
            <div className="spread-overview">
              <span className="spread-dir">{spread.direction?.toUpperCase()} SPREAD</span>
              <span className="spread-stat">
                Credit: <strong>${spread.entryCredit?.toFixed(2)}</strong>
              </span>
              <span className="spread-stat">
                Current: <strong>${spread.currentValue?.toFixed(2)}</strong>
              </span>
              <span className="spread-stat" style={{ color: (spread.unrealizedPnl ?? 0) >= 0 ? '#10b981' : '#ef4444' }}>
                P&L: <strong>${spread.unrealizedPnl?.toFixed(2)}</strong>
              </span>
              <span className="spread-stat">
                Max Loss: <strong>${spread.maxLoss?.toFixed(2)}</strong>
              </span>
            </div>
            <div className="legs-grid">
              <div className="leg-card">
                <span className="leg-title">SHORT LEG</span>
                <span className="leg-detail">Strike: {spread.shortLeg?.strike}</span>
                <span className="leg-detail">Delta: {spread.shortLeg?.delta?.toFixed(3)}</span>
                <span className="leg-detail">Bid/Ask: ${spread.shortLeg?.currentBid?.toFixed(2)} / ${spread.shortLeg?.currentAsk?.toFixed(2)}</span>
                <span className="leg-detail leg-sub">Entry: ${spread.shortLeg?.entryBid?.toFixed(2)} / ${spread.shortLeg?.entryAsk?.toFixed(2)}</span>
                <span className="leg-detail leg-sub">{spread.shortLeg?.symbol}</span>
              </div>
              <div className="leg-card">
                <span className="leg-title">LONG LEG</span>
                <span className="leg-detail">Strike: {spread.longLeg?.strike}</span>
                <span className="leg-detail">Delta: {spread.longLeg?.delta?.toFixed(3)}</span>
                <span className="leg-detail">Bid/Ask: ${spread.longLeg?.currentBid?.toFixed(2)} / ${spread.longLeg?.currentAsk?.toFixed(2)}</span>
                <span className="leg-detail leg-sub">Entry: ${spread.longLeg?.entryBid?.toFixed(2)} / ${spread.longLeg?.entryAsk?.toFixed(2)}</span>
                <span className="leg-detail leg-sub">{spread.longLeg?.symbol}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="no-spread">No active spread -- waiting for entry signal</div>
        )}
      </div>

      {/* ── Metrics ── */}
      <div className="metrics-grid">
        <div className="metric-card">
          <span className="metric-label">DAILY P&L</span>
          <span className="metric-value" style={{ color: pnlColor }}>
            ${(session?.state?.dailyPnl ?? 0).toFixed(2)}
          </span>
          <span className="metric-sub">
            Realized: ${(session?.state?.realizedPnl ?? 0).toFixed(2)}
          </span>
        </div>
        <div className="metric-card">
          <span className="metric-label">EQUITY</span>
          <span className="metric-value">${(session?.state?.equity ?? 0).toFixed(2)}</span>
          <span className="metric-sub">Cash: ${(session?.state?.cash ?? 0).toFixed(2)}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">UNDERLYING</span>
          <span className="metric-value">${(session?.state?.underlyingPrice ?? 0).toFixed(2)}</span>
          <span className="metric-sub">{session?.underlying ?? '-'}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">RISK UTILIZATION</span>
          <span className="metric-value">{(session?.state?.riskUtilizationPct ?? 0).toFixed(1)}%</span>
          <span className="metric-sub">Max daily loss: ${session?.config?.maxDailyLoss ?? '-'}</span>
        </div>
      </div>

      {/* ── Config ── */}
      <div className="section">
        <h3>SESSION CONFIG</h3>
        <div className="config-grid">
          <div className="config-item">
            <span className="config-label">Entry window</span>
            <span className="config-value">{session?.config?.entryWindowStart ?? '-'} - {session?.config?.entryWindowEnd ?? '-'}</span>
          </div>
          <div className="config-item">
            <span className="config-label">Analysis start</span>
            <span className="config-value">{session?.config?.analysisWindowStart ?? '-'}</span>
          </div>
          <div className="config-item">
            <span className="config-label">Qty</span>
            <span className="config-value">{session?.config?.qty ?? '-'}</span>
          </div>
          <div className="config-item">
            <span className="config-label">Spread width</span>
            <span className="config-value">{session?.config?.spreadWidth ?? '-'}</span>
          </div>
          <div className="config-item">
            <span className="config-label">Target delta</span>
            <span className="config-value">{session?.config?.targetDelta ?? '-'}</span>
          </div>
          <div className="config-item">
            <span className="config-label">Profit target %</span>
            <span className="config-value">{session?.config?.profitTargetPct != null ? `${(session.config.profitTargetPct * 100).toFixed(0)}%` : '-'}</span>
          </div>
          <div className="config-item">
            <span className="config-label">Stop loss multiplier</span>
            <span className="config-value">{session?.config?.stopLossMultiplier ?? '-'}x</span>
          </div>
          <div className="config-item">
            <span className="config-label">Check interval</span>
            <span className="config-value">{session?.config?.intervalSeconds ?? '-'}s</span>
          </div>
          <div className="config-item">
            <span className="config-label">Started</span>
            <span className="config-value">
              {session?.startedAt ? new Date(session.startedAt).toLocaleString() : '-'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Orders ── */}
      <div className="section">
        <h3>RECENT ORDERS ({session?.orders?.length ?? 0} total)</h3>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Legs</th>
                <th>Credit</th>
                <th>Status</th>
                <th>Order ID</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: '#6b7280' }}>
                    No orders yet -- waiting for entry signal
                  </td>
                </tr>
              ) : (
                recentOrders.map((order, i) => (
                  <tr key={i}>
                    <td>{order.createdAt ? new Date(order.createdAt).toLocaleTimeString() : '-'}</td>
                    <td>{order.type}</td>
                    <td className="legs-cell">
                      {order.legs?.map((l, j) => (
                        <span key={j} className="leg-tag">
                          {l.side?.toUpperCase()} {l.strike} <span className="leg-sym">{l.symbol?.slice(-15)}</span>
                        </span>
                      ))}
                    </td>
                    <td>${order.credit?.toFixed(2) ?? '-'}</td>
                    <td>{order.status}</td>
                    <td className="font-mono order-id">{order.alpacaOrderId?.slice(0, 12)}...</td>
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
  .waiting-card {
    display: flex;
    gap: 1rem;
    background: rgba(251, 191, 36, 0.06);
    border: 1px solid rgba(251, 191, 36, 0.2);
    border-radius: 10px;
    padding: 1rem 1.25rem;
    margin-bottom: 1.25rem;
  }

  .waiting-icon {
    font-size: 2rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .waiting-content h4 {
    margin: 0 0 0.35rem;
    color: #fbbf24;
    font-size: 0.95rem;
  }

  .waiting-message {
    color: #9ca3af;
    font-size: 0.8rem;
    margin: 0 0 0.75rem;
    line-height: 1.4;
  }

  .waiting-details {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
  }

  .waiting-detail {
    background: rgba(255, 255, 255, 0.03);
    border-radius: 6px;
    padding: 0.4rem 0.6rem;
  }

  .waiting-label {
    display: block;
    color: #6b7280;
    font-size: 0.65rem;
    letter-spacing: 0.3px;
  }

  .waiting-value {
    color: #e5e5e5;
    font-size: 0.85rem;
    font-weight: 600;
  }

  .opts-paper-dashboard {
    padding: 1.5rem;
    color: #e5e5e5;
    background: #0a0a0f;
    height: 100%;
    overflow-y: auto;
  }

  .opts-paper-dashboard .dashboard-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1.25rem;
    border-bottom: 1px solid #333;
    padding-bottom: 1rem;
    gap: 1rem;
  }

  .opts-paper-dashboard .header-left h2 {
    margin: 0;
    font-size: 1.1rem;
  }

  .opts-paper-dashboard .opts-badge {
    font-size: 0.7rem;
    color: #a78bfa;
    background: rgba(167, 139, 250, 0.15);
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  .opts-paper-dashboard .status-badge {
    font-size: 0.7rem;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
  }

  .opts-paper-dashboard .status-running { color: #10b981; background: rgba(16, 185, 129, 0.15); }
  .opts-paper-dashboard .status-paused { color: #fbbf24; background: rgba(251, 191, 36, 0.15); }
  .opts-paper-dashboard .status-stopped { color: #ef4444; background: rgba(239, 68, 68, 0.15); }
  .opts-paper-dashboard .status-waiting { color: #60a5fa; background: rgba(96, 165, 250, 0.15); }
  .opts-paper-dashboard .status-expired { color: #9ca3af; background: rgba(156, 163, 175, 0.15); }

  .opts-paper-dashboard .symbol-badge {
    font-size: 0.75rem;
    color: #60a5fa;
    background: rgba(96, 165, 250, 0.12);
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-family: monospace;
    font-weight: 600;
  }

  .opts-paper-dashboard .header-right {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .opts-paper-dashboard .btn-primary,
  .opts-paper-dashboard .btn-secondary,
  .opts-paper-dashboard .btn-danger,
  .opts-paper-dashboard .btn-warning {
    border: none;
    padding: 0.45rem 0.8rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.8rem;
  }

  .opts-paper-dashboard .btn-primary { background: #10b981; color: #fff; }
  .opts-paper-dashboard .btn-secondary { background: #374151; color: #fff; }
  .opts-paper-dashboard .btn-danger { background: #ef4444; color: #fff; }
  .opts-paper-dashboard .btn-warning { background: #f59e0b; color: #000; }
  .opts-paper-dashboard .btn-primary:disabled,
  .opts-paper-dashboard .btn-secondary:disabled,
  .opts-paper-dashboard .btn-danger:disabled,
  .opts-paper-dashboard .btn-warning:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .opts-paper-dashboard .notice {
    margin-bottom: 1rem;
    font-size: 0.85rem;
    color: #9ca3af;
  }

  .opts-paper-dashboard .notice.error {
    color: #fca5a5;
    background: rgba(239, 68, 68, 0.08);
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    border: 1px solid rgba(239, 68, 68, 0.2);
  }

  /* Phase indicator */
  .opts-paper-dashboard .phase-bar {
    display: flex;
    gap: 0;
    align-items: center;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    padding: 0.6rem 0.75rem;
    overflow-x: auto;
  }

  .opts-paper-dashboard .phase-step {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex: 1;
    min-width: 0;
  }

  .opts-paper-dashboard .phase-step:not(:last-child)::after {
    content: '';
    flex: 1;
    height: 2px;
    background: #333;
    margin: 0 0.3rem;
    min-width: 8px;
  }

  .opts-paper-dashboard .phase-step.phase-complete:not(:last-child)::after {
    background: #10b981;
  }

  .opts-paper-dashboard .phase-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #333;
    flex-shrink: 0;
  }

  .opts-paper-dashboard .phase-complete .phase-dot {
    background: #10b981;
  }

  .opts-paper-dashboard .phase-active .phase-dot {
    background: #a78bfa;
    box-shadow: 0 0 6px rgba(167, 139, 250, 0.6);
  }

  .opts-paper-dashboard .phase-label {
    font-size: 0.65rem;
    color: #6b7280;
    white-space: nowrap;
  }

  .opts-paper-dashboard .phase-active .phase-label {
    color: #a78bfa;
    font-weight: 600;
  }

  .opts-paper-dashboard .phase-complete .phase-label {
    color: #10b981;
  }

  /* Regime */
  .opts-paper-dashboard .regime-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
  }

  .opts-paper-dashboard .regime-current {
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: 0.5px;
  }

  .opts-paper-dashboard .regime-confidence {
    font-size: 0.8rem;
    color: #9ca3af;
  }

  .opts-paper-dashboard .regime-action {
    font-size: 0.8rem;
    color: #d1d5db;
    font-style: italic;
  }

  .opts-paper-dashboard .ticker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
    gap: 0.4rem;
    margin-top: 0.4rem;
  }

  .opts-paper-dashboard .ticker-cell {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid;
    border-radius: 6px;
    padding: 0.35rem 0.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
  }

  .opts-paper-dashboard .ticker-sym {
    font-size: 0.72rem;
    font-weight: 600;
    color: #e5e5e5;
    font-family: monospace;
  }

  .opts-paper-dashboard .ticker-pct {
    font-size: 0.8rem;
    font-weight: 700;
  }

  .opts-paper-dashboard .ticker-group {
    font-size: 0.6rem;
    color: #6b7280;
  }

  /* Spread */
  .opts-paper-dashboard .spread-container {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    padding: 0.75rem;
  }

  .opts-paper-dashboard .spread-overview {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
    padding-bottom: 0.6rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .opts-paper-dashboard .spread-dir {
    font-size: 0.85rem;
    font-weight: 700;
    color: #a78bfa;
    letter-spacing: 0.5px;
  }

  .opts-paper-dashboard .spread-stat {
    font-size: 0.8rem;
    color: #9ca3af;
  }

  .opts-paper-dashboard .spread-stat strong {
    color: #e5e5e5;
  }

  .opts-paper-dashboard .legs-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
  }

  .opts-paper-dashboard .leg-card {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    padding: 0.6rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .opts-paper-dashboard .leg-title {
    font-size: 0.7rem;
    color: #9ca3af;
    font-weight: 600;
    letter-spacing: 0.5px;
    margin-bottom: 0.15rem;
  }

  .opts-paper-dashboard .leg-detail {
    font-size: 0.8rem;
    color: #e5e5e5;
  }

  .opts-paper-dashboard .leg-sub {
    color: #6b7280;
    font-size: 0.72rem;
    font-family: monospace;
  }

  .opts-paper-dashboard .no-spread {
    color: #6b7280;
    font-size: 0.85rem;
    font-style: italic;
    padding: 0.5rem 0;
  }

  /* Metrics */
  .opts-paper-dashboard .metrics-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.75rem;
    margin-bottom: 1.25rem;
  }

  .opts-paper-dashboard .metric-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
  }

  .opts-paper-dashboard .metric-label {
    color: #9ca3af;
    font-size: 0.7rem;
    letter-spacing: 0.5px;
  }

  .opts-paper-dashboard .metric-value {
    color: #e5e5e5;
    font-size: 1.2rem;
    font-weight: 600;
    margin-top: 0.2rem;
  }

  .opts-paper-dashboard .metric-sub {
    color: #6b7280;
    font-size: 0.72rem;
    margin-top: 0.15rem;
  }

  /* Section */
  .opts-paper-dashboard .section {
    margin-bottom: 1.25rem;
  }

  .opts-paper-dashboard .section h3 {
    font-size: 0.85rem;
    color: #9ca3af;
    margin-bottom: 0.5rem;
    letter-spacing: 0.5px;
  }

  /* Config */
  .opts-paper-dashboard .config-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .opts-paper-dashboard .config-item {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
  }

  .opts-paper-dashboard .config-label {
    color: #6b7280;
    font-size: 0.7rem;
    display: block;
  }

  .opts-paper-dashboard .config-value {
    color: #e5e5e5;
    font-size: 0.85rem;
    font-weight: 500;
  }

  /* Table */
  .opts-paper-dashboard .table-container {
    border: 1px solid #333;
    border-radius: 10px;
    overflow: hidden;
  }

  .opts-paper-dashboard table {
    width: 100%;
    border-collapse: collapse;
  }

  .opts-paper-dashboard th,
  .opts-paper-dashboard td {
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid #23232a;
    text-align: left;
  }

  .opts-paper-dashboard th {
    color: #9ca3af;
    font-size: 0.72rem;
    letter-spacing: 0.3px;
  }

  .opts-paper-dashboard td {
    color: #e5e5e5;
    font-size: 0.8rem;
  }

  .opts-paper-dashboard .font-mono { font-family: monospace; }

  .opts-paper-dashboard .order-id {
    color: #6b7280;
    font-size: 0.72rem;
  }

  .opts-paper-dashboard .legs-cell {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .opts-paper-dashboard .leg-tag {
    font-size: 0.7rem;
    background: rgba(255, 255, 255, 0.05);
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
  }

  .opts-paper-dashboard .leg-sym {
    color: #6b7280;
    font-family: monospace;
    font-size: 0.65rem;
  }

  @media (max-width: 1200px) {
    .opts-paper-dashboard .metrics-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .opts-paper-dashboard .config-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .opts-paper-dashboard .legs-grid { grid-template-columns: 1fr; }
  }
`;
