import { getMarketHoursConfig } from './automation.config';
import type { BrokerOrder } from './automation.types';
import {
  AutomationPositionModel,
  LIVE_POSITION_STATUSES,
  type AutomationPositionDocument,
} from './models/automationPosition.model';
import { AutomationSessionModel, type AutomationSessionDocument } from './models/automationSession.model';
import { logAutomationEvent } from './services/automationAudit.service';
import type { PaperBrokerAdapter } from './services/brokerAdapter';
import { deriveMarketSession, type MarketSessionState } from './services/marketSession.service';
import {
  applyEntryFill,
  monitorAndMaybeExit,
  reconcileExit,
  submitExit,
  type MonitorContext,
} from './services/positionManager.service';
import { isAutomationReady } from './services/sessionRecovery.service';

// Phase 2C — the market-hours automation scheduler tick.
//
// One tick is a pure-ish orchestration over injected dependencies so it is
// fully testable with the mock broker and fixture marks. Responsibilities:
//   market-session gate → (entries only PRE_CUTOFF) → monitor live positions
//   → cancel unfilled entries in the cancel window → flatten before close.
// It NEVER submits directly: entries go through executeApprovedEntry, exits
// through submitExit — both idempotent, both broker-truth.

export type MarkProvider = (symbol: string) => Promise<{ mark: number | null; stale: boolean }>;

/** Runs one entry evaluation+execution pass; returns intents submitted. */
export type EntryEvaluator = (
  session: AutomationSessionDocument,
  adapter: PaperBrokerAdapter,
  session2: MarketSessionState
) => Promise<{ submitted: number }>;

export type SchedulerTickDeps = {
  /** Authoritative current option mark for monitoring. Live: Massive quotes. */
  markProvider: MarkProvider;
  /** Entry evaluation+execution. Live: options-native universe evaluation. */
  entryEvaluator?: EntryEvaluator;
  /** Whether the session strategy signal now contradicts an open position. */
  strategyInvalidated?: (position: AutomationPositionDocument) => boolean;
  now?: number;
};

export type SchedulerTickResult = {
  sessionState: MarketSessionState;
  entriesSubmitted: number;
  positionsMonitored: number;
  exitsTriggered: number;
  entryOrdersCancelled: number;
  skipped: string | null;
};

async function reconcilePendingEntry(
  position: AutomationPositionDocument,
  adapter: PaperBrokerAdapter
): Promise<void> {
  if (!position.entryBrokerOrderId) return;
  const order = await adapter.getOrder(position.entryBrokerOrderId).catch(() => null);
  if (order) {
    applyEntryFill(position, order);
    await position.save();
  }
}

/**
 * Cancel an unfilled automation ENTRY order at the broker and mark its position
 * for review if nothing filled. Filled quantity is preserved (partial fills
 * remain real positions that flattening will exit).
 */
async function cancelUnfilledEntry(
  position: AutomationPositionDocument,
  adapter: PaperBrokerAdapter
): Promise<boolean> {
  if (position.status !== 'PENDING_ENTRY' || !position.entryBrokerOrderId) return false;
  let order: BrokerOrder | null = null;
  try {
    order = await adapter.cancelOrder(position.entryBrokerOrderId);
  } catch {
    return false;
  }
  if (order) applyEntryFill(position, order);
  // Nothing filled → no position to manage; leave PENDING_ENTRY resolved.
  if (position.filledQty === 0 && (position.status as string) === 'PENDING_ENTRY') {
    position.status = 'MANUAL_REVIEW';
  }
  await position.save();
  logAutomationEvent({
    service: 'scheduler',
    event: 'ENTRY_ORDER_CANCELLED',
    automationSessionId: position.automationSessionId,
    symbol: position.optionSymbol,
    payload: { brokerOrderId: position.entryBrokerOrderId, filledQty: position.filledQty },
  });
  return true;
}

/**
 * Execute one scheduler tick for a session. Deterministic given its deps.
 */
export async function runSchedulerTick(
  sessionId: string,
  adapter: PaperBrokerAdapter,
  deps: SchedulerTickDeps
): Promise<SchedulerTickResult> {
  const now = deps.now ?? Date.now();
  const session = await AutomationSessionModel.findById(sessionId);
  if (!session) throw new Error(`Automation session ${sessionId} not found`);

  const clock = await adapter.getClock();
  const sessionState = deriveMarketSession(clock, getMarketHoursConfig(), now);

  const result: SchedulerTickResult = {
    sessionState,
    entriesSubmitted: 0,
    positionsMonitored: 0,
    exitsTriggered: 0,
    entryOrdersCancelled: 0,
    skipped: null,
  };

  const emergencyStop = session.emergencyStop.active;

  // ---- entries: only when open, pre-cutoff, ready, and not emergency-stopped -
  const entriesReady =
    sessionState.entriesAllowed &&
    !emergencyStop &&
    session.status === 'READY' &&
    session.reconciliationStatus === 'CLEAN' &&
    isAutomationReady();
  if (entriesReady && deps.entryEvaluator) {
    const evaluation = await deps.entryEvaluator(session, adapter, sessionState);
    result.entriesSubmitted = evaluation.submitted;
  }

  // ---- cancel unfilled entry orders in the cancel window -------------------
  if (sessionState.shouldCancelEntries) {
    const pending = await AutomationPositionModel.find({
      automationSessionId: sessionId,
      status: 'PENDING_ENTRY',
    });
    for (const position of pending) {
      if (await cancelUnfilledEntry(position, adapter)) result.entryOrdersCancelled += 1;
    }
  }

  // ---- monitor live positions (always, even when closed: reconcile only) ----
  const live = await AutomationPositionModel.find({
    automationSessionId: sessionId,
    status: { $in: LIVE_POSITION_STATUSES },
  });
  for (const position of live) {
    result.positionsMonitored += 1;

    if (position.status === 'PENDING_ENTRY') {
      await reconcilePendingEntry(position, adapter);
    }

    if (position.status === 'EXITING') {
      await reconcileExit(position, adapter, new Date(now));
      continue;
    }

    if (position.status === 'OPEN') {
      // Broker-manual-close detection: position gone at broker → treat as closed.
      const brokerPos = await adapter.getPosition(position.optionSymbol).catch(() => undefined);
      const brokerClosed = brokerPos === null; // null = confirmed absent
      const { mark, stale } = await deps.markProvider(position.optionSymbol);

      // End-of-day flatten takes over ordinary monitoring.
      if (sessionState.shouldFlatten) {
        await submitExit(position, adapter, 'END_OF_DAY', new Date(now));
        result.exitsTriggered += 1;
        continue;
      }

      const ctx: MonitorContext = {
        emergencyStop,
        flatten: sessionState.shouldFlatten,
        brokerClosed,
        strategyInvalidated: deps.strategyInvalidated?.(position) ?? false,
        currentMark: mark,
        quoteStale: stale,
      };
      const outcome = await monitorAndMaybeExit(position, adapter, ctx, new Date(now));
      if (outcome.exited) result.exitsTriggered += 1;
    }
  }

  return result;
}

/**
 * Emergency-stop flatten: submit an EMERGENCY_STOP exit for every open
 * automation position in the session. Highest-priority exit; idempotent.
 */
export async function flattenAllOnEmergency(
  sessionId: string,
  adapter: PaperBrokerAdapter,
  now: Date = new Date()
): Promise<{ exits: number }> {
  const open = await AutomationPositionModel.find({ automationSessionId: sessionId, status: 'OPEN' });
  let exits = 0;
  for (const position of open) {
    const intent = await submitExit(position, adapter, 'EMERGENCY_STOP', now);
    if (intent) exits += 1;
  }
  // Cancel any still-pending entries too.
  const pending = await AutomationPositionModel.find({ automationSessionId: sessionId, status: 'PENDING_ENTRY' });
  for (const position of pending) {
    if (position.entryBrokerOrderId) {
      const order = await adapter.cancelOrder(position.entryBrokerOrderId).catch(() => null);
      if (order) applyEntryFill(position, order);
      if (position.filledQty === 0) position.status = 'MANUAL_REVIEW';
      await position.save();
    }
  }
  return { exits };
}
