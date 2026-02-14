export type HealthMode = 'LIVE' | 'DEGRADED' | 'BACKFILLING' | 'FROZEN';
export type HealthSource = 'ws' | 'rest' | 'cache' | 'snapshot';

export type HealthMeta = {
  mode: HealthMode;
  source: HealthSource;
  providerThrottled: boolean;
  gapsDetected: number;
};

export type HealthState = HealthMeta & {
  lastUpdateMsAgo: number | null;
};

/**
 * Extended metrics for data quality monitoring and dashboard display.
 */
export type DataQualityMetrics = {
  symbol: string;
  timeframe: string;
  mode: HealthMode;
  source: HealthSource;
  barCount: number;
  gapsDetected: number;
  lastUpdateMsAgo: number | null;
  lastTimestamp: number | null;
  anomalyCount: number;
  providerThrottled: boolean;
  updatedAt: number;
};

/**
 * Log entry for data quality events (gaps, anomalies, state changes).
 */
export type DataQualityLogEntry = {
  type: 'gap_detected' | 'anomaly' | 'mode_change' | 'throttled' | 'reconnected';
  symbol: string;
  timeframe: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: number;
};

// In-memory log buffer for recent events (last 100)
const MAX_LOG_ENTRIES = 100;
const dataQualityLog: DataQualityLogEntry[] = [];

export function logDataQualityEvent(entry: Omit<DataQualityLogEntry, 'timestamp'>) {
  const logEntry: DataQualityLogEntry = {
    ...entry,
    timestamp: Date.now()
  };
  dataQualityLog.push(logEntry);
  if (dataQualityLog.length > MAX_LOG_ENTRIES) {
    dataQualityLog.shift();
  }
  // Also log to console for debugging
  const prefix = `[ChartHealth:${entry.type}]`;
  console.log(prefix, entry.symbol, entry.timeframe, entry.message, entry.details ?? '');
}

export function getRecentDataQualityLogs(limit = 50): DataQualityLogEntry[] {
  return dataQualityLog.slice(-limit);
}

export function buildHealth(meta: HealthMeta | null, lastTimestamp: number | null): HealthState | null {
  if (!meta) return null;
  const lastUpdateMsAgo =
    typeof lastTimestamp === 'number' ? Math.max(0, Date.now() - lastTimestamp) : null;
  return {
    ...meta,
    lastUpdateMsAgo
  };
}

/**
 * Compute a quality score from 0-100 for a given health state.
 * Higher is better. Used for dashboard displays.
 */
export function computeQualityScore(metrics: DataQualityMetrics): number {
  let score = 100;

  // Deduct for mode
  if (metrics.mode === 'DEGRADED') score -= 30;
  else if (metrics.mode === 'BACKFILLING') score -= 15;
  else if (metrics.mode === 'FROZEN') score -= 10;

  // Deduct for staleness (more than 2 minutes is bad for live data)
  if (metrics.lastUpdateMsAgo != null) {
    if (metrics.lastUpdateMsAgo > 120_000) score -= 25;
    else if (metrics.lastUpdateMsAgo > 60_000) score -= 10;
  }

  // Deduct for gaps
  score -= Math.min(metrics.gapsDetected * 5, 20);

  // Deduct for anomalies
  score -= Math.min(metrics.anomalyCount * 3, 15);

  // Deduct for throttling
  if (metrics.providerThrottled) score -= 10;

  return Math.max(0, score);
}
