import { getExecutionConfig, type ExecutionConfig } from '../automation.config';
import type { OrderIntentDocument } from '../models/orderIntent.model';
import { logAutomationEvent } from './automationAudit.service';
import type { PaperBrokerAdapter } from './brokerAdapter';
import { submitIntent, type SubmitIntentResult } from './orderIntent.service';
import { openOrUpdateEntryPosition, type EntryLinks } from './positionManager.service';

// Phase 2C — approved-entry execution wiring.
//
// Turns an APPROVED_AWAITING_EXECUTION intent into a real Alpaca paper order
// through the EXISTING submitIntent path (no second submission path), then
// materializes the automation position from broker truth. The deterministic
// limit-price policy is applied here so the intent carries a policy-consistent
// price before submission.

/**
 * Deterministic entry limit price from authoritative bid/ask.
 *  - MID: midpoint, capped so it never exceeds mid×(1+maxSlippage) (marketable ceiling).
 *  - ASK: pay the ask (most likely to fill), still capped by max slippage over mid.
 *  - BID: rest at the bid (price-improvement, may not fill).
 * Returns null when bid/ask are unusable (caller then fails closed).
 */
export function computeEntryLimitPrice(
  bid: number | null,
  ask: number | null,
  config: ExecutionConfig
): number | null {
  if (bid == null || ask == null || !(bid > 0) || !(ask >= bid)) return null;
  const mid = (bid + ask) / 2;
  const ceiling = mid * (1 + Math.max(0, config.entryMaxSlippagePct));
  let price: number;
  if (config.entryLimitPolicy === 'BID') price = bid;
  else if (config.entryLimitPolicy === 'ASK') price = Math.min(ask, ceiling);
  else price = mid; // MID
  return Number(price.toFixed(2));
}

/**
 * Submit one approved ENTRY intent and open its automation position.
 * Market-open / session-runnable / emergency-stop gates are enforced inside
 * submitIntent (assertEntryAllowed + runnable-status guard); the scheduler
 * additionally restricts calls to the PRE_CUTOFF phase. Idempotent by
 * construction: submitIntent maps one intent to at most one broker order.
 */
export async function executeApprovedEntry(
  intent: OrderIntentDocument,
  adapter: PaperBrokerAdapter,
  links: EntryLinks
): Promise<{ result: SubmitIntentResult; positionId: string | null }> {
  const result = await submitIntent(String(intent._id), adapter);

  let positionId: string | null = null;
  if (result.outcome === 'SUBMITTED' || result.outcome === 'ALREADY_SUBMITTED' || result.outcome === 'RECOVERED_FROM_BROKER') {
    const position = await openOrUpdateEntryPosition(result.intent, result.brokerOrder, links);
    positionId = String(position._id);
  }

  logAutomationEvent({
    service: 'entry-execution',
    event: 'ENTRY_EXECUTED',
    severity: result.outcome === 'BROKER_REJECTED' || result.outcome === 'AMBIGUOUS_SUBMIT_FAILURE' ? 'warning' : 'info',
    automationSessionId: links.automationSessionId,
    intentId: String(intent._id),
    symbol: links.optionSymbol,
    payload: { outcome: result.outcome, positionId },
  });
  return { result, positionId };
}

export function resolveExecutionConfig(): ExecutionConfig {
  return getExecutionConfig();
}
