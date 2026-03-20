import { useState, useEffect } from 'react';
import { apiClient } from '../../api';

type Strategy = {
  id: string;
  _id?: string;
  name: string;
  version: string;
  status: 'draft' | 'backtesting' | 'paper_trading' | 'live' | 'paused' | 'archived';
  type: string;
  metrics?: {
    sharpe?: number;
    return?: number;
    maxDrawdown?: number;
    winRate?: number;
  };
  paperTradingDays?: number;
  lastUpdated: string;
  created_by?: string;
};

type Props = {
  onSelectStrategy?: (strategy: Strategy) => void;
  onCreateNew?: () => void;
  refreshKey?: number;
};

const STATUS_CONFIG = {
  draft: { label: 'Draft', color: '#6b7280', icon: '📝' },
  backtesting: { label: 'Backtesting', color: '#f59e0b', icon: '🔬' },
  paper_trading: { label: 'Paper Trading', color: '#3b82f6', icon: '📊' },
  live: { label: 'Live', color: '#10b981', icon: '🔥' },
  paused: { label: 'Paused', color: '#ef4444', icon: '⏸️' },
  archived: { label: 'Archived', color: '#374151', icon: '📦' },
};

function mapStrategyStatus(raw: string): Strategy['status'] {
  if (raw === 'development') return 'draft';
  if (raw === 'validated') return 'backtesting';
  if (raw === 'failed') return 'paused';
  if (raw === 'paper_trading' || raw === 'backtesting' || raw === 'live' || raw === 'paused' || raw === 'archived') {
    return raw;
  }
  return 'draft';
}

function StrategyCard({ strategy, onClick, onArchive, onDelete, onUnarchive }: {
  strategy: Strategy;
  onClick?: () => void;
  onArchive?: (id: string) => void;
  onDelete?: (id: string) => void;
  onUnarchive?: (id: string) => void;
}) {
  const config = STATUS_CONFIG[strategy.status];

  return (
    <div className="strategy-card" onClick={onClick}>
      <div className="strategy-header">
        <span className="strategy-icon">{config.icon}</span>
        <div className="strategy-title">
          <h4>{strategy.name}</h4>
          <span className="strategy-version">{strategy.version}</span>
        </div>
        <div className="strategy-actions" onClick={e => e.stopPropagation()}>
          {strategy.status === 'archived' ? (
            <button className="action-btn action-unarchive" title="Unarchive" onClick={() => onUnarchive?.(strategy.id)}>
              &#8634;
            </button>
          ) : (
            <button className="action-btn action-archive" title="Archive" onClick={() => onArchive?.(strategy.id)}>
              &#128230;
            </button>
          )}
          <button className="action-btn action-delete" title="Delete permanently" onClick={() => onDelete?.(strategy.id)}>
            &#128465;
          </button>
        </div>
      </div>

      <div className="strategy-status" style={{ backgroundColor: `${config.color}20`, color: config.color }}>
        {config.label}
      </div>

      <div className="strategy-type">{strategy.type}</div>

      {strategy.metrics && (
        <div className="strategy-metrics">
          {strategy.metrics.sharpe && (
            <div className="metric">
              <span className="metric-label">Sharpe</span>
              <span className="metric-value">{strategy.metrics.sharpe.toFixed(2)}</span>
            </div>
          )}
          {strategy.metrics.return && (
            <div className="metric">
              <span className="metric-label">Return</span>
              <span className={`metric-value ${strategy.metrics.return >= 0 ? 'positive' : 'negative'}`}>
                {strategy.metrics.return >= 0 ? '+' : ''}{strategy.metrics.return.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}

      {strategy.status === 'paper_trading' && strategy.paperTradingDays && (
        <div className="paper-trading-progress">
          <span className="progress-label">Day {strategy.paperTradingDays}/15</span>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${(strategy.paperTradingDays / 15) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="strategy-footer">
        <span className="last-updated">
          Updated {new Date(strategy.lastUpdated).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}

export function StrategyListPanel({ onSelectStrategy, onCreateNew, refreshKey = 0 }: Props) {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'pipeline' | 'list'>('pipeline');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [internalRefresh, setInternalRefresh] = useState(0);

  const handleArchive = async (id: string) => {
    try {
      await apiClient.post(`/api/lab/strategy/${id}/archive`);
      setInternalRefresh(prev => prev + 1);
    } catch (err: any) {
      alert(`Failed to archive: ${err?.message ?? 'Unknown error'}`);
    }
  };

  const handleUnarchive = async (id: string) => {
    try {
      await apiClient.post(`/api/lab/strategy/${id}/unarchive`);
      setInternalRefresh(prev => prev + 1);
    } catch (err: any) {
      alert(`Failed to unarchive: ${err?.message ?? 'Unknown error'}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Permanently delete this strategy and all its versions? This cannot be undone.')) return;
    try {
      await apiClient.delete(`/api/lab/strategy/${id}`);
      setInternalRefresh(prev => prev + 1);
    } catch (err: any) {
      alert(`Failed to delete: ${err?.message ?? 'Unknown error'}`);
    }
  };

  useEffect(() => {
    const fetchStrategies = async () => {
      try {
        setLoading(true);
        const response = await apiClient.get('/api/lab/strategies');
        const data = Array.isArray(response.data) ? response.data : [];
        const mapped: Strategy[] = data.map((item: any) => ({
          id: String(item._id ?? item.id),
          _id: String(item._id ?? item.id),
          name: item.name ?? 'Unnamed Strategy',
          version: item.version ?? 'v1.0',
          status: mapStrategyStatus(String(item.status ?? 'draft')),
          type: String(item.strategyType ?? 'custom'),
          metrics: item.backtestResults?.metrics
            ? {
                sharpe: item.backtestResults.metrics.sharpeRatio,
                return: (item.backtestResults.metrics.expectedValue ?? 0) * 100,
                maxDrawdown: (item.backtestResults.metrics.drawdown ?? 0) * -100,
                winRate: (item.backtestResults.metrics.winRate ?? 0) * 100
              }
            : undefined,
          paperTradingDays: item.paperTradingDays ?? undefined,
          lastUpdated: item.updatedAt ?? item.createdAt ?? new Date().toISOString(),
          created_by: item.ownerId
        }));
        setStrategies(mapped);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch strategies:', error);
        setLoading(false);
      }
    };

    fetchStrategies();
  }, [refreshKey, internalRefresh]);

  const pipelineStages = ['draft', 'backtesting', 'paper_trading', 'live'];

  const getStrategiesByStatus = (status: string) => {
    return strategies.filter(s => s.status === status);
  };

  const filteredStrategies = filterStatus === 'all'
    ? strategies
    : strategies.filter(s => s.status === filterStatus);

  if (loading) {
    return (
      <div className="strategy-list-panel">
        <div className="loading-state">
          <div className="loading-spinner" />
          <p>Loading strategies...</p>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className="strategy-list-panel">
      <div className="panel-header">
        <div className="header-left">
          <h2>📋 My Strategies</h2>
          <span className="strategy-count">{strategies.length} strategies</span>
        </div>
        <div className="header-right">
          <div className="view-toggle">
            <button
              className={viewMode === 'pipeline' ? 'active' : ''}
              onClick={() => setViewMode('pipeline')}
            >
              Pipeline
            </button>
            <button
              className={viewMode === 'list' ? 'active' : ''}
              onClick={() => setViewMode('list')}
            >
              List
            </button>
          </div>
          <button className="create-btn" onClick={onCreateNew}>
            <span>+</span> New Strategy
          </button>
        </div>
      </div>

      {viewMode === 'pipeline' ? (
        <div className="pipeline-view">
          {pipelineStages.map(stage => {
            const stageStrategies = getStrategiesByStatus(stage);
            const config = STATUS_CONFIG[stage as keyof typeof STATUS_CONFIG];

            return (
              <div key={stage} className="pipeline-column">
                <div className="column-header">
                  <span className="column-icon">{config.icon}</span>
                  <span className="column-title">{config.label}</span>
                  <span className="column-count">{stageStrategies.length}</span>
                </div>
                <div className="column-content">
                  {stageStrategies.map(strategy => (
                    <StrategyCard
                      key={strategy.id}
                      strategy={strategy}
                      onClick={() => onSelectStrategy?.(strategy)}
                      onArchive={handleArchive}
                      onDelete={handleDelete}
                      onUnarchive={handleUnarchive}
                    />
                  ))}
                  {stageStrategies.length === 0 && (
                    <div className="empty-column">
                      <span>No strategies</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="list-view">
          <div className="list-filters">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="all">All Statuses</option>
              {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                <option key={key} value={key}>{config.label}</option>
              ))}
            </select>
          </div>
          <div className="strategy-list">
            {filteredStrategies.map(strategy => (
              <StrategyCard
                key={strategy.id}
                strategy={strategy}
                onClick={() => onSelectStrategy?.(strategy)}
                onArchive={handleArchive}
                onDelete={handleDelete}
                onUnarchive={handleUnarchive}
              />
            ))}
          </div>
        </div>
      )}

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .strategy-list-panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg-base, #060810);
    color: var(--text-primary, #f0f2f5);
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.25rem 1.75rem;
    border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.875rem;
  }

  .header-left h2 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .strategy-count {
    color: var(--text-tertiary, #555d73);
    font-size: 0.8rem;
    background: rgba(255,255,255,0.04);
    padding: 0.2rem 0.625rem;
    border-radius: 10px;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .view-toggle {
    display: flex;
    background: var(--bg-raised, #111420);
    border-radius: 8px;
    padding: 3px;
    border: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
  }

  .view-toggle button {
    padding: 0.375rem 0.875rem;
    border: none;
    background: transparent;
    color: var(--text-secondary, #8b92a5);
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 500;
    transition: all var(--transition-fast, 150ms);
  }

  .view-toggle button.active {
    background: var(--accent-muted, rgba(16,185,129,0.12));
    color: var(--accent, #10b981);
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }

  .view-toggle button:hover:not(.active) {
    color: var(--text-primary, #f0f2f5);
    background: rgba(255,255,255,0.04);
  }

  .create-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1.125rem;
    background: var(--accent, #10b981);
    border: none;
    border-radius: 8px;
    color: white;
    font-weight: 600;
    font-size: 0.8125rem;
    cursor: pointer;
    transition: all var(--transition-fast, 150ms);
    letter-spacing: 0.01em;
  }

  .create-btn:hover {
    background: var(--accent-hover, #34d399);
    box-shadow: var(--shadow-glow, 0 0 20px rgba(16,185,129,0.15));
    transform: translateY(-1px);
  }

  .pipeline-view {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.875rem;
    padding: 1.25rem 1.75rem;
    flex: 1;
    overflow: auto;
  }

  .pipeline-column {
    background: var(--bg-surface, #0c0e18);
    border-radius: var(--radius-lg, 14px);
    border: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
    display: flex;
    flex-direction: column;
    min-width: 260px;
  }

  .column-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.875rem 1rem;
    border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
  }

  .column-icon {
    font-size: 0.9rem;
  }

  .column-title {
    font-weight: 600;
    font-size: 0.8125rem;
    flex: 1;
    color: var(--text-primary, #f0f2f5);
  }

  .column-count {
    background: rgba(255, 255, 255, 0.06);
    padding: 0.125rem 0.5rem;
    border-radius: 10px;
    font-size: 0.7rem;
    color: var(--text-secondary, #8b92a5);
    font-weight: 600;
  }

  .column-content {
    flex: 1;
    padding: 0.625rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    overflow-y: auto;
  }

  .empty-column {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 80px;
    color: var(--text-tertiary, #555d73);
    font-size: 0.8rem;
    border: 1px dashed rgba(255, 255, 255, 0.08);
    border-radius: var(--radius-md, 10px);
    margin: 0.25rem;
  }

  .strategy-card {
    background: var(--bg-raised, #111420);
    border: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
    border-radius: var(--radius-md, 10px);
    padding: 0.875rem;
    cursor: pointer;
    transition: all var(--transition-fast, 150ms);
  }

  .strategy-card:hover {
    border-color: rgba(16, 185, 129, 0.25);
    background: var(--bg-overlay, #161a28);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(16,185,129,0.05);
    transform: translateY(-1px);
  }

  .strategy-header {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    margin-bottom: 0.625rem;
  }

  .strategy-icon {
    font-size: 1.1rem;
  }

  .strategy-actions {
    display: flex;
    gap: 0.25rem;
    margin-left: auto;
    opacity: 0;
    transition: opacity var(--transition-fast, 150ms);
  }

  .strategy-card:hover .strategy-actions {
    opacity: 1;
  }

  .action-btn {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 5px;
    color: var(--text-secondary, #8b92a5);
    cursor: pointer;
    font-size: 0.7rem;
    padding: 0.2rem 0.375rem;
    line-height: 1;
    transition: all var(--transition-fast, 150ms);
  }

  .action-btn:hover { background: rgba(255, 255, 255, 0.08); }
  .action-delete:hover { color: var(--danger, #f43f5e); border-color: rgba(244,63,94,0.3); }
  .action-archive:hover { color: var(--warning, #f59e0b); border-color: rgba(245,158,11,0.3); }
  .action-unarchive:hover { color: var(--accent, #10b981); border-color: rgba(16,185,129,0.3); }

  .strategy-title {
    flex: 1;
    min-width: 0;
  }

  .strategy-title h4 {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary, #f0f2f5);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .strategy-version {
    color: var(--text-tertiary, #555d73);
    font-size: 0.7rem;
  }

  .strategy-status {
    display: inline-block;
    padding: 0.2rem 0.5rem;
    border-radius: 5px;
    font-size: 0.65rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .strategy-type {
    color: var(--text-secondary, #8b92a5);
    font-size: 0.75rem;
    margin-bottom: 0.625rem;
  }

  .strategy-metrics {
    display: flex;
    gap: 0.875rem;
    margin-bottom: 0.625rem;
    padding: 0.5rem 0;
    border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
  }

  .metric {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .metric-label {
    color: var(--text-tertiary, #555d73);
    font-size: 0.625rem;
    text-transform: uppercase;
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  .metric-value {
    font-weight: 700;
    font-size: 0.85rem;
    color: var(--text-primary, #f0f2f5);
  }

  .metric-value.positive { color: var(--accent, #10b981); }
  .metric-value.negative { color: var(--danger, #f43f5e); }

  .paper-trading-progress {
    margin-bottom: 0.625rem;
  }

  .progress-label {
    font-size: 0.7rem;
    color: var(--text-secondary, #8b92a5);
    display: block;
    margin-bottom: 0.375rem;
    font-weight: 500;
  }

  .progress-bar {
    height: 3px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--info, #3b82f6), var(--accent, #10b981));
    border-radius: 2px;
    transition: width var(--transition-smooth, 300ms);
  }

  .strategy-footer {
    border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
    padding-top: 0.5rem;
    margin-top: 0.375rem;
  }

  .last-updated {
    color: var(--text-tertiary, #555d73);
    font-size: 0.65rem;
  }

  .list-view {
    flex: 1;
    padding: 1.25rem 1.75rem;
    overflow-y: auto;
  }

  .list-filters {
    margin-bottom: 1rem;
  }

  .list-filters select {
    padding: 0.5rem 1rem;
    background: var(--bg-raised, #111420);
    border: 1px solid var(--border-default, rgba(255,255,255,0.09));
    border-radius: 8px;
    color: var(--text-primary, #f0f2f5);
    font-size: 0.8rem;
    cursor: pointer;
    transition: border-color var(--transition-fast, 150ms);
  }

  .list-filters select:focus {
    outline: none;
    border-color: var(--accent, #10b981);
  }

  .strategy-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.875rem;
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 240px;
    color: var(--text-tertiary, #555d73);
    gap: 0.75rem;
  }

  .loading-spinner {
    width: 28px;
    height: 28px;
    border: 2px solid rgba(16, 185, 129, 0.15);
    border-top-color: var(--accent, #10b981);
    border-radius: 50%;
    animation: slp-spin 0.8s linear infinite;
  }

  @keyframes slp-spin {
    to { transform: rotate(360deg); }
  }
`;

export default StrategyListPanel;
