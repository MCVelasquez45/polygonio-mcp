import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import { getMarketHoursConfig, getSchedulerConfig, getSubmissionEnabled } from '../automation.config';
import {
  acquireSchedulerLease,
  releaseSchedulerLease,
} from '../models/schedulerLease.model';
import {
  AutomationSessionModel,
  RUNNABLE_SESSION_STATUSES,
  type AutomationSessionDocument,
} from '../models/automationSession.model';
import { logAutomationEvent } from './automationAudit.service';
import type { PaperBrokerAdapter } from './brokerAdapter';
import { deriveMarketSession, type MarketSessionState } from './marketSession.service';
import { submitApprovedIntent, type SubmissionOutcome } from './orderSubmission.service';
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
};

const controller: ControllerRuntime = {
  state: 'STOPPED',
  ownerId: null,
  timer: null,
  startedAt: null,
  lastTickAt: null,
  lastError: null,
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
  // The universe processor produces an APPROVED_AWAITING_EXECUTION intent and
  // STOPS. It never imports submitIntent, so no broker order is created here.
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
  ranAt: string;
  ownsLease: boolean;
  marketSession: MarketSessionState | null;
  evaluated: number;
  skipped: number;
  submitted: number;
  skippedReason: string | null;
  sessions: SessionEvaluationOutcome[];
};

/**
 * Deterministic per-window key for a session evaluation. Same instant + window
 * size → same key, so repeated ticks inside one window evaluate at most once.
 */
export function windowKeyFor(now: number, windowMs: number, tradingDate: string): string {
  return `${tradingDate}:${Math.floor(now / windowMs)}`;
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
    ranAt: new Date(now).toISOString(),
    ownsLease: false,
    marketSession: null,
    evaluated: 0,
    skipped: 0,
    submitted: 0,
    skippedReason: null,
    sessions: [],
  };

  // Reconciliation gate — never run before automation is READY.
  if (mongoose.connection?.readyState !== 1 || !isAutomationReady()) {
    return { ...base, skippedReason: 'AUTOMATION_NOT_READY' };
  }

  // Single-owner lease — a second process cannot evaluate concurrently.
  const ownsLease = await acquireSchedulerLease(SCHEDULER_SCOPE, deps.ownerId, config.leaseTtlMs, new Date(now));
  if (!ownsLease) {
    return { ...base, skippedReason: 'LEASE_NOT_OWNED' };
  }
  base.ownsLease = true;

  // Authoritative market clock → session phase (holiday/early-close aware).
  let marketSession: MarketSessionState;
  try {
    const clock = await deps.adapter.getClock();
    marketSession = deriveMarketSession(clock, getMarketHoursConfig(), now);
  } catch (error) {
    return { ...base, skippedReason: 'CLOCK_UNAVAILABLE', marketSession: null };
  }
  base.marketSession = marketSession;

  // Market-hours + entry-cutoff gate — evaluate ONLY in the entry window.
  if (!marketSession.entriesAllowed) {
    return { ...base, skippedReason: `MARKET_${marketSession.phase}` };
  }

  const tradingDateNow = exchangeTradingDate(new Date(now));
  const windowKey = windowKeyFor(now, config.windowMs, tradingDateNow);

  const sessions = await AutomationSessionModel.find({ status: { $in: RUNNABLE_SESSION_STATUSES } });
  for (const session of sessions) {
    const outcome = await evaluateSessionOnce(session, deps.adapter, windowKey, evaluate);
    base.sessions.push(outcome);
    if (outcome.evaluated) base.evaluated += 1;
    else base.skipped += 1;

    // Sprint 2: submit the Approved Order Intent (gated). Persist-then-STOP —
    // no fills, positions, or P&L. Idempotent; ambiguity → MANUAL_REVIEW.
    if (submissionEnabled && outcome.evaluated && outcome.approvedIntentId) {
      const submission = await submit(outcome.approvedIntentId, deps.adapter, {
        ownsLease: true,
        marketSession,
      });
      outcome.submission = submission;
      if (submission.outcome === 'SUBMITTED') base.submitted += 1;
    }
  }

  logAutomationEvent({
    service: 'scheduler',
    event: 'SCHEDULER_TICK',
    payload: {
      windowKey,
      phase: marketSession.phase,
      evaluated: base.evaluated,
      skipped: base.skipped,
      submitted: base.submitted,
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
  if (claim.modifiedCount !== 1) return skip('WINDOW_ALREADY_EVALUATED');

  try {
    const { approvedIntentId, outcome } = await evaluate(sessionId, adapter);
    logAutomationEvent({
      service: 'scheduler',
      event: 'APPROVED_EVALUATION_REQUEST',
      automationSessionId: sessionId,
      payload: { windowKey, outcome, approvedIntentId, note: 'Sprint 1 stops here — no broker submission' },
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
  return {
    state: controller.state,
    ownerId: controller.ownerId,
    startedAt: controller.startedAt ? controller.startedAt.toISOString() : null,
    lastTickAt: controller.lastTickAt ? controller.lastTickAt.toISOString() : null,
    lastError: controller.lastError,
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
    runEvaluationTick({ adapter: brokerAdapter, ownerId: controller.ownerId })
      .then(result => {
        controller.lastError = null;
        void result;
      })
      .catch(error => {
        controller.lastError = String(error?.message ?? error);
        logAutomationEvent({
          service: 'scheduler',
          event: 'SCHEDULER_TICK_ERROR',
          severity: 'warning',
          payload: { error: controller.lastError },
        });
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
}
