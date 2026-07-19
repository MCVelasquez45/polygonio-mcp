import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import {
  getExitPolicyConfig,
  getMarketHoursConfig,
  getSchedulerConfig,
} from '../automation.config';
import {
  AutomationPositionModel,
  LIVE_POSITION_STATUSES,
} from '../models/automationPosition.model';
import { runSchedulerTick, type MarkProvider, type MarkResult } from '../automation.scheduler';
import { fetchHeldContractMark, isMarkStale } from './automationMarketData.service';
import { logAutomationEvent } from './automationAudit.service';
import type { PaperBrokerAdapter } from './brokerAdapter';
import { acquireSchedulerLease, releaseSchedulerLease } from '../models/schedulerLease.model';
import { deriveMarketSession } from './marketSession.service';
import { isBrokerTruthCurrent } from './orderReconciliation.service';
import { getAutomationRuntime, isAutomationReady, resolveBrokerAdapter } from './sessionRecovery.service';

// Phase 2C finalization — the production POSITION-MONITORING scheduler.
//
// The evaluation scheduler (schedulerController) owns ENTRIES and stops at
// submission. THIS scheduler owns everything after a fill: it drives
// runSchedulerTick with NO entryEvaluator, so each tick only monitors live
// positions, cancels unfilled entries in the cancel window, executes
// stop-loss / profit-target exits, reconciles EXITING positions (retry /
// escalate), and flattens before the close. Together the two schedulers make
// the full lifecycle autonomous.
//
// It mirrors the evaluation scheduler exactly: a DB single-owner lease (its own
// scope), the reconciliation-ready gate, the authoritative market clock, and
// fail-closed behavior. Two monitors can never run concurrently. Every tick
// emits a structured MONITOR_HEARTBEAT.

export const MONITOR_SCOPE = 'automation-monitor';

export type MonitorState = 'STOPPED' | 'ACTIVE' | 'STOPPING';

type ControllerRuntime = {
  state: MonitorState;
  ownerId: string | null;
  timer: ReturnType<typeof setInterval> | null;
  startedAt: Date | null;
  lastTickAt: Date | null;
  lastError: string | null;
  lastResult: MonitorTickResult | null;
};

const controller: ControllerRuntime = {
  state: 'STOPPED',
  ownerId: null,
  timer: null,
  startedAt: null,
  lastTickAt: null,
  lastError: null,
  lastResult: null,
};

export type MonitorTickDeps = {
  adapter: PaperBrokerAdapter;
  ownerId: string;
  now?: number;
  /** Authoritative option mark provider. Live default reuses the option chain. */
  markProvider?: MarkProvider;
  /** Whether the session signal now contradicts an open position (optional). */
  strategyInvalidated?: Parameters<typeof runSchedulerTick>[2]['strategyInvalidated'];
};

export type MonitorHeartbeat = {
  ownsLease: boolean;
  mongoConnected: boolean;
  automationReady: boolean;
  brokerConnected: boolean;
  brokerTruthCurrent: boolean;
  marketPhase: string | null;
  minutesToClose: number | null;
  openPositions: number;
  exitingPositions: number;
  manualReviewPositions: number;
  staleExitingPositions: number;
};

export type MonitorTickResult = {
  ranAt: string;
  skippedReason: string | null;
  sessionsMonitored: number;
  positionsMonitored: number;
  exitsTriggered: number;
  entryOrdersCancelled: number;
  errors: number;
  heartbeat: MonitorHeartbeat;
};

// ---------------------------------------------------------------------------
// Live mark provider (fail closed)
// ---------------------------------------------------------------------------

/**
 * Live option-mark provider. Uses the TARGETED held-contract snapshot (one
 * direct request by OCC symbol via the shared request manager) instead of
 * downloading the whole chain every tick. Freshness is computed against the
 * contract's OWN provider quote timestamp — so a slow request cannot fake
 * staleness and a truly old (e.g. market-closed) quote cannot look fresh.
 * ALWAYS fails closed: any missing/unusable/older-than-threshold quote returns
 * `stale: true` so price triggers are suppressed rather than fired on invented
 * data. End-of-day flatten, overnight recovery, and broker-close detection do
 * NOT depend on the mark and keep working through an outage.
 */
export function createLiveMarkProvider(now: () => number = () => Date.now()): MarkProvider {
  return async (optionSymbol: string): Promise<MarkResult> => {
    const symbol = optionSymbol.toUpperCase();
    const result = await fetchHeldContractMark(symbol, now());
    const { monitorStaleQuoteMs } = getExitPolicyConfig();
    const hasMark = result.mark != null && result.mark > 0;
    const stale = isMarkStale(
      { mark: result.mark, providerQuoteTimestamp: result.providerQuoteTimestamp, computedAgeMs: result.computedAgeMs },
      monitorStaleQuoteMs
    );

    logAutomationEvent({
      service: 'monitor-scheduler',
      event: hasMark ? 'MONITOR_MARK_RECEIVED' : 'MONITOR_MARK_MISSING',
      severity: hasMark ? 'info' : 'warning',
      symbol,
      payload: {
        mark: result.mark,
        providerQuoteTimestamp: result.providerQuoteTimestamp,
        providerQuoteAt:
          result.providerQuoteTimestamp != null
            ? new Date(result.providerQuoteTimestamp).toISOString()
            : null,
        fetchStartedAt: new Date(result.fetchStartedAt).toISOString(),
        fetchCompletedAt: new Date(result.fetchCompletedAt).toISOString(),
        computedAgeMs: result.computedAgeMs,
        freshnessThresholdMs: monitorStaleQuoteMs,
        dataSource: result.source,
        cacheStatus: result.cacheStatus,
        stale,
      },
    });

    return {
      mark: hasMark ? result.mark : null,
      stale,
      providerQuoteTimestamp: result.providerQuoteTimestamp,
      fetchStartedAt: result.fetchStartedAt,
      fetchCompletedAt: result.fetchCompletedAt,
      receivedAt: result.fetchCompletedAt,
      computedAgeMs: result.computedAgeMs,
      source: result.source,
      cacheStatus: result.cacheStatus,
    };
  };
}

// ---------------------------------------------------------------------------
// One monitoring tick (pure orchestration over injected deps)
// ---------------------------------------------------------------------------

async function snapshotPositionHealth(now: number, exitTimeoutMs: number): Promise<{
  openPositions: number;
  exitingPositions: number;
  manualReviewPositions: number;
  staleExitingPositions: number;
}> {
  const [openPositions, exitingPositions, manualReviewPositions, staleExitingPositions] = await Promise.all([
    AutomationPositionModel.countDocuments({ status: 'OPEN' }),
    AutomationPositionModel.countDocuments({ status: 'EXITING' }),
    AutomationPositionModel.countDocuments({ status: 'MANUAL_REVIEW' }),
    AutomationPositionModel.countDocuments({
      status: 'EXITING',
      exitSubmittedAt: { $ne: null, $lte: new Date(now - exitTimeoutMs) },
    }),
  ]);
  return { openPositions, exitingPositions, manualReviewPositions, staleExitingPositions };
}

/**
 * Run ONE monitoring tick. Never throws for a single session's failure. Emits a
 * MONITOR_HEARTBEAT every tick — healthy or degraded.
 */
export async function runMonitorTick(deps: MonitorTickDeps): Promise<MonitorTickResult> {
  const now = deps.now ?? Date.now();
  const config = getSchedulerConfig();
  const { exitTimeoutMs } = getExitPolicyConfig();
  const markProvider = deps.markProvider ?? createLiveMarkProvider();

  const heartbeat: MonitorHeartbeat = {
    ownsLease: false,
    mongoConnected: mongoose.connection?.readyState === 1,
    automationReady: isAutomationReady(),
    brokerConnected: false,
    brokerTruthCurrent: false,
    marketPhase: null,
    minutesToClose: null,
    openPositions: 0,
    exitingPositions: 0,
    manualReviewPositions: 0,
    staleExitingPositions: 0,
  };
  const result: MonitorTickResult = {
    ranAt: new Date(now).toISOString(),
    skippedReason: null,
    sessionsMonitored: 0,
    positionsMonitored: 0,
    exitsTriggered: 0,
    entryOrdersCancelled: 0,
    errors: 0,
    heartbeat,
  };

  const emit = (severity: 'info' | 'warning' = 'info') => {
    logAutomationEvent({
      service: 'monitor-scheduler',
      event: 'MONITOR_HEARTBEAT',
      severity,
      payload: {
        skippedReason: result.skippedReason,
        sessionsMonitored: result.sessionsMonitored,
        positionsMonitored: result.positionsMonitored,
        exitsTriggered: result.exitsTriggered,
        entryOrdersCancelled: result.entryOrdersCancelled,
        errors: result.errors,
        ...heartbeat,
      },
    });
  };

  // Fail closed: never monitor/exit before automation is READY.
  if (!heartbeat.mongoConnected || !heartbeat.automationReady) {
    result.skippedReason = 'AUTOMATION_NOT_READY';
    emit('warning');
    return result;
  }

  // Single-owner monitor lease (its own scope — independent of the evaluator).
  const ownsLease = await acquireSchedulerLease(MONITOR_SCOPE, deps.ownerId, config.leaseTtlMs, new Date(now));
  if (!ownsLease) {
    result.skippedReason = 'LEASE_NOT_OWNED';
    emit();
    return result;
  }
  heartbeat.ownsLease = true;

  // Authoritative market clock. Without it we cannot know the session phase, so
  // we cannot safely flatten — fail closed for this tick (heartbeat records it).
  let marketPhaseKnown = false;
  try {
    const clock = await deps.adapter.getClock();
    const marketSession = deriveMarketSession(clock, getMarketHoursConfig(), now);
    heartbeat.brokerConnected = true;
    heartbeat.marketPhase = marketSession.phase;
    heartbeat.minutesToClose = marketSession.minutesToClose;
    marketPhaseKnown = true;
  } catch {
    heartbeat.brokerConnected = false;
  }
  heartbeat.brokerTruthCurrent = isBrokerTruthCurrent(now);

  const health = await snapshotPositionHealth(now, exitTimeoutMs);
  Object.assign(heartbeat, health);

  if (!marketPhaseKnown) {
    result.skippedReason = 'CLOCK_UNAVAILABLE';
    emit('warning');
    return result;
  }

  // Monitor exactly the sessions that own at least one live position.
  const sessionIds = (await AutomationPositionModel.distinct('automationSessionId', {
    status: { $in: LIVE_POSITION_STATUSES },
  })) as string[];

  for (const sessionId of sessionIds) {
    try {
      const tick = await runSchedulerTick(String(sessionId), deps.adapter, {
        markProvider,
        now,
        strategyInvalidated: deps.strategyInvalidated,
        // No entryEvaluator: entries are owned exclusively by the evaluation scheduler.
      });
      result.sessionsMonitored += 1;
      result.positionsMonitored += tick.positionsMonitored;
      result.exitsTriggered += tick.exitsTriggered;
      result.entryOrdersCancelled += tick.entryOrdersCancelled;
    } catch (error: any) {
      result.errors += 1;
      logAutomationEvent({
        service: 'monitor-scheduler',
        event: 'MONITOR_SESSION_ERROR',
        severity: 'warning',
        automationSessionId: String(sessionId),
        payload: { error: String(error?.message ?? error) },
      });
    }
  }

  // Refresh EXITING/open counts post-tick for an accurate heartbeat.
  Object.assign(heartbeat, await snapshotPositionHealth(now, exitTimeoutMs));
  emit(result.errors > 0 || heartbeat.staleExitingPositions > 0 || !heartbeat.brokerTruthCurrent ? 'warning' : 'info');
  return result;
}

// ---------------------------------------------------------------------------
// Controller lifecycle (boot / interval / graceful shutdown)
// ---------------------------------------------------------------------------

export function getMonitorStatus() {
  const config = getSchedulerConfig();
  return {
    state: controller.state,
    ownerId: controller.ownerId,
    startedAt: controller.startedAt ? controller.startedAt.toISOString() : null,
    lastTickAt: controller.lastTickAt ? controller.lastTickAt.toISOString() : null,
    lastError: controller.lastError,
    intervalMs: config.intervalMs,
    lastRun: controller.lastResult?.ranAt ?? null,
    positionsMonitored: controller.lastResult?.positionsMonitored ?? 0,
    exitsTriggered: controller.lastResult?.exitsTriggered ?? 0,
    skippedReason: controller.lastResult?.skippedReason ?? null,
    heartbeat: controller.lastResult?.heartbeat ?? null,
  };
}

/**
 * Start the boot-time monitoring scheduler. Refuses to start unless automation
 * is READY (startup reconciliation succeeded). Idempotent — never creates a
 * second in-process owner.
 */
export function startMonitorScheduler(adapter?: PaperBrokerAdapter): boolean {
  const config = getSchedulerConfig();
  if (!config.enabled) {
    logAutomationEvent({ service: 'monitor-scheduler', event: 'MONITOR_DISABLED', payload: { reason: 'AUTOMATION_SCHEDULER_ENABLED=false' } });
    return false;
  }
  if (controller.state !== 'STOPPED') return false;
  if (!isAutomationReady()) {
    logAutomationEvent({
      service: 'monitor-scheduler',
      event: 'MONITOR_START_REFUSED',
      severity: 'warning',
      payload: { reason: 'automation not ready — reconciliation must succeed first' },
    });
    return false;
  }

  const brokerAdapter = adapter ?? getAutomationRuntime().adapter ?? resolveBrokerAdapter();
  const markProvider = createLiveMarkProvider();
  controller.ownerId = randomUUID();
  controller.state = 'ACTIVE';
  controller.startedAt = new Date();
  controller.lastError = null;

  const tick = () => {
    if (controller.state !== 'ACTIVE' || !controller.ownerId) return;
    controller.lastTickAt = new Date();
    runMonitorTick({ adapter: brokerAdapter, ownerId: controller.ownerId, markProvider })
      .then(result => {
        controller.lastError = null;
        controller.lastResult = result;
      })
      .catch(error => {
        controller.lastError = String(error?.message ?? error);
        logAutomationEvent({
          service: 'monitor-scheduler',
          event: 'MONITOR_TICK_ERROR',
          severity: 'warning',
          payload: { error: controller.lastError },
        });
      });
  };

  controller.timer = setInterval(tick, config.intervalMs);
  if (typeof controller.timer.unref === 'function') controller.timer.unref();
  logAutomationEvent({
    service: 'monitor-scheduler',
    event: 'MONITOR_STARTED',
    payload: { ownerId: controller.ownerId, intervalMs: config.intervalMs, leaseTtlMs: config.leaseTtlMs, scope: MONITOR_SCOPE },
  });
  tick(); // immediate first tick
  return true;
}

/** Stop the monitor and release its lease. Idempotent; safe from signal handlers. */
export async function stopMonitorScheduler(reason = 'shutdown'): Promise<void> {
  if (controller.state === 'STOPPED') return;
  controller.state = 'STOPPING';
  if (controller.timer) {
    clearInterval(controller.timer);
    controller.timer = null;
  }
  const ownerId = controller.ownerId;
  controller.ownerId = null;
  controller.state = 'STOPPED';
  controller.startedAt = null;
  controller.lastResult = null;
  if (ownerId) {
    await releaseSchedulerLease(MONITOR_SCOPE, ownerId).catch(() => undefined);
  }
  logAutomationEvent({ service: 'monitor-scheduler', event: 'MONITOR_STOPPED', payload: { reason } });
}

/** Test-only: reset the in-process controller between cases. */
export function resetMonitorControllerForTests(): void {
  if (controller.timer) clearInterval(controller.timer);
  controller.state = 'STOPPED';
  controller.ownerId = null;
  controller.timer = null;
  controller.startedAt = null;
  controller.lastTickAt = null;
  controller.lastError = null;
  controller.lastResult = null;
}
