import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import { getMarketHoursConfig, getSchedulerConfig, getSignalMode, getSubmissionEnabled } from '../automation.config';
import {
  acquireSchedulerLease,
  releaseSchedulerLease,
} from '../models/schedulerLease.model';
import {
  AutomationSessionModel,
  RUNNABLE_SESSION_STATUSES,
  type AutomationSessionDocument,
} from '../models/automationSession.model';
import { UniverseEvaluationModel } from '../models/universeEvaluation.model';
import { logAutomationEvent } from './automationAudit.service';
import type { PaperBrokerAdapter } from './brokerAdapter';
import { deriveMarketSession, type MarketSessionState } from './marketSession.service';
import { hasUnresolvedAutomationOrder, isBrokerTruthCurrent } from './orderReconciliation.service';
import { cancelTimedOutEntryOrders, submitApprovedIntent, type EntryOrderTimeoutSummary, type SubmissionOutcome } from './orderSubmission.service';
import { exchangeTradingDate } from './sessionDailyReset.service';
import { getAutomationRuntime, isAutomationReady, resolveBrokerAdapter } from './sessionRecovery.service';

// Phase 2C Sprint 1 — the production automation scheduler (EVALUATION ONLY).
//
// This is the interval-driven owner of the automation lifecycle up to — and
// stopping at — the Approved Evaluation Request. It DOES NOT submit broker
// orders, does not monitor positions, and does not touch execution. Those are
// later sprints.
//
// Guarantees enforced here:
//  * single owner       — a DB lease; a second process cannot tick concurrently
//  * reconciliation gate — never evaluates until automation is READY (startup
//                          reconciliation succeeded)
//  * market-hours gate   — evaluates ONLY when the authoritative Alpaca clock
//                          says the session is open and before the entry cutoff
//                          (holiday/early-close handled by the clock's next_close)
//  * once-per-window     — a durable per-session window key; a window is never
//                          evaluated twice, even across restarts
//  * no submission       — the tick calls the universe evaluation, which stops
//                          at APPROVED_AWAITING_EXECUTION and never reaches a broker

export const SCHEDULER_SCOPE = 'automation-scheduler';

export type SchedulerState = 'STOPPED' | 'ACTIVE' | 'STOPPING';

type ControllerRuntime = {
  state: SchedulerState;
  ownerId: string | null;
  timer: ReturnType<typeof setInterval> | null;
  startedAt: Date | null;
  lastTickAt: Date | null;
  lastError: string | null;
  inFlight: boolean;
  lastResult: EvaluationTickResult | null;
  lastCompletedEvaluationAt: string | null;
  lastCompletedWindowKey: string | null;
};

const controller: ControllerRuntime = {
  state: 'STOPPED',
  ownerId: null,
  timer: null,
  startedAt: null,
  lastTickAt: null,
  lastError: null,
  inFlight: false,
  lastResult: null,
  lastCompletedEvaluationAt: null,
  lastCompletedWindowKey: null,
};

/** The universe evaluation → Approved Evaluation Request. Never submits. */
export type EvaluateSession = (
  sessionId: string,
  adapter: PaperBrokerAdapter
) => Promise<{ approvedIntentId: string | null; outcome: string }>;

async function defaultEvaluateSession(
  sessionId: string,
  adapter: PaperBrokerAdapter
): Promise<{ approvedIntentId: string | null; outcome: string }> {
  // The active signal engine is selected by configuration, never hardcoded.
  // Both evaluators produce an APPROVED_AWAITING_EXECUTION intent (or NO_TRADE)
  // and STOP — neither imports submitIntent, so no broker order is created here.
  if (getSignalMode() === 'OPTIONS_NATIVE_FLOW') {
    // Authorized options-native flow: baseline snapshot → completed window →
    // deterministic direction → contract → risk → approved intent. This is the
    // launch-authorized path under the Options Advanced entitlement.
    const { processOptionsFlowTick } = await import('./optionsFlowUniverseEvaluator.service');
    const { orderIntent, outcomeLabel } = await processOptionsFlowTick(sessionId, adapter);
    return { approvedIntentId: orderIntent ? String(orderIntent._id) : null, outcome: outcomeLabel };
  }
  // EQUITY_MOMENTUM: the underlying-bar strategy (unauthorized under the current
  // plan; warned at startup, retained for entitlements that include stock intraday).
  const { processUniverseTick } = await import('./universeTickProcessor.service');
  const { evaluation, orderIntent } = await processUniverseTick(sessionId, adapter);
  return { approvedIntentId: orderIntent ? String(orderIntent._id) : null, outcome: evaluation.outcome };
}

/** Submit one approved intent to the broker (Sprint 2). */
export type SubmitApproved = (
  intentId: string,
  adapter: PaperBrokerAdapter,
  ctx: { ownsLease: boolean; marketSession: MarketSessionState }
) => Promise<{ outcome: SubmissionOutcome; brokerOrderId: string | null; brokerStatus: string | null }>;

export type EvaluationTickDeps = {
  adapter: PaperBrokerAdapter;
  ownerId: string;
  now?: number;
  evaluate?: EvaluateSession;
  /** Sprint 2: submit the approved intent. Injected in tests; default = real path. */
  submit?: SubmitApproved;
  /** Force-enable submission regardless of env (tests). */
  submissionEnabled?: boolean;
};

export type SessionEvaluationOutcome = {
  automationSessionId: string;
  evaluated: boolean;
  skippedReason: string | null;
  approvedIntentId: string | null;
  windowKey: string;
  /** Sprint 2: broker submission outcome for the approved intent, if any. */
  submission: { outcome: SubmissionOutcome; brokerOrderId: string | null; brokerStatus: string | null } | null;
};

export type EvaluationTickResult = {
  tickId: string;
  ranAt: string;
  schedulerIntervalMs: number;
  flowWindowMinutes: number;
  currentWindowKey: string | null;
  lastEvaluatedWindowKey: string | null;
  nextEligibleEvaluationAt: string | null;
  ownsLease: boolean;
  marketSession: MarketSessionState | null;
  entryOrderTimeouts: EntryOrderTimeoutSummary | null;
  entryOrdersCancelled: number;
  evaluated: number;
  skipped: number;
  submitted: number;
  sessionsFound: number;
  sessionsEvaluated: number;
  sessionsSkipped: number;
  watchlistSymbolCount: number | null;
  candidateCount: number | null;
  submittedCount: number;
  skippedReason: string | null;
  skipReasons: Record<string, number>;
  sessions: SessionEvaluationOutcome[];
};

/**
 * Deterministic per-window key for a session evaluation. Same instant + window
 * size → same key, so repeated ticks inside one window evaluate at most once.
 */
export function windowKeyFor(now: number, windowMs: number, tradingDate: string): string {
  return `${tradingDate}:${Math.floor(now / windowMs)}`;
}

function nextWindowBoundary(now: number, windowMs: number): string | null {
  if (!Number.isFinite(now) || !Number.isFinite(windowMs) || windowMs <= 0) return null;
  return new Date((Math.floor(now / windowMs) + 1) * windowMs).toISOString();
}

function observableSkipReason(reason: string | null): string | null {
  if (!reason) return null;
  if (reason === 'WINDOW_ALREADY_EVALUATED') return 'WINDOW_ALREADY_CLAIMED';
  if (reason.startsWith('MARKET_')) return 'MARKET_CLOSED';
  if (reason === 'RECONCILIATION_NOT_CLEAN' || reason === 'EMERGENCY_STOP_ACTIVE') return 'SESSION_NOT_READY';
  if (reason === 'UNRESOLVED_AUTOMATION_ORDER') return 'EXISTING_POSITION';
  return reason;
}

function recordSkip(result: EvaluationTickResult, reason: string | null): void {
  const normalized = observableSkipReason(reason);
  if (!normalized) return;
  result.skipReasons[normalized] = (result.skipReasons[normalized] ?? 0) + 1;
}

function skippedTick(base: EvaluationTickResult, reason: string, extra: Partial<EvaluationTickResult> = {}): EvaluationTickResult {
  const result = { ...base, ...extra, skippedReason: reason, skipReasons: { ...base.skipReasons } };
  recordSkip(result, reason);
  return result;
}

/**
 * Run ONE evaluation tick. Pure orchestration over injected deps so it is fully
 * testable without timers. Never throws for a single session's failure.
 */
export async function runEvaluationTick(deps: EvaluationTickDeps): Promise<EvaluationTickResult> {
  const now = deps.now ?? Date.now();
  const config = getSchedulerConfig();
  const evaluate = deps.evaluate ?? defaultEvaluateSession;
  const submit: SubmitApproved =
    deps.submit ??
    (async (intentId, adapter, ctx) => {
      const r = await submitApprovedIntent(intentId, adapter, ctx);
      return { outcome: r.outcome, brokerOrderId: r.brokerOrderId, brokerStatus: r.brokerStatus };
    });
  const submissionEnabled = deps.submissionEnabled ?? getSubmissionEnabled();
  const base: EvaluationTickResult = {
    tickId: randomUUID(),
    ranAt: new Date(now).toISOString(),
    schedulerIntervalMs: config.intervalMs,
    flowWindowMinutes: config.windowMs / 60_000,
    currentWindowKey: null,
    lastEvaluatedWindowKey: null,
    nextEligibleEvaluationAt: nextWindowBoundary(now, config.windowMs),
    ownsLease: false,
    marketSession: null,
    entryOrderTimeouts: null,
    entryOrdersCancelled: 0,
    evaluated: 0,
    skipped: 0,
    submitted: 0,
    sessionsFound: 0,
    sessionsEvaluated: 0,
    sessionsSkipped: 0,
    watchlistSymbolCount: null,
    candidateCount: null,
    submittedCount: 0,
    skippedReason: null,
    skipReasons: {},
    sessions: [],
  };

  // Reconciliation gate — never run before automation is READY.
  if (mongoose.connection?.readyState !== 1 || !isAutomationReady()) {
    return skippedTick(base, 'AUTOMATION_NOT_READY');
  }

  // Single-owner lease — a second process cannot evaluate concurrently.
  const ownsLease = await acquireSchedulerLease(SCHEDULER_SCOPE, deps.ownerId, config.leaseTtlMs, new Date(now));
  if (!ownsLease) {
    return skippedTick(base, 'LEASE_NOT_OWNED');
  }
  base.ownsLease = true;

  // Authoritative market clock → session phase (holiday/early-close aware).
  let marketSession: MarketSessionState;
  try {
    const clock = await deps.adapter.getClock();
    marketSession = deriveMarketSession(clock, getMarketHoursConfig(), now);
  } catch (error) {
    return skippedTick(base, 'CLOCK_UNAVAILABLE', { marketSession: null });
  }
  base.marketSession = marketSession;

  const tradingDateNow = exchangeTradingDate(new Date(now));
  const windowKey = windowKeyFor(now, config.windowMs, tradingDateNow);
  base.currentWindowKey = windowKey;

  // Submitted ENTRY intents occupy automation exposure even before a fill creates
  // an AutomationPosition. Keep their lifecycle moving from broker truth so a
  // working order cannot block the one-position slot indefinitely.
  try {
    const entryOrderTimeouts = await cancelTimedOutEntryOrders(deps.adapter, new Date(now));
    base.entryOrderTimeouts = entryOrderTimeouts;
    base.entryOrdersCancelled = entryOrderTimeouts.cancelRequested;
  } catch (error: any) {
    logAutomationEvent({
      service: 'scheduler',
      event: 'ENTRY_ORDER_TIMEOUT_SCAN_FAILED',
      severity: 'warning',
      payload: { message: String(error?.message ?? error).slice(0, 300) },
    });
  }

  // Market-hours + entry-cutoff gate — evaluate ONLY in the entry window.
  if (!marketSession.entriesAllowed) {
    return skippedTick(base, `MARKET_${marketSession.phase}`);
  }

  const sessions = await AutomationSessionModel.find({ status: { $in: RUNNABLE_SESSION_STATUSES } });
  base.sessionsFound = sessions.length;
  base.lastEvaluatedWindowKey = sessions.find(session => typeof session.lastEvaluatedWindowKey === 'string')?.lastEvaluatedWindowKey ?? null;
  for (const session of sessions) {
    const outcome = await evaluateSessionOnce(session, deps.adapter, windowKey, evaluate);
    base.sessions.push(outcome);
    if (outcome.evaluated) base.evaluated += 1;
    else {
      base.skipped += 1;
      recordSkip(base, outcome.skippedReason);
    }

    // Sprint 2/3: submit the Approved Order Intent (gated). Persist-then-STOP —
    // no fills, positions, or P&L. Idempotent; ambiguity → MANUAL_REVIEW.
    // Sprint 3 gates: do not start a NEW submission while broker truth is not
    // current, or while any automation order is unresolved.
    if (submissionEnabled && outcome.evaluated && outcome.approvedIntentId) {
      if (!isBrokerTruthCurrent(now)) {
        outcome.submission = { outcome: 'REFUSED', brokerOrderId: null, brokerStatus: null };
      } else if (await hasUnresolvedAutomationOrder()) {
        outcome.submission = { outcome: 'REFUSED', brokerOrderId: null, brokerStatus: null };
      } else {
        const submission = await submit(outcome.approvedIntentId, deps.adapter, {
          ownsLease: true,
          marketSession,
        });
        outcome.submission = submission;
        if (submission.outcome === 'SUBMITTED') base.submitted += 1;
      }
    }
  }

  base.sessionsEvaluated = base.evaluated;
  base.sessionsSkipped = base.skipped;
  base.submittedCount = base.submitted;
  base.lastEvaluatedWindowKey = windowKey;
  if (base.evaluated === 0 && base.skipped > 0 && !base.skippedReason) {
    base.skippedReason = base.sessions.find(session => session.skippedReason)?.skippedReason ?? null;
  }
  const latestEvaluation = await UniverseEvaluationModel.findOne().sort({ evaluatedAt: -1 });
  if (latestEvaluation) {
    base.watchlistSymbolCount = Array.isArray((latestEvaluation as any).configuredSymbols)
      ? (latestEvaluation as any).configuredSymbols.length
      : null;
    base.candidateCount = Array.isArray((latestEvaluation as any).eligibleSymbols)
      ? (latestEvaluation as any).eligibleSymbols.length
      : null;
  }

  logAutomationEvent({
    service: 'scheduler',
    event: 'SCHEDULER_TICK',
    payload: {
      tickId: base.tickId,
      schedulerIntervalMs: base.schedulerIntervalMs,
      flowWindowMinutes: base.flowWindowMinutes,
      windowKey,
      currentWindowKey: base.currentWindowKey,
      lastEvaluatedWindowKey: base.lastEvaluatedWindowKey,
      nextEligibleEvaluationAt: base.nextEligibleEvaluationAt,
      phase: marketSession.phase,
      evaluated: base.evaluated,
      skipped: base.skipped,
      submitted: base.submitted,
      sessionsFound: base.sessionsFound,
      sessionsEvaluated: base.sessionsEvaluated,
      sessionsSkipped: base.sessionsSkipped,
      watchlistSymbolCount: base.watchlistSymbolCount,
      candidateCount: base.candidateCount,
      submittedCount: base.submittedCount,
      skipReasons: base.skipReasons,
      entryOrdersCancelled: base.entryOrdersCancelled,
      minutesToClose: marketSession.minutesToClose,
    },
  });
  return base;
}

/** Evaluate one session at most once per window; gate on session health. */
async function evaluateSessionOnce(
  session: AutomationSessionDocument,
  adapter: PaperBrokerAdapter,
  windowKey: string,
  evaluate: EvaluateSession
): Promise<SessionEvaluationOutcome> {
  const sessionId = String(session._id);
  const skip = (reason: string): SessionEvaluationOutcome => ({
    automationSessionId: sessionId,
    evaluated: false,
    skippedReason: reason,
    approvedIntentId: null,
    windowKey,
    submission: null,
  });

  if (session.reconciliationStatus !== 'CLEAN') return skip('RECONCILIATION_NOT_CLEAN');
  if (session.emergencyStop.active) return skip('EMERGENCY_STOP_ACTIVE');

  // Once-per-window: durable claim so repeated ticks (or a restart) inside the
  // same window never re-evaluate. Atomic conditional update = the claim.
  const claim = await AutomationSessionModel.updateOne(
    { _id: session._id, lastEvaluatedWindowKey: { $ne: windowKey } },
    { $set: { lastEvaluatedWindowKey: windowKey } }
  );
  if (claim.modifiedCount !== 1) return skip('WINDOW_ALREADY_CLAIMED');

  try {
    const { approvedIntentId, outcome } = await evaluate(sessionId, adapter);
    logAutomationEvent({
      service: 'scheduler',
      event: 'APPROVED_EVALUATION_REQUEST',
      automationSessionId: sessionId,
      payload: { windowKey, outcome, approvedIntentId, note: 'submission gated by AUTOMATION_SUBMIT_APPROVED_INTENTS' },
    });
    return { automationSessionId: sessionId, evaluated: true, skippedReason: null, approvedIntentId, windowKey, submission: null };
  } catch (error: any) {
    // Roll the window claim back so a transient failure can retry next tick.
    await AutomationSessionModel.updateOne(
      { _id: session._id, lastEvaluatedWindowKey: windowKey },
      { $set: { lastEvaluatedWindowKey: null } }
    );
    logAutomationEvent({
      service: 'scheduler',
      event: 'SCHEDULER_EVALUATION_ERROR',
      severity: 'warning',
      automationSessionId: sessionId,
      payload: { windowKey, error: String(error?.message ?? error) },
    });
    return skip('EVALUATION_ERROR');
  }
}

// ---------------------------------------------------------------------------
// Controller lifecycle (boot / interval / graceful shutdown)
// ---------------------------------------------------------------------------

export function getSchedulerStatus() {
  const config = getSchedulerConfig();
  const last = controller.lastResult;
  return {
    state: controller.state,
    ownerId: controller.ownerId,
    startedAt: controller.startedAt ? controller.startedAt.toISOString() : null,
    lastTickAt: controller.lastTickAt ? controller.lastTickAt.toISOString() : null,
    lastError: controller.lastError,
    inFlight: controller.inFlight,
    intervalMs: config.intervalMs,
    flowWindowMinutes: config.windowMs / 60_000,
    lastCompletedEvaluation: controller.lastCompletedEvaluationAt,
    lastCompletedWindow: controller.lastCompletedWindowKey,
    lastWindow: last?.currentWindowKey ?? null,
    nextWindow: last?.nextEligibleEvaluationAt ?? null,
    lastSkipReason: last?.skippedReason ?? null,
    watchlistCount: last?.watchlistSymbolCount ?? null,
    candidateCount: last?.candidateCount ?? null,
    submittedCount: last?.submittedCount ?? 0,
    skipReasons: last?.skipReasons ?? {},
    lastTick: last
      ? {
          tickId: last.tickId,
          ranAt: last.ranAt,
          ownsLease: last.ownsLease,
          marketPhase: last.marketSession?.phase ?? null,
          currentWindowKey: last.currentWindowKey,
          lastEvaluatedWindowKey: last.lastEvaluatedWindowKey,
          nextEligibleEvaluationAt: last.nextEligibleEvaluationAt,
          sessionsFound: last.sessionsFound,
          sessionsEvaluated: last.sessionsEvaluated,
          sessionsSkipped: last.sessionsSkipped,
          watchlistSymbolCount: last.watchlistSymbolCount,
          candidateCount: last.candidateCount,
          submittedCount: last.submittedCount,
          skipReasons: last.skipReasons,
        }
      : null,
  };
}

/**
 * Start the boot-time scheduler. Refuses to start unless automation is READY
 * (startup reconciliation succeeded) — reconciliation before activation. Idempotent.
 */
export function startAutomationScheduler(adapter?: PaperBrokerAdapter): boolean {
  const config = getSchedulerConfig();
  if (!config.enabled) {
    logAutomationEvent({ service: 'scheduler', event: 'SCHEDULER_DISABLED', payload: { reason: 'AUTOMATION_SCHEDULER_ENABLED=false' } });
    return false;
  }
  if (controller.state !== 'STOPPED') return false; // never create duplicate owners in-process
  if (!isAutomationReady()) {
    logAutomationEvent({
      service: 'scheduler',
      event: 'SCHEDULER_START_REFUSED',
      severity: 'warning',
      payload: { reason: 'automation not ready — reconciliation must succeed first' },
    });
    return false;
  }

  const brokerAdapter = adapter ?? getAutomationRuntime().adapter ?? resolveBrokerAdapter();
  controller.ownerId = randomUUID();
  controller.state = 'ACTIVE';
  controller.startedAt = new Date();
  controller.lastError = null;

  const tick = () => {
    if (controller.state !== 'ACTIVE' || !controller.ownerId) return;
    controller.lastTickAt = new Date();
    if (controller.inFlight) {
      const config = getSchedulerConfig();
      const skipped: EvaluationTickResult = {
        tickId: randomUUID(),
        ranAt: controller.lastTickAt.toISOString(),
        schedulerIntervalMs: config.intervalMs,
        flowWindowMinutes: config.windowMs / 60_000,
        currentWindowKey: null,
        lastEvaluatedWindowKey: controller.lastResult?.lastEvaluatedWindowKey ?? null,
        nextEligibleEvaluationAt: nextWindowBoundary(Date.now(), config.windowMs),
        ownsLease: false,
        marketSession: null,
        entryOrderTimeouts: null,
        entryOrdersCancelled: 0,
        evaluated: 0,
        skipped: 1,
        submitted: 0,
        sessionsFound: 0,
        sessionsEvaluated: 0,
        sessionsSkipped: 1,
        watchlistSymbolCount: controller.lastResult?.watchlistSymbolCount ?? null,
        candidateCount: controller.lastResult?.candidateCount ?? null,
        submittedCount: 0,
        skippedReason: 'EVALUATION_RUNNING',
        skipReasons: { EVALUATION_RUNNING: 1 },
        sessions: [],
      };
      controller.lastResult = skipped;
      logAutomationEvent({
        service: 'scheduler',
        event: 'EVALUATION_HEARTBEAT',
        severity: 'warning',
        payload: skipped,
      });
      return;
    }
    controller.inFlight = true;
    runEvaluationTick({ adapter: brokerAdapter, ownerId: controller.ownerId })
      .then(result => {
        controller.lastError = null;
        controller.lastResult = result;
        if (result.evaluated > 0) {
          controller.lastCompletedEvaluationAt = result.ranAt;
          controller.lastCompletedWindowKey = result.currentWindowKey;
        }
        // Every tick emits an evaluation heartbeat — visible even when the tick
        // no-ops (market closed, lease not owned), so the evaluation loop's
        // liveness is observable at all hours (mirrors MONITOR_HEARTBEAT).
        logAutomationEvent({
          service: 'scheduler',
          event: 'EVALUATION_HEARTBEAT',
          payload: {
            tickId: result.tickId,
            ranAt: result.ranAt,
            schedulerIntervalMs: result.schedulerIntervalMs,
            flowWindowMinutes: result.flowWindowMinutes,
            currentWindowKey: result.currentWindowKey,
            lastEvaluatedWindowKey: result.lastEvaluatedWindowKey,
            nextEligibleEvaluationAt: result.nextEligibleEvaluationAt,
            ownsLease: result.ownsLease,
            phase: result.marketSession?.phase ?? null,
            skippedReason: result.skippedReason,
            sessionsFound: result.sessionsFound,
            sessionsEvaluated: result.sessionsEvaluated,
            sessionsSkipped: result.sessionsSkipped,
            watchlistSymbolCount: result.watchlistSymbolCount,
            candidateCount: result.candidateCount,
            evaluated: result.evaluated,
            submitted: result.submitted,
            submittedCount: result.submittedCount,
            skipReasons: result.skipReasons,
          },
        });
      })
      .catch(error => {
        controller.lastError = String(error?.message ?? error);
        logAutomationEvent({
          service: 'scheduler',
          event: 'SCHEDULER_TICK_ERROR',
          severity: 'warning',
          payload: { error: controller.lastError },
        });
      })
      .finally(() => {
        controller.inFlight = false;
      });
  };

  controller.timer = setInterval(tick, config.intervalMs);
  if (typeof controller.timer.unref === 'function') controller.timer.unref();
  logAutomationEvent({
    service: 'scheduler',
    event: 'SCHEDULER_STARTED',
    payload: { ownerId: controller.ownerId, intervalMs: config.intervalMs, leaseTtlMs: config.leaseTtlMs },
  });
  // Kick an immediate first tick so we don't wait a full interval.
  tick();
  return true;
}

/**
 * Stop the scheduler and release its lease (end-of-day / process shutdown).
 * Idempotent and safe to call from signal handlers.
 */
export async function stopAutomationScheduler(reason = 'shutdown'): Promise<void> {
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
  controller.inFlight = false;
  if (ownerId) {
    await releaseSchedulerLease(SCHEDULER_SCOPE, ownerId).catch(() => undefined);
  }
  logAutomationEvent({ service: 'scheduler', event: 'SCHEDULER_STOPPED', payload: { reason } });
}

/** Test-only: reset the in-process controller between cases. */
export function resetSchedulerControllerForTests(): void {
  if (controller.timer) clearInterval(controller.timer);
  controller.state = 'STOPPED';
  controller.ownerId = null;
  controller.timer = null;
  controller.startedAt = null;
  controller.lastTickAt = null;
  controller.lastError = null;
  controller.inFlight = false;
  controller.lastResult = null;
  controller.lastCompletedEvaluationAt = null;
  controller.lastCompletedWindowKey = null;
}
