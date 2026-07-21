import { memo, useEffect, useMemo, useState } from 'react';
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
const LIVE_QUOTE_FRESH_MS = 10_000;

type DepthStatus =
  | 'LIVE'
  | 'CONNECTING'
  | 'WAITING_FOR_CONTRACTS'
  | 'WAITING_FOR_QUOTES'
  | 'DEGRADED'
  | 'PROVIDER_BLOCKED'
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

type PriceLadderProps = {
  symbol: string | null;
  underlying: string;
  contractLabel?: string | null;
  socketConnected: boolean;
  subscriptionActive: boolean;
  providerUnavailable?: boolean;
  marketClosed?: boolean;
};

export const PriceLadder = memo(function PriceLadder({
  symbol,
  underlying,
  contractLabel,
  socketConnected,
  subscriptionActive,
  providerUnavailable,
  marketClosed,
}: PriceLadderProps) {
  const [now, setNow] = useState(() => Date.now());
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
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const ageMs = quote?.timestamp != null ? now - quote.timestamp : null;
  const hasQuote = Boolean(quote);
  const isFresh = ageMs != null && ageMs >= 0 && ageMs <= LIVE_QUOTE_FRESH_MS;
  const status: DepthStatus = !symbol
    ? 'WAITING_FOR_CONTRACTS'
    : !socketConnected
      ? 'OFFLINE'
      : providerUnavailable
        ? 'PROVIDER_BLOCKED'
      : hasQuote && quote?.dataMode === 'delayed'
        ? 'DEGRADED'
        : hasQuote && quote?.dataMode === 'snapshot'
          ? 'DEGRADED'
          : hasQuote && isFresh
            ? 'LIVE'
            : hasQuote
              ? marketClosed
                ? 'MARKET_CLOSED'
                : 'STALE'
              : subscriptionActive
                ? 'WAITING_FOR_QUOTES'
                : 'CONNECTING';
  const statusCopy = {
    LIVE: 'Receiving live option quotes.',
    CONNECTING: 'Subscribing to option contracts...',
    WAITING_FOR_CONTRACTS: 'Select an option contract to begin streaming.',
    WAITING_FOR_QUOTES: 'Awaiting live option quotes...',
    DEGRADED: quote?.dataMode === 'delayed' ? 'Delayed option quote displayed.' : 'Snapshot option quote displayed.',
    PROVIDER_BLOCKED: 'Live options feed unavailable.',
    STALE: 'Last option quote is stale.',
    MARKET_CLOSED: 'Market closed. Showing last option quote.',
    OFFLINE: 'Options service unavailable.',
  }[status];

  return (
    <section className="flex h-full flex-col rounded-panel bg-intel-panel">
      <div className="flex items-center justify-between border-b border-intel-divider px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="font-mono text-[10px] font-semibold uppercase tracking-label text-intel-ink3">
            Matrix · Top of Book
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
        <div className="flex flex-1 items-center justify-center px-4 py-8 text-center font-mono text-[11px] text-intel-ink3">
          {statusCopy}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {rungs.map(rung => (
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
          ))}
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
      {tapeRows.length > 0 && (
        <div className="border-t border-intel-divider px-4 py-2">
          <div className="mb-1 font-mono text-[9.5px] uppercase tracking-label text-intel-ink3">Time &amp; Sales</div>
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
        </div>
      )}
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
