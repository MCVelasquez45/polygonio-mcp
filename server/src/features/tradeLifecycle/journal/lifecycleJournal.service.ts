import {
  TradeLifecycleJournalModel,
  type TradeLifecycleDocument,
} from '../storage/tradeLifecycle.model';
import type { TradeLifecycleState } from '../types/lifecycleTypes';

export async function appendLifecycleJournal(input: {
  tradeId: string;
  eventType: string;
  state: TradeLifecycleState;
  previousState: TradeLifecycleState | null;
  source: string;
  reason: string;
  confidence: TradeLifecycleDocument['confidence'];
  payload?: Record<string, unknown>;
  at?: Date;
}) {
  return TradeLifecycleJournalModel.create({
    tradeId: input.tradeId,
    at: input.at ?? new Date(),
    eventType: input.eventType,
    state: input.state,
    previousState: input.previousState,
    source: input.source,
    reason: input.reason,
    confidence: {
      entry: input.confidence.entry,
      current: input.confidence.current,
      trend: input.confidence.trend,
      delta: input.confidence.delta,
    },
    payload: input.payload ?? {},
  });
}

export async function listLifecycleJournal(tradeId?: string, limit = 200) {
  const query = tradeId ? { tradeId } : {};
  return TradeLifecycleJournalModel.find(query)
    .sort({ at: -1 })
    .limit(Math.min(Math.max(limit, 1), 500))
    .lean();
}
