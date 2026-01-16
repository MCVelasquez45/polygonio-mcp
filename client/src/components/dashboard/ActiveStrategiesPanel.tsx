import { useState, useEffect } from 'react';

type Strategy = {
  _id: string;
  name: string;
  description?: string;
  strategyType: 'screener' | 'quant';
  status: 'active' | 'paused' | 'stopped';
  state?: {
    lastRun?: string;
  };
  runtimeConfig?: {
    symbols?: string[];
    maxCapital?: number;
  };
  createdAt: string;
};

type Props = {
  apiBase?: string;
  refreshIntervalMs?: number;
  onStrategyClick?: (strategy: Strategy) => void;
};

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'active': return '#10b981';
    case 'paused': return '#f59e0b';
    case 'stopped': return '#ef4444';
    default: return '#9ca3af';
  }
}

function getTypeIcon(type: string): string {
  return type === 'screener' ? '🔍' : '📈';
}

export function ActiveStrategiesPanel({ apiBase = 'http://localhost:4000', refreshIntervalMs = 10000, onStrategyClick }: Props) {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);

  const fetchStrategies = async () => {
    try {
      const res = await fetch(`${apiBase}/api/engine/strategies`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStrategies(data.strategies ?? []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const triggerStrategy = async (id: string) => {
    setTriggeringId(id);
    try {
      const res = await fetch(`${apiBase}/api/engine/strategies/${id}/trigger`, {
        method: 'POST'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Refresh strategies to get updated lastRun
      await fetchStrategies();
    } catch (err: any) {
      setError(`Trigger failed: ${err.message}`);
    } finally {
      setTriggeringId(null);
    }
  };

  const toggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    try {
      const res = await fetch(`${apiBase}/api/engine/strategies/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchStrategies();
    } catch (err: any) {
      setError(`Status update failed: ${err.message}`);
    }
  };

  useEffect(() => {
    fetchStrategies();
    const interval = setInterval(fetchStrategies, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [apiBase, refreshIntervalMs]);

  const activeCount = strategies.filter(s => s.status === 'active').length;
  const screenerCount = strategies.filter(s => s.strategyType === 'screener').length;

  return (
    <div className="strategies-panel">
      <header className="panel-header">
        <div className="header-title">
          <h2>Active Strategies</h2>
          <p className="header-subtitle">Engine-deployed trading strategies</p>
        </div>
        <div className="header-stats">
          <div className="stat">
            <span className="stat-value">{activeCount}</span>
            <span className="stat-label">Active</span>
          </div>
          <div className="stat">
            <span className="stat-value">{screenerCount}</span>
            <span className="stat-label">Screeners</span>
          </div>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          ⚠️ {error}
        </div>
      )}

      {loading && strategies.length === 0 ? (
        <div className="loading-state">Loading strategies...</div>
      ) : strategies.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">🎯</span>
          <p>No strategies deployed</p>
          <span className="empty-hint">Create a strategy in Lab and request handoff</span>
        </div>
      ) : (
        <div className="strategies-list">
          {strategies.map(strategy => (
            <div
              key={strategy._id}
              className="strategy-card"
              onClick={() => onStrategyClick?.(strategy)}
            >
              <div className="strategy-header">
                <div className="strategy-title">
                  <span className="type-icon">{getTypeIcon(strategy.strategyType)}</span>
                  <span className="strategy-name">{strategy.name}</span>
                </div>
                <span
                  className="status-badge"
                  style={{
                    backgroundColor: getStatusColor(strategy.status) + '20',
                    color: getStatusColor(strategy.status)
                  }}
                >
                  {strategy.status}
                </span>
              </div>

              {strategy.description && (
                <p className="strategy-desc">{strategy.description}</p>
              )}

              <div className="strategy-meta">
                {strategy.runtimeConfig?.symbols && (
                  <div className="meta-item">
                    <span className="meta-label">Symbols</span>
                    <span className="meta-value">{strategy.runtimeConfig.symbols.join(', ')}</span>
                  </div>
                )}
                <div className="meta-item">
                  <span className="meta-label">Last Run</span>
                  <span className="meta-value">{formatDate(strategy.state?.lastRun)}</span>
                </div>
              </div>

              <div className="strategy-actions">
                {strategy.strategyType === 'screener' && (
                  <button
                    type="button"
                    className="action-btn trigger-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerStrategy(strategy._id);
                    }}
                    disabled={triggeringId === strategy._id || strategy.status !== 'active'}
                  >
                    {triggeringId === strategy._id ? '⏳ Running...' : '▶️ Trigger'}
                  </button>
                )}
                <button
                  type="button"
                  className="action-btn toggle-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleStatus(strategy._id, strategy.status);
                  }}
                >
                  {strategy.status === 'active' ? '⏸ Pause' : '▶️ Resume'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .strategies-panel {
          background: #111118;
          border-radius: 1rem;
          border: 1px solid rgba(255, 255, 255, 0.06);
          overflow: hidden;
        }

        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 1.5rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }

        .header-title h2 {
          margin: 0 0 0.25rem;
          font-size: 1.25rem;
          font-weight: 600;
        }

        .header-subtitle {
          margin: 0;
          font-size: 0.85rem;
          color: #9ca3af;
        }

        .header-stats {
          display: flex;
          gap: 2rem;
        }

        .stat {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
        }

        .stat-value {
          font-size: 1.5rem;
          font-weight: 700;
          color: #10b981;
        }

        .stat-label {
          font-size: 0.75rem;
          color: #9ca3af;
          text-transform: uppercase;
        }

        .error-banner {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: #fca5a5;
          padding: 0.75rem 1rem;
          margin: 1rem;
          border-radius: 0.5rem;
          font-size: 0.85rem;
        }

        .loading-state, .empty-state {
          padding: 3rem;
          text-align: center;
          color: #9ca3af;
        }

        .empty-icon {
          font-size: 2.5rem;
          display: block;
          margin-bottom: 1rem;
        }

        .empty-hint {
          font-size: 0.8rem;
          color: #6b7280;
        }

        .strategies-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          padding: 1rem;
        }

        .strategy-card {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 0.75rem;
          padding: 1rem;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .strategy-card:hover {
          border-color: rgba(16, 185, 129, 0.3);
          background: rgba(255, 255, 255, 0.03);
        }

        .strategy-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
        }

        .strategy-title {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .type-icon {
          font-size: 1.1rem;
        }

        .strategy-name {
          font-size: 1rem;
          font-weight: 600;
        }

        .status-badge {
          font-size: 0.7rem;
          font-weight: 600;
          padding: 0.25rem 0.5rem;
          border-radius: 0.25rem;
          text-transform: uppercase;
        }

        .strategy-desc {
          margin: 0 0 0.75rem;
          font-size: 0.85rem;
          color: #9ca3af;
        }

        .strategy-meta {
          display: flex;
          gap: 1.5rem;
          margin-bottom: 0.75rem;
        }

        .meta-item {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }

        .meta-label {
          font-size: 0.7rem;
          color: #6b7280;
          text-transform: uppercase;
        }

        .meta-value {
          font-size: 0.85rem;
          font-weight: 500;
        }

        .strategy-actions {
          display: flex;
          gap: 0.5rem;
          padding-top: 0.75rem;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }

        .action-btn {
          flex: 1;
          padding: 0.5rem 0.75rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 0.5rem;
          background: transparent;
          color: #e5e5e5;
          font-size: 0.8rem;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .action-btn:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.05);
        }

        .action-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .trigger-btn:hover:not(:disabled) {
          border-color: rgba(16, 185, 129, 0.4);
          color: #10b981;
        }
      `}</style>
    </div>
  );
}
