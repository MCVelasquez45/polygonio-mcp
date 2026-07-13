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
  underlying: string;
};

export async function createSession(input: CreateSessionInput) {
  assertMongo();
  const session = await AutomationSessionModel.create({
    mode: 'paper',
    strategyVersionId: input.strategyVersionId,
    underlying: input.underlying.toUpperCase(),
    status: 'CREATED',
    healthStatus: 'UNAVAILABLE',
    reconciliationStatus: 'PENDING',
  });
  logAutomationEvent({
    service: 'session',
    event: 'SESSION_CREATED',
    automationSessionId: String(session._id),
    symbol: session.underlying,
    payload: { strategyVersionId: session.strategyVersionId, mode: session.mode },
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
