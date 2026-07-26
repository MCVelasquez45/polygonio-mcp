import { http } from './http';

export type SystemStatusResponse = {
  status: 'RUNNING' | 'DEGRADED' | 'BLOCKED' | 'STOPPED';
  generatedAt: string;
  summary: string;
  system: {
    mongo: string;
    automation: string;
    scheduler: string;
    monitor: string;
    brokerTruthCurrent: boolean;
    mode: string | null;
    market: string | null;
    emergencyStop: string | null;
    nextEvaluationAt: string | null;
  };
  components: Array<{
    name: string;
    status: string;
    stale: boolean;
    staleReason: string | null;
    lastError: string | null;
  }>;
};

export type SystemMetricsResponse = {
  generatedAt: string;
  process: {
    uptimeSec: number;
    memoryRss: number;
    memoryHeapUsed: number;
    memoryHeapTotal: number;
  };
  marketData: {
    queueDepth: number;
    activeRequests: number;
    inflightDeduped: number;
    deduplicatedRequests: number;
    responseCacheEntries: number;
    chartFeeds: number;
  };
  automation: {
    schedulerState: string;
    monitorState: string;
    schedulerLastTickAt: string | null;
    monitorLastTickAt: string | null;
    schedulerSubmittedCount: number;
    schedulerSkipReasons: Record<string, number>;
  };
  autonomousTrading: Array<Record<string, unknown>>;
};

export async function getSystemStatus(): Promise<SystemStatusResponse> {
  const { data } = await http.get<SystemStatusResponse>('/api/system/status', {
    validateStatus: status => (status >= 200 && status < 300) || status === 503,
  });
  return data;
}

export async function getSystemMetrics(): Promise<SystemMetricsResponse> {
  const { data } = await http.get<SystemMetricsResponse>('/api/system/metrics');
  return data;
}

