import { useState, useEffect } from 'react';

type Strategy = {
  id: string;
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
};

const STATUS_CONFIG = {
  draft: { label: 'Draft', color: '#6b7280', icon: '📝' },
  backtesting: { label: 'Backtesting', color: '#f59e0b', icon: '🔬' },
  paper_trading: { label: 'Paper Trading', color: '#3b82f6', icon: '📊' },
  live: { label: 'Live', color: '#10b981', icon: '🔥' },
  paused: { label: 'Paused', color: '#ef4444', icon: '⏸️' },
  archived: { label: 'Archived', color: '#374151', icon: '📦' },
};

// Mock data for demonstration - replace with API call
const MOCK_STRATEGIES: Strategy[] = [
  {
    id: '1',
    name: 'VolArbitrage',
    version: 'v2.1',
    status: 'paper_trading',
    type: 'Volatility',
    metrics: { sharpe: 1.38, return: 12.45, maxDrawdown: -3.2, winRate: 62 },
    paperTradingDays: 12,
    lastUpdated: '2026-01-16T08:30:00Z',
  },
  {
    id: '2',
    name: 'MomentumScalper',
    version: 'v3.0',
    status: 'backtesting',
    type: 'Momentum',
    metrics: { sharpe: 1.42, return: 48.2, maxDrawdown: -15.8, winRate: 58 },
    lastUpdated: '2026-01-15T14:20:00Z',
  },
  {
    id: '3',
    name: 'MeanReversion',
    version: 'v1.5',
    status: 'live',
    type: 'Mean Reversion',
    metrics: { sharpe: 1.24, return: 8.5, maxDrawdown: -4.1, winRate: 55 },
    lastUpdated: '2026-01-16T09:00:00Z',
  },
  {
    id: '4',
    name: 'GammaScalp',
    version: 'v1.0',
    status: 'draft',
    type: '0-DTE Options',
    lastUpdated: '2026-01-14T10:00:00Z',
  },
  {
    id: '5',
    name: 'TrendFollower',
    version: 'v2.0',
    status: 'paused',
    type: 'Trend',
    metrics: { sharpe: 0.92, return: -2.1, maxDrawdown: -8.5, winRate: 48 },
    lastUpdated: '2026-01-13T16:00:00Z',
  },
];

function StrategyCard({ strategy, onClick }: { strategy: Strategy; onClick?: () => void }) {
  const config = STATUS_CONFIG[strategy.status];

  return (
    <div className="strategy-card" onClick={onClick}>
      <div className="strategy-header">
        <span className="strategy-icon">{config.icon}</span>
        <div className="strategy-title">
          <h4>{strategy.name}</h4>
          <span className="strategy-version">{strategy.version}</span>
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

export function StrategyListPanel({ onSelectStrategy, onCreateNew }: Props) {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'pipeline' | 'list'>('pipeline');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  useEffect(() => {
    // TODO: Replace with actual API call
    const fetchStrategies = async () => {
      try {
        // const response = await fetch('/api/lab/strategies');
        // const data = await response.json();
        // setStrategies(data);

        // Using mock data for now
        setTimeout(() => {
          setStrategies(MOCK_STRATEGIES);
          setLoading(false);
        }, 500);
      } catch (error) {
        console.error('Failed to fetch strategies:', error);
        setLoading(false);
      }
    };

    fetchStrategies();
  }, []);

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
    background: #0a0a0f;
    color: #e5e5e5;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .header-left h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .strategy-count {
    color: #6b7280;
    font-size: 0.875rem;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .view-toggle {
    display: flex;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 0.5rem;
    padding: 0.25rem;
  }

  .view-toggle button {
    padding: 0.5rem 1rem;
    border: none;
    background: transparent;
    color: #9ca3af;
    border-radius: 0.375rem;
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.15s ease;
  }

  .view-toggle button.active {
    background: rgba(16, 185, 129, 0.15);
    color: #10b981;
  }

  .view-toggle button:hover:not(.active) {
    color: #e5e5e5;
  }

  .create-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    border: none;
    border-radius: 0.5rem;
    color: white;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .create-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
  }

  .pipeline-view {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
    padding: 1.5rem;
    flex: 1;
    overflow-x: auto;
  }

  .pipeline-column {
    background: rgba(255, 255, 255, 0.02);
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    flex-direction: column;
    min-width: 280px;
  }

  .column-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .column-icon {
    font-size: 1rem;
  }

  .column-title {
    font-weight: 600;
    flex: 1;
  }

  .column-count {
    background: rgba(255, 255, 255, 0.1);
    padding: 0.125rem 0.5rem;
    border-radius: 1rem;
    font-size: 0.75rem;
    color: #9ca3af;
  }

  .column-content {
    flex: 1;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    overflow-y: auto;
  }

  .empty-column {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100px;
    color: #4b5563;
    font-size: 0.875rem;
    border: 2px dashed rgba(255, 255, 255, 0.1);
    border-radius: 0.5rem;
  }

  .strategy-card {
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.625rem;
    padding: 1rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .strategy-card:hover {
    border-color: rgba(16, 185, 129, 0.3);
    transform: translateY(-2px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  }

  .strategy-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .strategy-icon {
    font-size: 1.25rem;
  }

  .strategy-title {
    flex: 1;
  }

  .strategy-title h4 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .strategy-version {
    color: #6b7280;
    font-size: 0.75rem;
  }

  .strategy-status {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.7rem;
    font-weight: 500;
    margin-bottom: 0.5rem;
  }

  .strategy-type {
    color: #9ca3af;
    font-size: 0.8rem;
    margin-bottom: 0.75rem;
  }

  .strategy-metrics {
    display: flex;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }

  .metric {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .metric-label {
    color: #6b7280;
    font-size: 0.7rem;
    text-transform: uppercase;
  }

  .metric-value {
    font-weight: 600;
    font-size: 0.9rem;
  }

  .metric-value.positive {
    color: #10b981;
  }

  .metric-value.negative {
    color: #ef4444;
  }

  .paper-trading-progress {
    margin-bottom: 0.75rem;
  }

  .progress-label {
    font-size: 0.75rem;
    color: #9ca3af;
    display: block;
    margin-bottom: 0.25rem;
  }

  .progress-bar {
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #3b82f6 0%, #10b981 100%);
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .strategy-footer {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    padding-top: 0.5rem;
    margin-top: 0.5rem;
  }

  .last-updated {
    color: #6b7280;
    font-size: 0.7rem;
  }

  .list-view {
    flex: 1;
    padding: 1.5rem;
    overflow-y: auto;
  }

  .list-filters {
    margin-bottom: 1rem;
  }

  .list-filters select {
    padding: 0.5rem 1rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.5rem;
    color: #e5e5e5;
    font-size: 0.875rem;
  }

  .strategy-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 200px;
    color: #6b7280;
  }

  .loading-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid rgba(16, 185, 129, 0.2);
    border-top-color: #10b981;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 1rem;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;

export default StrategyListPanel;
