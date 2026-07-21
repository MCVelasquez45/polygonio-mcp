import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuote } from '../../lib/liveMarketStore';
import { useLiveMarketSubscription } from '../../hooks/useCockpitLiveSubscription';
import { freshnessOf, type QuoteFreshness } from '../../lib/marketFormat';

// ── Shared terminal design language ────────────────────────────────────────
// One import surface so every workspace (Terminal, Positions, Automation,
// Intelligence) speaks with the same headers, tables, pills, and live
// treatment. The cockpit primitives are re-exported here so callers never
// reach into a feature folder for a shared piece.

export { Panel, Stat, Pill, Badge, FreshnessDot, statusTone } from '../cockpit/cockpitUi';

/** A quote older than this reads as STALE; missing timestamp reads UNAVAILABLE. */
export const LIVE_STALE_MS = 6_000;

export function quoteFreshness(timestamp: number | null | undefined, now: number): QuoteFreshness {
  if (timestamp == null) return 'UNAVAILABLE';
  return freshnessOf(now - timestamp, LIVE_STALE_MS);
}

/** Uppercase mono section label — the eyebrow used across every panel. */
export function SectionLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`font-mono text-[10px] uppercase tracking-label text-intel-ink3 ${className}`}>
      {children}
    </span>
  );
}

/**
 * Consistent mode/page header. Every top-level workspace renders one so the
 * chrome, spacing, and typographic hierarchy are identical between screens.
 */
export function ModeHeader({
  kicker,
  title,
  subtitle,
  actions,
  right,
}: {
  kicker?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-intel-lineSoft pb-3">
      <div className="min-w-0">
        {kicker ? <SectionLabel className="tracking-eyebrow">{kicker}</SectionLabel> : null}
        <h1 className="mt-1 text-lg font-semibold leading-tight text-intel-ink">{title}</h1>
        {subtitle ? <div className="mt-1 text-xs text-intel-ink2">{subtitle}</div> : null}
      </div>
      <div className="flex items-center gap-2">
        {right}
        {actions}
      </div>
    </div>
  );
}

/**
 * A live numeric value that briefly flashes green/red when it changes and
 * carries no fabricated data: if there is nothing to show it renders an em
 * dash, never a placeholder number. Motion is disabled under motion-reduce.
 */
export function LiveNumber({
  value,
  format = v => v.toFixed(2),
  className = '',
}: {
  value: number | null | undefined;
  format?: (v: number) => string;
  className?: string;
}) {
  const prev = useRef<number | null>(null);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (value == null) return;
    const before = prev.current;
    if (before != null && value !== before) {
      setFlash(value > before ? 'up' : 'down');
      const id = window.setTimeout(() => setFlash(null), 500);
      prev.current = value;
      return () => window.clearTimeout(id);
    }
    prev.current = value;
  }, [value]);

  const flashCls =
    flash === 'up'
      ? 'motion-safe:animate-flash-up'
      : flash === 'down'
        ? 'motion-safe:animate-flash-down'
        : '';

  return (
    <span className={`rounded px-0.5 font-mono tabular-nums ${flashCls} ${className}`}>
      {value == null ? '—' : format(value)}
    </span>
  );
}

/**
 * Connection/freshness chip driven by a real quote timestamp. Shows LIVE
 * (streaming) / SNAPSHOT / STALE / OFFLINE honestly — a stale value must look
 * stale, and we never paint a green LIVE badge over data we don't have.
 */
export function LiveState({ timestamp }: { timestamp: number | null | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);
  const fresh = quoteFreshness(timestamp, now);
  const map = {
    FRESH: { dot: 'bg-intel-pos', text: 'text-intel-pos', label: 'LIVE', pulse: true },
    STALE: { dot: 'bg-intel-warn', text: 'text-intel-warn', label: 'STALE', pulse: false },
    UNAVAILABLE: { dot: 'bg-intel-ink3', text: 'text-intel-ink3', label: 'OFFLINE', pulse: false },
  }[fresh];
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-label ${map.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${map.dot} ${map.pulse ? 'motion-safe:animate-heartbeat' : ''}`} />
      {map.label}
    </span>
  );
}

/**
 * Compact live price tile for a symbol, reading the shared market store. Used
 * by the header symbol context and the market context bar. Shows the mid price
 * with tick-flash + honest freshness; renders a dash when no quote exists.
 */
export function LivePriceTile({
  symbol,
  label,
  compact = false,
}: {
  symbol: string;
  label?: string;
  compact?: boolean;
}) {
  useLiveMarketSubscription(symbol);
  const quote = useLiveQuote(symbol);
  const mid =
    quote?.midpoint ??
    (quote?.bidPrice != null && quote?.askPrice != null ? (quote.bidPrice + quote.askPrice) / 2 : null);
  return (
    <div className={`flex flex-col ${compact ? 'gap-0' : 'gap-0.5'}`}>
      <span className="font-mono text-[9.5px] uppercase tracking-label text-intel-ink3">{label ?? symbol}</span>
      <span className="flex items-center gap-1.5">
        <LiveNumber value={mid} className="text-sm font-semibold text-intel-ink" />
        {!compact ? <LiveState timestamp={quote?.timestamp ?? null} /> : null}
      </span>
    </div>
  );
}
