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

export function buildHealth(meta: HealthMeta | null, lastTimestamp: number | null): HealthState | null {
  if (!meta) return null;
  const lastUpdateMsAgo =
    typeof lastTimestamp === 'number' ? Math.max(0, Date.now() - lastTimestamp) : null;
  return {
    ...meta,
    lastUpdateMsAgo
  };
}
