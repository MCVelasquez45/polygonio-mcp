import { useEffect, useMemo, useState } from 'react';
import type { OptionChainExpirationGroup, OptionLeg } from '../../types/market';
import { Calendar, ChevronDown, TrendingUp } from 'lucide-react';

type Props = {
  ticker: string;
  groups: OptionChainExpirationGroup[];
  underlyingPrice: number | null;
  loading: boolean;
  error?: string | null;
  selectedContract?: OptionLeg | null;
  onContractSelect: (leg: OptionLeg | null) => void;
};

export function OptionsChainPanel({
  ticker,
  groups,
  underlyingPrice,
  loading,
  error,
  selectedContract,
  onContractSelect,
}: Props) {
  const [optionType, setOptionType] = useState<'calls' | 'puts'>('calls');
  const [selectedExpiration, setSelectedExpiration] = useState<string | null>(null);

  useEffect(() => {
    if (!groups.length) {
      setSelectedExpiration(null);
      return;
    }
    const hasSelected = groups.some(group => group.expiration === selectedExpiration);
    if (!hasSelected) {
      setSelectedExpiration(groups[0].expiration);
    }
  }, [groups, selectedExpiration]);

  const expirationOptions = useMemo(
    () =>
      groups.map(group => ({
        value: group.expiration,
        label: new Date(group.expiration).toLocaleDateString(),
        dte: group.dte ?? undefined,
      })),
    [groups]
  );

  const activeGroup = useMemo(() => {
    if (!groups.length) return null;
    return groups.find(group => group.expiration === selectedExpiration) ?? groups[0];
  }, [groups, selectedExpiration]);

  const rows = useMemo(() => {
    if (!activeGroup) return [];
    return activeGroup.strikes.filter(row =>
      optionType === 'calls' ? Boolean(row.call) : Boolean(row.put)
    );
  }, [activeGroup, optionType]);

  const dteLabel = activeGroup?.dte != null ? `${activeGroup.dte} DTE` : null;

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
        <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Options Chain</p>
        <div className="flex items-center gap-2 text-lg font-semibold">
          <span>{activeGroup ? new Date(activeGroup.expiration).toLocaleDateString() : '—'}</span>
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
        <div className="rounded-full border border-gray-800 p-1 flex">
          {(['calls', 'puts'] as const).map(type => (
            <button
              key={type}
              type="button"
              onClick={() => setOptionType(type)}
              className={`px-3 py-1 text-xs rounded-full ${
                optionType === type ? 'bg-emerald-500/20 text-white' : 'text-gray-400'
              }`}
            >
              {type.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-auto">
          <select
            className="appearance-none bg-gray-950 border border-gray-900 rounded-full pl-4 pr-9 py-2 text-sm w-full"
            value={activeGroup?.expiration ?? ''}
            onChange={event => setSelectedExpiration(event.target.value)}
          >
            {expirationOptions.map(exp => (
              <option key={exp.value} value={exp.value}>
                {exp.label} {exp.dte != null ? `(${exp.dte} DTE)` : ''}
              </option>
            ))}
          </select>
          <Calendar className="h-4 w-4 text-gray-500 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          <ChevronDown className="h-4 w-4 text-gray-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>
    </div>
  );

  const renderColumns = () => (
    <div className="px-4 py-2 border-b border-gray-900 bg-gray-950/60">
      <div className="grid grid-cols-5 md:grid-cols-8 gap-2 text-[0.65rem] uppercase tracking-widest text-gray-500 min-w-[640px]">
        <span>Strike</span>
        <span className="hidden md:block">Breakeven</span>
        <span className="hidden md:block">To breakeven</span>
        <span>% Change</span>
        <span className="hidden md:block">Change</span>
        <span>Price</span>
        <span className="hidden md:block">Volume</span>
        <span className="hidden md:block">Open Interest</span>
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

    return (
      <div key={`${leg.ticker}-${optionType}`} className="border-b border-gray-900/60">
        {showUnderlyingLine && (
          <div className="flex justify-center py-2">
            <div className="px-4 py-1 rounded-full bg-emerald-600/20 text-emerald-300 text-xs">
              Share: ${underlyingPrice?.toFixed(2)}
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => handleSelect(leg)}
          className={`w-full px-4 py-3 text-left transition-colors ${
            isSelected ? 'bg-gray-900/80' : 'hover:bg-gray-900/40'
          }`}
        >
          <div className="grid grid-cols-5 md:grid-cols-8 gap-2 items-center min-w-[640px]">
            <div className="text-gray-100 text-xs md:text-sm">${strike?.toFixed(2) ?? '—'}</div>
            <div className="hidden md:block text-gray-300 text-xs md:text-sm">
              {breakeven != null ? `$${breakeven.toFixed(2)}` : '—'}
            </div>
            <div className="hidden md:block text-gray-400 text-xs md:text-sm">
              {toBreakeven != null ? `${toBreakeven.toFixed(2)}%` : '—'}
            </div>
            <div
              className={`text-xs md:text-sm ${
                changePercent != null && changePercent >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {changePercent != null ? `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%` : '—'}
            </div>
            <div
              className={`hidden md:block text-xs md:text-sm ${
                changeValue != null && changeValue >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {changeValue != null ? `${changeValue >= 0 ? '+' : ''}$${changeValue.toFixed(2)}` : '—'}
            </div>
            <div className="text-right">
              <span
                className={`px-2 py-1 rounded-full border text-xs md:text-sm ${
                  changePercent != null && changePercent >= 0
                    ? 'border-emerald-500 text-emerald-300'
                    : 'border-orange-500 text-orange-300'
                }`}
              >
                {price != null ? `$${price.toFixed(2)}` : '—'}
              </span>
            </div>
            <div className="hidden md:block text-right text-xs md:text-sm text-gray-300">
              {leg.volume != null ? leg.volume.toLocaleString() : '—'}
            </div>
            <div className="hidden md:block text-right text-xs md:text-sm text-gray-300">
              {leg.openInterest != null ? leg.openInterest.toLocaleString() : '—'}
            </div>
          </div>
        </button>
        {isSelected && (
          <div className="px-4 py-4 bg-gray-900/50 border-t border-gray-900">
            <div className="text-xs text-gray-400 mb-3">
              {ticker} {strike != null ? `$${strike.toFixed(2)}` : ''} {leg.type.toUpperCase()} ·{' '}
              {new Date(leg.expiration).toLocaleDateString()}
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
          </div>
        )}
      </div>
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
            {renderColumns()}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-900/60">
              {rows.map((row, index) => renderRow(row, index))}
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
