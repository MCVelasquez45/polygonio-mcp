import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  ListCollapse,
  MessageSquare,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { marketApi } from '../../api';
import { listWatchlist, removeWatchlistItem, upsertWatchlistItem } from '../../api/watchlist';
import type { WatchlistSnapshot } from '../../types/market';
import { formatExpirationDate } from '../../utils/expirations';
import { deriveMarketDataStatus } from '../../lib/marketDataStatus';
import { useNow } from '../../hooks/useNow';
import { Sparkline } from '../intelligence/ui/charts/MicroCharts';

type WatchlistEntry = {
  symbol: string;
  name: string;
  price: number;
  change: number;
};

// Equities have no stream entitlement on this plan, so the watchlist is REST
// snapshots. 30s matches the server-side snapshot cache TTL — polling faster
// just re-serves the same cached value. Each card shows an honest SNAPSHOT/STALE
// badge with quote age; it is NEVER labelled LIVE.
const WATCHLIST_SNAPSHOT_TTL_MS = 30_000;
// A snapshot older than this (poll failing / rate-limited) reads as STALE.
const WATCHLIST_STALE_MS = 90_000;
const WATCHLIST_SNAPSHOT_BATCH_SIZE = 25;
const WATCHLIST_PROVIDER_COOLDOWN_MS = 60_000;
// Daily closes for the per-row sparkline. 30 sessions, refreshed rarely — the
// shape of a month barely moves intraday and the provider budget is precious.
const SPARKLINE_WINDOW = 30;
const SPARKLINE_TTL_MS = 10 * 60_000;

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
  // Drives the per-card quote-age label; reading the fetch-time ref each tick.
  const now = useNow(1000);
  const providerCooldownUntilRef = useRef(0);
  // 30-session close series per symbol for the row sparklines.
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});
  const sparklineCacheRef = useRef<Map<string, { values: number[]; fetchedAt: number }>>(new Map());

  // Sort mode for the scanner. Default to biggest movers first — the way a
  // desk actually scans a universe. Click a column header to cycle.
  const [sortKey, setSortKey] = useState<'change' | 'symbol' | 'last'>('change');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const watchlistSymbols = useMemo(
    () => watchlist.map(entry => entry.symbol.toUpperCase()),
    [watchlist]
  );
  const watchlistSymbolsKey = watchlistSymbols.join(',');

  // Derive a flat, sortable scanner row per watchlist entry, folding in the
  // latest snapshot. Kept as a memo so sorting/heat scaling is cheap on every
  // 1s clock tick without re-touching the fetch machinery.
  const scannerRows = useMemo(() => {
    const rows = watchlist.map(stock => {
      const snapshot = snapshots[stock.symbol.toUpperCase()] ?? null;
      const isContract = snapshot?.entryType === 'contract';
      const priceSource = isContract
        ? snapshot.mid ?? snapshot.price ?? snapshot.bid ?? snapshot.ask ?? null
        : snapshot?.price ?? null;
      const changeValue = snapshot?.changePercent ?? snapshot?.change ?? null;
      const price = typeof priceSource === 'number' && Number.isFinite(priceSource) ? priceSource : null;
      const change = typeof changeValue === 'number' && Number.isFinite(changeValue) ? changeValue : null;
      const volume = typeof snapshot?.volume === 'number' && Number.isFinite(snapshot.volume) ? snapshot.volume : null;
      return { stock, snapshot, isContract, price, change, volume };
    });
    const maxVol = rows.reduce((m, r) => (r.volume && r.volume > m ? r.volume : m), 0);
    const maxAbsChg = rows.reduce((m, r) => (r.change != null && Math.abs(r.change) > m ? Math.abs(r.change) : m), 0);
    const dir = sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      if (sortKey === 'symbol') return a.stock.symbol.localeCompare(b.stock.symbol) * dir;
      if (sortKey === 'last') return ((a.price ?? -Infinity) - (b.price ?? -Infinity)) * dir;
      return ((a.change ?? -Infinity) - (b.change ?? -Infinity)) * dir;
    });
    return { rows, maxVol, maxAbsChg };
  }, [watchlist, snapshots, sortKey, sortDir]);

  const cycleSort = useCallback((key: 'change' | 'symbol' | 'last') => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir(key === 'symbol' ? 'asc' : 'desc');
      return key;
    });
  }, []);

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

  // Sparkline sweep: sequential (never a burst), cache-first, and it stops
  // for the session's sweep the moment the provider throttles. It does not
  // start until the snapshot batch has landed at least once — Last/Chg% own
  // the provider budget; trend lines are the least urgent data on the row.
  const snapshotsReady = Object.keys(snapshots).length > 0;
  useEffect(() => {
    if (!snapshotsReady) return;
    const symbols = watchlistSymbolsKey
      .split(',')
      .filter(Boolean)
      .filter(symbol => !symbol.startsWith('O:'));
    if (!symbols.length) {
      setSparklines({});
      return;
    }
    let cancelled = false;
    (async () => {
      for (const symbol of symbols) {
        if (cancelled) return;
        await new Promise(resolve => setTimeout(resolve, 400));
        if (cancelled) return;
        const cached = sparklineCacheRef.current.get(symbol);
        if (cached && Date.now() - cached.fetchedAt < SPARKLINE_TTL_MS) {
          setSparklines(prev => (prev[symbol] ? prev : { ...prev, [symbol]: cached.values }));
          continue;
        }
        try {
          const response = await marketApi.getAggregates({
            ticker: symbol,
            multiplier: 1,
            timespan: 'day',
            window: SPARKLINE_WINDOW,
          });
          const closes = (response.results ?? [])
            .map(bar => bar?.c)
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
          if (closes.length >= 2 && !cancelled) {
            sparklineCacheRef.current.set(symbol, { values: closes, fetchedAt: Date.now() });
            // Paint each row as its series lands — no barrier on the sweep.
            setSparklines(prev => ({ ...prev, [symbol]: closes }));
          }
        } catch (error: unknown) {
          if ((error as { response?: { status?: number } })?.response?.status === 429) break;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [watchlistSymbolsKey, snapshotsReady]);

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
    <div className="flex flex-col h-full w-full overflow-hidden bg-intel-bg">
      <div className="px-2 py-2 border-b border-intel-line">
        <div className="grid grid-cols-2 gap-1 text-[11px] font-semibold">
          <button
            type="button"
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent ${
              view === 'watchlist'
                ? 'bg-intel-accentSoft border-intel-accentLine text-intel-accent'
                : 'border-transparent text-intel-ink2 hover:bg-intel-panel2'
            }`}
            onClick={() => setView('watchlist')}
          >
            <ListCollapse className="h-3.5 w-3.5" /> Watchlist
          </button>
          <button
            type="button"
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent ${
              view === 'intel'
                ? 'bg-intel-accentSoft border-intel-accentLine text-intel-accent'
                : 'border-transparent text-intel-ink2 hover:bg-intel-panel2'
            }`}
            onClick={() => setView('intel')}
          >
            <Bell className="h-3.5 w-3.5" /> Intel
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
        {view === 'watchlist' ? (
          <>
            <form onSubmit={handleAddTicker} className="rounded-panel bg-intel-panel p-2 space-y-2">
              <div className="flex items-center gap-1.5">
                <input
                  className="min-w-0 flex-1 rounded-md border border-intel-line bg-intel-panel2 px-2 py-1.5 text-xs font-mono uppercase tracking-wide text-intel-ink placeholder:text-intel-ink3 focus:border-intel-accentLine focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent"
                  placeholder="Add ticker (e.g. AMZN)"
                  value={tickerInput}
                  onChange={event => setTickerInput(event.target.value.toUpperCase())}
                />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-1 rounded-md bg-intel-accent px-2.5 py-1.5 text-xs font-semibold text-intel-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent"
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
                <button
                  type="button"
                  onClick={() => setRefreshNonce(prev => prev + 1)}
                  disabled={isRefreshing}
                  title="Refresh snapshots"
                  className={`inline-flex items-center justify-center rounded-md border border-intel-line p-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent ${
                    isRefreshing ? 'text-intel-ink3' : 'text-intel-ink2 hover:bg-intel-panel2 hover:text-intel-ink'
                  }`}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                </button>
              </div>
              {onRequestAutoSelect && (
                <button
                  type="button"
                  onClick={onRequestAutoSelect}
                  disabled={autoSelectDisabled}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-intel-line px-2 py-1.5 text-[11px] text-intel-ink2 transition-colors hover:bg-intel-panel2 hover:text-intel-ink disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent"
                >
                  Auto-Select Contract
                </button>
              )}
              {feedback && <p className="text-[11px] text-intel-warn">{feedback}</p>}
              {watchlistError && <p className="text-[11px] text-intel-neg">{watchlistError}</p>}
            </form>

            {/* Column header — sortable, sticky feel. This is a data grid, not a
                list of cards. Click a heading to sort; the active heading shows
                the direction caret. */}
            <div className="grid grid-cols-[minmax(0,1fr)_36px_54px_56px] items-center gap-1.5 border-b border-intel-line px-2 pb-1 text-[9px] font-semibold uppercase tracking-label text-intel-ink3">
              {([
                ['symbol', 'Symbol', 'justify-start'],
                ['spark', '30D', 'justify-start'],
                ['last', 'Last', 'justify-end'],
                ['change', 'Chg%', 'justify-end'],
              ] as const).map(([key, label, justify]) => {
                if (key === 'spark') {
                  return (
                    <span key={key} className={`flex items-center ${justify} text-intel-ink3`} title="30-session close trend">
                      {label}
                    </span>
                  );
                }
                const activeCol = sortKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => cycleSort(key)}
                    className={`flex items-center gap-0.5 ${justify} transition-colors hover:text-intel-ink2 focus-visible:outline focus-visible:outline-1 focus-visible:outline-intel-accent ${
                      activeCol ? 'text-intel-accent' : ''
                    }`}
                  >
                    {label}
                    {activeCol && <span className="text-[8px] leading-none">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                  </button>
                );
              })}
            </div>

            {/* Scanner rows — single-line, tabular, borderless. Each row carries a
                relative-volume activity bar tinted by direction, so the eye reads
                movers and activity before any number. */}
            <div className="divide-y divide-intel-lineSoft/60">
              {scannerRows.rows.map(({ stock, snapshot, isContract, price, change, volume }) => {
                const snapshotAgeMs = lastSnapshotFetchAtRef.current ? now - lastSnapshotFetchAtRef.current : null;
                const { status: cardStatus } = deriveMarketDataStatus({
                  source: snapshot ? 'rest' : null,
                  ageMs: snapshotAgeMs,
                  staleThresholdMs: WATCHLIST_STALE_MS,
                });
                // Bare freshness dot — the age text is redundant per-row (the
                // whole list shares one fetch); a colored dot is enough.
                const dotClass =
                  cardStatus === 'LIVE' ? 'bg-intel-pos'
                  : cardStatus === 'SNAPSHOT' ? 'bg-intel-accent'
                  : cardStatus === 'DELAYED' || cardStatus === 'STALE' ? 'bg-intel-warn'
                  : cardStatus === 'DISCONNECTED' ? 'bg-intel-neg'
                  : 'bg-intel-ink3/60';
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
                const positive = change == null ? null : change >= 0;
                const active =
                  normalizedSymbol === normalizedSelected ||
                  (normalizedSnapshotTicker ? normalizedSnapshotTicker === normalizedSelected : false) ||
                  (referenceContract ? referenceContract === normalizedSelected : false);
                const priceDisplay = price != null ? price.toFixed(2) : '—';
                const formattedExpiration =
                  isContract && snapshot?.entryType === 'contract' && snapshot.expiration
                    ? formatExpirationDate(snapshot.expiration)
                    : '';
                const secondaryLine =
                  isContract && snapshot?.entryType === 'contract'
                    ? `${snapshot?.type?.toUpperCase() ?? ''} ${snapshot?.strike ?? ''} ${formattedExpiration}`.trim()
                    : '';
                // Relative-volume fill (0–1) drives the activity bar width.
                const relVol = volume && scannerRows.maxVol > 0 ? Math.max(0.06, volume / scannerRows.maxVol) : 0;
                // Change magnitude fill (0–1) drives the heat intensity of the chip.
                const heat = change != null && scannerRows.maxAbsChg > 0 ? Math.min(1, Math.abs(change) / scannerRows.maxAbsChg) : 0;
                const chipColor = positive == null ? 'transparent' : positive ? '53,210,154' : '248,113,113';
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
                    className={`group relative cursor-pointer px-2 py-1 text-left transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-intel-accent ${
                      active ? 'bg-intel-info/10' : 'hover:bg-intel-panel2/70'
                    }`}
                  >
                    {/* Selection edge — a hard left rule when this row drives the workspace. */}
                    {active && <span className="absolute inset-y-0 left-0 w-[2px] bg-intel-info" />}
                    <div className="grid grid-cols-[minmax(0,1fr)_36px_54px_56px] items-center gap-1.5">
                      {/* Symbol cell: freshness dot + ticker, remove on hover */}
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass} ${cardStatus === 'LIVE' ? 'motion-safe:animate-livering' : ''}`}
                          title={cardStatus ?? 'No data'}
                          aria-hidden="true"
                        />
                        <span className="truncate font-mono text-[13px] font-semibold leading-none tracking-wide text-intel-ink">
                          {snapshot?.ticker ?? stock.symbol}
                        </span>
                        {isContract && (
                          <span className="shrink-0 rounded-sm bg-intel-raised px-1 text-[8px] font-semibold uppercase tracking-label text-intel-ink3">
                            OPT
                          </span>
                        )}
                        <button
                          type="button"
                          className="ml-auto shrink-0 rounded p-0.5 text-intel-ink3 opacity-0 transition-opacity hover:text-intel-neg group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-intel-accent"
                          onClick={event => {
                            event.stopPropagation();
                            handleRemoveTicker(stock.symbol);
                          }}
                          aria-label={`Remove ${stock.symbol} from watchlist`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      {/* 30-session trend */}
                      <span className="flex items-center" aria-hidden="true">
                        {sparklines[stock.symbol.toUpperCase()] ? (
                          <Sparkline values={sparklines[stock.symbol.toUpperCase()]} width={36} height={14} />
                        ) : (
                          <span className="h-[14px]" />
                        )}
                      </span>
                      {/* Last */}
                      <span className="text-right font-mono tabular-nums text-[13px] leading-none text-intel-ink">
                        {priceDisplay}
                      </span>
                      {/* Change chip — heat-tinted background scaled to relative magnitude */}
                      <span
                        className={`rounded-sm px-1 py-0.5 text-right font-mono tabular-nums text-[11px] font-semibold leading-none ${
                          positive == null ? 'text-intel-ink3' : positive ? 'text-intel-pos' : 'text-intel-neg'
                        }`}
                        style={
                          positive == null
                            ? undefined
                            : { backgroundColor: `rgba(${chipColor},${(0.08 + heat * 0.22).toFixed(3)})` }
                        }
                      >
                        {change != null ? `${positive ? '+' : ''}${change.toFixed(2)}%` : '—'}
                      </span>
                    </div>
                    {secondaryLine && (
                      <p className="mt-0.5 truncate pl-[18px] font-mono text-[10px] leading-none text-intel-ink3">{secondaryLine}</p>
                    )}
                    {/* Relative-volume activity bar — direction-tinted, width = rel volume */}
                    <span className="absolute inset-x-0 bottom-0 h-[2px] bg-transparent">
                      <span
                        className="block h-full transition-[width]"
                        style={{
                          width: `${(relVol * 100).toFixed(1)}%`,
                          backgroundColor: positive == null ? 'rgba(92,107,129,0.5)' : `rgba(${chipColor},0.55)`,
                        }}
                      />
                    </span>
                  </div>
                );
              })}
              {scannerRows.rows.length === 0 && !watchlistError && (
                <p className="px-2 py-4 text-center font-mono text-[11px] text-intel-ink3">
                  Empty universe — add a ticker to begin.
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-2">
            {alerts.map((alert, idx) => (
              <Fragment key={alert.id}>
                <div className="rounded-panel border-l-2 border-intel-accent/40 bg-intel-panel p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-sm font-semibold text-intel-ink">{alert.title}</p>
                    <span className="font-mono text-[10px] uppercase tracking-label text-intel-accent">{alert.impact}</span>
                  </div>
                  <p className="text-xs text-intel-ink2 leading-relaxed">{alert.body}</p>
                </div>
                {idx === 0 && (
                  <div className="rounded-panel bg-intel-panel2 p-3 flex gap-2.5">
                    <MessageSquare className="h-4 w-4 shrink-0 text-intel-info" />
                    <div>
                      <p className="text-[11px] text-intel-ink2">Ask AI desk</p>
                      <p className="text-sm text-intel-ink">"What does this mean for {selectedTicker}?"</p>
                    </div>
                  </div>
                )}
              </Fragment>
            ))}
            <div className="rounded-panel border-l-2 border-intel-warn/50 bg-intel-panel p-3 flex gap-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-intel-warn" />
              <div>
                <p className="font-mono text-[10px] uppercase tracking-label text-intel-warn">Desk Risk</p>
                <p className="text-sm text-intel-ink2">Vol uptick expected around macro catalysts this week.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
