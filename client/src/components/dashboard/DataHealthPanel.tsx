import { useState, useEffect } from 'react';
import { getApiBaseUrl } from '../../api/http';
import { apiClient } from '../../api';

type HealthMetric = {
  symbol: string;
  timeframe: string;
  mode: 'LIVE' | 'DEGRADED' | 'BACKFILLING' | 'FROZEN';
  source: 'ws' | 'rest' | 'cache' | 'snapshot';
  barCount: number;
  gapsDetected: number;
  lastUpdateMsAgo: number | null;
  anomalyCount: number;
  providerThrottled: boolean;
  qualityScore: number;
};

type Props = {
  apiBase?: string;
  refreshIntervalMs?: number;
};

function formatMsAgo(ms: number | null): string {
  if (ms == null) return 'N/A';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function getModeColor(mode: string): string {
  switch (mode) {
    case 'LIVE': return '#35d29a';      // intel-pos
    case 'DEGRADED': return '#fbbf24';  // intel-warn
    case 'BACKFILLING': return '#6aa5f5'; // intel-info
    case 'FROZEN': return '#64748b';    // intel-ink3
    default: return '#94a3b8';          // intel-ink2
  }
}

function getQualityColor(score: number): string {
  if (score >= 80) return '#35d29a';  // intel-pos
  if (score >= 60) return '#fbbf24';  // intel-warn
  return '#f87171';                   // intel-neg
}

export function DataHealthPanel({ apiBase = getApiBaseUrl(), refreshIntervalMs = 5000 }: Props) {
  const [metrics, setMetrics] = useState<HealthMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const fetchHealth = async () => {
    try {
      const { data } = await apiClient.get('/api/chart/health', {
        baseURL: apiBase
      });
      setMetrics(data.metrics ?? []);
      setError(null);
      setLastFetch(new Date());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [apiBase, refreshIntervalMs]);

  const averageScore = metrics.length > 0
    ? Math.round(metrics.reduce((sum, m) => sum + m.qualityScore, 0) / metrics.length)
    : 0;

  return (
    <div className="data-health-panel">
      <header className="panel-header">
        <div className="header-title">
          <h2>Data Health Monitor</h2>
          <p className="header-subtitle">Real-time chart data quality metrics</p>
        </div>
        <div className="header-stats">
          <div className="stat">
            <span className="stat-value">{metrics.length}</span>
            <span className="stat-label">Active Feeds</span>
          </div>
          <div className="stat">
            <span className="stat-value" style={{ color: getQualityColor(averageScore) }}>
              {averageScore}%
            </span>
            <span className="stat-label">Avg Quality</span>
          </div>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          ⚠️ Failed to fetch health data: {error}
        </div>
      )}

      {loading && metrics.length === 0 ? (
        <div className="loading-state">Loading health metrics...</div>
      ) : metrics.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">📊</span>
          <p>No active chart feeds</p>
          <span className="empty-hint">Open a chart to start monitoring</span>
        </div>
      ) : (
        <div className="metrics-grid">
          {metrics.map((metric, idx) => (
            <div key={`${metric.symbol}-${metric.timeframe}-${idx}`} className="metric-card">
              <div className="metric-header">
                <span className="metric-symbol">{metric.symbol}</span>
                <span className="metric-timeframe">{metric.timeframe}</span>
              </div>

              <div className="metric-badges">
                <span
                  className="badge mode-badge"
                  style={{ backgroundColor: getModeColor(metric.mode) + '20', color: getModeColor(metric.mode) }}
                >
                  {metric.mode}
                </span>
                <span className="badge source-badge">{metric.source.toUpperCase()}</span>
              </div>

              <div className="metric-stats">
                <div className="stat-row">
                  <span className="stat-key">Quality Score</span>
                  <span className="stat-val" style={{ color: getQualityColor(metric.qualityScore) }}>
                    {metric.qualityScore}%
                  </span>
                </div>
                <div className="stat-row">
                  <span className="stat-key">Last Update</span>
                  <span className="stat-val">{formatMsAgo(metric.lastUpdateMsAgo)}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-key">Bar Count</span>
                  <span className="stat-val">{metric.barCount}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-key">Gaps</span>
                  <span className="stat-val" style={{ color: metric.gapsDetected > 0 ? '#fbbf24' : 'inherit' }}>
                    {metric.gapsDetected}
                  </span>
                </div>
                {metric.anomalyCount > 0 && (
                  <div className="stat-row">
                    <span className="stat-key">Anomalies</span>
                    <span className="stat-val" style={{ color: '#f87171' }}>
                      {metric.anomalyCount}
                    </span>
                  </div>
                )}
              </div>

              {metric.providerThrottled && (
                <div className="throttle-warning">⚠️ Provider throttled</div>
              )}
            </div>
          ))}
        </div>
      )}

      {lastFetch && (
        <div className="panel-footer">
          Last updated: {lastFetch.toLocaleTimeString()}
        </div>
      )}

      <style>{`
        .data-health-panel {
          background: #0b1220;
          border-radius: 12px;
          border: 1px solid #1e293b;
          overflow: hidden;
        }

        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 1.5rem;
          border-bottom: 1px solid #1e293b;
        }

        .header-title h2 {
          margin: 0 0 0.25rem;
          font-size: 1.25rem;
          font-weight: 600;
          color: #e9edf6;
        }

        .header-subtitle {
          margin: 0;
          font-size: 0.85rem;
          color: #94a3b8;
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
          font-variant-numeric: tabular-nums;
          color: #e9edf6;
        }

        .stat-label {
          font-size: 0.75rem;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .error-banner {
          background: rgba(248, 113, 113, 0.1);
          border: 1px solid rgba(248, 113, 113, 0.4);
          color: #f87171;
          padding: 0.75rem 1rem;
          margin: 1rem;
          border-radius: 0.5rem;
          font-size: 0.85rem;
        }

        .loading-state, .empty-state {
          padding: 3rem;
          text-align: center;
          color: #94a3b8;
        }

        .empty-icon {
          font-size: 2.5rem;
          display: block;
          margin-bottom: 1rem;
        }

        .empty-hint {
          font-size: 0.8rem;
          color: #64748b;
        }

        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 1rem;
          padding: 1rem;
        }

        .metric-card {
          background: #111a2b;
          border: 1px solid #1e293b;
          border-radius: 12px;
          padding: 1rem;
        }

        .metric-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.75rem;
        }

        .metric-symbol {
          font-size: 1.1rem;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: #e9edf6;
        }

        .metric-timeframe {
          font-size: 0.8rem;
          color: #94a3b8;
          background: #020617;
          padding: 0.25rem 0.5rem;
          border-radius: 0.25rem;
        }

        .metric-badges {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }

        .badge {
          font-size: 0.7rem;
          font-weight: 600;
          padding: 0.25rem 0.5rem;
          border-radius: 0.25rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .source-badge {
          background: #020617;
          color: #94a3b8;
        }

        .metric-stats {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }

        .stat-row {
          display: flex;
          justify-content: space-between;
          font-size: 0.85rem;
        }

        .stat-key {
          color: #94a3b8;
        }

        .stat-val {
          font-weight: 500;
          font-variant-numeric: tabular-nums;
          color: #e9edf6;
        }

        .throttle-warning {
          margin-top: 0.75rem;
          font-size: 0.8rem;
          color: #fbbf24;
          background: rgba(251, 191, 36, 0.1);
          padding: 0.5rem;
          border-radius: 0.25rem;
          text-align: center;
        }

        .panel-footer {
          padding: 0.75rem 1rem;
          text-align: right;
          font-size: 0.75rem;
          color: #64748b;
          border-top: 1px solid #1e293b;
        }
      `}</style>
    </div>
  );
}
