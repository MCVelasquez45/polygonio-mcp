// Exchange-calendar date handling for options expirations.
//
// US listed options expire on an *exchange date* (America/New_York). Deriving
// DTE from `new Date('YYYY-MM-DD')` compares UTC midnight against the current
// instant, which goes negative on expiration day afternoons (the logged
// `dte: -1` bug). All DTE math must therefore be done in exchange-local
// calendar days, never in raw epoch-millisecond deltas.

const ET_TIME_ZONE = 'America/New_York';

// Options on equities/ETFs stop trading at 16:00 ET (SPY/QQQ PM-settled weeklies
// at 16:15 ET). We use 16:15 ET as the validity cutoff so same-day contracts are
// not rejected while they are still legally tradable; the risk engine's own
// gates govern whether same-day entries are allowed.
const EXPIRATION_CUTOFF_MINUTES_ET = 16 * 60 + 15;

const etDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ET_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const etTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ET_TIME_ZONE,
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
});

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The exchange-local (America/New_York) calendar date for an instant, as YYYY-MM-DD. */
export function exchangeDateOf(nowMs: number): string {
  // en-CA yields YYYY-MM-DD directly.
  return etDateFormatter.format(new Date(nowMs));
}

/** Minutes since ET midnight for an instant. */
export function exchangeMinutesOf(nowMs: number): number {
  const parts = etTimeFormatter.format(new Date(nowMs));
  const [hour, minute] = parts.split(':').map(Number);
  // Intl may render midnight as "24:00" in some ICU versions.
  const h = hour === 24 ? 0 : hour;
  return h * 60 + minute;
}

/** Days between two YYYY-MM-DD calendar dates (b - a), via UTC-midnight math on the *date strings*. */
function calendarDaysBetween(a: string, b: string): number | null {
  const ma = a.match(ISO_DATE);
  const mb = b.match(ISO_DATE);
  if (!ma || !mb) return null;
  const utcA = Date.UTC(Number(ma[1]), Number(ma[2]) - 1, Number(ma[3]));
  const utcB = Date.UTC(Number(mb[1]), Number(mb[2]) - 1, Number(mb[3]));
  return Math.round((utcB - utcA) / 86_400_000);
}

/**
 * Days-to-expiration in exchange calendar days.
 * - Same exchange day → 0 (never -1 while the contract remains valid).
 * - Returns null for unparseable input.
 * Note: this is calendar DTE (matching the strategy's 7–21 day window), not
 * trading-day DTE.
 */
export function computeDteEt(expiration: string | null | undefined, nowMs: number): number | null {
  if (typeof expiration !== 'string') return null;
  const normalized = expiration.slice(0, 10);
  if (!ISO_DATE.test(normalized)) return null;
  return calendarDaysBetween(exchangeDateOf(nowMs), normalized);
}

/**
 * A contract is expired when its exchange date is in the past, or it is
 * expiration day and the ET trading cutoff has passed.
 */
export function isExpiredContract(expiration: string | null | undefined, nowMs: number): boolean {
  const dte = computeDteEt(expiration, nowMs);
  if (dte == null) return false; // unknown expiration is handled by validation elsewhere
  if (dte < 0) return true;
  if (dte === 0 && exchangeMinutesOf(nowMs) >= EXPIRATION_CUTOFF_MINUTES_ET) return true;
  return false;
}

/** Add calendar days to a YYYY-MM-DD date string (pure date math, no TZ drift). */
export function addCalendarDays(date: string, days: number): string {
  const m = date.match(ISO_DATE);
  if (!m) throw new Error(`addCalendarDays: invalid date "${date}"`);
  const utc = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return utc.toISOString().slice(0, 10);
}

/** Expiration window [gte, lte] covering a DTE range from "now" in exchange days. */
export function expirationWindowForDte(nowMs: number, dteMin: number, dteMax: number): { gte: string; lte: string } {
  const today = exchangeDateOf(nowMs);
  return {
    gte: addCalendarDays(today, Math.max(0, Math.floor(dteMin))),
    lte: addCalendarDays(today, Math.max(0, Math.ceil(dteMax))),
  };
}
