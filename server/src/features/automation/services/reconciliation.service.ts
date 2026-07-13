import mongoose from 'mongoose';
import { CLIENT_ORDER_ID_PREFIX } from '../automation.constants';
import { MongoUnavailableError } from '../automation.errors';
import type { ReconciliationMismatch, ReconciliationReport } from '../automation.types';
import {
  AutomationSessionModel,
  RECOVERABLE_SESSION_STATUSES,
  type AutomationSessionDocument,
} from '../models/automationSession.model';
import { OrderIntentModel, UNRESOLVED_INTENT_STATUSES } from '../models/orderIntent.model';
import { logAutomationEvent } from './automationAudit.service';
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

    // 3+4. Broker truth.
    const brokerOpenOrders = await adapter.listOpenOrders();
    const brokerPositions = await adapter.listPositions();
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

    // 8. Orphaned broker positions on a session's underlying with no local intent.
    const intentSymbols = new Set(
      (await OrderIntentModel.find({}, { optionSymbol: 1, underlying: 1 }).lean()).flatMap(doc =>
        [doc.optionSymbol, doc.underlying].filter(Boolean).map(sym => String(sym).toUpperCase().replace(/^O:/, ''))
      )
    );
    for (const position of brokerPositions) {
      const symbol = position.symbol.toUpperCase().replace(/^O:/, '');
      if (intentSymbols.has(symbol)) continue;
      const owningSessions = sessions.filter(session =>
        symbol.startsWith(session.underlying.toUpperCase())
      );
      if (!owningSessions.length) continue; // not on any automation underlying → manual trading, ignore
      for (const session of owningSessions) {
        mismatches.push({
          kind: 'ORPHANED_BROKER_POSITION',
          detail: `Broker position ${position.symbol} (${position.qty}) has no local intent for session underlying ${session.underlying}`,
          automationSessionId: String(session._id),
          symbol: position.symbol,
          resolution: 'SESSION_PAUSED',
        });
        logAutomationEvent({
          service: 'reconciliation',
          event: 'ORPHANED_BROKER_POSITION',
          severity: 'critical',
          automationSessionId: String(session._id),
          symbol: position.symbol,
          payload: { qty: position.qty, side: position.side },
        });
        await pauseSession(session, `Reconciliation: orphaned broker position ${position.symbol}`);
      }
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
      brokerPositions: brokerPositions.length,
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
        brokerPositions: report.brokerPositions,
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
      brokerPositions: 0,
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
