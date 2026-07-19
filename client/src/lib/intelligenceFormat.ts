// Consolidated formatting + tone helpers for the Intelligence workspace.
//
// Replaces the per-page `formatMoney` / `formatNumber` / `formatPercent` /
// `gradeTone` copies that were duplicated across all five intelligence pages,
// each with slightly different empty-state wording.
//
// INTEGRITY RULE (enforced by the page tests): a missing value is NEVER a fake
// number and NEVER a cryptic placeholder. The UI must not contain "—", "N/A",
// "UNKNOWN", or a fabricated "$0.00". Absence is always spelled out in words.
// A genuine zero still renders "$0.00"; only absence renders the word form.

import { finiteOrNull } from './marketFormat';

/** The single inline placeholder for an absent scalar. Human, never cryptic. */
export const ABSENT = 'Not recorded';

/** Human sentences for empty panels — the single source of empty-state copy. */
export const EMPTY = {
  /** e.g. EMPTY.panel('timeline events') → "No timeline events recorded this session." */
  panel: (what: string) => `No ${what} recorded this session.`,
  /** Live P/L with no open position — a normal state, not a failure. */
  livePnl: 'No live P/L — no position is open.',
  /** Analytics needs more closed trades before rankings mean anything. */
  analytics: 'More completed trades are needed before strategy rankings are meaningful.',
} as const;

// ---- human copy for machine-generated tallies ----
//
// The engine speaks in counts ("2 trade report(s), 1 win(s)"); the operator
// reads sentences. These helpers are the single source of that translation so
// every surface phrases the same fact the same way.

/** e.g. (1, 1, -56) → "2 trades · 1 winner · 1 loser · Net -$56". */
export function fmtTradeTally(
  wins: number | null | undefined,
  losses: number | null | undefined,
  netPnl?: number | null
): string {
  const w = Math.max(0, finiteOrNull(wins) ?? 0);
  const l = Math.max(0, finiteOrNull(losses) ?? 0);
  const total = w + l;
  if (total === 0) return 'No closed trades yet';
  const parts = [
    `${total} trade${total === 1 ? '' : 's'}`,
    `${w} winner${w === 1 ? '' : 's'}`,
    `${l} loser${l === 1 ? '' : 's'}`,
  ];
  const net = finiteOrNull(netPnl);
  if (net !== null) parts.push(`Net ${fmtSignedUsd(net)}`);
  return parts.join(' · ');
}

/** e.g. 3 → "3 operational checks need attention"; 0 → "All operational checks passing". */
export function fmtChecksAttention(count: number | null | undefined): string {
  const c = Math.max(0, finiteOrNull(count) ?? 0);
  if (c === 0) return 'All operational checks passing';
  return `${c} operational check${c === 1 ? '' : 's'} need${c === 1 ? 's' : ''} attention`;
}

/** Sample-size gate copy for analytics: names how many trades exist so far. */
export function fmtSampleGate(count?: number | null): string {
  const n = finiteOrNull(count);
  if (n !== null && n > 0) return `Awaiting more completed trades — ${n} recorded so far.`;
  return EMPTY.analytics;
}

/** `$1,234.00`; absent → word (never `$0.00` for a missing value). */
export function fmtUsd(value: number | null | undefined): string {
  const n = finiteOrNull(value);
  if (n === null) return ABSENT;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

/** Signed money: `+$212.00` / `-$64.00`; absent → word. */
export function fmtSignedUsd(value: number | null | undefined): string {
  const n = finiteOrNull(value);
  if (n === null) return ABSENT;
  const body = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n));
  return `${n >= 0 ? '+' : '-'}${body}`;
}

/** Compact money for tight tiles: `+$1.2K` / `-$410`; absent → word. */
export function fmtCompactUsd(value: number | null | undefined): string {
  const n = finiteOrNull(value);
  if (n === null) return ABSENT;
  const sign = n < 0 ? '-' : '+';
  const abs = Math.abs(n);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** Fractional ratio (0..1) → `75%`; absent → word. */
export function fmtPct(value: number | null | undefined, digits = 0): string {
  const n = finiteOrNull(value);
  if (n === null) return ABSENT;
  return `${(n * 100).toFixed(digits)}%`;
}

/** Already-percent value (0..100) → `75%`; absent → word. */
export function fmtWholePct(value: number | null | undefined, digits = 0): string {
  const n = finiteOrNull(value);
  if (n === null) return ABSENT;
  return `${n.toFixed(digits)}%`;
}

/** Plain number with locale grouping; absent → word. */
export function fmtNum(value: number | null | undefined, digits = 0): string {
  const n = finiteOrNull(value);
  if (n === null) return ABSENT;
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Small signed decimal (greeks, profit factor, expectancy); absent → word. */
export function fmtDecimal(value: number | null | undefined, digits = 2): string {
  const n = finiteOrNull(value);
  if (n === null) return ABSENT;
  return n.toFixed(digits);
}

/** Localized date-time; absent/unparseable → word. */
export function fmtDateTime(value?: string | null): string {
  if (!value) return ABSENT;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return ABSENT;
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** `2h 50m` / `45m` from minutes; absent → word. */
export function fmtHoldTime(minutes: number | null | undefined): string {
  const n = finiteOrNull(minutes);
  if (n === null) return ABSENT;
  if (n < 60) return `${Math.round(n)}m`;
  const h = Math.floor(n / 60);
  const m = Math.round(n % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

// ---- tone / semantic color (intel tokens) ----

export type Tone = 'pos' | 'neg' | 'warn' | 'neutral';

/** Semantic P/L tone from a signed value. */
export function pnlTone(value: number | null | undefined): Tone {
  const n = finiteOrNull(value);
  if (n === null || n === 0) return 'neutral';
  return n > 0 ? 'pos' : 'neg';
}

/** Text-color class for a tone. */
export function toneText(tone: Tone): string {
  switch (tone) {
    case 'pos': return 'text-intel-pos';
    case 'neg': return 'text-intel-neg';
    case 'warn': return 'text-intel-warn';
    default: return 'text-intel-ink';
  }
}

export type GradeTier = 'a' | 'bc' | 'f' | 'na';

/** Collapse any letter grade (A+..F, UNAVAILABLE) into a tier for coloring. */
export function gradeTier(grade: string | null | undefined): GradeTier {
  if (!grade) return 'na';
  const g = grade.toUpperCase();
  if (g === 'UNAVAILABLE' || g === 'N/A') return 'na';
  if (g.startsWith('A')) return 'a';
  if (g.startsWith('B') || g.startsWith('C')) return 'bc';
  return 'f';
}

/** Border + bg + text classes for a grade badge. */
export function gradeToneClass(grade: string | null | undefined): string {
  switch (gradeTier(grade)) {
    case 'a': return 'border-intel-pos/40 bg-intel-pos/10 text-intel-pos';
    case 'bc': return 'border-intel-warn/40 bg-intel-warn/10 text-intel-warn';
    case 'f': return 'border-intel-neg/40 bg-intel-neg/10 text-intel-neg';
    default: return 'border-intel-line bg-intel-panel2 text-intel-ink2';
  }
}
