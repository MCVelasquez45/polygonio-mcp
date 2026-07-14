import { getBrokerLifecycleConfig } from '../automation.config';
import { BrokerOrderModel } from '../models/brokerOrder.model';
import { OrderIntentModel } from '../models/orderIntent.model';
import { logAutomationEvent } from './automationAudit.service';
import type { PaperBrokerAdapter } from './brokerAdapter';
import { ingestBrokerOrderUpdate, TERMINAL_BROKER_STATES } from './brokerUpdateIngestion.service';

// Phase 2C Sprint 3 — recurring order-reconciliation worker + broker-stream
// health. Because the current Alpaca integration has no trade-update stream,
// REST reconciliation IS the authoritative path that keeps broker truth
// current; the stream-health state reports DEGRADED_REST accordingly. When a
// real stream is added, mark events via markStreamEvent/markStreamState and
// REST becomes the recovery/verification path instead.

// ---------------------------------------------------------------------------
// Broker-stream health
// ---------------------------------------------------------------------------

export type BrokerStreamState = 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED' | 'DEGRADED_REST';

type StreamHealth = {
  state: BrokerStreamState;
  streamEnabled: boolean;
  lastEventAt: Date | null;
  lastRestReconciliationAt: Date | null;
  unresolvedContradictions: number;
};

const streamHealth: StreamHealth = {
  // No trade-update stream is wired yet → REST reconciliation is the truth path.
  state: 'DEGRADED_REST',
  streamEnabled: getBrokerLifecycleConfig().streamEnabled,
  lastEventAt: null,
  lastRestReconciliationAt: null,
  unresolvedContradictions: 0,
};

export function getBrokerStreamHealth(): Readonly<StreamHealth> & { truthCurrent: boolean } {
  return { ...streamHealth, truthCurrent: isBrokerTruthCurrent() };
}

export function markStreamEvent(now: Date = new Date()): void {
  streamHealth.lastEventAt = now;
}

export function markStreamState(state: BrokerStreamState): void {
  streamHealth.state = state;
}

export function markRestReconciliation(now: Date = new Date()): void {
  streamHealth.lastRestReconciliationAt = now;
}

/**
 * Is broker truth current enough to submit new orders? True when the stream is
 * CONNECTED, or when REST reconciliation ran within the staleness window. A
 * disconnected stream with stale REST → false (submissions blocked).
 */
export function isBrokerTruthCurrent(now: number = Date.now()): boolean {
  if (streamHealth.state === 'CONNECTED' && streamHealth.lastEventAt) return true;
  const { reconciliationStaleMs } = getBrokerLifecycleConfig();
  const lastRest = streamHealth.lastRestReconciliationAt?.getTime();
  return lastRest != null && now - lastRest <= reconciliationStaleMs;
}

/** Test-only reset. */
export function resetBrokerStreamHealthForTests(): void {
  streamHealth.state = 'DEGRADED_REST';
  streamHealth.streamEnabled = getBrokerLifecycleConfig().streamEnabled;
  streamHealth.lastEventAt = null;
  streamHealth.lastRestReconciliationAt = null;
  streamHealth.unresolvedContradictions = 0;
}

// ---------------------------------------------------------------------------
// Reconciliation worker
// ---------------------------------------------------------------------------

export type ReconcileSummary = {
  scanned: number;
  applied: number;
  stale: number;
  contradictions: number;
  errors: number;
  ranAt: string;
};

/** Nonterminal automation broker orders that still need broker verification. */
async function findNonterminalBrokerOrders() {
  return BrokerOrderModel.find({
    intentId: { $ne: null },
    status: { $nin: [...TERMINAL_BROKER_STATES] },
  }).lean();
}

/**
 * Reconcile every nonterminal automation broker order against Alpaca truth.
 * Idempotent; each order is claimed atomically so two workers never reconcile
 * the same order concurrently. Also recovers ack-lost intents (SUBMITTING with
 * a client_order_id but no broker order) by client_order_id lookup.
 */
export async function reconcileNonterminalAutomationOrders(
  adapter: PaperBrokerAdapter,
  now: Date = new Date()
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { scanned: 0, applied: 0, stale: 0, contradictions: 0, errors: 0, ranAt: now.toISOString() };
  const { reconciliationIntervalMs } = getBrokerLifecycleConfig();
  const claimStaleBefore = new Date(now.getTime() - Math.max(30_000, reconciliationIntervalMs * 2));

  const orders = await findNonterminalBrokerOrders();
  for (const order of orders) {
    // DB-backed claim: only one worker reconciles a given order at a time.
    const claim = await BrokerOrderModel.updateOne(
      {
        brokerOrderId: order.brokerOrderId,
        $or: [{ reconcileClaimedAt: null }, { reconcileClaimedAt: { $lte: claimStaleBefore } }],
      },
      { $set: { reconcileClaimedAt: now } }
    );
    if (claim.modifiedCount !== 1) continue; // another worker owns it
    summary.scanned += 1;
    try {
      const fresh = await adapter.getOrder(order.brokerOrderId);
      const res = await ingestBrokerOrderUpdate(fresh, 'reconciliation');
      if (res.transition === 'CONTRADICTION') summary.contradictions += 1;
      else if (res.transition === 'STALE' || res.transition === 'DUPLICATE') summary.stale += 1;
      else if (res.processed) summary.applied += 1;
    } catch {
      summary.errors += 1;
    } finally {
      await BrokerOrderModel.updateOne({ brokerOrderId: order.brokerOrderId }, { $set: { reconcileClaimedAt: null } });
    }
  }

  // Recover intents whose submit ack was lost (no broker order yet).
  const ackLost = await OrderIntentModel.find({ status: 'SUBMITTING', brokerOrderId: null }).lean();
  for (const intent of ackLost) {
    try {
      const found = await adapter.getOrderByClientOrderId(intent.clientOrderId);
      if (found) {
        summary.scanned += 1;
        const res = await ingestBrokerOrderUpdate(found, 'reconciliation');
        if (res.processed) summary.applied += 1;
      }
    } catch {
      summary.errors += 1;
    }
  }

  markRestReconciliation(now);
  streamHealth.unresolvedContradictions = await countUnresolvedContradictions();
  logAutomationEvent({
    service: 'order-reconciliation',
    event: 'ORDER_RECONCILIATION_RUN',
    payload: summary as unknown as Record<string, unknown>,
  });
  return summary;
}

async function countUnresolvedContradictions(): Promise<number> {
  return BrokerOrderModel.countDocuments({ status: 'MANUAL_REVIEW', intentId: { $ne: null } });
}

/**
 * Whether an unresolved automation order exists — new submissions must be
 * blocked while one does (a nonterminal order needing verification, or an order
 * in MANUAL_REVIEW).
 */
export async function hasUnresolvedAutomationOrder(): Promise<boolean> {
  const manualReview = await BrokerOrderModel.countDocuments({ status: 'MANUAL_REVIEW', intentId: { $ne: null } });
  if (manualReview > 0) return true;
  const manualReviewIntents = await OrderIntentModel.countDocuments({ status: 'MANUAL_REVIEW' });
  return manualReviewIntents > 0;
}

// ---------------------------------------------------------------------------
// Recurring worker controller
// ---------------------------------------------------------------------------

let workerTimer: ReturnType<typeof setInterval> | null = null;

export function startOrderReconciliationWorker(adapter: PaperBrokerAdapter): boolean {
  if (workerTimer) return false;
  const { reconciliationIntervalMs } = getBrokerLifecycleConfig();
  workerTimer = setInterval(() => {
    reconcileNonterminalAutomationOrders(adapter).catch(error => {
      logAutomationEvent({
        service: 'order-reconciliation',
        event: 'ORDER_RECONCILIATION_ERROR',
        severity: 'warning',
        payload: { error: String((error as Error)?.message ?? error) },
      });
    });
  }, reconciliationIntervalMs);
  if (typeof workerTimer.unref === 'function') workerTimer.unref();
  logAutomationEvent({ service: 'order-reconciliation', event: 'ORDER_RECONCILIATION_WORKER_STARTED', payload: { reconciliationIntervalMs } });
  return true;
}

export function stopOrderReconciliationWorker(): void {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
}
