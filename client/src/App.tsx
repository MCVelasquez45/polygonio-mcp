import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TradingHeader } from './components/layout/TradingHeader';
import { TradingSidebar } from './components/layout/TradingSidebar';
import { ChartPanel } from './components/trading/ChartPanel';
import { GreeksPanel } from './components/options/GreeksPanel';
import { OrderTicketPanel } from './components/trading/OrderTicketPanel';
import { OptionsChainPanel } from './components/options/OptionsChainPanel';
import { OptionsScanner } from './components/screener/OptionsScanner';
import { PortfolioPanel } from './components/portfolio/PortfolioPanel';
import { ChatDock } from './components/chat/ChatDock';
import { EntryChecklistPanel } from './components/trading/EntryChecklistPanel';
import { analysisApi, chatApi, marketApi } from './api';
import { DEFAULT_ASSISTANT_MESSAGE } from './constants';
import { getExpirationTimestamp } from './utils/expirations';
import type {
  AggregateBar,
  IndicatorBundle,
  IndicatorSeries,
  OptionChainExpirationGroup,
  OptionContractDetail,
  OptionLeg,
  QuoteSnapshot,
  TradePrint,
  WatchlistSnapshot,
} from './types/market';
import type { ChecklistResult, WatchlistReport } from './api/analysis';
import type { ChatMessage, ConversationMeta, ConversationPayload, ConversationResponse } from './types';

// Map timeframe choices in the UI to the aggregate query parameters expected by the API.
const TIMEFRAME_MAP = {
  '1/minute': { multiplier: 1, timespan: 'minute' as const, window: 240 },
  '3/minute': { multiplier: 3, timespan: 'minute' as const, window: 240 },
  '5/minute': { multiplier: 5, timespan: 'minute' as const, window: 240 },
  '15/minute': { multiplier: 15, timespan: 'minute' as const, window: 240 },
  '30/minute': { multiplier: 30, timespan: 'minute' as const, window: 240 },
  '1/hour': { multiplier: 1, timespan: 'hour' as const, window: 180 },
  '1/day': { multiplier: 1, timespan: 'day' as const, window: 180 },
};

// Default lookback window for the simple moving average indicator.
const SMA_WINDOW = 50;

// Compute a rolling SMA series for the supplied aggregate bars.
function computeSMA(bars: AggregateBar[], window = SMA_WINDOW): IndicatorSeries {
  if (!bars.length || window <= 0) {
    return { latest: null, trend: undefined, values: [] };
  }
  const values: IndicatorSeries['values'] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i += 1) {
    sum += bars[i].close;
    if (i >= window) {
      sum -= bars[i - window].close;
    }
    const value = i >= window - 1 ? sum / window : null;
    values.push({ timestamp: bars[i].timestamp, value });
  }
  const latest = values.at(-1)?.value ?? null;
  const previous = values.at(-2)?.value ?? null;
  let trend: 'rising' | 'falling' | 'flat' | undefined;
  if (typeof latest === 'number' && typeof previous === 'number') {
    if (latest > previous) trend = 'rising';
    else if (latest < previous) trend = 'falling';
    else trend = 'flat';
  }
  return { latest: typeof latest === 'number' ? latest : null, trend, values };
}

// Bundle any indicators we currently support so the chart can render overlays.
function buildIndicatorBundle(symbol: string, bars: AggregateBar[]): IndicatorBundle | undefined {
  if (!bars.length) return undefined;
  return {
    ticker: symbol,
    sma: computeSMA(bars),
  };
}

type View = 'trading' | 'scanner' | 'portfolio';
type TimeframeKey = keyof typeof TIMEFRAME_MAP;
// Local storage key for persisting conversations between refreshes.
const STORAGE_KEY = 'market-copilot.conversations';

// Snapshot of the trading session state returned by aggregate endpoints.
type MarketSessionMeta = {
  marketClosed: boolean;
  afterHours: boolean;
  usingLastSession: boolean;
  resultGranularity: 'intraday' | 'daily' | 'cache';
  note?: string | null;
  state?: string;
  nextOpen?: string | null;
  nextClose?: string | null;
  fetchedAt?: string;
};

// Convert ISO timestamps (next open/close) into small relative labels.
function formatRelativeTime(value?: string | null): string | null {
  if (!value) return null;
  const target = Date.parse(value);
  if (Number.isNaN(target)) return null;
  const deltaMs = target - Date.now();
  if (deltaMs <= 0) {
    return new Date(target).toLocaleString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
      day: 'numeric'
    });
  }
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `in ${days}d ${remainingHours}h`;
}

// Root component controlling all trading/scanner/portfolio views. Manages data
// fetching, caches, and cross-panel selection state.
function App() {
  const [view, setView] = useState<View>('trading');
  const [ticker, setTicker] = useState('SPY');
  const normalizedTicker = ticker.trim().toUpperCase() || 'SPY';

  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Option chain state (expirations + selected leg/contract).
  const [chainExpirations, setChainExpirations] = useState<OptionChainExpirationGroup[]>([]);
  const [chainUnderlyingPrice, setChainUnderlyingPrice] = useState<number | null>(null);
  const [chainLoading, setChainLoading] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  const [availableExpirations, setAvailableExpirations] = useState<string[]>([]);
  const [customExpirations, setCustomExpirations] = useState<string[]>([]);
  const [selectedExpiration, setSelectedExpiration] = useState<string | null>(null);
  const invalidExpirationsRef = useRef<Set<string>>(new Set());

  const [selectedLeg, setSelectedLeg] = useState<OptionLeg | null>(null);
  const [desiredContract, setDesiredContract] = useState<string | null>(null);
  const activeContractSymbol = selectedLeg?.ticker ?? null;

  const [contractDetail, setContractDetail] = useState<OptionContractDetail | null>(null);

  // Chart + indicator caches for the selected underlying.
  const [timeframe, setTimeframe] = useState<TimeframeKey>('1/day');
  const [bars, setBars] = useState<AggregateBar[]>([]);
  const [indicators, setIndicators] = useState<IndicatorBundle>();
  const [chartLoading, setChartLoading] = useState(false);

  const [quote, setQuote] = useState<QuoteSnapshot | null>(null);
  const [trades, setTrades] = useState<TradePrint[]>([]);
  const [underlyingSnapshot, setUnderlyingSnapshot] = useState<WatchlistSnapshot | null>(null);
  const underlyingSnapshotRef = useRef<WatchlistSnapshot | null>(null);

  // Conversation/chat state (AI insights dock).
  const [marketError, setMarketError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [transcripts, setTranscripts] = useState<Record<string, ChatMessage[]>>({});
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [latestInsight, setLatestInsight] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const transcriptsRef = useRef<Record<string, ChatMessage[]>>(transcripts);
  const activeConversationIdRef = useRef<string | null>(activeConversationId);
  const selectionHydratedRef = useRef(false);
  const pendingSelectionRef = useRef<{ contract: string | null; expiration: string | null }>({ contract: null, expiration: null });
  const [orderSide, setOrderSide] = useState<'buy' | 'sell'>('buy');
  // Cache chart payloads per ticker/timeframe so we can reuse fresh fetches.
  const chartCacheRef = useRef<
    Map<
      string,
      {
        timestamp: number;
        bars: AggregateBar[];
        indicators?: IndicatorBundle;
        note?: string | null;
        session?: MarketSessionMeta | null;
      }
    >
  >(new Map());
  const chartFetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chartRefreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chartRequestIdRef = useRef(0);
  const displayTicker = normalizedTicker;
  const [marketSessionMeta, setMarketSessionMeta] = useState<MarketSessionMeta | null>(null);
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>([]);
  const [scannerReports, setScannerReports] = useState<WatchlistReport[]>([]);
  const [scannerLoading, setScannerLoading] = useState(false);
  const [checklistHighlights, setChecklistHighlights] = useState<Record<string, ChecklistResult>>({});
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [currentChecklist, setCurrentChecklist] = useState<ChecklistResult | null>(null);

  // Broadcast a request to add a ticker in other components (watchlist panel).
  const addTickerToWatchlist = useCallback((symbol: string) => {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized || typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('watchlist:add', { detail: { symbol: normalized } }));
  }, []);

  // Track watchlist changes pushed from sidebar/watchlist component.
  const handleWatchlistChange = useCallback((symbols: string[]) => {
    setWatchlistSymbols(symbols);
  }, []);

  const watchlistSignature = watchlistSymbols.join(',');

  // Whenever the watchlist contents change, refresh the scanner reports for those tickers.
  // Fetch the option chain whenever the ticker or selected expiration changes.
  // Reset derived state when the user changes tickers (fresh bars, selection, etc.).
  // Persist the currently selected leg so it can be restored on next load.
  // Fetch aggregate bars/indicators for the active ticker/timeframe with caching + polling.
  // Poll trades + quote snapshots for the currently selected option contract.
  useEffect(() => {
    if (!watchlistSignature) {
      setScannerReports([]);
      setScannerLoading(false);
      setChecklistHighlights({});
      return;
    }
    let cancelled = false;
    setScannerLoading(true);
    analysisApi
      .getWatchlistReports(watchlistSymbols)
      .then(response => {
        if (cancelled) return;
        setScannerReports(response.reports ?? []);
      })
      .catch(error => {
        if (cancelled) return;
        console.warn('Failed to load watchlist reports', error);
        setScannerReports([]);
      })
      .finally(() => {
        if (!cancelled) {
          setScannerLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [watchlistSignature, watchlistSymbols]);

  // Run the entry checklist for the current watchlist to highlight notable setups.
  useEffect(() => {
    if (!watchlistSignature) {
      setChecklistHighlights({});
      return;
    }
    let cancelled = false;
    setChecklistLoading(true);
    analysisApi
      .runChecklist(watchlistSymbols)
      .then(response => {
        if (cancelled) return;
        const nextMap: Record<string, ChecklistResult> = {};
        (response.results ?? []).forEach(result => {
          if (!result?.symbol) return;
          nextMap[result.symbol.toUpperCase()] = result;
        });
        setChecklistHighlights(nextMap);
      })
      .catch(error => {
        if (cancelled) return;
        console.warn('Failed to load checklist highlights', error);
        setChecklistHighlights({});
      })
      .finally(() => {
        if (!cancelled) {
          setChecklistLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [watchlistSignature, watchlistSymbols]);

  // Keep the checklist card for the focused ticker up to date.
  useEffect(() => {
    const key = displayTicker?.toUpperCase();
    if (!key) {
      setCurrentChecklist(null);
      return;
    }
    if (checklistHighlights[key]) {
      setCurrentChecklist(checklistHighlights[key]);
      return;
    }
    let cancelled = false;
    analysisApi
      .runChecklist([key])
      .then(response => {
        if (cancelled) return;
        setCurrentChecklist(response.results?.[0] ?? null);
      })
      .catch(error => {
        if (cancelled) return;
        console.warn('Failed to fetch checklist for ticker', key, error);
        setCurrentChecklist(null);
      });
    return () => {
      cancelled = true;
    };
  }, [displayTicker, checklistHighlights]);

  // Lazily fetch conversation transcripts when the user re-opens a chat session.
  const ensureTranscriptLoaded = useCallback(async (sessionId: string) => {
    if (transcriptsRef.current[sessionId]) return;
    try {
      const payload = await chatApi.fetchConversationTranscript(sessionId);
      const mapped = mapMessages(payload);
      setTranscripts(prev => {
        const next = {
          ...prev,
          [sessionId]: mapped.length ? mapped : [DEFAULT_ASSISTANT_MESSAGE],
        };
        transcriptsRef.current = next;
        return next;
      });
    } catch (error) {
      console.warn('Failed to fetch conversation transcript', error);
    }
  }, []);

  // Merge expirations returned from the API with anything the user entered manually.
  const mergedExpirations = useMemo(() => {
    const merged = new Set<string>();
    availableExpirations.forEach(value => merged.add(value));
    customExpirations.forEach(value => merged.add(value));
    return Array.from(merged).sort((a, b) => {
      const tsA = getExpirationTimestamp(a);
      const tsB = getExpirationTimestamp(b);
      if (tsA == null && tsB == null) return 0;
      if (tsA == null) return 1;
      if (tsB == null) return -1;
      return tsA - tsB;
    });
  }, [availableExpirations, customExpirations]);

  // Load the user's AI conversations (remote first, falling back to local storage).
  const hydrateConversations = useCallback(async () => {
    try {
      const payloads = await chatApi.listConversations();
      const list: ConversationMeta[] = payloads.map(normalizeConversation);
      if (list.length === 0) {
        const seeded = createConversation();
        setConversations([seeded]);
        setActiveConversationId(seeded.id);
        setTranscripts(() => {
          const next = { [seeded.sessionId]: [DEFAULT_ASSISTANT_MESSAGE] };
          transcriptsRef.current = next;
          return next;
        });
        return;
      }
      setTranscripts(() => {
        const next: Record<string, ChatMessage[]> = {};
        transcriptsRef.current = next;
        return next;
      });
      setConversations(list);
      setActiveConversationId(list[0].id);
      await ensureTranscriptLoaded(list[0].sessionId);
    } catch (error) {
      console.warn('Failed to fetch conversations from API, using local cache if available.', error);
      if (typeof window !== 'undefined') {
        const cached = window.localStorage.getItem(STORAGE_KEY);
        if (cached) {
          try {
            const parsed: ConversationMeta[] = JSON.parse(cached);
            if (parsed.length) {
              setConversations(parsed);
              setActiveConversationId(parsed[0].id);
            }
          } catch (parseError) {
            console.warn('Failed to parse cached conversations', parseError);
          }
        }
      }
      if (!activeConversationIdRef.current) {
        const seeded = createConversation();
        setConversations([seeded]);
        setActiveConversationId(seeded.id);
        setTranscripts(() => {
          const next = { [seeded.sessionId]: [DEFAULT_ASSISTANT_MESSAGE] };
          transcriptsRef.current = next;
          return next;
        });
      }
    }
  }, [ensureTranscriptLoaded]);

  // Kick off initial conversation fetch on mount.
  useEffect(() => {
    hydrateConversations();
  }, [hydrateConversations]);

  // Restore any persisted ticker/contract selection the user had previously saved.
  useEffect(() => {
    if (selectionHydratedRef.current) return;
    selectionHydratedRef.current = true;
    let cancelled = false;
    async function hydrateSelection() {
      try {
        const payload = await marketApi.getPersistedSelection();
        if (cancelled) return;
        const selection = payload?.selection;
        if (selection?.ticker) {
          setTicker(selection.ticker);
        }
        const normalizedContract = selection?.contract ? selection.contract.toUpperCase() : null;
        pendingSelectionRef.current.contract = normalizedContract;
        pendingSelectionRef.current.expiration = selection?.expiration ?? null;
        if (normalizedContract) {
          setDesiredContract(normalizedContract);
        }
      } catch (error) {
        console.warn('Failed to hydrate option selection', error);
      }
    }
    hydrateSelection();
    return () => {
      cancelled = true;
    };
  }, []);

  // Mirror the active conversation id in a ref so async callbacks can read the latest value.
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  // If the API returns conversations but nothing is selected, default to the first.
  useEffect(() => {
    if (!activeConversationId && conversations.length) {
      setActiveConversationId(conversations[0].id);
    }
  }, [conversations, activeConversationId]);

  // Persist conversation metadata locally so we can boot offline.
  useEffect(() => {
    if (!conversations.length || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    } catch (error) {
      console.warn('Failed to persist conversations to local storage', error);
    }
  }, [conversations]);

  useEffect(() => {
    if (!normalizedTicker) {
      setChainExpirations([]);
      setChainUnderlyingPrice(null);
      setChainLoading(false);
      return;
    }
    let cancelled = false;
    async function loadChain() {
      setChainLoading(true);
      setChainError(null);
      try {
        const response = await marketApi.getOptionsChain({
          ticker: normalizedTicker,
          limit: selectedExpiration ? 200 : 150,
          expiration: selectedExpiration ?? undefined
        });
        console.log('[CLIENT] options chain response', {
          ticker: normalizedTicker,
          expirations: response?.expirations?.length ?? 0,
          sample: response?.expirations?.[0]
        });
        if (!cancelled) {
          const groups = Array.isArray(response.expirations) ? response.expirations : [];
          if (!groups.length) {
            const errorMessage = selectedExpiration
              ? 'No contracts available for this expiration'
              : `No option contracts found for ${normalizedTicker}.`;
            setChainError(errorMessage);
            setChainExpirations([]);
            setChainUnderlyingPrice(response?.underlyingPrice ?? null);
          } else {
            setChainExpirations(groups);
            const snapshotTicker =
              underlyingSnapshotRef.current && underlyingSnapshotRef.current.entryType === 'underlying'
                ? underlyingSnapshotRef.current.ticker?.toUpperCase()
                : null;
            const fallbackUnderlying =
              response?.underlyingPrice ??
              (snapshotTicker === normalizedTicker ? underlyingSnapshotRef.current?.price ?? null : null);
            setChainUnderlyingPrice(fallbackUnderlying);
          }
        }
      } catch (error: any) {
        if (!cancelled) {
          const status = error?.response?.status;
          if (status === 404 && selectedExpiration) {
            console.warn('[CLIENT] expiration missing, reverting to full chain', selectedExpiration);
            pendingSelectionRef.current.expiration = null;
            invalidExpirationsRef.current.add(selectedExpiration);
            setCustomExpirations(prev => prev.filter(value => value !== selectedExpiration));
            setSelectedExpiration(null);
          } else {
            const message = error?.response?.data?.error ?? error?.message ?? 'Failed to load options chain';
            setChainError(message);
            setChainExpirations([]);
            setChainUnderlyingPrice(null);
          }
        }
      } finally {
        if (!cancelled) setChainLoading(false);
      }
    }
    loadChain();
    return () => {
      cancelled = true;
    };
  }, [normalizedTicker, selectedExpiration]);

  useEffect(() => {
    setSelectedLeg(null);
    setContractDetail(null);
    setBars([]);
    setIndicators(undefined);
    setQuote(null);
    setTrades([]);
    setMarketError(null);
    setChainExpirations([]);
    setChainUnderlyingPrice(null);
    setChainError(null);

    if (normalizedTicker.startsWith('O:')) {
      const contractSymbol = normalizedTicker.toUpperCase();
      pendingSelectionRef.current.contract = contractSymbol;
      pendingSelectionRef.current.expiration = parseOptionExpirationFromTicker(contractSymbol);
      setDesiredContract(contractSymbol);
    } else if (!pendingSelectionRef.current.contract) {
      pendingSelectionRef.current.contract = null;
      pendingSelectionRef.current.expiration = null;
      setDesiredContract(null);
    }
  }, [normalizedTicker]);

  // Each underlying owns its own list of temporary expirations; clear on ticker change.
  useEffect(() => {
    setCustomExpirations([]);
    invalidExpirationsRef.current.clear();
  }, [normalizedTicker]);

  // Load the current underlying's expirations list for the expiration selector.
  useEffect(() => {
    if (!normalizedTicker) {
      setAvailableExpirations([]);
      setSelectedExpiration(null);
      setChainExpirations([]);
      setChainUnderlyingPrice(null);
      return;
    }
    let cancelled = false;
    setChainError(null);
    setAvailableExpirations([]);
    setSelectedExpiration(null);
    setChainExpirations([]);
    setChainUnderlyingPrice(null);
    async function loadExpirations() {
      try {
        const payload = await marketApi.getOptionExpirations(normalizedTicker);
        if (cancelled) return;
        const expirations = Array.isArray(payload?.expirations) ? payload.expirations : [];
        setAvailableExpirations(expirations);
        const pendingExpiration = pendingSelectionRef.current.expiration;
        if (pendingExpiration) {
          if (!expirations.includes(pendingExpiration)) {
            setCustomExpirations(prev =>
              prev.includes(pendingExpiration) ? prev : [...prev, pendingExpiration]
            );
          }
          setSelectedExpiration(pendingExpiration);
          pendingSelectionRef.current.expiration = null;
          invalidExpirationsRef.current.delete(pendingExpiration);
        } else if (selectedExpiration && !expirations.includes(selectedExpiration)) {
          setSelectedExpiration(null);
        }
      } catch (error: any) {
        if (!cancelled) {
          const message = error?.response?.data?.error ?? error?.message ?? 'Failed to load expirations';
          setChainError(message);
          setAvailableExpirations([]);
          setSelectedExpiration(null);
        }
      }
    }
    loadExpirations();
    return () => {
      cancelled = true;
    };
  }, [normalizedTicker]);

  // When a pending contract symbol is provided, auto-select that leg from the chain.
  // Ensure the expiration selector follows the desired contract's expiry.
  useEffect(() => {
    if (!desiredContract) return;
    if (!chainExpirations.length) return;
    if (selectedLeg?.ticker?.toUpperCase() === desiredContract.toUpperCase()) return;
    const matching = findLegByTicker(chainExpirations, desiredContract);
    if (matching) {
      setSelectedLeg(matching);
      if (pendingSelectionRef.current.contract?.toUpperCase() === desiredContract.toUpperCase()) {
        pendingSelectionRef.current.contract = null;
      }
    }
  }, [chainExpirations, desiredContract, selectedLeg]);

  useEffect(() => {
    if (!desiredContract) return;
    if (selectedLeg?.ticker === desiredContract) return;
    const parsedExpiration = parseOptionExpirationFromTicker(desiredContract);
    if (!parsedExpiration) return;
    if (selectedExpiration === parsedExpiration) return;
    pendingSelectionRef.current.expiration = parsedExpiration;
    if (!mergedExpirations.includes(parsedExpiration)) {
      setCustomExpirations(prev =>
        prev.includes(parsedExpiration) ? prev : [...prev, parsedExpiration]
      );
    }
    if (!invalidExpirationsRef.current.has(parsedExpiration)) {
      setSelectedExpiration(parsedExpiration);
    }
  }, [desiredContract, selectedLeg, mergedExpirations, selectedExpiration]);

  useEffect(() => {
    if (!selectedLeg) return;
    if (
      pendingSelectionRef.current.contract &&
      pendingSelectionRef.current.contract.toUpperCase() === selectedLeg.ticker.toUpperCase()
    ) {
      pendingSelectionRef.current.contract = null;
    }
    if (pendingSelectionRef.current.expiration === selectedLeg.expiration) {
      pendingSelectionRef.current.expiration = null;
    }
    marketApi
      .savePersistedSelection({
        ticker: normalizedTicker,
        contract: selectedLeg.ticker,
        expiration: selectedLeg.expiration,
        strike: selectedLeg.strike,
        type: selectedLeg.type
      })
      .catch(error => console.warn('Failed to persist option selection', error));
  }, [selectedLeg, normalizedTicker]);

  // Pull an underlying snapshot (quote + percent changes) unless we are on an option symbol.
  useEffect(() => {
    if (!normalizedTicker || normalizedTicker.startsWith('O:')) {
      setUnderlyingSnapshot(null);
      underlyingSnapshotRef.current = null;
      return;
    }
    let cancelled = false;
    async function loadSnapshot() {
      try {
        const payload = await marketApi.getWatchlistSnapshots([normalizedTicker]);
        if (!cancelled) {
          const snapshot = payload.entries?.[0] ?? null;
          setUnderlyingSnapshot(snapshot);
          underlyingSnapshotRef.current = snapshot ?? null;
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to load underlying snapshot', error);
          setUnderlyingSnapshot(null);
          underlyingSnapshotRef.current = null;
        }
      }
    }
    loadSnapshot();
    return () => {
      cancelled = true;
    };
  }, [normalizedTicker]);

  // Clear previous market errors when we have an active contract symbol again.
  useEffect(() => {
    if (activeContractSymbol) {
      setMarketError(null);
    }
  }, [activeContractSymbol]);

  // Keep the Greeks panel detail in sync with the selected leg.
  useEffect(() => {
    if (!selectedLeg) {
      setContractDetail(null);
      return;
    }
    setContractDetail(optionLegToContractDetail(selectedLeg));
  }, [selectedLeg]);

  useEffect(() => {
    const symbol = normalizedTicker;
    if (!symbol) {
      setBars([]);
      setIndicators(undefined);
      return;
    }
    if (chartFetchTimeoutRef.current) {
      clearTimeout(chartFetchTimeoutRef.current);
      chartFetchTimeoutRef.current = null;
    }
    if (chartRefreshIntervalRef.current) {
      clearInterval(chartRefreshIntervalRef.current);
      chartRefreshIntervalRef.current = null;
    }
    const cacheKey = `${symbol}-${timeframe}`;
    const cached = chartCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 15_000) {
      setBars(cached.bars);
      setIndicators(cached.indicators);
      setMarketError(cached.note ?? null);
      setMarketSessionMeta(cached.session ?? null);
      return;
    }

    setChartLoading(true);
    setMarketError(null);

    const triggerFetch = () => {
      chartRequestIdRef.current += 1;
      const requestId = chartRequestIdRef.current;
      const config = TIMEFRAME_MAP[timeframe] ?? TIMEFRAME_MAP['5/minute'];

      const fetchAggregates = async () => {
        const response = await marketApi.getAggregates({
          ticker: symbol,
          multiplier: config.multiplier,
          timespan: config.timespan,
          window: config.window ?? 180,
        });
        return response;
      };

      const runFetch = async () => {
        const aggregates = await fetchAggregates();
        if (chartRequestIdRef.current !== requestId) return;
        const bars = (aggregates.results ?? []).map(entry => ({
          timestamp: Number.isFinite(Date.parse(entry.t)) ? Date.parse(entry.t) : Date.now(),
          open: entry.o,
          high: entry.h,
          low: entry.l,
          close: entry.c,
          volume: entry.v
        }));
        const indicatorBundle = buildIndicatorBundle(symbol, bars);
        setBars(bars);
        setIndicators(indicatorBundle);
        const nextError =
          aggregates.note ?? (bars.length === 0 ? `No aggregate data available for ${symbol} (${timeframe}).` : null);
        const sessionMeta: MarketSessionMeta = {
          marketClosed: Boolean(aggregates.marketClosed),
          afterHours: Boolean(aggregates.afterHours),
          usingLastSession: Boolean(aggregates.usingLastSession),
          resultGranularity: aggregates.resultGranularity ?? 'intraday',
          note: nextError,
          state: aggregates.marketStatus?.state,
          nextOpen: aggregates.marketStatus?.nextOpen ?? null,
          nextClose: aggregates.marketStatus?.nextClose ?? null,
          fetchedAt: aggregates.marketStatus?.asOf ?? aggregates.fetchedAt ?? undefined
        };
        chartCacheRef.current.set(cacheKey, {
          bars,
          indicators: indicatorBundle,
          timestamp: Date.now(),
          note: nextError,
          session: sessionMeta
        });
        setMarketSessionMeta(sessionMeta);
        setMarketError(nextError);
      };

      const safeRun = async () => {
        try {
          await runFetch();
        } catch (error: any) {
          if (error?.response?.status === 429) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await runFetch();
          } else {
            throw error;
          }
        }
      };

      safeRun()
        .catch(error => {
          if (chartRequestIdRef.current !== requestId) return;
          const message = error?.response?.data?.error ?? error?.message ?? 'Failed to load chart data';
          setMarketError(message);
          setBars([]);
          setIndicators(undefined);
        })
        .finally(() => {
          if (chartRequestIdRef.current === requestId) setChartLoading(false);
        });
    };

    chartFetchTimeoutRef.current = setTimeout(triggerFetch, 200);
    const refreshConfig = TIMEFRAME_MAP[timeframe] ?? TIMEFRAME_MAP['5/minute'];
    const refreshMs =
      refreshConfig.timespan === 'minute'
        ? Math.max(30_000, refreshConfig.multiplier * 60_000)
        : refreshConfig.timespan === 'hour'
        ? refreshConfig.multiplier * 3_600_000
        : 300_000;
    chartRefreshIntervalRef.current = setInterval(triggerFetch, refreshMs);

    return () => {
      if (chartFetchTimeoutRef.current) {
        clearTimeout(chartFetchTimeoutRef.current);
        chartFetchTimeoutRef.current = null;
      }
      if (chartRefreshIntervalRef.current) {
        clearInterval(chartRefreshIntervalRef.current);
        chartRefreshIntervalRef.current = null;
      }
    };
  }, [normalizedTicker, timeframe]);

  useEffect(() => {
    if (!activeContractSymbol) {
      setQuote(null);
      setTrades([]);
      return;
    }
    const symbol = activeContractSymbol!;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const shouldPoll = !marketSessionMeta?.marketClosed;

    const loadSnapshots = async () => {
      try {
        const [tradesPayload, quotePayload] = await Promise.all([
          marketApi.getTrades(symbol),
          marketApi.getQuote(symbol),
        ]);
        console.log('[CLIENT] trades response', {
          ticker: symbol,
          count: tradesPayload?.trades?.length ?? 0,
          sample: tradesPayload?.trades?.[0]
        });
        console.log('[CLIENT] quote response', {
          ticker: symbol,
          bid: quotePayload?.bidPrice,
          ask: quotePayload?.askPrice,
          midpoint: quotePayload?.midpoint,
          updated: quotePayload?.updated
        });
        if (!cancelled) {
          setTrades(tradesPayload.trades ?? []);
          setQuote(quotePayload);
        }
      } catch (error: any) {
        if (!cancelled) {
          const message = error?.response?.data?.error ?? error?.message ?? 'Failed to load market snapshots';
          setMarketError(message);
        }
      }
    };

    loadSnapshots();
    if (shouldPoll) {
      timer = setInterval(loadSnapshots, 60_000);
    }

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [activeContractSymbol, marketSessionMeta?.marketClosed]);

  // Spawn a brand new chat session in the dock and make it active.
  function startNewConversation() {
    const convo = createConversation();
    setConversations(prev => [convo, ...prev]);
    setTranscripts(prev => {
      const next = {
        ...prev,
        [convo.sessionId]: [DEFAULT_ASSISTANT_MESSAGE],
      };
      transcriptsRef.current = next;
      return next;
    });
    setActiveConversationId(convo.id);
    setLatestInsight('');
  }

  // Switch active chat sessions and lazily hydrate transcripts as required.
  async function handleConversationSelect(id: string) {
    setActiveConversationId(id);
    const convo = conversations.find(c => c.id === id);
    if (convo) {
      setLatestInsight(convo.preview);
      await ensureTranscriptLoaded(convo.sessionId);
    }
  }

  // Allow dock components to push latest messages into the transcript cache.
  function handleMessagesChange(sessionId: string, nextMessages: ChatMessage[]) {
    setTranscripts(prev => {
      const next = {
        ...prev,
        [sessionId]: nextMessages,
      };
      transcriptsRef.current = next;
      return next;
    });
  }

  // When the assistant replies, refresh metadata + previews so the list stays sorted.
  function handleConversationUpdate(payload: ConversationPayload) {
    const normalized = normalizeConversation(payload);
    setConversations(prev => {
      const filtered = prev.filter(convo => convo.sessionId !== normalized.sessionId);
      return [normalized, ...filtered];
    });
    setLatestInsight(normalized.preview);
  }

  // Sidebar component handles watchlist interactions + ticker selection.
  const sidebar = (
    <TradingSidebar
      selectedTicker={normalizedTicker}
      onSelectTicker={(next, snapshot) => {
        const normalized = next.toUpperCase();
        setTicker(normalized);
        setUnderlyingSnapshot(snapshot ?? null);
        underlyingSnapshotRef.current = snapshot ?? null;
        if (snapshot?.entryType === 'underlying' && snapshot.referenceContract) {
          const referenceContract = snapshot.referenceContract.toUpperCase();
          pendingSelectionRef.current.contract = referenceContract;
          pendingSelectionRef.current.expiration = parseOptionExpirationFromTicker(referenceContract);
          setDesiredContract(referenceContract);
        } else if (normalized.startsWith('O:')) {
          pendingSelectionRef.current.contract = normalized;
          pendingSelectionRef.current.expiration = parseOptionExpirationFromTicker(normalized);
          setDesiredContract(normalized);
        } else {
          pendingSelectionRef.current.contract = null;
          pendingSelectionRef.current.expiration = null;
          setDesiredContract(null);
        }
        setSidebarOpen(false);
      }}
      onSnapshotUpdate={(ticker, snapshot) => {
        if (!ticker) return;
        if (ticker.toUpperCase() !== normalizedTicker.toUpperCase()) return;
        setUnderlyingSnapshot(snapshot ?? null);
        underlyingSnapshotRef.current = snapshot ?? null;
      }}
      onWatchlistChange={handleWatchlistChange}
    />
  );

  // When the user chooses a contract in the chain, sync selection + expiration state.
  const handleContractSelection = useCallback(
    (leg: OptionLeg | null) => {
      setSelectedLeg(leg);
      if (leg?.ticker) {
        setDesiredContract(leg.ticker.toUpperCase());
        if (leg.expiration) {
          setCustomExpirations(prev =>
            prev.includes(leg.expiration) ? prev : [...prev, leg.expiration]
          );
          setSelectedExpiration(leg.expiration);
          invalidExpirationsRef.current.delete(leg.expiration);
        }
      } else if (normalizedTicker.startsWith('O:')) {
        setDesiredContract(normalizedTicker);
      } else {
        setDesiredContract(null);
      }
    },
    [normalizedTicker]
  );

  // Update the selected expiration and reset leg selection when dropdown changes.
  const handleExpirationChange = useCallback((value: string | null) => {
    pendingSelectionRef.current.expiration = null;
    if (value) {
      invalidExpirationsRef.current.delete(value);
    }
    setSelectedExpiration(value);
    setSelectedLeg(null);
    setDesiredContract(null);
  }, []);

  // Prefer the latest chain price for Greeks panel, fall back to watchlist snapshot.
  const greeksUnderlyingPrice =
    chainUnderlyingPrice ??
    (underlyingSnapshot && underlyingSnapshot.entryType === 'underlying' ? underlyingSnapshot.price ?? null : null);

  // Determine the best available underlying price for options chain calculations.
  const resolvedUnderlyingPrice = useMemo(() => {
    if (chainUnderlyingPrice != null) return chainUnderlyingPrice;
    if (underlyingSnapshot && underlyingSnapshot.entryType === 'underlying') {
      return typeof underlyingSnapshot.price === 'number' ? underlyingSnapshot.price : null;
    }
    const latestBar = bars.at(-1);
    return latestBar?.close ?? null;
  }, [chainUnderlyingPrice, underlyingSnapshot, bars]);

  // Main trading workspace layout (chart, insights, greeks, and options chain).
  const tradingView = (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pb-24 lg:pb-8">
      <div className="lg:col-span-2 flex flex-col gap-4 min-h-[26rem] min-w-0">
        {marketSessionMeta && (marketSessionMeta.marketClosed || marketSessionMeta.afterHours) && (
          <div
            className={`rounded-2xl border px-4 py-3 ${
              marketSessionMeta.marketClosed
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
                : 'border-sky-500/40 bg-sky-500/10 text-sky-100'
            }`}
          >
            <p className="text-sm font-semibold flex items-center gap-2">
              {marketSessionMeta.marketClosed ? 'Market Closed' : 'After-Hours'}
              {marketSessionMeta.usingLastSession && (
                <span className="text-[10px] uppercase tracking-[0.3em] opacity-80">Last Session</span>
              )}
            </p>
            <p className="text-xs mt-1">
              {marketSessionMeta.marketClosed
                ? 'Data reflects the last completed trading session.'
                : 'Prices are updating slower during the extended session.'}{' '}
              {marketSessionMeta.nextOpen && `Next session ${formatRelativeTime(marketSessionMeta.nextOpen) ?? ''}.`}
            </p>
            {marketSessionMeta.note && <p className="text-[11px] mt-1 opacity-80">{marketSessionMeta.note}</p>}
          </div>
        )}
        <ChartPanel
          ticker={displayTicker}
          timeframe={timeframe}
          data={bars}
          indicators={indicators}
          isLoading={chartLoading}
          onTimeframeChange={value => setTimeframe(value as TimeframeKey)}
          fallbackPrice={
            underlyingSnapshot && underlyingSnapshot.entryType === 'underlying'
              ? underlyingSnapshot.price ?? null
              : null
          }
          fallbackChange={
            underlyingSnapshot && underlyingSnapshot.entryType === 'underlying'
              ? { absolute: underlyingSnapshot.change ?? null, percent: underlyingSnapshot.changePercent ?? null }
              : undefined
          }
          sessionMeta={marketSessionMeta}
        />
        <div className="bg-gray-950 border border-gray-900 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Latest Insight</p>
              <p className="text-sm text-gray-400">AI desk notes for {displayTicker}</p>
            </div>
            <button
              type="button"
              onClick={() => setIsChatOpen(true)}
              className="px-3 py-1 rounded-full border border-emerald-500/40 text-xs text-emerald-300 hover:bg-emerald-500/10"
            >
              Ask AI
            </button>
          </div>
          <p className="text-sm text-gray-200 whitespace-pre-line">
            {latestInsight || `No notes yet. Open the AI desk to ask about ${displayTicker} or any spread.`}
          </p>
        </div>
        <EntryChecklistPanel result={currentChecklist} loading={checklistLoading} />
        <GreeksPanel contract={contractDetail} leg={selectedLeg} label={displayTicker} underlyingPrice={greeksUnderlyingPrice} />
      </div>
      <div className="lg:col-span-1 min-h-[26rem] min-w-0">
        <OrderTicketPanel
          contract={contractDetail}
          quote={quote}
          trades={trades}
          isLoading={false}
          label={displayTicker}
          marketClosed={marketSessionMeta?.marketClosed}
          afterHours={marketSessionMeta?.afterHours}
          nextOpen={marketSessionMeta?.nextOpen ?? null}
        />
      </div>
      <div className="lg:col-span-3 min-w-0">
        {marketSessionMeta?.marketClosed && (
          <div className="mb-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 text-amber-100 px-4 py-2 text-xs">
            Options quotes are paused — spreads reflect the last available snapshot.
          </div>
        )}
        <OptionsChainPanel
          ticker={displayTicker}
          groups={chainExpirations}
          underlyingPrice={resolvedUnderlyingPrice}
          loading={chainLoading}
          error={chainError}
          availableExpirations={mergedExpirations}
          selectedExpiration={selectedExpiration}
          onExpirationChange={handleExpirationChange}
          selectedContract={selectedLeg}
          onContractSelect={handleContractSelection}
        />
      </div>
    </div>
  );

  return (
    <div className="h-screen w-full flex flex-col bg-gray-950 text-gray-100">
      <TradingHeader
        selectedTicker={normalizedTicker}
        onTickerSubmit={value => {
          const normalized = value.trim().toUpperCase();
          if (!normalized) return;
          setTicker(normalized);
          if (normalized.startsWith('O:')) {
            pendingSelectionRef.current.contract = normalized;
            pendingSelectionRef.current.expiration = parseOptionExpirationFromTicker(normalized);
            setDesiredContract(normalized);
          } else {
            pendingSelectionRef.current.contract = null;
            pendingSelectionRef.current.expiration = null;
            setDesiredContract(null);
          }
        }}
        onAddToWatchlist={addTickerToWatchlist}
        currentView={view}
        onViewChange={setView}
        onToggleSidebar={() => setSidebarOpen(prev => !prev)}
        onToggleChat={() => setIsChatOpen(prev => !prev)}
        isChatOpen={isChatOpen}
      />

      <div className="flex flex-1 overflow-hidden bg-gray-950 relative">
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/60 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        <aside
          className={`fixed inset-y-0 left-0 z-30 w-72 transform transition-transform duration-300 bg-gray-950 border-r border-gray-900 lg:static lg:z-0 lg:w-72 lg:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          }`}
        >
          <div className="h-full overflow-y-auto px-2">{sidebar}</div>
        </aside>

        <main className="flex-1 overflow-y-auto">
          <div className="w-full max-w-screen-2xl mx-auto px-4 py-6 flex flex-col gap-4">
            {marketError && (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 text-sm text-red-300 px-4 py-3">
                {marketError}
              </div>
            )}

            {view === 'trading' && tradingView}
            {view === 'scanner' && (
              <div className="pb-24">
                <OptionsScanner
                  reports={scannerReports}
                  isLoading={scannerLoading}
                  highlights={checklistHighlights}
                  highlightLoading={checklistLoading}
                  onTickerSelect={value => {
                    setTicker(value);
                    setView('trading');
                  }}
                />
              </div>
            )}
            {view === 'portfolio' && (
              <div className="pb-24">
                <PortfolioPanel />
              </div>
            )}
          </div>
        </main>
      </div>

      <ChatDock
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        conversations={conversations}
        transcripts={transcripts}
        activeConversationId={activeConversationId}
        onConversationSelect={id => {
          handleConversationSelect(id);
        }}
        onRequestNewChat={startNewConversation}
        onMessagesChange={handleMessagesChange}
        onConversationUpdate={handleConversationUpdate}
        onAssistantReply={setLatestInsight}
        latestInsight={latestInsight}
        selectedTicker={displayTicker}
      />
    </div>
  );
}

export default App;

// Initialize a new blank conversation entry the dock can display immediately.
function createConversation(
  title = 'New chat',
  preview = 'Ask the desk anything to get started.'
): ConversationMeta {
  const sessionId = crypto.randomUUID();
  const timestamp = Date.now();
  return {
    id: sessionId,
    sessionId,
    title,
    preview,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

// Clean API payloads to ensure the rest of the app sees consistent conversation data.
function normalizeConversation(payload: ConversationPayload): ConversationMeta {
  return {
    id: payload.sessionId,
    sessionId: payload.sessionId,
    title: payload.title || 'New chat',
    preview: payload.preview || 'Ask the agent anything to get started.',
    createdAt: Date.parse(payload.createdAt),
    updatedAt: Date.parse(payload.updatedAt),
  };
}

// Transform raw conversation response objects into the simplified chat message model.
function mapMessages(response: ConversationResponse): ChatMessage[] {
  return (response.messages ?? []).map(message => ({
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: Date.parse(message.timestamp),
  }));
}

// Walk all expiration groups/strikes to locate a matching option leg.
function findLegByTicker(groups: OptionChainExpirationGroup[], ticker: string): OptionLeg | null {
  const normalized = ticker.toUpperCase();
  for (const group of groups) {
    for (const row of group.strikes) {
      if (row.call && row.call.ticker.toUpperCase() === normalized) return row.call;
      if (row.put && row.put.ticker.toUpperCase() === normalized) return row.put;
    }
  }
  return null;
}

// Convert an option leg returned by the chain API into the richer Details shape.
function optionLegToContractDetail(leg: OptionLeg): OptionContractDetail {
  const greeks = {
    ...(leg.greeks ?? {}),
    ...(typeof leg.delta === 'number' ? { delta: leg.delta } : {}),
    ...(typeof leg.gamma === 'number' ? { gamma: leg.gamma } : {}),
    ...(typeof leg.theta === 'number' ? { theta: leg.theta } : {}),
    ...(typeof leg.vega === 'number' ? { vega: leg.vega } : {}),
    ...(typeof leg.rho === 'number' ? { rho: leg.rho } : {}),
  };
  return {
    ticker: leg.ticker,
    underlying: leg.underlying,
    expiration: leg.expiration,
    type: leg.type,
    strike: leg.strike,
    openInterest: leg.openInterest ?? undefined,
    breakEvenPrice: leg.breakeven ?? undefined,
    impliedVolatility: leg.iv ?? undefined,
    day: {
      change: leg.change ?? null,
      change_percent: leg.changePercent ?? null,
      volume: leg.volume ?? null,
      open_interest: leg.openInterest ?? null,
    },
    greeks,
    lastQuote: {
      bid: leg.bid ?? undefined,
      ask: leg.ask ?? undefined,
      mid: leg.mid ?? undefined,
      mark: leg.mark ?? undefined,
    },
    lastTrade: leg.lastTrade
      ? {
          price: leg.lastTrade.price ?? undefined,
          size: leg.lastTrade.size ?? undefined,
          sip_timestamp: leg.lastTrade.sip_timestamp ?? undefined,
        }
      : undefined,
  };
}

// Extract YYYY-MM-DD expiration dates from OCC-formatted symbols (O:XYZ...).
function parseOptionExpirationFromTicker(symbol: string | null | undefined): string | null {
  if (!symbol) return null;
  const match = symbol.toUpperCase().match(/O:[A-Z0-9\.]+(\d{6})([CP])/);
  if (!match) return null;
  const raw = match[1];
  const year = Number(raw.slice(0, 2));
  const month = raw.slice(2, 4);
  const day = raw.slice(4, 6);
  if (Number.isNaN(year) || Number.isNaN(Number(month)) || Number.isNaN(Number(day))) {
    return null;
  }
  const fullYear = 2000 + year;
  return `${fullYear}-${month}-${day}`;
}
