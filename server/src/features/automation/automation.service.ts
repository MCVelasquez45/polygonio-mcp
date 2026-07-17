import mongoose from 'mongoose';
import { MongoUnavailableError, NotFoundError } from './automation.errors';
import type { AutomationHealth, ReconciliationReport } from './automation.types';
import { AutomationSessionModel } from './models/automationSession.model';
import { listSessionEvents, logAutomationEvent } from './services/automationAudit.service';
import { getAutomationHealth } from './services/automationHealth.service';
import { listSessionBrokerOrders, listSessionIntents } from './services/orderIntent.service';
import { runStartupReconciliation } from './services/reconciliation.service';
import { getAutomationRuntime, resolveBrokerAdapter } from './services/sessionRecovery.service';

// Facade over the automation safety foundation. Phase 2A deliberately exposes
// NO path from market signals to broker submissions — sessions can be created
// and observed, reconciliation can be run, but no scheduler exists.

function assertMongo(): void {
  if (mongoose.connection?.readyState !== 1) {
    throw new MongoUnavailableError();
  }
}

export async function health(): Promise<AutomationHealth> {
  return getAutomationHealth();
}

export type CreateSessionInput = {
  strategyVersionId: string;
  /** Single-symbol (Phase 2B) session. */
  underlying?: string | null;
  /** Universe (Phase 2.6) session: overrides AUTOMATION_UNDERLYINGS when set. */
  universe?: string[] | null;
};

export async function createSession(input: CreateSessionInput) {
  assertMongo();
  const session = await AutomationSessionModel.create({
    mode: 'paper',
    strategyVersionId: input.strategyVersionId,
    underlying: input.underlying ? input.underlying.toUpperCase() : null,
    universe: (input.universe ?? []).map(symbol => symbol.toUpperCase()),
    status: 'CREATED',
    healthStatus: 'UNAVAILABLE',
    reconciliationStatus: 'PENDING',
  });
  logAutomationEvent({
    service: 'session',
    event: 'SESSION_CREATED',
    automationSessionId: String(session._id),
    symbol: session.underlying,
    payload: {
      strategyVersionId: session.strategyVersionId,
      mode: session.mode,
      universe: session.universe,
    },
  });
  return session;
}

export async function listSessions(limit = 50) {
  assertMongo();
  return AutomationSessionModel.find({})
    .sort({ updatedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 200))
    .lean();
}

export async function getSession(id: string) {
  assertMongo();
  const session = await AutomationSessionModel.findById(id).lean().catch(() => null);
  if (!session) throw new NotFoundError(`Automation session ${id}`);
  return session;
}

export async function getSessionEvents(id: string, limit = 100) {
  assertMongo();
  await getSession(id);
  return listSessionEvents(id, limit);
}

export async function getSessionOrders(id: string, limit = 100) {
  assertMongo();
  await getSession(id);
  const [intents, brokerOrders] = await Promise.all([
    listSessionIntents(id, limit),
    listSessionBrokerOrders(id, limit),
  ]);
  return { intents, brokerOrders };
}

/** Operator-triggered reconciliation (same procedure as startup). */
export async function reconcileNow(): Promise<ReconciliationReport> {
  assertMongo();
  const runtime = getAutomationRuntime();
  const adapter = runtime.adapter ?? resolveBrokerAdapter();
  return runStartupReconciliation(adapter);
}

/**
 * Sprint 2E launch — promote a session to the runnable READY state and reconcile
 * it to CLEAN. A session is created as CREATED/PENDING; the evaluation scheduler
 * only runs READY + CLEAN sessions, so this is the operator's "go live" action
 * for a session. Reconciliation (which processes READY/PAUSED sessions) sets the
 * reconciliation status; if a proven automation position has lost its broker
 * order it pauses the session instead. Manual/external broker positions are
 * never inspected and can never pause a session.
 * Idempotent: an already-READY session is simply re-reconciled.
 */
export async function activateSession(id: string) {
  assertMongo();
  const session = await AutomationSessionModel.findById(id);
  if (!session) throw new NotFoundError(`Automation session ${id}`);
  if (session.status === 'CREATED' || session.status === 'PAUSED') {
    session.status = 'READY';
    session.healthStatus = 'HEALTHY';
    session.reconciliationStatus = 'PENDING';
    session.pauseReason = null;
    if (!session.startedAt) session.startedAt = new Date();
    await session.save();
    logAutomationEvent({
      service: 'session',
      event: 'SESSION_ACTIVATED',
      automationSessionId: String(session._id),
      payload: { status: session.status },
    });
  }
  // Reconcile against broker truth → CLEAN (or PAUSED if an orphan is found).
  const runtime = getAutomationRuntime();
  const adapter = runtime.adapter ?? resolveBrokerAdapter();
  await runStartupReconciliation(adapter).catch(() => undefined);
  const reloaded = await AutomationSessionModel.findById(id);
  return reloaded ?? session;
}

// ---------------------------------------------------------------------------
// Phase 2B: decision-pipeline reads + guarded evaluate-bar
// ---------------------------------------------------------------------------

export async function getSessionCandidates(id: string, limit = 100) {
  assertMongo();
  await getSession(id);
  const { TradeCandidateModel } = await import('./models/tradeCandidate.model');
  return TradeCandidateModel.find({ automationSessionId: id })
    .sort({ barTimestamp: -1 })
    .limit(Math.min(Math.max(limit, 1), 500))
    .lean();
}

export async function getSessionContractSelections(id: string, limit = 50) {
  assertMongo();
  await getSession(id);
  const { ContractSelectionModel } = await import('./models/contractSelection.model');
  return ContractSelectionModel.find({ automationSessionId: id })
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 200))
    .lean();
}

export async function getSessionRiskDecisions(id: string, limit = 100) {
  assertMongo();
  await getSession(id);
  const { RiskDecisionModel } = await import('./models/riskDecision.model');
  return RiskDecisionModel.find({ automationSessionId: id })
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 500))
    .lean();
}

/**
 * Evaluate one closed bar for a session. Fixtures are only honored when the
 * controller has verified the explicit test/dev gate; this function never
 * submits anything to a broker.
 */
export async function evaluateBar(id: string, fixture?: import('./services/closedBarProcessor.service').EvaluateBarFixture) {
  assertMongo();
  const runtime = getAutomationRuntime();
  const adapter = runtime.adapter ?? resolveBrokerAdapter();
  const { processClosedBar } = await import('./services/closedBarProcessor.service');
  return processClosedBar(id, adapter, fixture);
}

// ---------------------------------------------------------------------------
// Phase 2.6: configurable trading universe
// ---------------------------------------------------------------------------

/** The configured universe (dashboard: "current universe"). Config-only, no I/O. */
export async function getUniverse() {
  const { getUniverseConfig } = await import('./automation.config');
  return getUniverseConfig();
}

/** Current scheduler controller status (Phase 2C Sprint 1). */
export async function getSchedulerStatus() {
  const { getSchedulerStatus } = await import('./services/schedulerController.service');
  return getSchedulerStatus();
}

/** Persisted universe evaluations (dashboard: eligibility, ranking, selection). */
export async function getSessionUniverseEvaluations(id: string, limit = 20) {
  assertMongo();
  await getSession(id);
  const { UniverseEvaluationModel } = await import('./models/universeEvaluation.model');
  return UniverseEvaluationModel.find({ automationSessionId: id })
    .sort({ evaluatedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 100))
    .lean();
}

/**
 * Evaluate the whole configured universe for a session. Fixtures are only
 * honored when the controller has verified the explicit test/dev gate; this
 * function never submits anything to a broker.
 */
export async function evaluateUniverse(
  id: string,
  fixture?: import('./services/universeTickProcessor.service').UniverseTickFixture
) {
  assertMongo();
  const runtime = getAutomationRuntime();
  const adapter = runtime.adapter ?? resolveBrokerAdapter();
  const { processUniverseTick } = await import('./services/universeTickProcessor.service');
  return processUniverseTick(id, adapter, fixture);
}
