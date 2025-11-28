import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  ListCollapse,
  MessageSquare,
  Plus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { marketApi } from '../../api';
import type { WatchlistSnapshot } from '../../types/market';

type WatchlistEntry = {
  symbol: string;
  name: string;
  price: number;
  change: number;
};

const WATCHLIST_DATA: Record<string, Omit<WatchlistEntry, 'symbol'>> = {
  SPY: { name: 'S&P 500 ETF', price: 512.4, change: 0.36 },
  AAPL: { name: 'Apple', price: 227.1, change: -0.42 },
  TSLA: { name: 'Tesla', price: 194.3, change: 1.12 },
  NVDA: { name: 'NVIDIA', price: 131.8, change: 0.87 },
  MSFT: { name: 'Microsoft', price: 423.2, change: -0.25 },
  META: { name: 'Meta Platforms', price: 486.9, change: 0.52 },
  AMZN: { name: 'Amazon', price: 175.43, change: 1.66 },
  AMD: { name: 'Advanced Micro Devices', price: 118.67, change: -1.75 },
  GOOG: { name: 'Alphabet', price: 142.54, change: 0.61 },
  NFLX: { name: 'Netflix', price: 605.21, change: 0.97 },
};

const defaultWatchlist: WatchlistEntry[] = ['SPY', 'AAPL', 'TSLA', 'NVDA', 'MSFT', 'META'].map(symbol => ({
  symbol,
  ...WATCHLIST_DATA[symbol],
}));

const WATCHLIST_STORAGE_KEY = 'market-copilot.watchlist';

function hydrateWatchlistEntry(symbol: string, overrides?: Partial<WatchlistEntry>): WatchlistEntry {
  const upper = symbol.toUpperCase();
  const base = WATCHLIST_DATA[upper];
  const resolvedName = overrides?.name ?? base?.name ?? upper;
  const resolvedPrice =
    typeof overrides?.price === 'number' && Number.isFinite(overrides.price)
      ? overrides.price
      : base?.price ?? Number.NaN;
  const resolvedChange =
    typeof overrides?.change === 'number' && Number.isFinite(overrides.change)
      ? overrides.change
      : base?.change ?? Number.NaN;
  return {
    symbol: upper,
    name: resolvedName,
    price: resolvedPrice,
    change: resolvedChange,
  };
}

const alerts = [
  {
    id: 'cpi',
    title: 'CPI beats expectations',
    body: 'Headline CPI printed 3.2% vs 3.1% est. Rates bid, tech outperforming.',
    impact: 'High',
  },
  {
    id: 'nvda',
    title: 'NVDA call sweep',
    body: '8,000x Feb 500C purchased on offer. Watch semis for continuation.',
    impact: 'Medium',
  },
  {
    id: 'spy',
    title: 'Desk note',
    body: 'SPY gamma flip around 504. Expect chop between 504-512 until OPEX.',
    impact: 'Desk',
  },
];

type Props = {
  selectedTicker: string;
  onSelectTicker: (ticker: string) => void;
};

export function TradingSidebar({ selectedTicker, onSelectTicker }: Props) {
  const [view, setView] = useState<'watchlist' | 'intel'>('watchlist');
  const [tickerInput, setTickerInput] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length) {
            const hydrated = parsed
              .map(entry => (entry?.symbol ? hydrateWatchlistEntry(entry.symbol, entry) : null))
              .filter(Boolean);
            if (hydrated.length) {
              return hydrated as WatchlistEntry[];
            }
          }
        }
      } catch {
        // ignore corrupted cache
      }
    }
    return defaultWatchlist;
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [snapshots, setSnapshots] = useState<Record<string, WatchlistSnapshot>>({});

  const watchlistSymbols = useMemo(
    () => watchlist.map(entry => entry.symbol.toUpperCase()),
    [watchlist]
  );
  const watchlistSymbolsKey = watchlistSymbols.join(',');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(watchlist));
    } catch {
      // ignore persistence failures
    }
  }, [watchlist]);

  const handleAddTicker = (event?: React.FormEvent) => {
    event?.preventDefault();
    const normalized = tickerInput.trim().toUpperCase();
    if (!normalized) {
      setFeedback('Enter a ticker to add it to the watchlist.');
      return;
    }
    if (watchlist.some(entry => entry.symbol === normalized)) {
      setFeedback(`${normalized} is already on the watchlist.`);
      return;
    }
    const entry = hydrateWatchlistEntry(normalized);
    setWatchlist(prev => [...prev, entry]);
    setTickerInput('');
    setFeedback(null);
  };

  const handleRemoveTicker = (symbol: string) => {
    const nextList = watchlist.filter(entry => entry.symbol !== symbol);
    setWatchlist(nextList);
    if (selectedTicker === symbol) {
      const fallback = nextList[0]?.symbol ?? '';
      if (fallback) {
        onSelectTicker(fallback);
      } else {
        onSelectTicker('');
      }
    }
  };

  useEffect(() => {
    if (!watchlistSymbolsKey) return;
    let cancelled = false;
    setWatchlistError(null);
    setIsRefreshing(true);
    const symbols = watchlistSymbolsKey.split(',').filter(Boolean);
    marketApi.getWatchlistSnapshots(symbols)
      .then(payload => {
        if (cancelled) return;
        const snapshots = Array.isArray(payload?.entries) ? payload.entries : [];
        if (!snapshots.length) return;
        const nextMap: Record<string, WatchlistSnapshot> = {};
        snapshots.forEach(entry => {
          if (entry?.ticker) {
            nextMap[entry.ticker.toUpperCase()] = entry;
          }
        });
        setSnapshots(nextMap);
        setWatchlist(prev =>
          prev.map(item => {
            const snapshot = nextMap[item.symbol.toUpperCase()];
            if (snapshot?.name && snapshot.name !== item.name) {
              return { ...item, name: snapshot.name };
            }
            return item;
          })
        );
      })
      .catch(error => {
        if (cancelled) return;
        const message = error?.response?.data?.error ?? error?.message ?? 'Failed to refresh watchlist';
        setWatchlistError(message);
      })
      .finally(() => {
        if (!cancelled) {
          setIsRefreshing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [watchlistSymbolsKey, refreshNonce]);

  useEffect(() => {
    if (!watchlistSymbolsKey) return;
    const interval = setInterval(() => {
      setRefreshNonce(prev => prev + 1);
    }, 60_000);
    return () => {
      clearInterval(interval);
    };
  }, [watchlistSymbolsKey]);

  useEffect(() => {
    if (!watchlist.length) return;
    if (!selectedTicker && watchlist[0]) {
      onSelectTicker(watchlist[0].symbol);
    }
  }, [watchlist, selectedTicker, onSelectTicker]);

  return (
    <aside className="w-72 max-w-[18rem] bg-gray-950 border-r border-gray-900 flex flex-col h-full">
      <div className="p-3 border-b border-gray-900">
        <div className="grid grid-cols-2 gap-2 text-xs font-semibold">
          <button
            type="button"
            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 border ${
              view === 'watchlist'
                ? 'bg-gray-900 border-emerald-500/60 text-white'
                : 'border-gray-800 text-gray-400'
            }`}
            onClick={() => setView('watchlist')}
          >
            <ListCollapse className="h-4 w-4" /> Watchlist
          </button>
          <button
            type="button"
            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 border ${
              view === 'intel'
                ? 'bg-gray-900 border-emerald-500/60 text-white'
                : 'border-gray-800 text-gray-400'
            }`}
            onClick={() => setView('intel')}
          >
            <Bell className="h-4 w-4" /> Intel
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
        {view === 'watchlist' ? (
          <>
            <form onSubmit={handleAddTicker} className="rounded-2xl border border-gray-900 bg-gray-950 p-3 space-y-2">
              <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Add Ticker</p>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-xl border border-gray-800 bg-gray-900 px-3 py-2 text-sm uppercase tracking-wide text-gray-100 focus:border-emerald-500 focus:outline-none"
                  placeholder="e.g. AMZN"
                  value={tickerInput}
                  onChange={event => setTickerInput(event.target.value.toUpperCase())}
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"
                >
                  <Plus className="h-4 w-4" /> Add
                </button>
              </div>
              <div className="flex items-center justify-between text-[11px] text-gray-500 gap-2">
                <span>Add equities or option contracts (prefix with O:). Live data refreshes automatically.</span>
                <button
                  type="button"
                  onClick={() => setRefreshNonce(prev => prev + 1)}
                  disabled={isRefreshing}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 ${
                    isRefreshing ? 'border-gray-800 text-gray-500' : 'border-gray-800 text-gray-300 hover:text-white'
                  }`}
                >
                  <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                  <span className="text-[10px] uppercase tracking-wide">
                    {isRefreshing ? 'Refreshing' : 'Refresh'}
                  </span>
                </button>
              </div>
              {feedback && <p className="text-xs text-amber-400">{feedback}</p>}
              {watchlistError && <p className="text-xs text-red-400">{watchlistError}</p>}
            </form>
            {watchlist.map(stock => {
              const snapshot = snapshots[stock.symbol.toUpperCase()];
              const normalizedSelected = selectedTicker ? selectedTicker.toUpperCase() : '';
              const normalizedSymbol = stock.symbol.toUpperCase();
              const normalizedSnapshotTicker =
                snapshot && typeof snapshot.ticker === 'string' ? snapshot.ticker.toUpperCase() : null;
              let referenceContract: string | null = null;
              if (snapshot && snapshot.entryType === 'underlying' && typeof snapshot.referenceContract === 'string') {
                referenceContract = snapshot.referenceContract.toUpperCase();
              } else if (snapshot && snapshot.entryType === 'contract') {
                const contractTicker = snapshot.contract ?? snapshot.ticker;
                if (contractTicker) referenceContract = contractTicker.toUpperCase();
              }
              const priceSource =
                snapshot && snapshot.entryType === 'contract'
                  ? snapshot.mid ?? snapshot.price ?? snapshot.bid ?? snapshot.ask ?? null
                  : snapshot?.price ?? null;
              const changeValue =
                snapshot?.changePercent ??
                snapshot?.change ??
                null;
              const hasPrice = typeof priceSource === 'number' && Number.isFinite(priceSource);
              const hasChange = typeof changeValue === 'number' && Number.isFinite(changeValue);
              const positive = hasChange ? changeValue! >= 0 : null;
              const active =
                normalizedSymbol === normalizedSelected ||
                (normalizedSnapshotTicker ? normalizedSnapshotTicker === normalizedSelected : false) ||
                (referenceContract ? referenceContract === normalizedSelected : false);
              const priceDisplay = hasPrice ? `$${Number(priceSource).toFixed(2)}` : '—';
              const secondaryLine =
                snapshot?.entryType === 'contract'
                  ? `${snapshot?.type?.toUpperCase() ?? ''} ${snapshot?.strike ?? ''}$ ${
                      snapshot?.expiration ? new Date(snapshot.expiration).toLocaleDateString() : ''
                    }`
                  : `Last refresh ${new Date().toLocaleTimeString()}`;
              return (
                <div
                  key={snapshot?.ticker ?? stock.symbol}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectTicker(stock.symbol)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectTicker(stock.symbol);
                    }
                  }}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                    active ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-gray-900 bg-gray-950 hover:border-gray-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold tracking-wide truncate">
                          {snapshot?.ticker ?? stock.symbol}
                        </p>
                        <button
                          type="button"
                          className="rounded-full border border-transparent p-1 text-gray-500 hover:text-red-400 hover:border-red-500/30 transition-colors"
                          onClick={event => {
                            event.stopPropagation();
                            handleRemoveTicker(stock.symbol);
                          }}
                          aria-label={`Remove ${stock.symbol} from watchlist`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 truncate">{secondaryLine}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-semibold">{priceDisplay}</p>
                      <p
                        className={`text-xs flex items-center justify-end gap-1 ${
                          positive == null ? 'text-gray-400' : positive ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {positive == null ? (
                          <TrendingUp className="h-3 w-3 opacity-0" />
                        ) : positive ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3" />
                        )}
                        {hasChange ? `${positive ? '+' : ''}${Number(changeValue).toFixed(2)}%` : '—'}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert, idx) => (
              <Fragment key={alert.id}>
                <div className="rounded-2xl border border-gray-900 bg-gray-950 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-gray-100">{alert.title}</p>
                    <span className="text-xs text-emerald-400 uppercase tracking-wide">{alert.impact}</span>
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed">{alert.body}</p>
                </div>
                {idx === 0 && (
                  <div className="rounded-2xl border border-blue-500/40 bg-blue-500/10 p-4 flex gap-3">
                    <MessageSquare className="h-5 w-5 text-blue-300" />
                    <div>
                      <p className="text-xs text-blue-200">Ask AI desk</p>
                      <p className="text-sm text-blue-100">"What does this mean for {selectedTicker}?"</p>
                    </div>
                  </div>
                )}
              </Fragment>
            ))}
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 flex gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              <div>
                <p className="text-xs uppercase tracking-wider text-amber-300">Desk Risk</p>
                <p className="text-sm text-amber-100">Vol uptick expected around macro catalysts this week.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
