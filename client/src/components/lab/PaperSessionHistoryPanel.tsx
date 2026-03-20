import { useEffect, useState } from 'react';
import { futuresApi, alpacaApi } from '../../api';
import type { FuturesPaperSession } from '../../types/futures';
import type { AlpacaPaperSession, OptionsPaperSession } from '../../api/alpaca';

type SessionKind = 'futures' | 'equity' | 'options';

type UnifiedSession = {
  _id: string;
  kind: SessionKind;
  strategyName: string;
  symbol: string;
  status: string;
  equity: number;
  pnl: number;
  dailyPnl: number;
  versionLabel?: string;
  backtestId?: string;
  startedAt: string;
  endedAt: string | null;
};

type Props = {
  strategyId: string;
  strategyName?: string;
  onSelectSession: (sessionId: string, kind: SessionKind) => void;
  onBack: () => void;
};

function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function normalizeFutures(s: FuturesPaperSession): UnifiedSession {
  return {
    _id: s._id,
    kind: 'futures',
    strategyName: s.strategyName,
    symbol: s.symbol,
    status: s.status,
    equity: s.state.equity,
    pnl: s.state.realizedPnl + s.state.unrealizedPnl,
    dailyPnl: s.state.dailyPnl,
    versionLabel: s.versionLabel,
    backtestId: s.backtestId,
    startedAt: (s as any).startedAt ?? (s as any).createdAt ?? '',
    endedAt: (s as any).endedAt ?? null,
  };
}

function normalizeAlpaca(s: AlpacaPaperSession): UnifiedSession {
  return {
    _id: s._id,
    kind: 'equity',
    strategyName: s.strategyName,
    symbol: s.symbol,
    status: s.status,
    equity: s.state.equity,
    pnl: s.state.realizedPnl + s.state.unrealizedPnl,
    dailyPnl: s.state.dailyPnl,
    versionLabel: s.versionLabel,
    backtestId: s.backtestId,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
  };
}

function normalizeOptions(s: OptionsPaperSession): UnifiedSession {
  return {
    _id: s._id,
    kind: 'options',
    strategyName: s.strategyName,
    symbol: s.underlying,
    status: s.status,
    equity: s.state.equity,
    pnl: s.state.realizedPnl + s.state.dailyPnl,
    dailyPnl: s.state.dailyPnl,
    versionLabel: s.versionLabel,
    backtestId: s.backtestId,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
  };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  running:  { label: 'Running',  color: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)' },
  paused:   { label: 'Paused',   color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
  stopped:  { label: 'Stopped',  color: '#6b7280', bg: 'rgba(107,114,128,0.12)', border: 'rgba(107,114,128,0.3)' },
  deployed: { label: 'Deployed', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.3)' },
  waiting:  { label: 'Waiting',  color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.3)' },
  expired:  { label: 'Expired',  color: '#6b7280', bg: 'rgba(107,114,128,0.12)', border: 'rgba(107,114,128,0.3)' },
};

const KIND_LABEL: Record<SessionKind, string> = {
  futures: 'Futures',
  equity: 'Equity',
  options: 'Options',
};

export function PaperSessionHistoryPanel({ strategyId, strategyName, onSelectSession, onBack }: Props) {
  const [sessions, setSessions] = useState<UnifiedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.allSettled([
      futuresApi.listFuturesPaperSessions(strategyId),
      alpacaApi.listAlpacaPaperSessions(strategyId),
      alpacaApi.listOptionsPaperSessions(strategyId),
    ]).then(([futuresRes, alpacaRes, optionsRes]) => {
      if (cancelled) return;
      const all: UnifiedSession[] = [];
      if (futuresRes.status === 'fulfilled') all.push(...futuresRes.value.sessions.map(normalizeFutures));
      if (alpacaRes.status === 'fulfilled') all.push(...alpacaRes.value.sessions.map(normalizeAlpaca));
      if (optionsRes.status === 'fulfilled') all.push(...optionsRes.value.sessions.map(normalizeOptions));
      all.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      setSessions(all);
    }).catch(err => {
      if (!cancelled) setError(err?.message ?? 'Failed to load sessions');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [strategyId]);

  const activeSessions = sessions.filter(s => s.status === 'running' || s.status === 'paused' || s.status === 'waiting');
  const pastSessions = sessions.filter(s => s.status !== 'running' && s.status !== 'paused' && s.status !== 'waiting');

  return (
    <div className="psh-panel">
      <div className="psh-header">
        <div className="psh-header-left">
          <button className="psh-back-btn" onClick={onBack} title="Back">&larr;</button>
          <div>
            <h2>{strategyName ?? 'Strategy'}</h2>
            <span className="psh-subtitle">Paper Trading Sessions &middot; {sessions.length} total</span>
          </div>
        </div>
      </div>

      {loading && (
        <div className="psh-loading">
          <div className="psh-spinner" />
          <span>Loading paper sessions...</span>
        </div>
      )}

      {error && (
        <div className="psh-error"><span>&#9888;</span> {error}</div>
      )}

      {!loading && !error && sessions.length === 0 && (
        <div className="psh-empty">
          <div className="psh-empty-icon">&#128640;</div>
          <h3>No paper sessions yet</h3>
          <p>Deploy a backtest to paper trading to see sessions here.</p>
        </div>
      )}

      {!loading && activeSessions.length > 0 && (
        <div className="psh-section">
          <h3 className="psh-section-title">
            <span className="psh-dot psh-dot-active" />
            Active Sessions
          </h3>
          <div className="psh-list">
            {activeSessions.map(s => (
              <SessionCard key={s._id} session={s} onClick={() => onSelectSession(s._id, s.kind)} />
            ))}
          </div>
        </div>
      )}

      {!loading && pastSessions.length > 0 && (
        <div className="psh-section">
          <h3 className="psh-section-title">Past Sessions</h3>
          <div className="psh-list">
            {pastSessions.map(s => (
              <SessionCard key={s._id} session={s} onClick={() => onSelectSession(s._id, s.kind)} />
            ))}
          </div>
        </div>
      )}

      <style>{panelStyles}</style>
    </div>
  );
}

function SessionCard({ session: s, onClick }: { session: UnifiedSession; onClick: () => void }) {
  const statusCfg = STATUS_CONFIG[s.status] ?? STATUS_CONFIG.stopped;
  const isActive = s.status === 'running' || s.status === 'paused' || s.status === 'waiting';
  const pnlPositive = s.pnl >= 0;

  return (
    <button className={`psh-card ${isActive ? 'psh-card-active' : ''}`} onClick={onClick}>
      <div className="psh-card-top">
        <div className="psh-card-meta">
          <span
            className="psh-status-badge"
            style={{ color: statusCfg.color, background: statusCfg.bg, borderColor: statusCfg.border }}
          >
            {isActive && <span className="psh-pulse" style={{ background: statusCfg.color }} />}
            {statusCfg.label}
          </span>
          <span className="psh-kind-badge">{KIND_LABEL[s.kind]}</span>
          {s.versionLabel && <span className="psh-version-badge">{s.versionLabel}</span>}
          <span className="psh-card-time">{timeAgo(s.startedAt)}</span>
        </div>
        <span className={`psh-pnl ${pnlPositive ? 'positive' : 'negative'}`}>
          {pnlPositive ? '+' : ''}{s.pnl >= 1000 || s.pnl <= -1000
            ? `$${(s.pnl / 1000).toFixed(1)}k`
            : `$${s.pnl.toFixed(2)}`}
        </span>
      </div>

      <div className="psh-card-metrics">
        <div className="psh-metric">
          <span className="psh-metric-label">Symbol</span>
          <span className="psh-metric-value">{s.symbol}</span>
        </div>
        <div className="psh-metric">
          <span className="psh-metric-label">Equity</span>
          <span className="psh-metric-value">${s.equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        </div>
        <div className="psh-metric">
          <span className="psh-metric-label">Daily P&L</span>
          <span className={`psh-metric-value ${s.dailyPnl >= 0 ? 'positive' : 'negative'}`}>
            {s.dailyPnl >= 0 ? '+' : ''}${s.dailyPnl.toFixed(2)}
          </span>
        </div>
      </div>

      {s.endedAt && (
        <div className="psh-card-footer">
          <span>Ended {timeAgo(s.endedAt)}</span>
        </div>
      )}
    </button>
  );
}

const panelStyles = `
  .psh-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0a0a0f;
    color: #e5e5e5;
    padding: 1.5rem;
    overflow-y: auto;
  }

  .psh-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .psh-header-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .psh-back-btn {
    background: transparent;
    border: 1px solid #333;
    color: #9ca3af;
    width: 2rem;
    height: 2rem;
    border-radius: 0.5rem;
    cursor: pointer;
    font-size: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }
  .psh-back-btn:hover { border-color: #666; color: #e5e5e5; }

  .psh-header h2 {
    margin: 0;
    font-size: 1.25rem;
    background: linear-gradient(90deg, #e5e5e5, #9ca3af);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .psh-subtitle {
    font-size: 0.8rem;
    color: #6b7280;
  }

  .psh-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 3rem 1rem;
    color: #6b7280;
    font-size: 0.9rem;
  }

  .psh-spinner {
    width: 1.25rem;
    height: 1.25rem;
    border: 2px solid rgba(255,255,255,0.1);
    border-top-color: #10b981;
    border-radius: 50%;
    animation: psh-spin 0.8s linear infinite;
  }
  @keyframes psh-spin { to { transform: rotate(360deg); } }

  .psh-error {
    padding: 0.75rem 1rem;
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 0.5rem;
    color: #f87171;
    font-size: 0.85rem;
  }

  .psh-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 1rem;
    text-align: center;
    color: #6b7280;
  }
  .psh-empty-icon { font-size: 3rem; margin-bottom: 1rem; opacity: 0.5; }
  .psh-empty h3 { margin: 0 0 0.5rem; color: #9ca3af; font-size: 1.1rem; }
  .psh-empty p { margin: 0; font-size: 0.85rem; }

  .psh-section {
    margin-bottom: 1.5rem;
  }

  .psh-section-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 0.75rem;
    font-size: 0.85rem;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
  }

  .psh-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: #6b7280;
  }
  .psh-dot-active {
    background: #10b981;
    box-shadow: 0 0 6px rgba(16, 185, 129, 0.5);
  }

  .psh-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .psh-card {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.85rem 1rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 0.75rem;
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
    width: 100%;
    color: inherit;
    font-family: inherit;
    font-size: inherit;
  }
  .psh-card:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(16, 185, 129, 0.3);
    transform: translateY(-1px);
  }
  .psh-card-active {
    border-color: rgba(16, 185, 129, 0.15);
  }

  .psh-card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .psh-card-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .psh-status-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.12rem 0.5rem;
    border-radius: 1rem;
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border: 1px solid;
  }

  .psh-pulse {
    display: inline-block;
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    animation: psh-pulse-anim 2s ease-in-out infinite;
  }
  @keyframes psh-pulse-anim {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .psh-kind-badge {
    padding: 0.1rem 0.4rem;
    border-radius: 0.25rem;
    font-size: 0.6rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background: rgba(255, 255, 255, 0.06);
    color: #9ca3af;
  }

  .psh-version-badge {
    padding: 0.1rem 0.4rem;
    border-radius: 0.25rem;
    font-size: 0.6rem;
    font-weight: 700;
    font-family: monospace;
    background: rgba(139, 92, 246, 0.12);
    color: #a78bfa;
    border: 1px solid rgba(139, 92, 246, 0.25);
  }

  .psh-card-time {
    font-size: 0.75rem;
    color: #6b7280;
  }

  .psh-pnl {
    font-size: 1.15rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .psh-pnl.positive { color: #10b981; }
  .psh-pnl.negative { color: #ef4444; }

  .psh-card-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }

  .psh-metric {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .psh-metric-label {
    font-size: 0.6rem;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .psh-metric-value {
    font-size: 0.85rem;
    font-weight: 600;
    color: #d1d5db;
    font-variant-numeric: tabular-nums;
  }
  .psh-metric-value.positive { color: #10b981; }
  .psh-metric-value.negative { color: #ef4444; }

  .psh-card-footer {
    font-size: 0.7rem;
    color: #6b7280;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
    padding-top: 0.4rem;
  }
`;

export default PaperSessionHistoryPanel;
