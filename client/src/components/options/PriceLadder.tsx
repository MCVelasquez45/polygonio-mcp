import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { debugLog } from '../../lib/debugLog';
import { useLiveQuote, useLiveTrade, useLiveTradeHistory } from '../../lib/liveMarketStore';

// Institutional price ladder (DOM) — the execution surface. A centered price
// spine with resting size on the flanks, the inside market highlighted, the
// last trade lit on the spine, and a short time & sales tape below. Built
// strictly from the real NBBO + prints the live store already carries: deeper
// book levels are shown as empty rungs rather than invented — a ladder must
// never paint depth it doesn't have.

const TICK = 0.01;
const RUNGS_EACH_SIDE = 7;
const TAPE_ROWS = 8;
// Collapse a run of this many (or more) dead inside-spread rungs into one gap.
const COLLAPSE_MIN = 4;
const LIVE_QUOTE_FRESH_MS = 10_000;
// A quiet contract with a healthy, acknowledged subscription can legitimately
// go well past LIVE_QUOTE_FRESH_MS between NBBO prints — the last quote is
// still accurate, not stale. Only fall back to STALE once an actively
// subscribed contract has gone this long without a print.
const SUBSCRIBED_QUIET_GRACE_MS = 60_000;

type DepthStatus =
  | 'LIVE'
  | 'CONNECTING'
  | 'WAITING_FOR_CONTRACTS'
  | 'WAITING_FOR_QUOTES'
  | 'DEGRADED'
  | 'PROVIDER_BLOCKED'
  | 'SUBSCRIPTION_FAILED'
  | 'STALE'
  | 'MARKET_CLOSED'
  | 'OFFLINE';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type Rung = {
  price: number;
  bidSize: number | null;
  askSize: number | null;
  isBid: boolean;
  isAsk: boolean;
  isLast: boolean;
};

// A ladder display row is either a real price rung or a collapsed gap standing
// in for a run of dead inside-spread rungs.
type LadderItem = { type: 'rung'; rung: Rung } | { type: 'gap'; id: string; rungs: Rung[] };

type PriceLadderProps = {
  symbol: string | null;
  underlying: string;
  contractLabel?: string | null;
  socketConnected: boolean;
  subscriptionActive: boolean;
  providerUnavailable?: boolean;
  subscriptionFailed?: boolean;
  marketClosed?: boolean;
};

export const PriceLadder = memo(function PriceLadder({
  symbol,
  underlying,
  contractLabel,
  socketConnected,
  subscriptionActive,
  providerUnavailable,
  subscriptionFailed,
  marketClosed,
}: PriceLadderProps) {
  const [now, setNow] = useState(() => Date.now());
  // Inside-spread price levels with no resting size are collapsed by default so
  // a wide spread doesn't flood the ladder with dead rungs. Operators can
  // expand a gap on demand; a new contract starts collapsed again.
  const [expandedGaps, setExpandedGaps] = useState<Set<string>>(() => new Set());
  const quote = useLiveQuote(symbol);
  const lastTrade = useLiveTrade(symbol);
  const tape = useLiveTradeHistory(symbol);
  const bid = quote?.bidPrice ?? null;
  const ask = quote?.askPrice ?? null;
  const mid =
    quote?.midpoint ?? (bid != null && ask != null ? round2((bid + ask) / 2) : null);
  const lastPrice = lastTrade?.price ?? null;

  const rungs = useMemo<Rung[]>(() => {
    if (bid == null || ask == null) return [];
    const top = round2(ask + RUNGS_EACH_SIDE * TICK);
    const rows: Rung[] = [];
    const count = Math.round((top - (bid - RUNGS_EACH_SIDE * TICK)) / TICK) + 1;
    for (let i = 0; i < count; i += 1) {
      const price = round2(top - i * TICK);
      const isBid = Math.abs(price - bid) < TICK / 2;
      const isAsk = Math.abs(price - ask) < TICK / 2;
      const isLast = lastPrice != null && Math.abs(price - lastPrice) < TICK / 2;
      rows.push({
        price,
        bidSize: isBid ? quote?.bidSize ?? null : null,
        askSize: isAsk ? quote?.askSize ?? null : null,
        isBid,
        isAsk,
        isLast,
      });
    }
    return rows;
  }, [bid, ask, quote?.bidSize, quote?.askSize, lastPrice]);

  const tapeRows = useMemo(() => tape.slice(0, TAPE_ROWS), [tape]);

  // A new contract resets any manually expanded gaps.
  useEffect(() => {
    setExpandedGaps(new Set());
  }, [symbol]);

  // Fold the rungs into a display list: any run of ≥ COLLAPSE_MIN contiguous
  // inside-spread rungs that carry no resting size (and aren't the last print
  // or the mid marker) becomes a single collapsible gap. The inside market —
  // bid, ask, mid, and last — always survives, so the market stays centered.
  const ladderItems = useMemo<LadderItem[]>(() => {
    if (!rungs.length) return [];
    const items: LadderItem[] = [];
    let run: Rung[] = [];
    const flush = () => {
      if (!run.length) return;
      if (run.length >= COLLAPSE_MIN) {
        const id = `${run[0].price.toFixed(2)}-${run[run.length - 1].price.toFixed(2)}`;
        items.push({ type: 'gap', id, rungs: run });
      } else {
        for (const r of run) items.push({ type: 'rung', rung: r });
      }
      run = [];
    };
    for (const rung of rungs) {
      const isMidMarker = mid != null && Math.abs(rung.price - mid) < TICK / 2;
      const significant =
        rung.isBid || rung.isAsk || rung.isLast || rung.bidSize != null || rung.askSize != null || isMidMarker;
      const insideSpread =
        bid != null && ask != null && rung.price > bid + TICK / 2 && rung.price < ask - TICK / 2;
      if (insideSpread && !significant) {
        run.push(rung);
      } else {
        flush();
        items.push({ type: 'rung', rung });
      }
    }
    flush();
    return items;
  }, [rungs, mid, bid, ask]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  // Provider (SIP) clocks and the browser clock aren't perfectly synced, so a
  // just-arrived quote can appear to be from a few hundred ms in the future.
  // That's freshness, not staleness — clamp to zero rather than reject it.
  const rawAgeMs = quote?.timestamp != null ? now - quote.timestamp : null;
  const ageMs = rawAgeMs != null ? Math.max(0, rawAgeMs) : null;
  const hasQuote = Boolean(quote);
  const isFresh = ageMs != null && ageMs <= LIVE_QUOTE_FRESH_MS;
  // An actively subscribed (acknowledged-live) contract that has simply gone
  // quiet is not stale — the last NBBO printed is still the accurate one.
  // Only demote to STALE once it's been quiet for much longer than a normal
  // print gap would ever take.
  const isQuietButActive = ageMs != null && subscriptionActive && ageMs <= SUBSCRIBED_QUIET_GRACE_MS;
  // Priority: real, fresh quote data always wins. `providerUnavailable` is a
  // subscription-lifecycle flag (set when the backend rejects/errors a
  // live:subscribe) that only ever gets CLEARED by a matching socket event —
  // but quotes also land in the store via a REST snapshot fallback (App.tsx's
  // loadSnapshots), which never touches that flag. If we check
  // providerUnavailable before freshness, a stale rejection from an earlier
  // contract can force PROVIDER_BLOCKED even while this contract's quotes are
  // genuinely live. Data freshness is the ground truth; the flag only matters
  // when we don't have fresh data to show instead.
  let statusReason = '';
  const status: DepthStatus = !symbol
    ? ((statusReason = 'no contract selected'), 'WAITING_FOR_CONTRACTS')
    : !socketConnected
      ? ((statusReason = 'socketConnected=false'), 'OFFLINE')
      : hasQuote && quote?.dataMode === 'delayed'
        ? ((statusReason = 'quote.dataMode=delayed'), 'DEGRADED')
        : hasQuote && quote?.dataMode === 'snapshot'
          ? ((statusReason = 'quote.dataMode=snapshot'), 'DEGRADED')
          : hasQuote && isFresh
            ? ((statusReason = `hasQuote=true, ageMs=${ageMs} <= ${LIVE_QUOTE_FRESH_MS}`), 'LIVE')
            : hasQuote && isQuietButActive
              ? ((statusReason = `hasQuote=true, ageMs=${ageMs}, subscriptionActive=true (quiet contract, not stale)`), 'LIVE')
              : !hasQuote && subscriptionFailed
                ? ((statusReason = 'subscriptionFailed=true — no ack or quote arrived before timeout'), 'SUBSCRIPTION_FAILED')
                : providerUnavailable
                  ? ((statusReason = 'providerUnavailable=true, no fresh quote to show instead'), 'PROVIDER_BLOCKED')
                  : hasQuote
                    ? marketClosed
                      ? ((statusReason = `hasQuote=true, ageMs=${ageMs} (stale) marketClosed=true`), 'MARKET_CLOSED')
                      : ((statusReason = `hasQuote=true, ageMs=${ageMs} (stale) marketClosed=false`), 'STALE')
                    : subscriptionActive
                    ? ((statusReason = 'hasQuote=false, subscriptionActive=true — no quote in store for this symbol key'), 'WAITING_FOR_QUOTES')
                    : ((statusReason = 'hasQuote=false, subscriptionActive=false'), 'CONNECTING');

  const prevStatusRef = useRef<DepthStatus | null>(null);
  useEffect(() => {
    if (prevStatusRef.current === status) return;
    debugLog('depth', '[DEPTH_STATE]', {
      symbol,
      prevStatus: prevStatusRef.current,
      status,
      reason: statusReason,
      socketConnected,
      subscriptionActive,
      providerUnavailable,
      marketClosed,
      hasQuote,
      quoteTicker: quote?.ticker ?? null,
      quoteDataMode: quote?.dataMode ?? null,
      quoteTimestamp: quote?.timestamp ?? null,
      nowMs: now,
      ageMs,
      isFresh,
      subscriptionFailed,
    });
    prevStatusRef.current = status;
  }, [status, statusReason, symbol, socketConnected, subscriptionActive, providerUnavailable, subscriptionFailed, marketClosed, hasQuote, quote, now, ageMs, isFresh]);
  const statusCopy = {
    LIVE: 'Receiving live option quotes.',
    CONNECTING: 'Subscribing to option contracts...',
    WAITING_FOR_CONTRACTS: 'Select an option contract to begin streaming.',
    WAITING_FOR_QUOTES: 'Awaiting live option quotes...',
    DEGRADED: quote?.dataMode === 'delayed' ? 'Delayed option quote displayed.' : 'Snapshot option quote displayed.',
    PROVIDER_BLOCKED: 'Live options feed unavailable.',
    SUBSCRIPTION_FAILED: 'Subscription failed — no response from live feed.',
    STALE: 'Last option quote is stale.',
    MARKET_CLOSED: 'Market closed. Showing last option quote.',
    OFFLINE: 'Options service unavailable.',
  }[status];

  const renderRung = (rung: Rung) => (
    <div
      key={rung.price.toFixed(2)}
      className={`grid grid-cols-3 items-center px-4 py-[3px] font-mono text-[12px] tabular-nums ${
        rung.isBid || rung.isAsk ? 'bg-intel-panel2' : ''
      }`}
    >
      {/* Bid size — left flank, only at the best bid rung. */}
      <span className="text-intel-info">
        {rung.bidSize != null ? (
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-3 rounded-sm bg-intel-info/25" style={{ width: sizeBar(rung.bidSize) }} />
            {rung.bidSize}
          </span>
        ) : (
          ''
        )}
      </span>

      {/* Price spine — center band; last trade lit; bid/ask tinted. */}
      <span
        className={`rounded-sm py-[1px] text-center font-semibold ${
          rung.isLast
            ? 'bg-intel-info text-intel-bg'
            : rung.isBid
              ? 'bg-intel-panel2 text-intel-info'
              : rung.isAsk
                ? 'bg-intel-panel2 text-intel-neg'
                : mid != null && Math.abs(rung.price - mid) < TICK / 2
                  ? 'bg-intel-accentSoft text-intel-accent'
                  : 'bg-intel-panel2/50 text-intel-ink2'
        }`}
        title={rung.isLast && lastTrade?.size != null ? `Last trade ×${lastTrade.size}` : undefined}
      >
        {rung.price.toFixed(2)}
      </span>

      {/* Ask size — right flank, only at the best ask rung. */}
      <span className="text-right text-intel-neg">
        {rung.askSize != null ? (
          <span className="inline-flex items-center justify-end gap-2">
            {rung.askSize}
            <span className="inline-block h-3 rounded-sm bg-intel-neg/25" style={{ width: sizeBar(rung.askSize) }} />
          </span>
        ) : (
          ''
        )}
      </span>
    </div>
  );

  return (
    <section className="flex h-full flex-col rounded-panel bg-intel-panel" data-testid="price-ladder">
      <div className="flex items-center justify-between border-b border-intel-divider px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="font-mono text-[10px] font-semibold uppercase tracking-label text-intel-ink3">
            Top of Book
          </h3>
          <span className="truncate font-mono text-[11px] font-semibold text-intel-ink">
            {contractLabel ?? symbol ?? `${underlying} Options`}
          </span>
        </div>
        <DepthStatusChip status={status} />
      </div>

      <div className="grid grid-cols-3 px-4 py-1.5 font-mono text-[9.5px] uppercase tracking-label text-intel-ink3">
        <span>Bid Size</span>
        <span className="text-center">Price</span>
        <span className="text-right">Ask Size</span>
      </div>

      {rungs.length === 0 ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-8 text-center"
          data-testid="price-ladder-status"
        >
          {/* Stacked-rung glyph — reads as "book" even before data lands, so the
              panel looks intentional rather than empty. */}
          <div
            aria-hidden
            className="flex flex-col items-center gap-[3px] opacity-60"
          >
            {[16, 24, 20, 28, 18].map((w, i) => (
              <span
                key={i}
                className={`h-[3px] rounded-full ${i === 2 ? 'bg-intel-accent/60' : 'bg-intel-line'}`}
                style={{ width: `${w}px` }}
              />
            ))}
          </div>
          <p className="font-mono text-[11px] text-intel-ink2">{statusCopy}</p>
          {status === 'WAITING_FOR_CONTRACTS' && (
            <p className="max-w-[220px] font-mono text-[10px] leading-relaxed text-intel-ink3">
              Pick a strike in the Matrix, or use Auto-Select Contract, to stream the live book and tape here.
            </p>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {ladderItems.map(item =>
            item.type === 'rung' ? (
              renderRung(item.rung)
            ) : expandedGaps.has(item.id) ? (
              item.rungs.map(rung => renderRung(rung))
            ) : (
              <button
                key={`gap-${item.id}`}
                type="button"
                onClick={() =>
                  setExpandedGaps(prev => {
                    const next = new Set(prev);
                    next.add(item.id);
                    return next;
                  })
                }
                className="grid w-full grid-cols-3 items-center px-4 py-1 transition-colors hover:bg-intel-panel2/50"
                title={`${item.rungs.length} price levels with no resting size — click to expand`}
                aria-label={`Show ${item.rungs.length} hidden price levels with no resting size`}
              >
                <span className="h-px bg-intel-divider" />
                <span className="mx-auto rounded-sm border border-intel-divider bg-intel-panel2/40 px-2 py-[1px] font-mono text-[9px] uppercase tracking-label text-intel-ink3">
                  {item.rungs.length} empty ⋯
                </span>
                <span className="h-px bg-intel-divider" />
              </button>
            )
          )}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-intel-divider px-4 py-2 font-mono text-[11px] tabular-nums">
        <span className="text-intel-info">
          BID <span className="font-semibold text-intel-ink">{bid != null ? bid.toFixed(2) : '—'}</span>
          {quote?.bidSize != null ? <span className="text-intel-ink3"> ×{quote.bidSize}</span> : null}
        </span>
        <span className="text-intel-ink3">
          SPR <span className="text-intel-ink2">{bid != null && ask != null ? (ask - bid).toFixed(2) : '—'}</span>
        </span>
        <span className="text-intel-neg">
          {quote?.askSize != null ? <span className="text-intel-ink3">×{quote.askSize} </span> : null}
          <span className="font-semibold text-intel-ink">{ask != null ? ask.toFixed(2) : '—'}</span> ASK
        </span>
      </div>

      {/* Time & sales — the most recent real prints, newest first. Direction
          is judged against the concurrent mid: at/above ask lifts (green),
          at/below bid hits (red), between prints neutral. */}
      <div className="border-t border-intel-divider px-4 py-2" data-testid="time-sales">
        <div className="mb-1 font-mono text-[9.5px] uppercase tracking-label text-intel-ink3">Time &amp; Sales</div>
        {tapeRows.length > 0 ? (
          <div className="flex flex-col gap-[2px]">
            {tapeRows.map((print, idx) => {
              const tone =
                mid == null || print.price == null
                  ? 'text-intel-ink2'
                  : print.price > mid
                    ? 'text-intel-pos'
                    : print.price < mid
                      ? 'text-intel-neg'
                      : 'text-intel-ink2';
              const timeLabel = formatTradeTime(print.timestamp);
              return (
                <div
                  key={`${print.timestamp ?? idx}-${idx}`}
                  className="grid grid-cols-[86px_1fr_auto] gap-2 font-mono text-[10.5px] tabular-nums"
                >
                  <span className="text-intel-ink3">
                    {timeLabel}
                  </span>
                  <span className={`font-semibold ${tone}`}>{print.price != null ? print.price.toFixed(2) : '—'}</span>
                  <span className="text-intel-ink2">×{print.size ?? '—'}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="font-mono text-[10.5px] text-intel-ink3">No recent prints.</div>
        )}
      </div>
    </section>
  );
});

function DepthStatusChip({ status }: { status: DepthStatus }) {
  const map = {
    LIVE: { dot: 'bg-intel-pos', text: 'text-intel-pos', label: 'LIVE', pulse: true },
    CONNECTING: { dot: 'bg-intel-info', text: 'text-intel-info', label: 'CONNECTING', pulse: true },
    WAITING_FOR_CONTRACTS: { dot: 'bg-intel-ink3', text: 'text-intel-ink3', label: 'WAITING', pulse: false },
    WAITING_FOR_QUOTES: { dot: 'bg-intel-info', text: 'text-intel-info', label: 'WAITING', pulse: true },
    DEGRADED: { dot: 'bg-intel-warn', text: 'text-intel-warn', label: 'DEGRADED', pulse: false },
    PROVIDER_BLOCKED: { dot: 'bg-intel-warn', text: 'text-intel-warn', label: 'BLOCKED', pulse: false },
    SUBSCRIPTION_FAILED: { dot: 'bg-intel-neg', text: 'text-intel-neg', label: 'SUB FAILED', pulse: false },
    STALE: { dot: 'bg-intel-warn', text: 'text-intel-warn', label: 'STALE', pulse: false },
    MARKET_CLOSED: { dot: 'bg-intel-ink3', text: 'text-intel-ink3', label: 'CLOSED', pulse: false },
    OFFLINE: { dot: 'bg-intel-neg', text: 'text-intel-neg', label: 'OFFLINE', pulse: false },
  }[status];

  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-label ${map.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${map.dot} ${map.pulse ? 'motion-safe:animate-heartbeat' : ''}`} />
      {map.label}
    </span>
  );
}

function formatTradeTime(timestamp: number | null | undefined): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return '—';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}

/** Width of the resting-size bar, scaled and capped for a compact flank. */
function sizeBar(size: number): string {
  const px = Math.min(40, Math.max(4, Math.round(size / 5)));
  return `${px}px`;
}
