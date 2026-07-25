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

type RuntimeHealth = {
  runtime?: {
    broker?: {
      adapterResolved?: boolean;
      streamState?: string;
      truthCurrent?: boolean;
      lastRestReconciliationAt?: string | null;
      unresolvedContradictions?: number;
    };
    mongo?: {
      connected?: boolean;
      readyState?: number;
      host?: string | null;
      name?: string | null;
    };
    market?: {
      queueDepth?: number;
      activeRequests?: number;
      inflightDeduped?: number;
      responseCacheEntries?: number;
      heartbeatAgeMs?: number | null;
      lastSnapshotAt?: string | null;
      lastOptionTickAt?: string | null;
      lastOptionTradeAt?: string | null;
    };
    ai?: {
      status?: string;
      agentReachable?: boolean | null;
      openaiConfigured?: boolean;
      latencyMs?: number | null;
      checkedAt?: string | null;
      error?: string | null;
    };
    automation?: {
      ready?: boolean;
      heartbeat?: {
        schedulerAgeMs?: number | null;
        monitorAgeMs?: number | null;
      };
      scheduler?: {
        state?: string;
        lastTickAt?: string | null;
        candidateCount?: number | null;
        watchlistCount?: number | null;
      };
      monitor?: {
        state?: string;
        lastTickAt?: string | null;
        positionsMonitored?: number;
        exitsTriggered?: number;
      };
      recentDecisions?: Array<{
        automationSessionId?: string;
        evaluated?: boolean;
        skippedReason?: string | null;
        approvedIntentId?: string | null;
        windowKey?: string;
      }>;
    };
  };
};

function formatMsAgo(ms: number | null): string {
  if (ms == null) return 'N/A';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return 'N/A';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleTimeString();
}

function compactBool(value: boolean | null | undefined): string {
  if (value === true) return 'YES';
  if (value === false) return 'NO';
  return 'N/A';
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

function RuntimeCard({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="runtime-card">
      <div className="runtime-title">{title}</div>
      <div className="runtime-rows">
        {rows.map(([label, value]) => (
          <div className="runtime-row" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DataHealthPanel({ apiBase = getApiBaseUrl(), refreshIntervalMs = 5000 }: Props) {
  const [metrics, setMetrics] = useState<HealthMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [systemHealth, setSystemHealth] = useState<RuntimeHealth | null>(null);

  const fetchHealth = async () => {
    try {
      const [chartResponse, systemResponse] = await Promise.all([
        apiClient.get('/api/chart/health', { baseURL: apiBase }),
        apiClient.get('/api/system/health', { baseURL: apiBase, validateStatus: () => true }),
      ]);
      setMetrics(chartResponse.data.metrics ?? []);
      setSystemHealth(systemResponse.data ?? null);
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
  const runtime = systemHealth?.runtime;
  const recentDecisions = runtime?.automation?.recentDecisions?.slice(0, 3) ?? [];

  return (
    <div className="data-health-panel">
      <header className="panel-header">
        <div className="header-title">
          <h2>Data Health Monitor</h2>
          <p className="header-subtitle">Runtime telemetry from backend, broker, market data, AI, and automation.</p>
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
          Failed to fetch health data: {error}
        </div>
      )}

      <div className="runtime-grid">
        <RuntimeCard
          title="Broker"
          rows={[
            ['Adapter', compactBool(runtime?.broker?.adapterResolved)],
            ['Stream', runtime?.broker?.streamState ?? 'N/A'],
            ['Truth Current', compactBool(runtime?.broker?.truthCurrent)],
            ['REST Sync', formatTimestamp(runtime?.broker?.lastRestReconciliationAt)],
            ['Contradictions', String(runtime?.broker?.unresolvedContradictions ?? 0)],
          ]}
        />
        <RuntimeCard
          title="MongoDB"
          rows={[
            ['Connected', compactBool(runtime?.mongo?.connected)],
            ['Ready State', String(runtime?.mongo?.readyState ?? 'N/A')],
            ['Host', runtime?.mongo?.host ?? 'N/A'],
            ['DB', runtime?.mongo?.name ?? 'N/A'],
          ]}
        />
        <RuntimeCard
          title="Market"
          rows={[
            ['Queue Depth', String(runtime?.market?.queueDepth ?? 'N/A')],
            ['Active Requests', String(runtime?.market?.activeRequests ?? 'N/A')],
            ['Heartbeat', formatMsAgo(runtime?.market?.heartbeatAgeMs ?? null)],
            ['Last Snapshot', formatTimestamp(runtime?.market?.lastSnapshotAt)],
            ['Last Option Tick', formatTimestamp(runtime?.market?.lastOptionTickAt)],
            ['Last Trade', formatTimestamp(runtime?.market?.lastOptionTradeAt)],
          ]}
        />
        <RuntimeCard
          title="AI"
          rows={[
            ['Status', runtime?.ai?.status?.toUpperCase() ?? 'UNKNOWN'],
            ['Agent', compactBool(runtime?.ai?.agentReachable)],
            ['OpenAI', compactBool(runtime?.ai?.openaiConfigured)],
            ['Latency', runtime?.ai?.latencyMs == null ? 'N/A' : `${runtime.ai.latencyMs}ms`],
            ['Checked', formatTimestamp(runtime?.ai?.checkedAt)],
          ]}
        />
        <RuntimeCard
          title="Automation"
          rows={[
            ['Ready', compactBool(runtime?.automation?.ready)],
            ['Scheduler', runtime?.automation?.scheduler?.state ?? 'N/A'],
            ['Scheduler HB', formatMsAgo(runtime?.automation?.heartbeat?.schedulerAgeMs ?? null)],
            ['Monitor', runtime?.automation?.monitor?.state ?? 'N/A'],
            ['Monitor HB', formatMsAgo(runtime?.automation?.heartbeat?.monitorAgeMs ?? null)],
            ['Positions', String(runtime?.automation?.monitor?.positionsMonitored ?? 0)],
          ]}
        />
      </div>

      {recentDecisions.length > 0 && (
        <div className="recent-decisions">
          <div className="recent-title">Recent Decisions</div>
          {recentDecisions.map((decision, index) => (
            <div className="decision-row" key={`${decision.automationSessionId ?? 'session'}-${decision.windowKey ?? index}`}>
              <span>{decision.evaluated ? 'EVALUATED' : decision.skippedReason ?? 'SKIPPED'}</span>
              <span>{decision.approvedIntentId ? `Intent ${decision.approvedIntentId}` : decision.windowKey ?? 'N/A'}</span>
            </div>
          ))}
        </div>
      )}

      {loading && metrics.length === 0 ? (
        <div className="loading-state">Loading health metrics...</div>
      ) : metrics.length === 0 ? (
        <div className="empty-state">
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
                <div className="throttle-warning">Provider throttled</div>
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

        .runtime-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
          gap: 0.75rem;
          padding: 1rem;
          border-bottom: 1px solid #1e293b;
        }

        .runtime-card {
          border: 1px solid #1e293b;
          border-radius: 8px;
          background: #111a2b;
          padding: 0.85rem;
          min-width: 0;
        }

        .runtime-title {
          margin-bottom: 0.55rem;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #94a3b8;
        }

        .runtime-rows {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }

        .runtime-row,
        .decision-row {
          display: flex;
          justify-content: space-between;
          gap: 0.75rem;
          min-width: 0;
          font-size: 0.78rem;
          color: #94a3b8;
        }

        .runtime-row strong,
        .decision-row span:last-child {
          min-width: 0;
          overflow-wrap: anywhere;
          text-align: right;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 0.74rem;
          color: #e9edf6;
        }

        .recent-decisions {
          margin: 0 1rem 1rem;
          border: 1px solid #1e293b;
          border-radius: 8px;
          background: #020617;
          padding: 0.85rem;
        }

        .recent-title {
          margin-bottom: 0.5rem;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #94a3b8;
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
