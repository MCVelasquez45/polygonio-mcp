import type { AutomationStrategyConfig } from '../automation.config';
import type { BrokerAccount, BrokerClock } from '../automation.types';
import type { AutomationSessionDocument } from '../models/automationSession.model';
import { logAutomationEvent } from './automationAudit.service';

// Deterministic market-day reset. The trading date is derived from the BROKER
// CLOCK timestamp rendered in the exchange timezone (America/New_York) —
// never from server-local midnight. Same clock instant → same trading date,
// on any host in any timezone.

const NY_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** YYYY-MM-DD exchange trading date for a given instant. */
export function exchangeTradingDate(instant: Date): string {
  return NY_DATE_FORMATTER.format(instant);
}

export type DailyResetOutcome = {
  didReset: boolean;
  tradingDate: string;
};

/**
 * Reset daily counters when the exchange trading date has advanced past the
 * session's last reset. Idempotent within a trading day.
 */
export async function ensureDailyReset(
  session: AutomationSessionDocument,
  clock: BrokerClock,
  account: BrokerAccount | null,
  config: AutomationStrategyConfig
): Promise<DailyResetOutcome> {
  const tradingDate = exchangeTradingDate(clock.asOf);
  if (session.lastResetTradingDate === tradingDate) {
    return { didReset: false, tradingDate };
  }

  const previous = {
    tradingDate: session.lastResetTradingDate,
    dailyTradeCount: session.dailyTradeCount,
    dailyRealizedPnl: session.dailyRealizedPnl,
    consecutiveLossCount: session.consecutiveLossCount,
  };

  session.dailyTradeCount = 0;
  session.dailyRealizedPnl = 0;
  // Cooldowns are per-day protections: a new exchange day clears the counter.
  session.consecutiveLossCount = 0;
  session.startingDayEquity = account?.equity ?? session.startingDayEquity ?? null;
  session.dailyLossBudget =
    session.startingDayEquity != null
      ? Number((session.startingDayEquity * config.risk.maxDailyLossPct).toFixed(2))
      : null;
  session.lastResetTradingDate = tradingDate;
  await session.save();

  logAutomationEvent({
    service: 'daily-reset',
    event: 'SESSION_DAILY_RESET',
    automationSessionId: String(session._id),
    payload: {
      tradingDate,
      startingDayEquity: session.startingDayEquity,
      dailyLossBudget: session.dailyLossBudget,
      previous,
      clockSource: clock.source,
    },
  });
  return { didReset: true, tradingDate };
}
