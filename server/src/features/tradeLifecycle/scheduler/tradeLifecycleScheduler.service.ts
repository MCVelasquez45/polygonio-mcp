import { randomUUID } from 'crypto';
import { syncTradeLifecycle } from '../positionManager/lifecycleOwner.service';
import { getTradeLifecycleFlags, getTradeLifecycleScheduleMs } from '../types/config';

type Runtime = {
  state: 'STOPPED' | 'ACTIVE' | 'STOPPING';
  ownerId: string | null;
  timer: ReturnType<typeof setInterval> | null;
  startedAt: Date | null;
  lastTickAt: Date | null;
  lastError: string | null;
  lastResult: unknown;
};

const runtime: Runtime = {
  state: 'STOPPED',
  ownerId: null,
  timer: null,
  startedAt: null,
  lastTickAt: null,
  lastError: null,
  lastResult: null,
};

export function getTradeLifecycleSchedulerStatus() {
  return {
    state: runtime.state,
    ownerId: runtime.ownerId,
    startedAt: runtime.startedAt?.toISOString() ?? null,
    lastTickAt: runtime.lastTickAt?.toISOString() ?? null,
    lastError: runtime.lastError,
    intervalMs: getTradeLifecycleScheduleMs(),
    lastResult: runtime.lastResult,
  };
}

export function startTradeLifecycleScheduler(): boolean {
  const flags = getTradeLifecycleFlags();
  if (!flags.TRADE_LIFECYCLE_ENABLED || !flags.TRADE_LIFECYCLE_AUTOSTART || !flags.AUTONOMOUS_MONITORING) {
    return false;
  }
  if (runtime.state !== 'STOPPED') return false;
  runtime.state = 'ACTIVE';
  runtime.ownerId = randomUUID();
  runtime.startedAt = new Date();
  runtime.lastError = null;
  const tick = () => {
    if (runtime.state !== 'ACTIVE') return;
    runtime.lastTickAt = new Date();
    syncTradeLifecycle()
      .then(result => {
        runtime.lastResult = result;
        runtime.lastError = null;
      })
      .catch(error => {
        runtime.lastError = String(error?.message ?? error);
      });
  };
  tick();
  runtime.timer = setInterval(tick, getTradeLifecycleScheduleMs());
  return true;
}

export async function stopTradeLifecycleScheduler(): Promise<void> {
  if (runtime.timer) clearInterval(runtime.timer);
  runtime.timer = null;
  runtime.state = 'STOPPED';
  runtime.ownerId = null;
}
