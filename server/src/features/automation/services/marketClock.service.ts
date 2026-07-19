import { getMarketStatusSnapshot } from '../../market/services/marketStatus';
import { CLOCK_DECISION_MAX_AGE_MS, CLOCK_DECISION_TTL_MS } from '../automation.constants';
import type { MarketClockDecision, MarketClockState } from '../automation.types';
import { logAutomationEvent } from './automationAudit.service';
import type { PaperBrokerAdapter } from './brokerAdapter';

// Deterministic market-clock gate.
//
// Authority order:
//   1. Broker clock — execution authority (it decides whether orders can work).
//   2. Massive market status — supporting health signal only.
//
// UNKNOWN NEVER DEFAULTS TO SAFE: if the broker clock is unreachable, stale,
// or the decision is ambiguous, `canEnter` is false. Every decision is
// timestamped and audited.

let cachedDecision: MarketClockDecision | null = null;
let lastAuditedSignature: string | null = null;

function decisionSignature(decision: MarketClockDecision): string {
  return `${decision.state}|${decision.canEnter}|${decision.reasons.join(',')}`;
}

export function clearMarketClockCache(): void {
  cachedDecision = null;
  lastAuditedSignature = null;
}

export async function getMarketClockDecision(
  adapter: PaperBrokerAdapter,
  { force = false }: { force?: boolean } = {}
): Promise<MarketClockDecision> {
  const now = Date.now();
  if (!force && cachedDecision && now - cachedDecision.decidedAt.getTime() < CLOCK_DECISION_TTL_MS) {
    return cachedDecision;
  }

  const reasons: string[] = [];
  let brokerOk = false;
  let brokerIsOpen: boolean | null = null;
  let brokerNextOpen: Date | null = null;
  let brokerNextClose: Date | null = null;
  let brokerError: string | undefined;

  try {
    const clock = await adapter.getClock();
    brokerOk = true;
    brokerIsOpen = clock.isOpen;
    brokerNextOpen = clock.nextOpen;
    brokerNextClose = clock.nextClose;
    // A clock timestamp wildly out of sync is treated as unreliable.
    const skewMs = Math.abs(now - clock.asOf.getTime());
    if (skewMs > CLOCK_DECISION_MAX_AGE_MS * 60) {
      // Note: mock clocks use fixed timestamps; only flag, never auto-trust.
      reasons.push(`broker clock timestamp skew ${Math.round(skewMs / 1000)}s`);
    }
  } catch (error) {
    brokerError = (error as Error)?.message?.slice(0, 300);
    reasons.push(`broker clock unavailable: ${brokerError}`);
  }

  let massiveOk = false;
  let massiveMarket: string | null = null;
  let conflictsWithBroker = false;
  try {
    const snapshot = await getMarketStatusSnapshot();
    massiveMarket = snapshot.market ?? 'unknown';
    // Massive silently degrades to 'unknown' on failure — treat that as not-ok.
    massiveOk = massiveMarket !== 'unknown';
    if (massiveOk && brokerOk) {
      const massiveSaysOpen = massiveMarket === 'open';
      if (massiveSaysOpen !== Boolean(brokerIsOpen) && !snapshot.afterHours && !snapshot.preMarket) {
        conflictsWithBroker = true;
        reasons.push(`massive says '${massiveMarket}' but broker isOpen=${brokerIsOpen}`);
      }
    }
  } catch (error) {
    reasons.push(`massive status unavailable: ${(error as Error)?.message?.slice(0, 200)}`);
  }

  let state: MarketClockState;
  if (!brokerOk) {
    state = 'UNKNOWN';
  } else if (brokerIsOpen) {
    state = 'OPEN';
  } else {
    state = 'CLOSED';
  }

  // Entry rule: broker verifiably OPEN and no unresolved conflict.
  const canEnter = state === 'OPEN' && !conflictsWithBroker;
  if (state === 'UNKNOWN') reasons.push('unknown market state blocks all entries');
  if (state === 'CLOSED') reasons.push('market closed');
  if (conflictsWithBroker) reasons.push('conflicting market sources block entries');

  const decision: MarketClockDecision = {
    state,
    canEnter,
    reasons,
    decidedAt: new Date(),
    stale: false,
    broker: {
      ok: brokerOk,
      isOpen: brokerIsOpen,
      nextOpen: brokerNextOpen,
      nextClose: brokerNextClose,
      ...(brokerError ? { error: brokerError } : {}),
    },
    massive: { ok: massiveOk, market: massiveMarket, conflictsWithBroker },
  };

  cachedDecision = decision;

  // Audit on every state/entry change (avoids flooding on steady state).
  const signature = decisionSignature(decision);
  if (signature !== lastAuditedSignature) {
    lastAuditedSignature = signature;
    logAutomationEvent({
      service: 'market-clock',
      event: 'MARKET_CLOCK_DECISION',
      severity: state === 'UNKNOWN' ? 'warning' : 'info',
      payload: {
        state,
        canEnter,
        reasons,
        broker: { ok: brokerOk, isOpen: brokerIsOpen },
        massive: { ok: massiveOk, market: massiveMarket, conflictsWithBroker },
      },
    });
  }

  return decision;
}

/**
 * Gate used by any future entry path: throws unless the market is verifiably
 * open. Exits and cancels are deliberately NOT gated here — closing risk must
 * remain possible whenever the broker accepts it.
 */
export async function assertEntryAllowed(adapter: PaperBrokerAdapter): Promise<MarketClockDecision> {
  const decision = await getMarketClockDecision(adapter);
  if (!decision.canEnter) {
    const { MarketClockBlockedError } = await import('../automation.errors');
    throw new MarketClockBlockedError(decision.state, decision.reasons);
  }
  return decision;
}
