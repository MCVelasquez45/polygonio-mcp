import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { listWatchlist, removeWatchlistItem, upsertWatchlistItem } from '../../api/watchlist';
import type { WatchlistSnapshot } from '../../types/market';
import { formatExpirationDate } from '../../utils/expirations';

type WatchlistEntry = {
  symbol: string;
  name: string;
  price: number;
  change: number;
};

const WATCHLIST_SNAPSHOT_TTL_MS = 60_000;
const WATCHLIST_SNAPSHOT_BATCH_SIZE = 25;
const WATCHLIST_PROVIDER_COOLDOWN_MS = 60_000;

type SnapshotBatchResult = {
  entries: WatchlistSnapshot[];
  error?: any;
};

// The server-side watchlist (/api/watchlist) is the SINGLE source of truth for
// the symbol universe — the same records drive research, the options browser,
// and automation. This sidebar hydrates from it and keeps NO hardcoded seed
// list and NO localStorage copy (either of which would resurrect removed
// symbols and diverge from the authoritative automation universe). Prices/names
// are filled in from live Massive snapshots once fetched; before then we show
// the bare symbol.
function hydrateWatchlistEntry(symbol: string, overrides?: Partial<WatchlistEntry>): WatchlistEntry {
  const upper = symbol.toUpperCase();
  const resolvedName = overrides?.name ?? upper;
  const resolvedPrice =
    typeof overrides?.price === 'number' && Number.isFinite(overrides.price)
      ? overrides.price
      : Number.NaN;
  const resolvedChange =
    typeof overrides?.change === 'number' && Number.isFinite(overrides.change)
      ? overrides.change
      : Number.NaN;
  return {
    symbol: upper,
    name: resolvedName,
    price: resolvedPrice,
    change: resolvedChange,
  };
}

// Placeholder desk alerts/intel panel content.
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
  onSelectTicker: (ticker: string, snapshot?: WatchlistSnapshot | null) => void;
  onSnapshotUpdate?: (ticker: string, snapshot: WatchlistSnapshot | null) => void;
  onWatchlistChange?: (symbols: string[]) => void;
  onRequestAutoSelect?: () => void;
  autoSelectDisabled?: boolean;
};

// memo: the sidebar runs its own 60s snapshot poll; the rest of the app's
// renders (chart bars, selections) should not re-render the watchlist.
export const TradingSidebar = memo(function TradingSidebar({
  selectedTicker,
  onSelectTicker,
  onSnapshotUpdate,
  onWatchlistChange,
  onRequestAutoSelect,
  autoSelectDisabled,
}: Props) {
  // Local UI mode (watchlist vs intel alerts).
  const [view, setView] = useState<'watchlist' | 'intel'>('watchlist');
  const [tickerInput, setTickerInput] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  // The watchlist is loaded from the server (single source of truth); it starts
  // empty and is populated by loadWatchlist() on mount and after every mutation.
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [snapshots, setSnapshots] = useState<Record<string, WatchlistSnapshot>>({});
  const [snapshotsStale, setSnapshotsStale] = useState(false);
  const snapshotCacheRef = useRef<Record<string, WatchlistSnapshot>>({});
  const lastSnapshotFetchAtRef = useRef(0);
  const snapshotInFlightRef = useRef<Promise<void> | null>(null);
  const providerCooldownUntilRef = useRef(0);

  const watchlistSymbols = useMemo(
    () => watchlist.map(entry => entry.symbol.toUpperCase()),
    [watchlist]
  );
  const watchlistSymbolsKey = watchlistSymbols.join(',');

  // Load the authoritative watchlist from the server (single source of truth).
  const loadWatchlist = useCallback(async () => {
    try {
      const items = await listWatchlist();
      setWatchlist(items.map(item => hydrateWatchlistEntry(item.symbol)));
      setWatchlistError(null);
    } catch {
      setWatchlistError('Failed to load watchlist');
    }
  }, []);

  useEffect(() => {
    void loadWatchlist();
  }, [loadWatchlist]);

  // Adds a new ticker to the SERVER watchlist (research-visible, automation
  // opt-in defaults to false server-side), then reloads from the server.
  const handleAddTicker = async (event?: React.FormEvent) => {
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
    try {
      await upsertWatchlistItem({ symbol: normalized });
      setTickerInput('');
      setFeedback(null);
      await loadWatchlist();
    } catch {
      setFeedback(`Failed to add ${normalized} to the watchlist.`);
    }
  };

  const handleRemoveTicker = async (symbol: string) => {
    const nextList = watchlist.filter(entry => entry.symbol !== symbol);
    try {
      await removeWatchlistItem(symbol);
    } catch {
      setFeedback(`Failed to remove ${symbol} from the watchlist.`);
      return;
    }
    setWatchlist(nextList);
    if (selectedTicker === symbol) {
      onSelectTicker(nextList[0]?.symbol ?? '');
    }
  };

  const refreshSnapshots = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (!watchlistSymbolsKey) return;
      if (typeof document !== 'undefined' && document.hidden && !force) return;

      const symbols = watchlistSymbolsKey.split(',').filter(Boolean);
      const now = Date.now();
      const cached = snapshotCacheRef.current;
      const hasCachedValues = Object.keys(cached).length > 0;
      const cacheCoversSymbols = symbols.every(symbol => Boolean(cached[symbol]));
      if (!force && hasCachedValues && cacheCoversSymbols && now - lastSnapshotFetchAtRef.current < WATCHLIST_SNAPSHOT_TTL_MS) {
        setSnapshots(cached);
        setSnapshotsStale(false);
        return;
      }

      if (now < providerCooldownUntilRef.current && !force) {
        if (hasCachedValues) {
          setSnapshots(cached);
          setSnapshotsStale(true);
          setWatchlistError('Using cached watchlist data while provider cooldown is active.');
        }
        return;
      }

      if (snapshotInFlightRef.current) {
        return snapshotInFlightRef.current;
      }

      const run = (async () => {
        setWatchlistError(null);
        setIsRefreshing(true);
        const batches: string[][] = [];
        for (let i = 0; i < symbols.length; i += WATCHLIST_SNAPSHOT_BATCH_SIZE) {
          batches.push(symbols.slice(i, i + WATCHLIST_SNAPSHOT_BATCH_SIZE));
        }

        const results = await Promise.all(
          batches.map<Promise<SnapshotBatchResult>>(batch =>
            marketApi.getWatchlistSnapshots(batch).catch(error => ({ entries: [], error }))
          )
        );
        const nextMap: Record<string, WatchlistSnapshot> = { ...snapshotCacheRef.current };
        let hadEntries = false;
        let hadErrors = false;
        let rateLimited = false;
        let retryAfterMs: number | null = null;

        results.forEach(result => {
          if (result.error) {
            hadErrors = true;
            if (result.error?.response?.status === 429) {
              rateLimited = true;
              const retryHeader = result.error?.response?.headers?.['retry-after'] ?? result.error?.response?.headers?.['Retry-After'];
              const retrySeconds = Number(retryHeader);
              const retryFromBody = Number(result.error?.response?.data?.retryAfterMs);
              if (Number.isFinite(retryFromBody) && retryFromBody > 0) {
                retryAfterMs = Math.max(retryAfterMs ?? 0, retryFromBody);
              } else if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
                retryAfterMs = Math.max(retryAfterMs ?? 0, retrySeconds * 1000);
              }
            }
          }
          const entries = Array.isArray(result.entries) ? result.entries : [];
          if (entries.length) hadEntries = true;
          entries.forEach(entry => {
            if (entry?.ticker) {
              nextMap[entry.ticker.toUpperCase()] = entry;
            }
          });
        });

        if (rateLimited) {
          const cooldownMs = retryAfterMs ?? WATCHLIST_PROVIDER_COOLDOWN_MS;
          providerCooldownUntilRef.current = Date.now() + cooldownMs;
        }

        if (!hadEntries) {
          const cachedValues = snapshotCacheRef.current;
          const hasCache = Object.keys(cachedValues).length > 0;
          if (hasCache) {
            setSnapshots(cachedValues);
            setSnapshotsStale(true);
            setWatchlistError(rateLimited ? 'Using cached watchlist data while provider cooldown is active.' : null);
          } else {
            setWatchlistError(hadErrors ? 'Failed to refresh watchlist' : null);
            setSnapshots({});
            setSnapshotsStale(false);
          }
          return;
        }

        snapshotCacheRef.current = nextMap;
        lastSnapshotFetchAtRef.current = Date.now();
        setSnapshots(nextMap);
        setSnapshotsStale(rateLimited);
        setWatchlist(prev =>
          prev.map(item => {
            const snapshot = nextMap[item.symbol.toUpperCase()];
            if (snapshot?.name && snapshot.name !== item.name) {
              return { ...item, name: snapshot.name };
            }
            return item;
          })
        );
      })()
        .catch(error => {
          const cachedValues = snapshotCacheRef.current;
          if (Object.keys(cachedValues).length) {
            setSnapshots(cachedValues);
            setSnapshotsStale(true);
            return;
          }
          const message = error?.response?.data?.error ?? error?.message ?? 'Failed to refresh watchlist';
          setWatchlistError(message);
          setSnapshots({});
          setSnapshotsStale(false);
        })
        .finally(() => {
          setIsRefreshing(false);
          snapshotInFlightRef.current = null;
        });

      snapshotInFlightRef.current = run;
      return run;
    },
    [watchlistSymbolsKey]
  );

  useEffect(() => {
    void refreshSnapshots({ force: refreshNonce > 0 });
  }, [watchlistSymbolsKey, refreshNonce, refreshSnapshots]);

  useEffect(() => {
    if (!watchlistSymbolsKey) return;
    const interval = setInterval(() => {
      void refreshSnapshots();
    }, WATCHLIST_SNAPSHOT_TTL_MS);
    const handleVisibilityChange = () => {
      if (typeof document === 'undefined' || document.hidden) return;
      void refreshSnapshots();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    return () => {
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [watchlistSymbolsKey, refreshSnapshots]);

  useEffect(() => {
    onWatchlistChange?.(watchlistSymbols);
  }, [watchlistSymbolsKey, watchlistSymbols, onWatchlistChange]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ symbol?: string }>).detail;
      const normalized = detail?.symbol?.trim().toUpperCase();
      if (!normalized) return;
      if (watchlistSymbols.includes(normalized)) {
        setFeedback(`${normalized} is already on the watchlist.`);
        return;
      }
      upsertWatchlistItem({ symbol: normalized })
        .then(() => {
          setFeedback(`${normalized} added to the watchlist.`);
          return loadWatchlist();
        })
        .catch(() => setFeedback(`Failed to add ${normalized} to the watchlist.`));
    };
    window.addEventListener('watchlist:add', handler as EventListener);
    return () => {
      window.removeEventListener('watchlist:add', handler as EventListener);
    };
  }, [watchlistSymbols, loadWatchlist]);

  useEffect(() => {
    if (!watchlist.length) return;
    if (!selectedTicker && watchlist[0]) {
      const firstSymbol = watchlist[0].symbol;
      const snapshot = snapshots[firstSymbol.toUpperCase()] ?? null;
      onSelectTicker(firstSymbol, snapshot);
    }
  }, [watchlist, selectedTicker, onSelectTicker, snapshots]);

  useEffect(() => {
    if (!selectedTicker || !onSnapshotUpdate) return;
    const snapshot = snapshots[selectedTicker.toUpperCase()] ?? null;
    onSnapshotUpdate(selectedTicker, snapshot ?? null);
  }, [snapshots, selectedTicker, onSnapshotUpdate]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-gray-950">
      <div className="px-3 py-3 border-b border-gray-900">
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
            <form onSubmit={handleAddTicker} className="rounded-2xl border border-gray-900 bg-gray-950/80 p-3 space-y-3">
              <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Add Ticker</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="w-full sm:flex-1 rounded-xl border border-gray-800 bg-gray-900 px-3 py-2 text-sm uppercase tracking-wide text-gray-100 focus:border-emerald-500 focus:outline-none"
                  placeholder="e.g. AMZN"
                  value={tickerInput}
                  onChange={event => setTickerInput(event.target.value.toUpperCase())}
                />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white w-full sm:w-auto"
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
              {snapshotsStale && <p className="text-[11px] uppercase tracking-wide text-amber-400">Stale</p>}
              {onRequestAutoSelect && (
                <button
                  type="button"
                  onClick={onRequestAutoSelect}
                  disabled={autoSelectDisabled}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-800 px-3 py-2 text-xs text-gray-300 hover:border-emerald-500/40 hover:text-white disabled:opacity-60"
                >
                  Auto-Select Contract
                </button>
              )}
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
              const formattedExpiration =
                snapshot && snapshot.entryType === 'contract' && snapshot.expiration
                  ? formatExpirationDate(snapshot.expiration)
                  : '';
              const secondaryLine =
                snapshot?.entryType === 'contract'
                  ? `${snapshot?.type?.toUpperCase() ?? ''} ${snapshot?.strike ?? ''}$ ${formattedExpiration}`
                  : `Last refresh ${new Date().toLocaleTimeString()}`;
              return (
                <div
                  key={snapshot?.ticker ?? stock.symbol}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectTicker(stock.symbol, snapshot ?? null)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectTicker(stock.symbol, snapshot ?? null);
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
    </div>
  );
});
