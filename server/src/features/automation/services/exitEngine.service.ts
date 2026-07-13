import type { ExitReason } from '../models/automationPosition.model';

// Phase 2C — deterministic exit decision engine (pure).
//
// Given an open automation position, the current authoritative mark, and the
// session/market context, decide whether to exit and WHY. Triggers are ranked;
// the highest-priority active trigger wins. There is NO AI input and NO
// improvised exit — a trigger fires only when its deterministic condition holds.

// Priority order (highest first). Once an exit lifecycle starts, lower-priority
// triggers must not open a second exit — the caller enforces that via position
// status, but the ranking here defines which reason is recorded when several
// fire on the same evaluation.
export const EXIT_PRIORITY: ExitReason[] = [
  'EMERGENCY_STOP',
  'END_OF_DAY',
  'HARD_STOP',
  'BROKER_MANUAL_CLOSE',
  'OPERATOR_CLOSE',
  'PROFIT_TARGET',
  'STRATEGY_INVALIDATION',
];

export type ExitContext = {
  /** Session emergency stop is active. */
  emergencyStop: boolean;
  /** Market session is in the flatten window (end-of-day). */
  flatten: boolean;
  /** Broker reports the position already closed/absent (manual close detected). */
  brokerClosed: boolean;
  /** Options-native signal now contradicts the position direction (optional). */
  strategyInvalidated: boolean;
  /** Current authoritative option mark (mid), or null when data is unavailable. */
  currentMark: number | null;
  avgEntryPrice: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
};

export type ExitDecision = {
  shouldExit: boolean;
  reason: ExitReason | null;
  /** Every condition that was active this evaluation (for the audit trail). */
  activeTriggers: ExitReason[];
  detail: string;
};

/**
 * Evaluate exit triggers in priority order. Price-based triggers require a
 * valid mark and the snapshotted stop/target; when the mark is unavailable,
 * price triggers are suppressed (data-outage safety is handled by the caller,
 * which blocks entries and raises a warning instead of inventing a mark).
 */
export function evaluateExit(context: ExitContext): ExitDecision {
  const active: ExitReason[] = [];

  if (context.emergencyStop) active.push('EMERGENCY_STOP');
  if (context.flatten) active.push('END_OF_DAY');

  const haveMark = context.currentMark != null && Number.isFinite(context.currentMark);
  if (haveMark && context.stopPrice != null && context.currentMark! <= context.stopPrice) {
    active.push('HARD_STOP');
  }
  if (context.brokerClosed) active.push('BROKER_MANUAL_CLOSE');
  if (haveMark && context.targetPrice != null && context.currentMark! >= context.targetPrice) {
    active.push('PROFIT_TARGET');
  }
  if (context.strategyInvalidated) active.push('STRATEGY_INVALIDATION');

  if (!active.length) {
    return { shouldExit: false, reason: null, activeTriggers: [], detail: 'no exit trigger active' };
  }

  // Highest-priority active trigger wins.
  const reason = EXIT_PRIORITY.find(candidate => active.includes(candidate)) ?? active[0];
  return {
    shouldExit: true,
    reason,
    activeTriggers: active,
    detail: `exit ${reason} (active: ${active.join(', ')})`,
  };
}

/** Snapshot stop/target absolute prices from entry premium — done once at fill. */
export function computeExitLevels(
  avgEntryPrice: number,
  stopLossPct: number,
  profitTargetPct: number
): { stopPrice: number; targetPrice: number } {
  return {
    stopPrice: Number((avgEntryPrice * (1 - stopLossPct)).toFixed(2)),
    targetPrice: Number((avgEntryPrice * (1 + profitTargetPct)).toFixed(2)),
  };
}
