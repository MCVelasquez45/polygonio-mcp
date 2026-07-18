import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react';
import type { OptionChainExpirationGroup, OptionContractDetail, OptionLeg } from '../../types/market';
import { computeExpirationDte, formatExpirationDate } from '../../utils/expirations';
import { useLiveQuotes, useLiveTrades } from '../../lib/liveMarketStore';

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

type ChainRow = {
  strike: number | null;
  breakeven: number | null;
  toBreakeven: number | null;
  changePercent: number | null;
  changeValue: number | null;
  price: number | null;
  volume: number | null;
  openInterest: number | null;
};

type ChainColumn = {
  key: keyof ChainRow;
  label: string;
  align?: 'left' | 'right';
  formatter?: (value: number | null) => string;
};

// Ladder columns — strike anchors the left, price sits right before size/flow.
const CHAIN_COLUMNS: ChainColumn[] = [
  { key: 'strike', label: 'Strike', align: 'left', formatter: value => formatCurrency(value) },
  { key: 'price', label: 'Mark', align: 'right', formatter: value => formatCurrency(value) },
  { key: 'changePercent', label: 'Chg%', align: 'right', formatter: value => formatPercent(value) },
  { key: 'breakeven', label: 'B/E', align: 'right', formatter: value => formatCurrency(value) },
  { key: 'toBreakeven', label: 'To B/E', align: 'right', formatter: value => formatPercent(value) },
  { key: 'volume', label: 'Vol', align: 'right', formatter: value => formatCount(value) },
  { key: 'openInterest', label: 'OI', align: 'right', formatter: value => formatCount(value) },
];

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
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const tableBodyRef = useRef<HTMLTableSectionElement | null>(null);

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
    return activeGroup.strikes.filter(row =>
      optionType === 'calls' ? Boolean(row.call) : Boolean(row.put)
    );
  }, [activeGroup, optionType]);

  const dteValue =
    activeGroup?.dte != null
      ? activeGroup.dte
      : selectedExpiration
      ? computeExpirationDte(selectedExpiration)
      : null;
  const dteLabel = dteValue != null ? `${dteValue}DTE` : null;

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
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-intel-ink3">Chain</span>
        <span className="font-mono text-[15px] font-semibold tracking-wide text-intel-ink">{ticker}</span>
        {underlyingPrice != null && (
          <span className="font-mono text-[11px] tabular-nums text-intel-info">@ {underlyingPrice.toFixed(2)}</span>
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
        {/* Expiration */}
        <div className="flex items-center gap-1.5">
          <select
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
    const price = liveMark ?? liveMid ?? liveLast ?? liveBid ?? liveAsk ?? null;
    const changePercent = leg.changePercent ?? null;
    const changeValue =
      leg.change ??
      (changePercent != null && price != null ? (changePercent / 100) * price : null);
    const breakeven = leg.breakeven ?? detailOverride?.breakEvenPrice ?? null;
    const toBreakeven = leg.toBreakevenPercent ?? null;
    const isSelected = selectedContract?.ticker === leg.ticker;
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

    const alignedRow: ChainRow = {
      strike: strike ?? null,
      breakeven,
      toBreakeven,
      changePercent,
      changeValue,
      price,
      volume: leg.volume ?? null,
      openInterest: resolvedOpenInterest ?? null
    };

    const changeUp = changePercent != null && changePercent >= 0;

    return (
      <Fragment key={`${leg.ticker}-${optionType}`}>
        {showUnderlyingLine && (
          <tr>
            <td colSpan={CHAIN_COLUMNS.length} className="p-0">
              <div className="flex items-center gap-2 bg-intel-info/10 px-3 py-0.5">
                <span className="h-px flex-1 bg-intel-info/40" />
                <span className="font-mono text-[9px] font-semibold uppercase tracking-label text-intel-info">
                  Spot {formatCurrency(underlyingPrice)}
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
              : itm
              ? 'border-l-transparent bg-intel-panel2/40 hover:bg-intel-panel2'
              : 'border-l-transparent hover:bg-intel-panel2/70'
          }`}
          data-strike={strike ?? undefined}
        >
          {CHAIN_COLUMNS.map(column => {
            const rawValue = alignedRow[column.key];
            const formattedValue = column.formatter ? column.formatter(rawValue) : formatValue(rawValue);
            const isChange = column.key === 'changePercent';
            const isStrike = column.key === 'strike';
            const isPrice = column.key === 'price';
            const changeColor = isChange
              ? changePercent != null
                ? changeUp
                  ? 'text-intel-pos'
                  : 'text-intel-neg'
                : 'text-intel-ink3'
              : '';
            return (
              <td
                key={column.key}
                className={`px-2.5 py-1 font-mono text-[11px] tabular-nums ${
                  column.align === 'right' ? 'text-right' : 'text-left'
                } ${isStrike ? 'font-semibold text-intel-ink' : isPrice ? 'font-semibold text-intel-ink' : 'text-intel-ink2'} ${changeColor}`}
              >
                {isStrike ? (
                  <span className="inline-flex items-center gap-1.5">
                    {isLive && <span className="h-1 w-1 shrink-0 rounded-full bg-intel-cyan" />}
                    {formattedValue}
                    {itm && (
                      <span className="rounded-sm bg-intel-raised px-1 text-[8px] font-semibold uppercase tracking-label text-intel-ink3">
                        ITM
                      </span>
                    )}
                  </span>
                ) : (
                  formattedValue
                )}
              </td>
            );
          })}
        </tr>
        {isSelected && (
          <tr>
            <td colSpan={CHAIN_COLUMNS.length} className="border-l-2 border-l-intel-info bg-intel-info/5 px-3 py-3">
              <div className="mb-2.5 font-mono text-[10px] uppercase tracking-label text-intel-ink3">
                {ticker} {strike != null ? `$${strike.toFixed(2)}` : ''} {leg.type.toUpperCase()} ·{' '}
                {formatExpirationDate(leg.expiration)}
              </div>
              <div className="grid grid-cols-4 gap-x-4 gap-y-2 md:grid-cols-8">
                <InfoTile label="Bid" value={liveBid != null ? `$${liveBid.toFixed(2)}` : '—'} tone="pos" />
                <InfoTile label="Ask" value={liveAsk != null ? `$${liveAsk.toFixed(2)}` : '—'} tone="neg" />
                <InfoTile label="Mark" value={liveMark != null ? `$${liveMark.toFixed(2)}` : '—'} />
                <InfoTile label="Last" value={liveLast != null ? `$${liveLast.toFixed(2)}` : '—'} />
                <InfoTile label="Vol" value={leg.volume != null ? leg.volume.toLocaleString() : '—'} />
                <InfoTile label="OI" value={resolvedOpenInterest != null ? resolvedOpenInterest.toLocaleString() : '—'} />
                <InfoTile label="IV" value={resolvedIv != null ? `${(resolvedIv * 100).toFixed(1)}%` : '—'} />
                <InfoTile label="B/E" value={breakeven != null ? `$${breakeven.toFixed(2)}` : '—'} />
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
            {groups.length ? 'No contracts for this expiration' : 'No option contracts available.'}
          </div>
        ) : (
          <div className="flex h-full flex-col overflow-hidden">
            <div ref={scrollContainerRef} className="flex-1 overflow-auto">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10 bg-intel-panel">
                  <tr className="border-b border-intel-line font-mono text-[9px] uppercase tracking-label text-intel-ink3">
                    {CHAIN_COLUMNS.map(column => (
                      <th
                        key={column.key}
                        className={`px-2.5 py-1.5 font-semibold ${column.align === 'right' ? 'text-right' : 'text-left'}`}
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

function InfoTile({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  const valueColor = tone === 'pos' ? 'text-intel-pos' : tone === 'neg' ? 'text-intel-neg' : 'text-intel-ink';
  return (
    <div>
      <p className="font-mono text-[8.5px] uppercase tracking-label text-intel-ink3">{label}</p>
      <p className={`mt-0.5 font-mono text-[12px] font-semibold tabular-nums ${valueColor}`}>{value}</p>
    </div>
  );
}

function formatValue(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  return String(value);
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
