import mongoose from 'mongoose';
import { CLIENT_ORDER_ID_PREFIX } from '../automation.constants';
import { MongoUnavailableError } from '../automation.errors';
import type { ReconciliationMismatch, ReconciliationReport } from '../automation.types';
import {
  AutomationSessionModel,
  RECOVERABLE_SESSION_STATUSES,
  type AutomationSessionDocument,
} from '../models/automationSession.model';
import {
  AutomationPositionModel,
  LIVE_POSITION_STATUSES,
} from '../models/automationPosition.model';
import { OrderIntentModel, UNRESOLVED_INTENT_STATUSES } from '../models/orderIntent.model';
import { logAutomationEvent } from './automationAudit.service';
import { isAutomationOwned } from './automationOwnership.service';
import type { PaperBrokerAdapter } from './brokerAdapter';
import { recordBrokerOrderSnapshot } from './orderIntent.service';

// Startup reconciliation: local journal vs broker truth.
//
// Runs before the (future) scheduler may start and before automationReady can
// become true. NEVER submits, resubmits, closes, or recreates orders — its
// only powers are: import broker facts, advance local records to match broker
// truth, pause sessions, and park ambiguity in MANUAL_REVIEW.

let lastReconciliation: ReconciliationReport | null = null;

export function getLastReconciliation(): ReconciliationReport | null {
  return lastReconciliation;
}

export function clearReconciliationStateForTests(): void {
  lastReconciliation = null;
}

function isOurs(clientOrderId: string | null | undefined): boolean {
  return Boolean(clientOrderId && clientOrderId.startsWith(CLIENT_ORDER_ID_PREFIX));
}

export async function runStartupReconciliation(adapter: PaperBrokerAdapter): Promise<ReconciliationReport> {
  if (mongoose.connection?.readyState !== 1) {
    throw new MongoUnavailableError('Reconciliation requires MongoDB');
  }

  const startedAt = new Date();
  const mismatches: ReconciliationMismatch[] = [];
  const pausedSessionIds = new Set<string>();
  let matchedOrders = 0;

  logAutomationEvent({ service: 'reconciliation', event: 'RECONCILIATION_STARTED' });

  try {
    // 1. Active/recoverable sessions.
    const sessions = await AutomationSessionModel.find({ status: { $in: RECOVERABLE_SESSION_STATUSES } });
    const sessionsById = new Map(sessions.map(session => [String(session._id), session]));

    // 2. Unresolved local intents.
    const intents = await OrderIntentModel.find({ status: { $in: UNRESOLVED_INTENT_STATUSES } });

    // 3+4. Broker truth. We enumerate broker ORDERS (each carries our
    //      deterministic client_order_id, the only proof of ownership) but we
    //      NEVER enumerate broker positions to look for automation work —
    //      ownership can never be inferred from a position's symbol/underlying.
    const brokerOpenOrders = await adapter.listOpenOrders();
    const openByClientId = new Map(
      brokerOpenOrders.filter(order => order.clientOrderId).map(order => [order.clientOrderId as string, order])
    );

    const pauseSession = async (
      session: AutomationSessionDocument | undefined,
      reason: string
    ) => {
      if (!session) return;
      const id = String(session._id);
      if (pausedSessionIds.has(id)) return;
      pausedSessionIds.add(id);
      session.status = 'PAUSED';
      session.pauseReason = reason;
      session.pausedAt = new Date();
      session.reconciliationStatus = 'MANUAL_REVIEW';
      await session.save();
      logAutomationEvent({
        service: 'reconciliation',
        event: 'SESSION_PAUSED',
        severity: 'critical',
        automationSessionId: id,
        payload: { reason },
      });
    };

    // 5–7. Match local intents against broker orders.
    for (const intent of intents) {
      const session = sessionsById.get(intent.automationSessionId);

      if (intent.status === 'CREATED') {
        // Never attempted a broker call — inherently safe; nothing to reconcile.
        continue;
      }

      // Resolve by broker order id first, then client order id.
      let brokerOrder = null;
      try {
        if (intent.brokerOrderId) {
          brokerOrder = await adapter.getOrder(intent.brokerOrderId).catch(() => null);
        }
        if (!brokerOrder) {
          brokerOrder = await adapter.getOrderByClientOrderId(intent.clientOrderId);
        }
      } catch {
        brokerOrder = null;
      }

      if (brokerOrder) {
        matchedOrders += 1;
        await recordBrokerOrderSnapshot(brokerOrder, {
          source: 'reconciliation',
          intentId: String(intent._id),
          automationSessionId: intent.automationSessionId,
        });
        intent.brokerOrderId = brokerOrder.brokerOrderId;
        intent.status = brokerOrder.status === 'REJECTED' ? 'BROKER_REJECTED' : 'SUBMITTED';
        intent.lastReconciledAt = new Date();
        await intent.save();
        continue;
      }

      // 6. Local order (submitting/submitted) missing at broker → MANUAL_REVIEW.
      intent.status = 'MANUAL_REVIEW';
      intent.lastReconciledAt = new Date();
      await intent.save();
      const mismatch: ReconciliationMismatch = {
        kind: 'LOCAL_ORDER_MISSING_AT_BROKER',
        detail: `Intent ${String(intent._id)} (${intent.clientOrderId}) has no matching broker order`,
        automationSessionId: intent.automationSessionId,
        intentId: String(intent._id),
        clientOrderId: intent.clientOrderId,
        symbol: intent.optionSymbol ?? intent.underlying,
        resolution: 'MANUAL_REVIEW',
      };
      mismatches.push(mismatch);
      logAutomationEvent({
        service: 'reconciliation',
        event: 'LOCAL_ORDER_MISSING_AT_BROKER',
        severity: 'critical',
        automationSessionId: intent.automationSessionId,
        intentId: String(intent._id),
        payload: { clientOrderId: intent.clientOrderId },
      });
      await pauseSession(session, `Reconciliation: local order ${intent.clientOrderId} missing at broker`);
    }

    // 7. Broker orders that carry OUR client-id prefix but have no local intent.
    //    (Orders without our prefix belong to manual/UI trading — ignored.)
    const knownClientIds = new Set(
      (await OrderIntentModel.find({}, { clientOrderId: 1 }).lean()).map(doc => doc.clientOrderId)
    );
    for (const [clientOrderId, order] of openByClientId) {
      if (!isOurs(clientOrderId) || knownClientIds.has(clientOrderId)) continue;
      // Import safely (journaled, unowned) + flag. Never cancel or adopt.
      await recordBrokerOrderSnapshot(order, { source: 'reconciliation' });
      mismatches.push({
        kind: 'BROKER_ORDER_MISSING_LOCALLY',
        detail: `Broker order ${order.brokerOrderId} (${clientOrderId}) has no local intent`,
        brokerOrderId: order.brokerOrderId,
        clientOrderId,
        symbol: order.symbol,
        resolution: 'IMPORTED',
      });
      logAutomationEvent({
        service: 'reconciliation',
        event: 'BROKER_ORDER_MISSING_LOCALLY',
        severity: 'critical',
        brokerOrderId: order.brokerOrderId,
        symbol: order.symbol,
        payload: { clientOrderId, imported: true },
      });
    }

    // 8. Reconcile AUTOMATION-OWNED positions against broker truth. This is the
    //    ONLY position-level reconciliation, and it starts from durable
    //    AutomationPosition records — never from broker positions. Ownership is
    //    proven by the position's deterministic entry client_order_id (the chain
    //    session → intent → client_order_id → broker order → position). A broker
    //    position we cannot reach through this chain is manual/external and is
    //    left completely untouched (Portfolio-only). We never infer ownership
    //    from symbol, underlying, strike, expiration, side, or quantity.
    let automationPositionsReconciled = 0;
    const livePositions = await AutomationPositionModel.find({
      status: { $in: LIVE_POSITION_STATUSES },
    });
    for (const position of livePositions) {
      // Fail closed: only reconcile provably automation-owned positions.
      if (!isAutomationOwned(position)) continue;
      const session = sessionsById.get(position.automationSessionId);

      // Prove the automation entry order behind this position still exists at
      // the broker — resolve by broker order id first, then our client_order_id.
      let brokerOrder = null;
      try {
        if (position.entryBrokerOrderId) {
          brokerOrder = await adapter.getOrder(position.entryBrokerOrderId).catch(() => null);
        }
        if (!brokerOrder) {
          brokerOrder = await adapter.getOrderByClientOrderId(position.entryClientOrderId);
        }
      } catch {
        brokerOrder = null;
      }

      if (brokerOrder) {
        // Ownership proven → advance the position's broker-truth timestamp only.
        automationPositionsReconciled += 1;
        position.lastBrokerReconciledAt = new Date();
        await position.save();
        continue;
      }

      // Our own entry order has vanished at the broker — a genuine automation
      // ambiguity (never a manual position, which has no AutomationPosition).
      // Park for operator review and pause the session. Never touch broker truth.
      position.status = 'MANUAL_REVIEW';
      position.manualReviewReason =
        `Reconciliation: automation entry order ${position.entryClientOrderId} missing at broker`;
      position.lastBrokerReconciledAt = new Date();
      await position.save();
      mismatches.push({
        kind: 'AUTOMATION_POSITION_ORDER_MISSING',
        detail: `Automation position ${position.optionSymbol} (${position.entryClientOrderId}) has no matching broker order`,
        automationSessionId: position.automationSessionId,
        clientOrderId: position.entryClientOrderId,
        symbol: position.optionSymbol,
        resolution: 'MANUAL_REVIEW',
      });
      logAutomationEvent({
        service: 'reconciliation',
        event: 'AUTOMATION_POSITION_ORDER_MISSING',
        severity: 'critical',
        automationSessionId: position.automationSessionId,
        symbol: position.optionSymbol,
        payload: { entryClientOrderId: position.entryClientOrderId, status: position.status },
      });
      await pauseSession(
        session,
        `Reconciliation: automation entry order ${position.entryClientOrderId} missing at broker`
      );
    }

    // 9–11. Persist outcomes on the clean sessions.
    const now = new Date();
    for (const session of sessions) {
      if (pausedSessionIds.has(String(session._id))) continue;
      session.reconciliationStatus = 'CLEAN';
      session.lastReconciledAt = now;
      await session.save();
    }

    const report: ReconciliationReport = {
      startedAt,
      finishedAt: new Date(),
      status: mismatches.length ? 'MISMATCH' : 'CLEAN',
      sessionsScanned: sessions.length,
      intentsScanned: intents.length,
      brokerOpenOrders: brokerOpenOrders.length,
      automationPositionsReconciled,
      matchedOrders,
      mismatches,
      pausedSessionIds: [...pausedSessionIds],
    };
    lastReconciliation = report;

    // 12. Structured completion event.
    logAutomationEvent({
      service: 'reconciliation',
      event: 'RECONCILIATION_COMPLETE',
      severity: mismatches.length ? 'warning' : 'info',
      payload: {
        status: report.status,
        sessionsScanned: report.sessionsScanned,
        intentsScanned: report.intentsScanned,
        brokerOpenOrders: report.brokerOpenOrders,
        automationPositionsReconciled: report.automationPositionsReconciled,
        matchedOrders,
        mismatchCount: mismatches.length,
        pausedSessionIds: report.pausedSessionIds,
      },
    });
    return report;
  } catch (error) {
    const report: ReconciliationReport = {
      startedAt,
      finishedAt: new Date(),
      status: 'FAILED',
      sessionsScanned: 0,
      intentsScanned: 0,
      brokerOpenOrders: 0,
      automationPositionsReconciled: 0,
      matchedOrders,
      mismatches,
      pausedSessionIds: [...pausedSessionIds],
      error: (error as Error)?.message?.slice(0, 500),
    };
    lastReconciliation = report;
    logAutomationEvent({
      service: 'reconciliation',
      event: 'RECONCILIATION_FAILED',
      severity: 'critical',
      payload: { error: report.error },
    });
    return report;
  }
}
