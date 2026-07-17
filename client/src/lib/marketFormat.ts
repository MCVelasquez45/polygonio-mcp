// Shared market-data formatting for the operator cockpit.
//
// The cardinal rule: a MISSING value is never rendered as a real number. In JS
// `Number(null) === 0`, so any formatter that coerces before checking for absence
// will silently turn a missing bid into "$0.00" — a lie the operator cannot
// distinguish from a genuine zero. Every formatter here guards absence first and
// returns the em-dash placeholder instead.

export const UNAVAILABLE = '—';

export type QuoteFreshness = 'FRESH' | 'STALE' | 'UNAVAILABLE';

/** null/undefined/'' — the three ways a value can be genuinely absent. */
export function isAbsent(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/** A finite number or null — the only two states a formatter should trust. */
export function finiteOrNull(value: unknown): number | null {
  if (isAbsent(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Freshness of a quote from its age. UNAVAILABLE when there is no age (no quote
 * at all); STALE when older than the threshold; FRESH otherwise. Freshness must
 * be derived from the provider quote's own age, never the request cadence.
 */
export function freshnessOf(ageMs: number | null | undefined, thresholdMs: number): QuoteFreshness {
  const age = finiteOrNull(ageMs);
  if (age === null || age < 0) return 'UNAVAILABLE';
  return age > thresholdMs ? 'STALE' : 'FRESH';
}

/** `$X.XX`; absent → em dash (NEVER `$0.00`). A real zero renders `$0.00`. */
export function fmtMoney(value: unknown, digits = 2): string {
  const n = finiteOrNull(value);
  if (n === null) return UNAVAILABLE;
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(digits)}`;
}

/** Signed money: `+$1.20` / `-$0.40`; absent → em dash. */
export function fmtSignedMoney(value: unknown, digits = 2): string {
  const n = finiteOrNull(value);
  if (n === null) return UNAVAILABLE;
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(digits)}`;
}

/** `X.X%`; absent → em dash. */
export function fmtPercent(value: unknown, digits = 1): string {
  const n = finiteOrNull(value);
  if (n === null) return UNAVAILABLE;
  return `${n.toFixed(digits)}%`;
}

/** Signed percent: `+12.5%` / `-3.0%`; absent → em dash. */
export function fmtSignedPercent(value: unknown, digits = 1): string {
  const n = finiteOrNull(value);
  if (n === null) return UNAVAILABLE;
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

/** Plain number with locale grouping; absent → em dash. */
export function fmtNumber(value: unknown, digits = 0): string {
  const n = finiteOrNull(value);
  if (n === null) return UNAVAILABLE;
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Contract/quote size, e.g. `×18`; absent → em dash (never `×0` for missing). */
export function fmtSize(value: unknown): string {
  const n = finiteOrNull(value);
  if (n === null) return UNAVAILABLE;
  return `×${n.toLocaleString()}`;
}

/** Greeks — small signed decimals; absent → em dash. */
export function fmtGreek(value: unknown, digits = 2): string {
  const n = finiteOrNull(value);
  if (n === null) return UNAVAILABLE;
  return n.toFixed(digits);
}

/** Compact human duration for quote age / time-in-trade; absent/negative → em dash. */
export function fmtDuration(ms: unknown): string {
  const n = finiteOrNull(ms);
  if (n === null || n < 0) return UNAVAILABLE;
  const totalSeconds = Math.floor(n / 1000);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Direction of a value change for tick animation. */
export type TickDirection = 'up' | 'down' | 'none';

export function tickDirection(prev: number | null | undefined, next: number | null | undefined): TickDirection {
  const a = finiteOrNull(prev);
  const b = finiteOrNull(next);
  if (a === null || b === null) return 'none';
  if (b > a) return 'up';
  if (b < a) return 'down';
  return 'none';
}

/**
 * Unrealized P/L for a long option position, in dollars.
 * (mark - entry) * |contracts| * 100. Returns null if inputs are absent so the
 * UI shows UNAVAILABLE rather than a fabricated 0. Multiplier defaults to the
 * standard 100-share option contract.
 */
export function computeUnrealizedPnl(
  mark: unknown,
  entry: unknown,
  contracts: unknown,
  multiplier = 100
): number | null {
  const m = finiteOrNull(mark);
  const e = finiteOrNull(entry);
  const q = finiteOrNull(contracts);
  if (m === null || e === null || q === null) return null;
  return (m - e) * Math.abs(q) * multiplier;
}

/** Unrealized P/L as a percentage of entry cost; null when uncomputable. */
export function computeUnrealizedPnlPct(mark: unknown, entry: unknown): number | null {
  const m = finiteOrNull(mark);
  const e = finiteOrNull(entry);
  if (m === null || e === null || e === 0) return null;
  return ((m - e) / e) * 100;
}

/**
 * Signed distance from the current mark to a trigger price, and the same as a
 * percentage of the mark. Positive = mark is above the trigger. Both null when
 * either input is absent.
 */
export function distanceToTrigger(
  mark: unknown,
  trigger: unknown
): { abs: number | null; pct: number | null } {
  const m = finiteOrNull(mark);
  const t = finiteOrNull(trigger);
  if (m === null || t === null) return { abs: null, pct: null };
  const abs = m - t;
  return { abs, pct: m === 0 ? null : (abs / m) * 100 };
}
