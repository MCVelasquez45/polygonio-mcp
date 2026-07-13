import mongoose from 'mongoose';
import { AUTOMATION_ENV } from '../automation.constants';
import { LiveTradingBlockedError } from '../automation.errors';
import { AutomationEventModel } from '../models/automationEvent.model';
import { AutomationSessionModel } from '../models/automationSession.model';
import { BrokerOrderModel } from '../models/brokerOrder.model';
import { OrderIntentModel } from '../models/orderIntent.model';
import { createAlpacaPaperBrokerAdapter } from './alpacaPaperBrokerAdapter.service';
import { logAutomationEvent } from './automationAudit.service';
import type { PaperBrokerAdapter } from './brokerAdapter';
import { MockPaperBrokerAdapter } from './mockPaperBrokerAdapter.service';
import { getLastReconciliation, runStartupReconciliation } from './reconciliation.service';

// Automation lifecycle owner: init gates, adapter selection, and readiness.
//
// Fail-closed contract:
//   MongoDB disconnected → status UNAVAILABLE, no scheduler startup, no new
//   intents, no broker submissions, structured error event.
//   Live broker config  → status FAILED (LiveTradingBlockedError).
//   Readiness is only true after startup reconciliation has COMPLETED.

export type AutomationRuntimeState =
  | 'DISABLED'
  | 'UNAVAILABLE'
  | 'INITIALIZING'
  | 'READY'
  | 'FAILED';

type AutomationRuntime = {
  state: AutomationRuntimeState;
  adapter: PaperBrokerAdapter | null;
  initializedAt: Date | null;
  lastError: string | null;
};

const runtime: AutomationRuntime = {
  state: 'UNAVAILABLE',
  adapter: null,
  initializedAt: null,
  lastError: null,
};

export function resetAutomationRuntimeForTests(): void {
  runtime.state = 'UNAVAILABLE';
  runtime.adapter = null;
  runtime.initializedAt = null;
  runtime.lastError = null;
}

export function getAutomationRuntime(): Readonly<AutomationRuntime> {
  return runtime;
}

/** True only when init succeeded AND startup reconciliation has completed. */
export function isAutomationReady(): boolean {
  const reconciliation = getLastReconciliation();
  return (
    runtime.state === 'READY' &&
    mongoose.connection?.readyState === 1 &&
    reconciliation != null &&
    reconciliation.status !== 'FAILED'
  );
}

/** Await every automation index build (unique constraints are load-bearing). */
export async function ensureAutomationIndexes(): Promise<void> {
  const models = [AutomationSessionModel, OrderIntentModel, BrokerOrderModel, AutomationEventModel];
  // Phase 2B models are loaded lazily to keep 2A boot lean.
  const [{ TradeCandidateModel }, { ContractSelectionModel }, { RiskDecisionModel }] = await Promise.all([
    import('../models/tradeCandidate.model'),
    import('../models/contractSelection.model'),
    import('../models/riskDecision.model'),
  ]);
  await Promise.all(
    [...models, TradeCandidateModel, ContractSelectionModel, RiskDecisionModel].map(model => model.init())
  );
}

export function resolveBrokerAdapter(explicit?: PaperBrokerAdapter): PaperBrokerAdapter {
  if (explicit) return explicit;
  if (runtime.adapter) return runtime.adapter;
  const kind = (process.env[AUTOMATION_ENV.broker] ?? 'alpaca-paper').toLowerCase();
  if (kind === 'mock') {
    return new MockPaperBrokerAdapter();
  }
  return createAlpacaPaperBrokerAdapter();
}

export type InitializeResult = {
  ready: boolean;
  state: AutomationRuntimeState;
  detail: string;
};

/**
 * Boot-time initialization. Order matters:
 *   1. enabled gate → 2. Mongo gate (fail closed) → 3. paper-only adapter
 *   construction (live config rejected) → 4. startup reconciliation →
 *   5. readiness.
 */
export async function initializeAutomation(
  options: { adapter?: PaperBrokerAdapter } = {}
): Promise<InitializeResult> {
  const enabled = (process.env[AUTOMATION_ENV.enabled] ?? 'true').toLowerCase() !== 'false';
  if (!enabled) {
    runtime.state = 'DISABLED';
    runtime.adapter = null;
    logAutomationEvent({
      service: 'recovery',
      event: 'AUTOMATION_DISABLED',
      payload: { reason: `${AUTOMATION_ENV.enabled}=false` },
    });
    return { ready: false, state: runtime.state, detail: 'automation disabled by configuration' };
  }

  // Mandatory MongoDB gate — fail closed.
  if (mongoose.connection?.readyState !== 1) {
    runtime.state = 'UNAVAILABLE';
    runtime.adapter = null;
    runtime.lastError = 'MongoDB disconnected';
    logAutomationEvent({
      service: 'recovery',
      event: 'AUTOMATION_UNAVAILABLE_MONGO_DOWN',
      severity: 'critical',
      payload: {
        detail: 'MongoDB disconnected — no scheduler startup, no order intents, no broker submissions',
      },
    });
    return { ready: false, state: runtime.state, detail: 'MongoDB is not connected (fail-closed)' };
  }

  // Paper-only broker construction; live configuration is structurally rejected.
  let adapter: PaperBrokerAdapter;
  try {
    adapter = resolveBrokerAdapter(options.adapter);
  } catch (error) {
    runtime.state = 'FAILED';
    runtime.adapter = null;
    runtime.lastError = (error as Error)?.message?.slice(0, 300) ?? 'adapter construction failed';
    logAutomationEvent({
      service: 'recovery',
      event: error instanceof LiveTradingBlockedError ? 'LIVE_TRADING_BLOCKED' : 'BROKER_ADAPTER_FAILED',
      severity: 'critical',
      payload: { message: runtime.lastError },
    });
    return { ready: false, state: runtime.state, detail: runtime.lastError };
  }

  runtime.state = 'INITIALIZING';
  runtime.adapter = adapter;
  logAutomationEvent({
    service: 'recovery',
    event: 'AUTOMATION_INITIALIZING',
    payload: { broker: adapter.describe() },
  });

  // The idempotency guarantees (unique idempotencyKey, unique candidate bar
  // key) DEPEND on their indexes existing. Await index builds before any
  // evaluation or readiness — Model.init() resolves when indexes are built.
  await ensureAutomationIndexes();

  // Startup reconciliation MUST complete before readiness.
  const report = await runStartupReconciliation(adapter);
  if (report.status === 'FAILED') {
    runtime.state = 'UNAVAILABLE';
    runtime.lastError = report.error ?? 'reconciliation failed';
    logAutomationEvent({
      service: 'recovery',
      event: 'AUTOMATION_NOT_READY',
      severity: 'critical',
      payload: { reason: 'startup reconciliation failed', error: runtime.lastError },
    });
    return { ready: false, state: runtime.state, detail: `reconciliation failed: ${runtime.lastError}` };
  }

  runtime.state = 'READY';
  runtime.initializedAt = new Date();
  runtime.lastError = null;
  logAutomationEvent({
    service: 'recovery',
    event: 'AUTOMATION_READY',
    payload: {
      broker: adapter.describe(),
      reconciliationStatus: report.status,
      mismatches: report.mismatches.length,
      pausedSessions: report.pausedSessionIds,
    },
  });
  return { ready: true, state: runtime.state, detail: `ready (reconciliation ${report.status})` };
}
