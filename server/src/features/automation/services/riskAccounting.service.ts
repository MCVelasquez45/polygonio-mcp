import { AutomationSessionModel, type AutomationSessionDocument } from '../models/automationSession.model';
import { AutomationPositionModel, type AutomationPositionDocument } from '../models/automationPosition.model';
import { logAutomationEvent } from './automationAudit.service';

// Phase 2C — broker-truth risk accounting (the mandatory feedback loop).
//
// After a broker-confirmed close, realized P&L is computed from broker fills
// and the session's durable risk counters are updated atomically. The risk
// engine reads these exact fields on its NEXT decision, so completed outcomes
// genuinely constrain future trading. Pure math is separated from persistence
// so it is fully unit-testable; the persistence path is idempotent per
// position (riskCounted guard) and never double-counts partials.

export type TradeResult = 'WIN' | 'LOSS' | 'BREAKEVEN';

export type RealizedTradeInput = {
  /** Filled contracts (the SAME quantity entered and exited; V1 exits in full). */
  quantity: number;
  avgEntryPrice: number;
  avgExitPrice: number;
  entryFees?: number | null;
  exitFees?: number | null;
};

export type RealizedTradeOutcome = {
  entryCost: number;
  exitProceeds: number;
  realizedPnl: number;
  returnPct: number | null;
  result: TradeResult;
};

const MULTIPLIER = 100; // standard US equity-option contract multiplier

/**
 * Realized P&L for a LONG option position (both bullish long-call and bearish
 * long-put are opened with BUY and closed with SELL):
 *   entryCost     = entryPrice × qty × 100 + entryFees
 *   exitProceeds  = exitPrice  × qty × 100 − exitFees
 *   realizedPnl   = exitProceeds − entryCost
 */
export function computeRealizedTrade(input: RealizedTradeInput): RealizedTradeOutcome {
  const qty = Math.max(0, input.quantity);
  const entryFees = input.entryFees ?? 0;
  const exitFees = input.exitFees ?? 0;
  const entryCost = Number((input.avgEntryPrice * qty * MULTIPLIER + entryFees).toFixed(2));
  const exitProceeds = Number((input.avgExitPrice * qty * MULTIPLIER - exitFees).toFixed(2));
  const realizedPnl = Number((exitProceeds - entryCost).toFixed(2));
  const returnPct = entryCost > 0 ? Number((realizedPnl / entryCost).toFixed(4)) : null;
  const result: TradeResult = realizedPnl > 0 ? 'WIN' : realizedPnl < 0 ? 'LOSS' : 'BREAKEVEN';
  return { entryCost, exitProceeds, realizedPnl, returnPct, result };
}

export type CounterState = {
  dailyRealizedPnl: number;
  dailyTradeCount: number;
  consecutiveLossCount: number;
  currentEquity: number | null;
  peakEquity: number | null;
  currentDrawdown: number;
  maxDrawdown: number;
  lastTradeResult: TradeResult;
};

/**
 * Fold one completed trade into the risk counters. Pure — returns the next
 * counter state, mutates nothing.
 *
 * Decisions (documented and applied consistently):
 *  - dailyTradeCount increments once per COMPLETED trade (entry+exit round trip).
 *  - WIN resets consecutive losses to 0; LOSS increments; BREAKEVEN leaves it.
 *  - drawdown is measured off peak equity in dollars (peak − current), never negative.
 */
export function applyRealizedTradeToCounters(
  prev: {
    dailyRealizedPnl: number;
    dailyTradeCount: number;
    consecutiveLossCount: number;
    peakEquity: number | null;
    maxDrawdown: number;
  },
  outcome: RealizedTradeOutcome,
  brokerEquityAfterClose: number | null
): CounterState {
  const dailyRealizedPnl = Number((prev.dailyRealizedPnl + outcome.realizedPnl).toFixed(2));
  const dailyTradeCount = prev.dailyTradeCount + 1;
  const consecutiveLossCount =
    outcome.result === 'WIN' ? 0 : outcome.result === 'LOSS' ? prev.consecutiveLossCount + 1 : prev.consecutiveLossCount;

  const currentEquity = brokerEquityAfterClose;
  const peakEquity =
    currentEquity == null
      ? prev.peakEquity
      : prev.peakEquity == null
        ? currentEquity
        : Math.max(prev.peakEquity, currentEquity);
  const currentDrawdown =
    peakEquity != null && currentEquity != null ? Math.max(0, Number((peakEquity - currentEquity).toFixed(2))) : 0;
  const maxDrawdown = Number(Math.max(prev.maxDrawdown, currentDrawdown).toFixed(2));

  return {
    dailyRealizedPnl,
    dailyTradeCount,
    consecutiveLossCount,
    currentEquity,
    peakEquity,
    currentDrawdown,
    maxDrawdown,
    lastTradeResult: outcome.result,
  };
}

/**
 * Persist a completed trade's risk impact exactly once. Loads the position and
 * session, computes realized P&L from broker-truth fills, and atomically
 * updates the session counters. Idempotent: a position already counted
 * (riskCounted) is a no-op.
 */
export async function recordClosedTradeRisk(
  positionId: string,
  brokerEquityAfterClose: number | null,
  now: Date = new Date()
): Promise<{ counted: boolean; outcome: RealizedTradeOutcome | null }> {
  const position = await AutomationPositionModel.findById(positionId);
  if (!position) return { counted: false, outcome: null };
  if (position.riskCounted) return { counted: false, outcome: null };
  if (position.avgEntryPrice == null || position.avgExitPrice == null || position.filledQty <= 0) {
    return { counted: false, outcome: null };
  }

  const outcome = computeRealizedTrade({
    quantity: position.filledQty,
    avgEntryPrice: position.avgEntryPrice,
    avgExitPrice: position.avgExitPrice,
    entryFees: position.entryFees,
    exitFees: position.exitFees,
  });

  // Claim the count atomically: flip riskCounted false→true in one update so a
  // concurrent caller cannot double-count. Only the winner proceeds.
  const claim = await AutomationPositionModel.updateOne(
    { _id: position._id, riskCounted: false },
    { $set: { riskCounted: true, realizedPnl: outcome.realizedPnl, returnPct: outcome.returnPct } }
  );
  if (claim.modifiedCount !== 1) return { counted: false, outcome: null };

  const sessionDoc = await AutomationSessionModel.findById(position.automationSessionId);
  if (!sessionDoc) return { counted: true, outcome };

  const next = applyRealizedTradeToCounters(
    {
      dailyRealizedPnl: sessionDoc.dailyRealizedPnl,
      dailyTradeCount: sessionDoc.dailyTradeCount,
      consecutiveLossCount: sessionDoc.consecutiveLossCount,
      peakEquity: sessionDoc.peakEquity,
      maxDrawdown: sessionDoc.maxDrawdown,
    },
    outcome,
    brokerEquityAfterClose
  );

  sessionDoc.dailyRealizedPnl = next.dailyRealizedPnl;
  sessionDoc.dailyTradeCount = next.dailyTradeCount;
  sessionDoc.consecutiveLossCount = next.consecutiveLossCount;
  sessionDoc.currentDrawdown = next.currentDrawdown;
  sessionDoc.maxDrawdown = next.maxDrawdown;
  if (next.peakEquity != null) sessionDoc.peakEquity = next.peakEquity;
  sessionDoc.lastClosedTradeAt = now;
  sessionDoc.lastTradeResult = next.lastTradeResult;
  await sessionDoc.save();

  logAutomationEvent({
    service: 'risk-accounting',
    event: 'TRADE_RISK_RECORDED',
    severity: next.lastTradeResult === 'LOSS' ? 'warning' : 'info',
    automationSessionId: String(sessionDoc._id),
    symbol: position.optionSymbol,
    payload: {
      positionId: String(position._id),
      realizedPnl: outcome.realizedPnl,
      returnPct: outcome.returnPct,
      result: outcome.result,
      dailyRealizedPnl: next.dailyRealizedPnl,
      dailyTradeCount: next.dailyTradeCount,
      consecutiveLossCount: next.consecutiveLossCount,
      currentDrawdown: next.currentDrawdown,
    },
  });

  return { counted: true, outcome };
}

/**
 * Rebuild a session's daily counters from durable CLOSED positions for the
 * current exchange trading day — the restart-recovery path. Deterministic and
 * idempotent: derives counters purely from persisted realized trades.
 */
export async function rebuildDailyCountersFromPositions(
  session: AutomationSessionDocument,
  dayStart: Date,
  dayEnd: Date
): Promise<void> {
  const closed = await AutomationPositionModel.find({
    automationSessionId: String(session._id),
    status: 'CLOSED',
    closedAt: { $gte: dayStart, $lt: dayEnd },
  })
    .sort({ closedAt: 1 })
    .lean();

  let dailyRealizedPnl = 0;
  let dailyTradeCount = 0;
  let consecutiveLossCount = 0;
  let lastTradeResult: TradeResult | null = null;
  for (const pos of closed) {
    const pnl = pos.realizedPnl ?? 0;
    dailyRealizedPnl += pnl;
    dailyTradeCount += 1;
    if (pnl > 0) {
      consecutiveLossCount = 0;
      lastTradeResult = 'WIN';
    } else if (pnl < 0) {
      consecutiveLossCount += 1;
      lastTradeResult = 'LOSS';
    } else {
      lastTradeResult = 'BREAKEVEN';
    }
  }

  session.dailyRealizedPnl = Number(dailyRealizedPnl.toFixed(2));
  session.dailyTradeCount = dailyTradeCount;
  session.consecutiveLossCount = consecutiveLossCount;
  session.lastTradeResult = lastTradeResult;
  await session.save();
}
