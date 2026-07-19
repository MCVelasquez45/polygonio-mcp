import type { QuoteFreshness } from '../../../lib/marketFormat';
import {
  marketDataAgeLabel,
  marketDataStatusLabel,
  type MarketDataStatus,
} from '../../../lib/marketDataStatus';

/**
 * Pulsing "live" dot. The ring animation is disabled under
 * prefers-reduced-motion. `active=false` renders a static dim dot.
 */
export function LiveDot({ active = true, label }: { active?: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-label">
      <span
        className={`h-2 w-2 rounded-full ${active ? 'bg-intel-pos motion-safe:animate-livering' : 'bg-intel-ink3'}`}
        aria-hidden="true"
      />
      {label && <span className={active ? 'text-intel-pos' : 'text-intel-ink3'}>{label}</span>}
    </span>
  );
}

/**
 * Automation heartbeat. Beats when healthy; still + red when not; grey when
 * status is unknown (null) — never implies health that wasn't reported.
 */
export function Heartbeat({ healthy, label = 'Automation' }: { healthy?: boolean | null; label?: string }) {
  const color = healthy == null ? 'bg-intel-ink3' : healthy ? 'bg-intel-pos' : 'bg-intel-neg';
  const text = healthy == null ? 'text-intel-ink3' : healthy ? 'text-intel-pos' : 'text-intel-neg';
  const state = healthy == null ? 'Unknown' : healthy ? 'Live' : 'Down';
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-label">
      <span className={`h-2 w-2 rounded-full ${color} ${healthy ? 'motion-safe:animate-heartbeat' : ''}`} aria-hidden="true" />
      <span className={text}>{label} · {state}</span>
    </span>
  );
}

const FRESH_STYLE: Record<QuoteFreshness, { cls: string; label: string }> = {
  FRESH: { cls: 'border-intel-pos/40 text-intel-pos', label: 'Live' },
  STALE: { cls: 'border-intel-warn/40 text-intel-warn', label: 'Stale' },
  UNAVAILABLE: { cls: 'border-intel-line text-intel-ink3', label: 'No quote' },
};

/** Quote freshness pill. Derive `freshness` from the quote's own age upstream. */
export function FreshnessBadge({ freshness, ageLabel }: { freshness: QuoteFreshness; ageLabel?: string }) {
  const s = FRESH_STYLE[freshness];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10.5px] tracking-wide ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${freshness === 'FRESH' ? 'bg-intel-pos motion-safe:animate-livering' : freshness === 'STALE' ? 'bg-intel-warn' : 'bg-intel-ink3'}`} aria-hidden="true" />
      {s.label}{ageLabel ? ` · ${ageLabel}` : ''}
    </span>
  );
}

// Visual treatment per unified market-data status. Only LIVE animates — a
// static value must never appear to be streaming.
const MARKET_DATA_STYLE: Record<
  MarketDataStatus,
  { pill: string; dot: string; pulse: boolean }
> = {
  LIVE: { pill: 'border-intel-pos/40 text-intel-pos', dot: 'bg-intel-pos', pulse: true },
  SNAPSHOT: { pill: 'border-intel-accentLine text-intel-accent', dot: 'bg-intel-accent', pulse: false },
  DELAYED: { pill: 'border-intel-warn/40 text-intel-warn', dot: 'bg-intel-warn', pulse: false },
  STALE: { pill: 'border-intel-warn/40 text-intel-warn', dot: 'bg-intel-warn', pulse: false },
  DISCONNECTED: { pill: 'border-intel-neg/40 text-intel-neg', dot: 'bg-intel-neg', pulse: false },
};
const MARKET_DATA_ABSENT = { pill: 'border-intel-line text-intel-ink3', dot: 'bg-intel-ink3', pulse: false };

/**
 * Unified market-data status pill: LIVE / SNAPSHOT / DELAYED / STALE /
 * DISCONNECTED, with the quote age (or delay note) as a sub-label. Derive
 * `status` and `ageMs` upstream with deriveMarketDataStatus — never hard-code
 * LIVE. `status=null` renders a neutral "No quote".
 */
export function MarketDataBadge({
  status,
  ageMs,
  delayLabel,
  className = '',
}: {
  status: MarketDataStatus | null;
  ageMs?: number | null;
  delayLabel?: string;
  className?: string;
}) {
  const s = status ? MARKET_DATA_STYLE[status] : MARKET_DATA_ABSENT;
  const age = marketDataAgeLabel(status, ageMs ?? null, delayLabel);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10.5px] tracking-wide ${s.pill} ${className}`}
      data-status={status ?? 'NONE'}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${s.dot} ${s.pulse ? 'motion-safe:animate-livering' : ''}`}
        aria-hidden="true"
      />
      {marketDataStatusLabel(status)}
      {age ? <span className="text-intel-ink3"> · {age}</span> : null}
    </span>
  );
}

const MARKET_DATA_SHORT: Record<MarketDataStatus, string> = {
  LIVE: 'Live',
  SNAPSHOT: 'Snap',
  DELAYED: 'Delayed',
  STALE: 'Stale',
  DISCONNECTED: 'Off',
};

/**
 * Compact freshness indicator for dense rows (watchlist, tape). A tiny dot + a
 * short status word + age, e.g. `● Snap · 28s`. Full status/age is in the title
 * tooltip. Same honest vocabulary as MarketDataBadge — just quieter, so the row
 * is dominated by price, not by freshness.
 */
export function MarketDataDot({
  status,
  ageMs,
  className = '',
}: {
  status: MarketDataStatus | null;
  ageMs?: number | null;
  className?: string;
}) {
  const s = status ? MARKET_DATA_STYLE[status] : MARKET_DATA_ABSENT;
  const short = status ? MARKET_DATA_SHORT[status] : '—';
  const age = marketDataAgeLabel(status, ageMs ?? null);
  return (
    <span
      title={`${marketDataStatusLabel(status)}${age ? ` · ${age}` : ''}`}
      className={`inline-flex items-center gap-1 font-mono text-[10px] text-intel-ink3 ${className}`}
      data-status={status ?? 'NONE'}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${s.dot} ${s.pulse ? 'motion-safe:animate-livering' : ''}`}
        aria-hidden="true"
      />
      <span>
        {short}
        {age ? ` · ${age.replace(/^Updated |^Last update /, '')}` : ''}
      </span>
    </span>
  );
}

/** Broker / socket connection indicator. */
export function ConnectionBadge({ connected, label }: { connected: boolean | null; label: string }) {
  const tone = connected == null ? 'text-intel-ink3 border-intel-line' : connected ? 'text-intel-pos border-intel-pos/40' : 'text-intel-neg border-intel-neg/40';
  const dot = connected == null ? 'bg-intel-ink3' : connected ? 'bg-intel-pos' : 'bg-intel-neg';
  const state = connected == null ? 'Unknown' : connected ? 'Connected' : 'Disconnected';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] tracking-wide ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {label} · {state}
    </span>
  );
}
