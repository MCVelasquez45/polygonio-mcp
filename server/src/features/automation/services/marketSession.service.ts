import type { MarketHoursConfig } from '../automation.config';
import type { BrokerClock } from '../automation.types';

// Phase 2C — market-session phase policy.
//
// Pure function of the AUTHORITATIVE broker clock (never server-local time)
// plus the configured cutoffs. The broker clock already encodes holidays and
// early closes via next_close, so nothing here hardcodes 9:30–16:00. Phases
// are derived from minutes-to-close so an early-close day flattens on time.

export type SessionPhase =
  | 'CLOSED' // market closed — no entries, no ordinary exits
  | 'PRE_CUTOFF' // open, entries allowed
  | 'POST_ENTRY_CUTOFF' // open, no new entries, still monitoring
  | 'CANCEL_ENTRIES' // cancel unfilled entry orders
  | 'FLATTEN'; // exit all automation positions before close

export type MarketSessionState = {
  isOpen: boolean;
  phase: SessionPhase;
  /** Entries permitted only in PRE_CUTOFF. */
  entriesAllowed: boolean;
  /** Unfilled entry orders should be cancelled at/after the cancel window. */
  shouldCancelEntries: boolean;
  /** Automation positions should be flattened at/after the flatten window. */
  shouldFlatten: boolean;
  minutesToClose: number | null;
  nextClose: string | null;
  nextOpen: string | null;
  asOf: string;
};

/**
 * Derive the current session phase from the broker clock.
 * `nextClose` is the exchange's authoritative close for the current session
 * (already holiday/early-close aware). Minutes-to-close drives every cutoff.
 */
export function deriveMarketSession(
  clock: BrokerClock,
  config: MarketHoursConfig,
  now: number = Date.now()
): MarketSessionState {
  const base = {
    nextClose: clock.nextClose ? clock.nextClose.toISOString() : null,
    nextOpen: clock.nextOpen ? clock.nextOpen.toISOString() : null,
    asOf: new Date(now).toISOString(),
  };

  if (!clock.isOpen) {
    return {
      isOpen: false,
      phase: 'CLOSED',
      entriesAllowed: false,
      shouldCancelEntries: false,
      shouldFlatten: false,
      minutesToClose: null,
      ...base,
    };
  }

  // Open but no authoritative close time → fail safe: monitor only, no entries.
  if (!clock.nextClose) {
    return {
      isOpen: true,
      phase: 'POST_ENTRY_CUTOFF',
      entriesAllowed: false,
      shouldCancelEntries: false,
      shouldFlatten: false,
      minutesToClose: null,
      ...base,
    };
  }

  const minutesToClose = (clock.nextClose.getTime() - now) / 60_000;

  let phase: SessionPhase;
  if (minutesToClose <= config.flattenMinutesBeforeClose) phase = 'FLATTEN';
  else if (minutesToClose <= config.cancelEntryOrdersMinutesBeforeClose) phase = 'CANCEL_ENTRIES';
  else if (minutesToClose <= config.finalEntryMinutesBeforeClose) phase = 'POST_ENTRY_CUTOFF';
  else phase = 'PRE_CUTOFF';

  return {
    isOpen: true,
    phase,
    entriesAllowed: phase === 'PRE_CUTOFF',
    // Cancel/flatten are cumulative: once inside the cancel window (incl. flatten).
    shouldCancelEntries: phase === 'CANCEL_ENTRIES' || phase === 'FLATTEN',
    shouldFlatten: phase === 'FLATTEN',
    minutesToClose: Number(minutesToClose.toFixed(2)),
    ...base,
  };
}
