import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { OptionChainExpirationGroup, OptionLeg } from '../../types/market';
import { Calendar, ChevronDown, TrendingUp } from 'lucide-react';
import { computeExpirationDte, formatExpirationDate } from '../../utils/expirations';

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
  minWidth: string;
  align?: 'left' | 'right';
  className?: string;
  formatter?: (value: number | null) => string;
};

const CHAIN_COLUMNS: ChainColumn[] = [
  { key: 'strike', label: 'Strike', minWidth: '90px', align: 'left', formatter: value => formatCurrency(value) },
  { key: 'breakeven', label: 'Breakeven', minWidth: '120px', align: 'left', formatter: value => formatCurrency(value) },
  { key: 'toBreakeven', label: 'To Breakeven', minWidth: '120px', align: 'left', formatter: value => formatPercent(value) },
  { key: 'changePercent', label: '% Change', minWidth: '90px', align: 'right', className: 'font-semibold', formatter: value => formatPercent(value) },
  { key: 'changeValue', label: 'Change', minWidth: '100px', align: 'right', formatter: value => formatSignedCurrency(value) },
  { key: 'price', label: 'Price', minWidth: '90px', align: 'right', className: 'font-semibold', formatter: value => formatCurrency(value) },
  { key: 'volume', label: 'Volume', minWidth: '110px', align: 'right', formatter: value => formatCount(value) },
  { key: 'openInterest', label: 'Open Interest', minWidth: '120px', align: 'right', formatter: value => formatCount(value) }
];

export function OptionsChainPanel({
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
}: Props) {
  const [optionType, setOptionType] = useState<'calls' | 'puts'>('calls');
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const tableBodyRef = useRef<HTMLTableSectionElement | null>(null);

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
  const dteLabel = dteValue != null ? `${dteValue} DTE` : null;

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
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <p className="text-xs uppercase tracking-[0.4em] text-gray-500 flex items-center gap-2">
          Options Chain
          <span className="tracking-normal text-gray-300">{ticker}</span>
        </p>
        <div className="flex items-center gap-2 text-lg font-semibold">
          <span>
            {selectedExpiration
              ? formatExpirationDate(selectedExpiration)
              : activeGroup
              ? formatExpirationDate(activeGroup.expiration)
              : '—'}
          </span>
          {dteLabel && <span className="text-xs text-gray-500">{dteLabel}</span>}
        </div>
        {underlyingPrice != null && (
          <p className="text-xs text-emerald-400 flex items-center gap-1 mt-1">
            <TrendingUp className="h-3 w-3" />
            Underlying: ${underlyingPrice.toFixed(2)}
          </p>
        )}
      </div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full lg:w-auto">
        <div className="grid grid-cols-2 gap-2 text-[0.65rem] font-semibold w-full sm:w-auto">
          {(['calls', 'puts'] as const).map(type => (
            <button
              key={type}
              type="button"
              onClick={() => setOptionType(type)}
              className={`rounded-xl px-3 py-2 border transition-colors ${
                optionType === type
                  ? type === 'calls'
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-white'
                    : 'border-orange-500/60 bg-orange-500/15 text-white'
                  : 'border-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {type === 'calls' ? 'CALLS' : 'PUTS'}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-auto">
          <select
            className={`appearance-none bg-gray-950 border rounded-full pl-10 pr-9 py-2 text-sm w-full disabled:opacity-50 ${
              selectedExpiration ? 'border-emerald-500/60 text-emerald-100' : 'border-gray-900'
            }`}
            value={selectedExpiration ?? ''}
            onChange={event => onExpirationChange(event.target.value || null)}
            disabled={!expirationOptions.length}
          >
            <option value="">{expirationOptions.length ? 'All expirations' : 'No expirations'}</option>
            {expirationOptions.map(exp => (
              <option key={exp.value} value={exp.value}>
                {exp.label} {exp.dte != null ? `(${exp.dte} DTE)` : ''}
              </option>
            ))}
          </select>
          <Calendar
            className={`h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none ${
              selectedExpiration ? 'text-emerald-400' : 'text-gray-500'
            }`}
          />
          <ChevronDown
            className={`h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none ${
              selectedExpiration ? 'text-emerald-400' : 'text-gray-500'
            }`}
          />
        </div>
      </div>
    </div>
  );

  const renderRow = (row: typeof rows[number], index: number) => {
    const leg = optionType === 'calls' ? row.call : row.put;
    if (!leg) return null;
    const strike = row.strike ?? leg.strike;
    const price =
      leg.mark ?? leg.mid ?? leg.lastPrice ?? leg.bid ?? leg.ask ?? leg.lastTrade?.price ?? null;
    const changePercent = leg.changePercent ?? null;
    const changeValue =
      leg.change ??
      (changePercent != null && price != null ? (changePercent / 100) * price : null);
    const breakeven = leg.breakeven ?? null;
    const toBreakeven = leg.toBreakevenPercent ?? null;
    const isSelected = selectedContract?.ticker === leg.ticker;
    const prevStrike = index > 0 ? rows[index - 1].strike ?? rows[index - 1].call?.strike ?? rows[index - 1].put?.strike ?? null : null;
    const showUnderlyingLine =
      underlyingPrice != null &&
      strike != null &&
      ((prevStrike == null && underlyingPrice <= strike) ||
        (prevStrike != null && prevStrike < underlyingPrice && strike >= underlyingPrice));

    const alignedRow: ChainRow = {
      strike: strike ?? null,
      breakeven,
      toBreakeven,
      changePercent,
      changeValue,
      price,
      volume: leg.volume ?? null,
      openInterest: leg.openInterest ?? null
    };

    return (
      <Fragment key={`${leg.ticker}-${optionType}`}>
        {showUnderlyingLine && (
          <tr>
            <td colSpan={CHAIN_COLUMNS.length} className="py-2 text-center">
              <span className="px-4 py-1 rounded-full bg-emerald-600/20 text-emerald-300 text-xs">
                Share: {formatCurrency(underlyingPrice)}
              </span>
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
          className={`cursor-pointer transition-colors ${
            isSelected
              ? 'bg-emerald-500/10 border-l-4 border-emerald-500'
              : 'hover:bg-gray-900/30'
          }`}
          data-strike={strike ?? undefined}
        >
          {CHAIN_COLUMNS.map(column => {
            const rawValue = alignedRow[column.key];
            const formattedValue = column.formatter ? column.formatter(rawValue) : formatValue(rawValue);
            const changeColor =
              column.key === 'changePercent' || column.key === 'changeValue'
                ? changePercent != null
                  ? changePercent >= 0
                    ? 'text-emerald-400'
                    : 'text-red-400'
                  : 'text-gray-400'
                : '';
            return (
              <td
                key={column.key}
                className={`px-4 py-3 text-xs md:text-sm ${
                  column.align === 'right' ? 'text-right' : 'text-left'
                } ${column.className ?? ''} ${changeColor}`}
                style={{ minWidth: column.minWidth }}
              >
                {column.key === 'price' ? (
                  <span
                    className={`px-2 py-1 rounded-full border ${
                      changePercent != null && changePercent >= 0
                        ? 'border-emerald-500 text-emerald-300'
                        : changePercent != null
                        ? 'border-orange-500 text-orange-300'
                        : 'border-gray-700 text-gray-300'
                    }`}
                  >
                    {formattedValue}
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
            <td
              colSpan={CHAIN_COLUMNS.length}
              className="px-4 py-4 bg-emerald-500/5 border-t border-emerald-500/30"
            >
              <div className="text-xs text-gray-400 mb-3">
                {ticker} {strike != null ? `$${strike.toFixed(2)}` : ''} {leg.type.toUpperCase()} ·{' '}
                {formatExpirationDate(leg.expiration)}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
              <InfoTile label="Bid" value={leg.bid != null ? `$${leg.bid.toFixed(2)}` : '—'} />
              <InfoTile label="Ask" value={leg.ask != null ? `$${leg.ask.toFixed(2)}` : '—'} />
              <InfoTile label="Mark" value={leg.mark != null ? `$${leg.mark.toFixed(2)}` : '—'} />
              <InfoTile label="Last" value={leg.lastPrice != null ? `$${leg.lastPrice.toFixed(2)}` : '—'} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
              <InfoTile label="Volume" value={leg.volume != null ? leg.volume.toLocaleString() : '—'} />
              <InfoTile label="Open Interest" value={leg.openInterest != null ? leg.openInterest.toLocaleString() : '—'} />
              <InfoTile label="Implied Vol" value={leg.iv != null ? `${(leg.iv * 100).toFixed(1)}%` : '—'} />
              <InfoTile label="Breakeven" value={breakeven != null ? `$${breakeven.toFixed(2)}` : '—'} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <InfoTile label="Delta" value={leg.delta != null ? leg.delta.toFixed(3) : '—'} />
              <InfoTile label="Gamma" value={leg.gamma != null ? leg.gamma.toFixed(3) : '—'} />
              <InfoTile label="Theta" value={leg.theta != null ? leg.theta.toFixed(3) : '—'} />
              <InfoTile label="Vega" value={leg.vega != null ? leg.vega.toFixed(3) : '—'} />
              <InfoTile label="Rho" value={leg.rho != null ? leg.rho.toFixed(3) : '—'} />
            </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  return (
    <section className="bg-gray-950 border border-gray-900 rounded-2xl p-4 flex flex-col h-[32rem] overflow-hidden">
      {renderHeader()}
      <div className="mt-4 flex-1 rounded-2xl border border-gray-900 overflow-hidden">
        {loading ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-500">
            Loading options chain…
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-sm text-red-400">{error}</div>
        ) : !rows.length ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-500">
            {groups.length ? 'No contracts available for this expiration' : 'No option contracts available.'}
          </div>
        ) : (
          <div className="flex flex-col h-full overflow-hidden">
            <div ref={scrollContainerRef} className="flex-1 overflow-auto">
              <table className="w-full table-fixed border-collapse min-w-full">
                <thead className="bg-gray-950/70">
                  <tr className="text-[0.65rem] uppercase tracking-[0.2em] text-gray-500">
                    {CHAIN_COLUMNS.map(column => (
                      <th
                        key={column.key}
                        className={`px-4 py-2 ${column.align === 'right' ? 'text-right' : 'text-left'}`}
                        style={{ minWidth: column.minWidth }}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody ref={tableBodyRef}>{rows.map((row, index) => renderRow(row, index))}</tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-900 bg-gray-950 p-3">
      <p className="text-[0.65rem] uppercase tracking-widest text-gray-500">{label}</p>
      <p className="text-sm font-semibold text-gray-100 mt-1">{value}</p>
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

function formatSignedCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}
