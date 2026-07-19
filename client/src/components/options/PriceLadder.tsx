import { memo, useMemo } from 'react';
import { useLiveQuote, useLiveTrade, useLiveTradeHistory } from '../../lib/liveMarketStore';
import { LiveState } from '../shared/terminal';

// Institutional price ladder (DOM) — the execution surface. A centered price
// spine with resting size on the flanks, the inside market highlighted, the
// last trade lit on the spine, and a short time & sales tape below. Built
// strictly from the real NBBO + prints the live store already carries: deeper
// book levels are shown as empty rungs rather than invented — a ladder must
// never paint depth it doesn't have.

const TICK = 0.01;
const RUNGS_EACH_SIDE = 7;
const TAPE_ROWS = 8;

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

export const PriceLadder = memo(function PriceLadder({ symbol }: { symbol: string }) {
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

  const tapeRows = useMemo(() => tape.slice(-TAPE_ROWS).reverse(), [tape]);

  return (
    <section className="flex h-full flex-col rounded-panel bg-intel-panel">
      <div className="flex items-center justify-between border-b border-intel-divider px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h3 className="font-mono text-[10px] font-semibold uppercase tracking-label text-intel-ink3">
            Matrix · Depth
          </h3>
          <span className="font-mono text-[11px] font-semibold text-intel-ink">{symbol}</span>
        </div>
        <LiveState timestamp={quote?.timestamp ?? null} />
      </div>

      <div className="grid grid-cols-3 px-4 py-1.5 font-mono text-[9.5px] uppercase tracking-label text-intel-ink3">
        <span>Bid Size</span>
        <span className="text-center">Price</span>
        <span className="text-right">Ask Size</span>
      </div>

      {rungs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 py-8 text-center font-mono text-[11px] text-intel-ink3">
          Awaiting live quotes for {symbol}
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
              const ts = print.timestamp != null ? new Date(print.timestamp) : null;
              return (
                <div
                  key={`${print.timestamp ?? idx}-${idx}`}
                  className="grid grid-cols-[56px_1fr_auto] gap-2 font-mono text-[10.5px] tabular-nums"
                >
                  <span className="text-intel-ink3">
                    {ts ? ts.toLocaleTimeString(undefined, { hour12: false }) : '—'}
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

/** Width of the resting-size bar, scaled and capped for a compact flank. */
function sizeBar(size: number): string {
  const px = Math.min(40, Math.max(4, Math.round(size / 5)));
  return `${px}px`;
}
