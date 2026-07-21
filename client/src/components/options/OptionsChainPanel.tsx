import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react';
import type { OptionChainExpirationGroup, OptionContractDetail, OptionLeg } from '../../types/market';
import { computeExpirationDte, formatExpirationDate } from '../../utils/expirations';
import { useLiveQuotes, useLiveTrades } from '../../lib/liveMarketStore';
import { getOptionPositions } from '../../api/alpaca';
import {
  expectedMove,
  extrinsicValue,
  intrinsicValue,
  probItm,
  probOtm,
  probTouch,
  spreadPercent,
} from '../../lib/optionsMath';

type Props = {
  ticker: string;
  groups: OptionChainExpirationGroup[];
  underlyingPrice: number | null;
  loading: boolean;
  error?: string | null;
  availableExpirations: string[];
  selectedExpiration: string | null;
  onExpirationChange: (value: string | null) => void;
  selectedContract?: OptionLeg | null;
  onContractSelect: (leg: OptionLeg | null) => void;
  selectedContractDetail?: OptionContractDetail | null;
  preferredSide?: 'call' | 'put' | null;
  onRequestAnalysis?: () => void;
  analysisDisabled?: boolean;
};

// Matrix columns — strike anchors the left; quote, flow, and greeks read
// left-to-right the way a desk scans a chain. B/E and the full greek set live
// in the expanded row so the ladder itself stays one line per strike.
const MATRIX_HEADERS: Array<{ label: string; align: 'left' | 'right' }> = [
  { label: 'Strike', align: 'left' },
  { label: 'Bid', align: 'right' },
  { label: 'Ask', align: 'right' },
  { label: 'Mark', align: 'right' },
  { label: 'Sprd%', align: 'right' },
  { label: 'Last', align: 'right' },
  { label: 'Chg%', align: 'right' },
  { label: 'Vol', align: 'right' },
  { label: 'OI', align: 'right' },
  { label: 'IV', align: 'right' },
  { label: 'Δ', align: 'right' },
  { label: 'Θ', align: 'right' },
  { label: 'P.ITM', align: 'right' },
];

type MatrixHighlight = {
  atm?: boolean;
  highestOi?: boolean;
  highestVolume?: boolean;
  tightestSpread?: boolean;
  highestDelta?: boolean;
  lowLiquidity?: boolean;
};

/** Normalize an OSI/Massive contract symbol for cross-source comparison. */
function normalizeContract(symbol: string | null | undefined): string {
  return (symbol ?? '').toUpperCase().replace(/^O:/, '');
}

// memo: live ticks re-render this panel via the store subscription below —
// the rest of the app's renders should not re-render the chain table.
export const OptionsChainPanel = memo(function OptionsChainPanel({
  ticker,
  groups,
  underlyingPrice,
  loading,
  error,
  availableExpirations,
  selectedExpiration,
  onExpirationChange,
  selectedContract,
  onContractSelect,
  selectedContractDetail,
  preferredSide,
  onRequestAnalysis,
  analysisDisabled,
}: Props) {
  // Live prices come straight from the shared store, not through App state.
  const liveQuotes = useLiveQuotes();
  const liveTrades = useLiveTrades();
  const [optionType, setOptionType] = useState<'calls' | 'puts'>('calls');
  const [strikeFilter, setStrikeFilter] = useState('');
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const tableBodyRef = useRef<HTMLTableSectionElement | null>(null);
  // Broker positions (normalized symbols) so held contracts read as POS rows.
  const [heldContracts, setHeldContracts] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    getOptionPositions()
      .then(response => {
        if (cancelled) return;
        const next = new Set<string>();
        response.positions?.forEach(pos => {
          if (pos?.symbol) next.add(normalizeContract(pos.symbol));
        });
        setHeldContracts(next);
      })
      .catch(() => {
        // Broker unavailable → no POS badges; the chain still renders.
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  useEffect(() => {
    if (preferredSide === 'call') {
      setOptionType('calls');
    } else if (preferredSide === 'put') {
      setOptionType('puts');
    }
  }, [preferredSide]);

  const expirationOptions = useMemo(
    () =>
      availableExpirations.map(date => ({
        value: date,
        label: formatExpirationDate(date),
        dte: computeExpirationDte(date) ?? undefined,
      })),
    [availableExpirations]
  );

  const activeGroup = useMemo(() => {
    if (!groups.length) return null;
    if (!selectedExpiration) return groups[0];
    return groups.find(group => group.expiration === selectedExpiration) ?? groups[0];
  }, [groups, selectedExpiration]);

  const rows = useMemo(() => {
    if (!activeGroup) return [];
    let filtered = activeGroup.strikes.filter(row =>
      optionType === 'calls' ? Boolean(row.call) : Boolean(row.put)
    );
    const filterValue = Number(strikeFilter);
    if (strikeFilter.trim() && Number.isFinite(filterValue) && filterValue > 0) {
      filtered = filtered.filter(row => {
        const strike = row.strike ?? row.call?.strike ?? row.put?.strike;
        return strike != null && Math.abs(strike - filterValue) / filterValue <= 0.05;
      });
    }
    return filtered;
  }, [activeGroup, optionType, strikeFilter]);

  const dteValue =
    activeGroup?.dte != null
      ? activeGroup.dte
      : selectedExpiration
      ? computeExpirationDte(selectedExpiration)
      : null;
  const dteLabel = dteValue != null ? `${dteValue}DTE` : null;

  // Expected move (1σ to this expiration) from the ATM implied vol. Uses the
  // strike nearest spot on the active side — an honest desk approximation.
  const expectedMoveValue = useMemo(() => {
    if (underlyingPrice == null || dteValue == null || !activeGroup) return null;
    let atmIv: number | null = null;
    let smallestDiff = Number.POSITIVE_INFINITY;
    for (const row of activeGroup.strikes) {
      const leg = optionType === 'calls' ? row.call : row.put;
      const strike = row.strike ?? leg?.strike;
      if (!leg || strike == null || leg.iv == null) continue;
      const diff = Math.abs(strike - underlyingPrice);
      if (diff < smallestDiff) {
        smallestDiff = diff;
        atmIv = leg.iv;
      }
    }
    return expectedMove(underlyingPrice, atmIv, dteValue);
  }, [activeGroup, optionType, underlyingPrice, dteValue]);

  const matrixHighlights = useMemo(() => {
    const ranked = new Map<string, MatrixHighlight>();
    if (!rows.length) return ranked;

    let atmTicker: string | null = null;
    let atmDistance = Number.POSITIVE_INFINITY;
    let maxOiTicker: string | null = null;
    let maxOi = -Infinity;
    let maxVolTicker: string | null = null;
    let maxVol = -Infinity;
    let tightTicker: string | null = null;
    let tightSpread = Number.POSITIVE_INFINITY;
    let highDeltaTicker: string | null = null;
    let highDelta = -Infinity;

    for (const row of rows) {
      const leg = optionType === 'calls' ? row.call : row.put;
      if (!leg) continue;
      const strike = row.strike ?? leg.strike;
      const quote = liveQuotes?.[leg.ticker];
      const bid = quote?.bidPrice ?? leg.bid ?? null;
      const ask = quote?.askPrice ?? leg.ask ?? null;
      const detailOverride =
        selectedContractDetail?.ticker?.toUpperCase() === leg.ticker.toUpperCase()
          ? selectedContractDetail
          : null;
      const oi =
        typeof detailOverride?.openInterest === 'number'
          ? detailOverride.openInterest
          : leg.openInterest ?? null;
      const volume = leg.volume ?? null;
      const delta =
        typeof detailOverride?.greeks?.delta === 'number'
          ? detailOverride.greeks.delta
          : leg.delta ?? null;
      const spread = spreadPercent(bid, ask);

      if (underlyingPrice != null && strike != null) {
        const distance = Math.abs(strike - underlyingPrice);
        if (distance < atmDistance) {
          atmDistance = distance;
          atmTicker = leg.ticker;
        }
      }
      if (oi != null && oi > maxOi) {
        maxOi = oi;
        maxOiTicker = leg.ticker;
      }
      if (volume != null && volume > maxVol) {
        maxVol = volume;
        maxVolTicker = leg.ticker;
      }
      if (spread != null && spread >= 0 && spread < tightSpread) {
        tightSpread = spread;
        tightTicker = leg.ticker;
      }
      if (delta != null && Math.abs(delta) > highDelta) {
        highDelta = Math.abs(delta);
        highDeltaTicker = leg.ticker;
      }

      const lowLiquidity =
        (oi != null && oi < 100 && (volume ?? 0) < 20) ||
        (spread != null && spread > 20) ||
        (bid == null && ask == null);
      if (lowLiquidity) {
        ranked.set(leg.ticker, { ...(ranked.get(leg.ticker) ?? {}), lowLiquidity: true });
      }
    }

    const mark = (ticker: string | null, key: keyof MatrixHighlight) => {
      if (!ticker) return;
      ranked.set(ticker, { ...(ranked.get(ticker) ?? {}), [key]: true });
    };

    mark(atmTicker, 'atm');
    mark(maxOiTicker, 'highestOi');
    mark(maxVolTicker, 'highestVolume');
    mark(tightTicker, 'tightestSpread');
    mark(highDeltaTicker, 'highestDelta');
    return ranked;
  }, [rows, optionType, underlyingPrice, liveQuotes, selectedContractDetail]);

  useEffect(() => {
    if (!scrollContainerRef.current || !tableBodyRef.current) return;
    if (underlyingPrice == null) return;
    const rowElements = Array.from(
      tableBodyRef.current.querySelectorAll<HTMLTableRowElement>('tr[data-strike]')
    );
    if (!rowElements.length) return;
    let closestRow: HTMLTableRowElement | null = null;
    let smallestDiff = Number.POSITIVE_INFINITY;
    for (const rowEl of rowElements) {
      const strikeAttr = rowEl.getAttribute('data-strike');
      if (!strikeAttr) continue;
      const strikeValue = Number(strikeAttr);
      if (Number.isNaN(strikeValue)) continue;
      const distance = Math.abs(strikeValue - underlyingPrice);
      if (distance < smallestDiff) {
        smallestDiff = distance;
        closestRow = rowEl;
      }
    }
    if (closestRow) {
      const container = scrollContainerRef.current;
      const targetOffset = closestRow.offsetTop - container.clientHeight / 2;
      container.scrollTo({ top: Math.max(0, targetOffset), behavior: 'auto' });
    }
  }, [underlyingPrice, optionType, selectedExpiration, rows.length]);

  const handleSelect = (leg: OptionLeg) => {
    if (selectedContract?.ticker === leg.ticker) {
      onContractSelect(null);
    } else {
      onContractSelect(leg);
    }
  };

  const renderHeader = () => (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-intel-line px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-intel-ink3">Matrix</span>
        <span className="font-mono text-[15px] font-semibold tracking-wide text-intel-ink">{ticker}</span>
        {underlyingPrice != null && (
          <span className="font-mono text-[11px] tabular-nums text-intel-info">@ {underlyingPrice.toFixed(2)}</span>
        )}
        {expectedMoveValue != null && (
          <span
            className="font-mono text-[11px] tabular-nums text-intel-ai"
            title={`1σ expected move by this expiration, from ATM implied vol${dteLabel ? ` (${dteLabel})` : ''}`}
          >
            EM ±${expectedMoveValue.toFixed(2)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* Calls / Puts — hard segmented toggle */}
        <div className="flex overflow-hidden rounded-panel border border-intel-line font-mono text-[11px] font-semibold uppercase tracking-label">
          {(['calls', 'puts'] as const).map(type => {
            const activeT = optionType === type;
            const tint = type === 'calls' ? 'bg-intel-pos text-intel-bg' : 'bg-intel-neg text-intel-bg';
            return (
              <button
                key={type}
                type="button"
                onClick={() => setOptionType(type)}
                className={`px-3 py-1.5 transition-colors ${activeT ? tint : 'text-intel-ink3 hover:bg-intel-panel2'}`}
              >
                {type === 'calls' ? 'Calls' : 'Puts'}
              </button>
            );
          })}
        </div>
        {/* Strike filter — jump the ladder to a neighborhood (±5%). */}
        <input
          value={strikeFilter}
          onChange={event => setStrikeFilter(event.target.value.replace(/[^0-9.]/g, ''))}
          placeholder="Strike"
          aria-label="Filter strikes near a price"
          className="w-[72px] rounded-panel border border-intel-line bg-intel-panel2 px-2 py-1.5 font-mono text-[11px] tabular-nums text-intel-ink placeholder:text-intel-ink3 focus:border-intel-accentLine focus-visible:outline-none"
        />
        {/* Expiration */}
        <div className="flex items-center gap-1.5">
          <select
            aria-label="Expiration"
            className="appearance-none rounded-panel border border-intel-line bg-intel-panel2 px-2.5 py-1.5 font-mono text-[11px] text-intel-ink focus:border-intel-accentLine focus-visible:outline-none disabled:opacity-50"
            value={selectedExpiration ?? ''}
            onChange={event => onExpirationChange(event.target.value || null)}
            disabled={!expirationOptions.length}
          >
            <option value="">{expirationOptions.length ? 'All expirations' : 'No expirations'}</option>
            {expirationOptions.map(exp => (
              <option key={exp.value} value={exp.value}>
                {exp.label} {exp.dte != null ? `(${exp.dte}D)` : ''}
              </option>
            ))}
          </select>
          {dteLabel && (
            <span className="rounded-sm bg-intel-raised px-1.5 py-1 font-mono text-[10px] font-semibold tabular-nums text-intel-ink2">
              {dteLabel}
            </span>
          )}
        </div>
        {onRequestAnalysis && (
          <button
            type="button"
            onClick={onRequestAnalysis}
            disabled={analysisDisabled}
            className="rounded-panel border border-intel-aiLine px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-label text-intel-ai transition-colors hover:bg-intel-aiSoft disabled:opacity-60"
          >
            Analyze · AI
          </button>
        )}
      </div>
    </div>
  );

  const renderRow = (row: typeof rows[number], index: number) => {
    const leg = optionType === 'calls' ? row.call : row.put;
    if (!leg) return null;
    const side = optionType === 'calls' ? ('call' as const) : ('put' as const);
    const strike = row.strike ?? leg.strike;
    const detailOverride =
      selectedContractDetail?.ticker?.toUpperCase() === leg.ticker.toUpperCase()
        ? selectedContractDetail
        : null;
    const liveQuote = liveQuotes?.[leg.ticker];
    const liveTrade = liveTrades?.[leg.ticker];
    const liveBid = liveQuote?.bidPrice ?? leg.bid ?? null;
    const liveAsk = liveQuote?.askPrice ?? leg.ask ?? null;
    const liveMid = liveQuote?.midpoint ?? leg.mid ?? null;
    const liveMark = liveQuote?.midpoint ?? leg.mark ?? null;
    const liveLast = liveTrade?.price ?? leg.lastPrice ?? leg.lastTrade?.price ?? null;
    const mark = liveMark ?? liveMid ?? liveLast ?? liveBid ?? liveAsk ?? null;
    const changePercent = leg.changePercent ?? null;
    const breakeven = leg.breakeven ?? detailOverride?.breakEvenPrice ?? null;
    const isSelected = selectedContract?.ticker === leg.ticker;
    const isHeld = heldContracts.has(normalizeContract(leg.ticker));
    const isLive = Boolean(liveQuote || liveTrade);
    const resolvedIv =
      typeof detailOverride?.impliedVolatility === 'number' ? detailOverride.impliedVolatility : leg.iv ?? null;
    const resolvedOpenInterest =
      typeof detailOverride?.openInterest === 'number' ? detailOverride.openInterest : leg.openInterest ?? null;
    const detailGreeks = detailOverride?.greeks ?? null;
    const resolvedDelta = typeof detailGreeks?.delta === 'number' ? detailGreeks.delta : leg.delta ?? null;
    const resolvedGamma = typeof detailGreeks?.gamma === 'number' ? detailGreeks.gamma : leg.gamma ?? null;
    const resolvedTheta = typeof detailGreeks?.theta === 'number' ? detailGreeks.theta : leg.theta ?? null;
    const resolvedVega = typeof detailGreeks?.vega === 'number' ? detailGreeks.vega : leg.vega ?? null;
    const resolvedRho = typeof detailGreeks?.rho === 'number' ? detailGreeks.rho : leg.rho ?? null;
    const spreadPct = spreadPercent(liveBid, liveAsk);
    const pItm = probItm(side, underlyingPrice, strike, resolvedIv, dteValue);
    const prevStrike = index > 0 ? rows[index - 1].strike ?? rows[index - 1].call?.strike ?? rows[index - 1].put?.strike ?? null : null;
    const showUnderlyingLine =
      underlyingPrice != null &&
      strike != null &&
      ((prevStrike == null && underlyingPrice <= strike) ||
        (prevStrike != null && prevStrike < underlyingPrice && strike >= underlyingPrice));
    // Moneyness: ITM calls have strike below spot; ITM puts strike above spot.
    const itm =
      underlyingPrice != null && strike != null
        ? optionType === 'calls'
          ? strike < underlyingPrice
          : strike > underlyingPrice
        : false;
    const highlight = matrixHighlights.get(leg.ticker) ?? {};
    const moneynessLabel = underlyingPrice != null && strike != null ? (highlight.atm ? 'ATM' : itm ? 'ITM' : 'OTM') : null;
    const moneynessClass = highlight.atm
      ? 'bg-intel-info/15 text-intel-info'
      : itm
        ? 'bg-intel-raised text-intel-ink3'
        : 'bg-intel-panel2 text-intel-ink3';
    const highlightTags: Array<{ label: string; cls: string; title: string }> = [
      highlight.highestOi
        ? { label: 'OI', cls: 'bg-intel-accentSoft text-intel-accent', title: 'Highest open interest in visible rows' }
        : null,
      highlight.highestVolume
        ? { label: 'VOL', cls: 'bg-intel-pos/12 text-intel-pos', title: 'Highest volume in visible rows' }
        : null,
      highlight.tightestSpread
        ? { label: 'TIGHT', cls: 'bg-intel-cyan/10 text-intel-cyan', title: 'Tightest spread in visible rows' }
        : null,
      highlight.highestDelta
        ? { label: 'DELTA', cls: 'bg-intel-aiSoft text-intel-ai', title: 'Highest absolute delta in visible rows' }
        : null,
      highlight.lowLiquidity
        ? { label: 'LOW LIQ', cls: 'bg-intel-warn/10 text-intel-warn', title: 'Low liquidity or wide spread' }
        : null,
    ].filter((tag): tag is { label: string; cls: string; title: string } => Boolean(tag));

    const changeUp = changePercent != null && changePercent >= 0;
    const cell = 'px-2 py-1 font-mono text-[11px] tabular-nums text-right';

    return (
      <Fragment key={`${leg.ticker}-${optionType}`}>
        {showUnderlyingLine && (
          <tr>
            <td colSpan={MATRIX_HEADERS.length} className="p-0">
              <div className="flex items-center gap-2 bg-intel-info/10 px-3 py-0.5">
                <span className="h-px flex-1 bg-intel-info/40" />
                <span className="font-mono text-[9px] font-semibold uppercase tracking-label text-intel-info">
                  Spot {formatCurrency(underlyingPrice)}
                  {expectedMoveValue != null && underlyingPrice != null && (
                    <span className="ml-2 text-intel-ai">
                      1σ {formatCurrency(underlyingPrice - expectedMoveValue)} – {formatCurrency(underlyingPrice + expectedMoveValue)}
                    </span>
                  )}
                </span>
                <span className="h-px flex-1 bg-intel-info/40" />
              </div>
            </td>
          </tr>
        )}
        <tr
          role="button"
          tabIndex={0}
          onClick={() => handleSelect(leg)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              handleSelect(leg);
            }
          }}
          className={`cursor-pointer border-l-2 transition-colors ${
            isSelected
              ? 'border-l-intel-info bg-intel-info/10'
            : isHeld
              ? 'border-l-intel-accent bg-intel-accentSoft/40 hover:bg-intel-accentSoft'
              : highlight.atm
              ? 'border-l-intel-info bg-intel-info/5 hover:bg-intel-info/10'
              : highlight.lowLiquidity
              ? 'border-l-intel-warn/70 bg-intel-warn/5 hover:bg-intel-warn/10'
            : itm
              ? 'border-l-transparent bg-intel-panel2/40 hover:bg-intel-panel2'
              : 'border-l-transparent hover:bg-intel-panel2/70'
          }`}
          data-strike={strike ?? undefined}
        >
          <td className="px-2 py-1 text-left font-mono text-[11px] font-semibold tabular-nums text-intel-ink">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              {isLive && <span className="h-1 w-1 shrink-0 rounded-full bg-intel-cyan" />}
              {formatCurrency(strike)}
              {isHeld && (
                <span className="rounded-sm bg-intel-accent px-1 text-[8px] font-semibold uppercase tracking-label text-intel-bg">
                  POS
                </span>
              )}
              {moneynessLabel && (
                <span
                  className={`rounded-sm px-1 text-[8px] font-semibold uppercase tracking-label ${moneynessClass}`}
                  title={moneynessLabel === 'ATM' ? 'At the money' : moneynessLabel === 'ITM' ? 'In the money' : 'Out of the money'}
                >
                  {moneynessLabel}
                </span>
              )}
              {highlightTags.slice(0, 3).map(tag => (
                <span
                  key={tag.label}
                  title={tag.title}
                  className={`rounded-sm px-1 py-0 font-mono text-[8px] font-semibold uppercase tracking-label ${tag.cls}`}
                >
                  {tag.label}
                </span>
              ))}
            </span>
          </td>
          <td className={`${cell} text-intel-pos`}>{formatCurrency(liveBid)}</td>
          <td className={`${cell} text-intel-neg`}>{formatCurrency(liveAsk)}</td>
          <td className={`${cell} font-semibold text-intel-ink`}>{formatCurrency(mark)}</td>
          <td className={`${cell} ${spreadPct != null && spreadPct > 10 ? 'text-intel-warn' : 'text-intel-ink3'}`}>
            {spreadPct != null ? spreadPct.toFixed(1) : '—'}
          </td>
          <td className={`${cell} text-intel-ink2`}>{formatCurrency(liveLast)}</td>
          <td className={`${cell} ${changePercent != null ? (changeUp ? 'text-intel-pos' : 'text-intel-neg') : 'text-intel-ink3'}`}>
            {formatPercent(changePercent)}
          </td>
          <td className={`${cell} text-intel-ink2`}>{formatCount(leg.volume ?? null)}</td>
          <td className={`${cell} text-intel-ink2`}>{formatCount(resolvedOpenInterest)}</td>
          <td className={`${cell} text-intel-ink2`}>{resolvedIv != null ? `${(resolvedIv * 100).toFixed(1)}` : '—'}</td>
          <td className={`${cell} text-intel-ink2`}>{resolvedDelta != null ? resolvedDelta.toFixed(2) : '—'}</td>
          <td className={`${cell} text-intel-ink2`}>{resolvedTheta != null ? resolvedTheta.toFixed(2) : '—'}</td>
          <td className={`${cell} text-intel-ink2`}>{pItm != null ? `${Math.round(pItm * 100)}%` : '—'}</td>
        </tr>
        {isSelected && (
          <tr>
            <td colSpan={MATRIX_HEADERS.length} className="border-l-2 border-l-intel-info bg-intel-info/5 px-3 py-3">
              <div className="mb-2.5 font-mono text-[10px] uppercase tracking-label text-intel-ink3">
                {ticker} {strike != null ? `$${strike.toFixed(2)}` : ''} {leg.type.toUpperCase()} ·{' '}
                {formatExpirationDate(leg.expiration)}
                {isHeld && <span className="ml-2 text-intel-accent">· In your book</span>}
              </div>
              <div className="grid grid-cols-4 gap-x-4 gap-y-2 md:grid-cols-8">
                <InfoTile
                  label="Bid"
                  value={liveBid != null ? `$${liveBid.toFixed(2)}` : '—'}
                  sub={liveQuote?.bidSize != null ? `×${liveQuote.bidSize}` : undefined}
                  tone="pos"
                />
                <InfoTile
                  label="Ask"
                  value={liveAsk != null ? `$${liveAsk.toFixed(2)}` : '—'}
                  sub={liveQuote?.askSize != null ? `×${liveQuote.askSize}` : undefined}
                  tone="neg"
                />
                <InfoTile label="Mark" value={liveMark != null ? `$${liveMark.toFixed(2)}` : '—'} />
                <InfoTile label="Last" value={liveLast != null ? `$${liveLast.toFixed(2)}` : '—'} />
                <InfoTile label="Vol" value={leg.volume != null ? leg.volume.toLocaleString() : '—'} />
                <InfoTile label="OI" value={resolvedOpenInterest != null ? resolvedOpenInterest.toLocaleString() : '—'} />
                <InfoTile label="IV" value={resolvedIv != null ? `${(resolvedIv * 100).toFixed(1)}%` : '—'} />
                <InfoTile label="B/E" value={breakeven != null ? `$${breakeven.toFixed(2)}` : '—'} />
              </div>
              <div className="mt-2 grid grid-cols-4 gap-x-4 gap-y-2 border-t border-intel-line pt-2.5 md:grid-cols-8">
                <InfoTile
                  label="Intrinsic"
                  value={formatCurrency(intrinsicValue(side, underlyingPrice, strike))}
                />
                <InfoTile
                  label="Extrinsic"
                  value={formatCurrency(extrinsicValue(side, underlyingPrice, strike, mark))}
                />
                <InfoTile
                  label="Spread"
                  value={spreadPct != null ? `${spreadPct.toFixed(1)}%` : '—'}
                  tone={spreadPct != null && spreadPct > 10 ? 'warn' : undefined}
                />
                <InfoTile label="Prob ITM" value={pItm != null ? `${(pItm * 100).toFixed(0)}%` : '—'} />
                <InfoTile
                  label="Prob OTM"
                  value={(() => {
                    const p = probOtm(side, underlyingPrice, strike, resolvedIv, dteValue);
                    return p != null ? `${(p * 100).toFixed(0)}%` : '—';
                  })()}
                />
                <InfoTile
                  label="Prob Touch"
                  value={(() => {
                    const p = probTouch(side, underlyingPrice, strike, resolvedIv, dteValue);
                    return p != null ? `${(p * 100).toFixed(0)}%` : '—';
                  })()}
                />
                <InfoTile label="DTE" value={dteValue != null ? String(dteValue) : '—'} />
                <InfoTile
                  label="1σ Move"
                  value={expectedMoveValue != null ? `±$${expectedMoveValue.toFixed(2)}` : '—'}
                />
              </div>
              <div className="mt-2 grid grid-cols-5 gap-x-4 gap-y-2 border-t border-intel-line pt-2.5">
                <InfoTile label="Δ Delta" value={resolvedDelta != null ? resolvedDelta.toFixed(3) : '—'} />
                <InfoTile label="Γ Gamma" value={resolvedGamma != null ? resolvedGamma.toFixed(3) : '—'} />
                <InfoTile label="Θ Theta" value={resolvedTheta != null ? resolvedTheta.toFixed(3) : '—'} />
                <InfoTile label="V Vega" value={resolvedVega != null ? resolvedVega.toFixed(3) : '—'} />
                <InfoTile label="ρ Rho" value={resolvedRho != null ? resolvedRho.toFixed(3) : '—'} />
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  return (
    <section className="flex h-[32rem] flex-col overflow-hidden rounded-panel border border-intel-line bg-intel-panel">
      {renderHeader()}
      <div className="relative flex-1 overflow-hidden">
        {error && rows.length > 0 && (
          <div className="border-b border-intel-line bg-intel-warn/10 px-3 py-1.5 font-mono text-[10px] text-intel-warn">
            {error}
          </div>
        )}
        {loading && !rows.length ? (
          <div className="flex h-full items-center justify-center font-mono text-[11px] text-intel-ink3">
            Loading options chain…
          </div>
        ) : error && !rows.length ? (
          <div className="flex h-full items-center justify-center font-mono text-[11px] text-intel-neg">{error}</div>
        ) : !rows.length ? (
          <div className="flex h-full items-center justify-center font-mono text-[11px] text-intel-ink3">
            {strikeFilter.trim()
              ? 'No strikes within 5% of that price.'
              : groups.length
              ? 'No contracts for this expiration'
              : 'No option contracts available.'}
          </div>
        ) : (
          <div className="flex h-full flex-col overflow-hidden">
            <div ref={scrollContainerRef} className="flex-1 overflow-auto">
              <table className="w-full min-w-[860px] border-collapse">
                <thead className="sticky top-0 z-10 bg-intel-panel">
                  <tr className="border-b border-intel-line font-mono text-[9px] uppercase tracking-label text-intel-ink3">
                    {MATRIX_HEADERS.map(column => (
                      <th
                        key={column.label}
                        className={`px-2 py-1.5 font-semibold ${column.align === 'right' ? 'text-right' : 'text-left'}`}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody ref={tableBodyRef} className="divide-y divide-intel-lineSoft/50">
                  {rows.map((row, index) => renderRow(row, index))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {loading && rows.length > 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-start justify-end p-2">
            <span className="rounded-sm border border-intel-line bg-intel-panel px-2 py-1 font-mono text-[10px] text-intel-cyan">
              Updating…
            </span>
          </div>
        )}
      </div>
    </section>
  );
});

function InfoTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'pos' | 'neg' | 'warn' }) {
  const valueColor =
    tone === 'pos' ? 'text-intel-pos' : tone === 'neg' ? 'text-intel-neg' : tone === 'warn' ? 'text-intel-warn' : 'text-intel-ink';
  return (
    <div>
      <p className="font-mono text-[8.5px] uppercase tracking-label text-intel-ink3">{label}</p>
      <p className={`mt-0.5 font-mono text-[12px] font-semibold tabular-nums ${valueColor}`}>
        {value}
        {sub && <span className="ml-1 text-[10px] font-normal text-intel-ink3">{sub}</span>}
      </p>
    </div>
  );
}

function formatCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—';
  return `$${value.toFixed(2)}`;
}

function formatPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatCount(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString();
}
