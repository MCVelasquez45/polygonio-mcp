import { CLIENT_ORDER_ID_PREFIX } from '../automation.constants';
import type { AutomationPositionDocument } from '../models/automationPosition.model';

// Centralized automation-ownership guard.
//
// There are two independent trading systems that share broker visibility but
// NEVER share ownership: manual/external trading (user-owned, may originate
// outside this app, allowed to sit overnight, Portfolio-display only) and
// autonomous trading (managed exclusively by this engine). The autonomous
// engine may act on a position ONLY when it can PROVE it created it. Ownership
// is proven by the durable chain — never inferred from symbol, underlying,
// strike, expiration, side, quantity, price, or timestamps:
//
//   AutomationSession → Automation OrderIntent → deterministic client_order_id
//   → Broker Order → AutomationPosition → Broker Position
//
// This module is the single place that decides ownership. It fails CLOSED:
// when ownership cannot be proven the engine must do nothing to the position.

/** The minimal ownership evidence carried on every automation position. */
type OwnershipEvidence = Pick<
  AutomationPositionDocument,
  'source' | 'entryClientOrderId' | 'entryIntentId'
>;

/**
 * True only when the position carries the full, non-forgeable ownership
 * evidence: automation source, a linked entry intent, and our deterministic
 * client_order_id prefix. Manual/external broker positions have no
 * AutomationPosition record at all, so they can never satisfy this.
 */
export function isAutomationOwned(position: OwnershipEvidence | null | undefined): boolean {
  if (!position) return false;
  return (
    position.source === 'AUTOMATION' &&
    typeof position.entryIntentId === 'string' &&
    position.entryIntentId.length > 0 &&
    typeof position.entryClientOrderId === 'string' &&
    position.entryClientOrderId.startsWith(CLIENT_ORDER_ID_PREFIX)
  );
}

/**
 * Assert automation ownership before any state-changing lifecycle action
 * (monitoring, overnight recovery, exit creation, risk counting, reconciliation
 * updates, P&L accounting, emergency flatten, manual-review escalation).
 * Throws when ownership is not proven — an internal invariant violation, since
 * only automation-created positions are ever AutomationPosition records.
 */
export function assertAutomationOwnership(
  position: OwnershipEvidence,
  context: string
): void {
  if (!isAutomationOwned(position)) {
    throw new Error(
      `assertAutomationOwnership(${context}): position is not provably automation-owned ` +
        `(source=${position?.source}, entryClientOrderId=${position?.entryClientOrderId}) — refusing to act`
    );
  }
}
