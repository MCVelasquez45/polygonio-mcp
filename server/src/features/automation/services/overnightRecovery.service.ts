import { REASON } from '../automation.config';
import {
  AutomationPositionModel,
  LIVE_POSITION_STATUSES,
  type AutomationPositionDocument,
  type AutomationPositionStatus,
} from '../models/automationPosition.model';

// Overnight recovery (critical lifecycle repair).
//
// The V1 invariant is: no automation position is intentionally held overnight —
// every automation position is intraday and MUST be flattened before the close.
// When a position survives the flatten window (process down during flatten, a
// missed EOD trigger, discovery at startup while the options market is closed,
// …) it is a POLICY VIOLATION, not a healthy open position. This module decides,
// purely, whether a position is an overnight carry and when the recovery flatten
// becomes eligible (the next valid options session from the AUTHORITATIVE broker
// clock — never server-local time). The recovery flatten itself is a mandatory
// market exit that does NOT depend on a fresh mark.

export const OVERNIGHT_CARRY_REASON = 'CARRIED_PAST_FLATTEN_WINDOW';

export type OvernightAssessment = {
  /** Whether this position is an overnight carry that must be recovered. */
  required: boolean;
  /** Machine reason for the carry (audit/UI). */
  reason: string | null;
  /** Earliest broker-clock time the recovery exit may be submitted, or null. */
  eligibleAt: Date | null;
};

/**
 * Decide whether an automation position is an overnight carry. A carry is any
 * automation-owned, filled, still-OPEN position observed while the options
 * market is CLOSED — such a position should already have been flattened before
 * the close, so its continued existence is the violation. Deterministic and
 * side-effect free.
 */
export function assessOvernightCarry(params: {
  status: AutomationPositionStatus;
  filledQty: number;
  source: string;
  marketOpen: boolean;
  nextOpen: Date | null;
  sessionOpenSkewMs: number;
}): OvernightAssessment {
  const isAutomationOpen =
    params.source === 'AUTOMATION' && params.status === 'OPEN' && params.filledQty > 0;
  if (!isAutomationOpen || params.marketOpen) {
    return { required: false, reason: null, eligibleAt: null };
  }
  const eligibleAt =
    params.nextOpen != null
      ? new Date(params.nextOpen.getTime() + Math.max(0, params.sessionOpenSkewMs))
      : null;
  return { required: true, reason: OVERNIGHT_CARRY_REASON, eligibleAt };
}

/**
 * Persist an overnight assessment onto the position (additive fields only). The
 * detection timestamp and eligibility are latched once; re-detection refreshes
 * eligibility only if it was unknown (missing broker clock at first detection).
 * The flag is NEVER cleared here — only a broker-confirmed close ends the carry.
 * Returns true when the position transitioned into the overnight state.
 */
export function applyOvernightAssessment(
  position: AutomationPositionDocument,
  assessment: OvernightAssessment,
  now: Date
): boolean {
  if (!assessment.required) return false;
  const firstDetection = !position.overnightRecoveryRequired;
  position.overnightRecoveryRequired = true;
  if (position.overnightDetectedAt == null) position.overnightDetectedAt = now;
  if (position.overnightReason == null) position.overnightReason = assessment.reason;
  // Latch eligibility when we first learn it; refresh only if still unknown.
  if (position.recoveryExitEligibleAt == null && assessment.eligibleAt != null) {
    position.recoveryExitEligibleAt = assessment.eligibleAt;
  }
  return firstDetection;
}

/**
 * Whether the recovery flatten may be submitted now: the position is flagged,
 * the options market is OPEN (a valid session), and we are at/past the latched
 * eligibility time (or eligibility was never learned, in which case an OPEN
 * market IS the valid session). Fail closed: never eligible while closed.
 */
export function isRecoveryExitEligible(
  position: Pick<AutomationPositionDocument, 'overnightRecoveryRequired' | 'recoveryExitEligibleAt'>,
  marketOpen: boolean,
  now: Date
): boolean {
  if (!position.overnightRecoveryRequired || !marketOpen) return false;
  const eligibleAt = position.recoveryExitEligibleAt?.getTime();
  return eligibleAt == null || now.getTime() >= eligibleAt;
}

/** Reason code surfaced when an overnight carry blocks new entries. */
export const OVERNIGHT_BLOCKS_ENTRY = REASON.OVERNIGHT_POSITION_BLOCKS_ENTRY;

/**
 * Count automation-owned, still-live positions flagged for overnight recovery in
 * a session. Terminal (CLOSED) positions never count, so a broker-confirmed
 * recovery close releases the entry slot. A manual equity position is never an
 * AutomationPosition, so it can never be counted here.
 */
export async function countOvernightRecoveryPositions(sessionId: string): Promise<number> {
  return AutomationPositionModel.countDocuments({
    automationSessionId: sessionId,
    overnightRecoveryRequired: true,
    status: { $in: LIVE_POSITION_STATUSES },
  });
}
