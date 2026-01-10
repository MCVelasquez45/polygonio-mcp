import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { TradingHeader } from './components/layout/TradingHeader';
import { TradingSidebar } from './components/layout/TradingSidebar';
import { ChartPanel } from './components/trading/ChartPanel';
import { GreeksPanel } from './components/options/GreeksPanel';
import { OrderTicketPanel } from './components/trading/OrderTicketPanel';
import { OptionsChainPanel } from './components/options/OptionsChainPanel';
import { OptionsScanner } from './components/screener/OptionsScanner';
import { PortfolioPanel } from './components/portfolio/PortfolioPanel';
import { ChatDock } from './components/chat/ChatDock';
import { analysisApi, chatApi, marketApi } from './api';
import { computeExpirationDte } from './utils/expirations';
import { getApiBaseUrl } from './api/http';
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
import type { ChecklistResult, DeskInsight, WatchlistReport, ContractSelectionResult } from './api/analysis';
import type { ChatContext, ChatMessage, ConversationMeta, ConversationPayload, ConversationResponse } from './types';

// Map timeframe choices in the UI to the aggregate query parameters expected by the API.
const TIMEFRAME_MAP = {
  '1/minute': { multiplier: 1, timespan: 'minute' as const, window: 390 },
  '3/minute': { multiplier: 3, timespan: 'minute' as const, window: 130 },
  '5/minute': { multiplier: 5, timespan: 'minute' as const, window: 78 },
  '15/minute': { multiplier: 15, timespan: 'minute' as const, window: 26 },
  '30/minute': { multiplier: 30, timespan: 'minute' as const, window: 13 },
  '1/hour': { multiplier: 1, timespan: 'hour' as const, window: 7 },
  '1/day': { multiplier: 1, timespan: 'day' as const, window: 180 },
};
const AGG_TIMESTAMP_MS_THRESHOLD = 1_000_000_000_000;

// Default lookback window for the simple moving average indicator.
const SMA_WINDOW = 50;
const MAX_TRADE_HISTORY = 200;
const LIVE_STALE_TTL_MS = 60_000;
const LIVE_HEALTH_CHECK_INTERVAL_MS = 30_000;
const LIVE_CHAIN_STRIKE_ROWS = 3;
const DESK_INSIGHT_DEBOUNCE_MS = 500;
const DESK_INSIGHT_TTL_MS = 30 * 60 * 1000;
const DESK_INSIGHT_THROTTLE_MS = 30_000;
const CONTRACT_SELECTION_THROTTLE_MS = 30_000;
const AUTO_DESK_INSIGHTS_KEY = 'market-copilot.autoDeskInsights';
const AUTO_CONTRACT_SELECTION_KEY = 'market-copilot.autoContractSelection';

function parseAggregateTimestamp(value: string | number): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < AGG_TIMESTAMP_MS_THRESHOLD ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric < AGG_TIMESTAMP_MS_THRESHOLD ? numeric * 1000 : numeric;
    }
  }
  return null;
}

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

function isAbortError(error: any): boolean {
  return error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' || error?.name === 'AbortError';
}

// Bundle any indicators we currently support so the chart can render overlays.
function buildIndicatorBundle(symbol: string, bars: AggregateBar[]): IndicatorBundle | undefined {
  if (!bars.length) return undefined;
  return {
    ticker: symbol,
    sma: computeSMA(bars),
  };
}

function readStoredBoolean(key: string, fallback: boolean) {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.localStorage.getItem(key);
    if (value == null) return fallback;
    return value === 'true';
  } catch {
    return fallback;
  }
}

type View = 'trading' | 'scanner' | 'portfolio';
type TimeframeKey = keyof typeof TIMEFRAME_MAP;
type PreferredSide = 'call' | 'put' | null;
type LiveTradePrint = TradePrint & { ticker: string };
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
  const [aiRequestWarning, setAiRequestWarning] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [transcripts, setTranscripts] = useState<Record<string, ChatMessage[]>>({});
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [latestInsight, setLatestInsight] = useState('');
  const [deskInsight, setDeskInsight] = useState<DeskInsight | null>(null);
  const [deskInsightLoading, setDeskInsightLoading] = useState(false);
  const [deskInsightUpdatedAt, setDeskInsightUpdatedAt] = useState<number | null>(null);
  const deskInsightCacheRef = useRef<Map<string, { insight: DeskInsight; fetchedAt: number }>>(new Map());
  const deskInsightThrottleRef = useRef<Map<string, number>>(new Map());
  const [deskInsightRefreshId, setDeskInsightRefreshId] = useState(0);
  const deskInsightRefreshRef = useRef(0);
  const deskInsightDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoDeskInsights, setAutoDeskInsights] = useState(() => readStoredBoolean(AUTO_DESK_INSIGHTS_KEY, false));
  const [autoContractSelection, setAutoContractSelection] = useState(() => readStoredBoolean(AUTO_CONTRACT_SELECTION_KEY, false));
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
  const [scannerRefreshId, setScannerRefreshId] = useState(0);
  const scannerRequestIdRef = useRef(0);
  const checklistRequestIdRef = useRef(0);
  const lastScannerRefreshRef = useRef(0);
  const lastChecklistRefreshRef = useRef(0);
  const [liveSocketConnected, setLiveSocketConnected] = useState(false);
  const [liveSubscriptionActive, setLiveSubscriptionActive] = useState(false);
  const [lastLiveQuoteAt, setLastLiveQuoteAt] = useState<number | null>(null);
  const [lastLiveTradeAt, setLastLiveTradeAt] = useState<number | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [liveChainQuotes, setLiveChainQuotes] = useState<Record<string, QuoteSnapshot>>({});
  const [liveChainTrades, setLiveChainTrades] = useState<Record<string, TradePrint>>({});
  const liveChainSymbolsRef = useRef<Set<string>>(new Set());
  const contractDetailCacheRef = useRef<Map<string, OptionContractDetail>>(new Map());
  const [contractSelection, setContractSelection] = useState<ContractSelectionResult | null>(null);
  const [contractSelectionLoading, setContractSelectionLoading] = useState(false);
  const [contractSelectionRequestId, setContractSelectionRequestId] = useState(0);
  const contractSelectionRequestRef = useRef(0);
  const lastContractSelectionRequestRef = useRef(0);
  const contractSelectionThrottleRef = useRef<Map<string, number>>(new Map());
  const autoContractSelectionKeyRef = useRef<string | null>(null);
  const [contractAnalysisRequestId, setContractAnalysisRequestId] = useState(0);
  const selectionSourceRef = useRef<'auto' | 'user' | null>(null);

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

  const handleDeskInsightRefresh = useCallback(() => {
    setDeskInsightRefreshId(prev => prev + 1);
  }, []);

  const handleScannerRefresh = useCallback(() => {
    setScannerRefreshId(prev => prev + 1);
  }, []);

  const handleContractSelectionRequest = useCallback(() => {
    setContractSelectionRequestId(prev => prev + 1);
  }, []);

  const handleContractAnalysisRequest = useCallback(() => {
    setContractAnalysisRequestId(prev => prev + 1);
  }, []);

  const handleAiLimit = useCallback((error: any) => {
    if (error?.response?.status !== 429) return false;
    const baseMessage = error?.response?.data?.error ?? 'AI request limit reached.';
    const retryAfterMs = error?.response?.data?.retryAfterMs;
    const retryLabel =
      typeof retryAfterMs === 'number' && retryAfterMs > 0
        ? ` Retry in ${Math.ceil(retryAfterMs / 1000)}s.`
        : '';
    setAiRequestWarning(`${baseMessage}${retryLabel}`);
    return true;
  }, []);

  const watchlistSignature = watchlistSymbols.join(',');
  const deskInsightSymbol = useMemo(() => {
    if (normalizedTicker.startsWith('O:')) {
      return extractUnderlyingFromOptionTicker(normalizedTicker) ?? normalizedTicker;
    }
    return normalizedTicker;
  }, [normalizedTicker]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(AUTO_DESK_INSIGHTS_KEY, String(autoDeskInsights));
    } catch {
      // ignore persistence failures
    }
  }, [autoDeskInsights]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(AUTO_CONTRACT_SELECTION_KEY, String(autoContractSelection));
    } catch {
      // ignore persistence failures
    }
  }, [autoContractSelection]);

  useEffect(() => {
    if (autoContractSelection) return;
    autoContractSelectionKeyRef.current = null;
  }, [autoContractSelection]);

  // Whenever the watchlist contents change, refresh the scanner reports for those tickers.
  // Fetch the option chain whenever the ticker or selected expiration changes.
  // Reset derived state when the user changes tickers (fresh bars, selection, etc.).
  // Persist the currently selected leg so it can be restored on next load.
  // Fetch aggregate bars/indicators for the active ticker/timeframe with caching + polling.
  // Establish Socket.IO connection for live Massive feed.
  useEffect(() => {
    const baseUrl = getApiBaseUrl();
    const parsed = typeof window !== 'undefined' ? new URL(baseUrl, window.location.href) : null;
    const isMixedContent =
      typeof window !== 'undefined' &&
      window.location.protocol === 'https:' &&
      parsed?.protocol === 'http:';
    const socket = io(baseUrl, {
      transports: isMixedContent ? ['polling'] : ['websocket', 'polling'],
      upgrade: !isMixedContent,
      withCredentials: false,
      path: '/socket.io',
      timeout: 10_000,
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 5_000
    });
    socketRef.current = socket;

    const forcePolling = () => {
      const opts = socket.io.opts;
      if (opts.transports?.length === 1 && opts.transports[0] === 'polling') return;
      opts.transports = ['polling'];
      opts.upgrade = false;
      if (socket.connected) {
        socket.disconnect();
      }
      socket.connect();
    };

    socket.on('connect', () => {
      setLiveSocketConnected(true);
    });
    socket.on('connect_error', error => {
      const description =
        typeof (error as { description?: unknown })?.description === 'string'
          ? (error as { description?: string }).description
          : undefined;
      console.warn('[CLIENT] live feed connect error', {
        message: error?.message,
        ...(description ? { description } : {})
      });
      const shouldForcePolling = isMixedContent || String(error?.message ?? '').toLowerCase().includes('websocket');
      if (shouldForcePolling) {
        forcePolling();
      }
    });
    socket.on('disconnect', () => {
      setLiveSocketConnected(false);
      setLiveSubscriptionActive(false);
    });
    socket.on('live:error', payload => {
      console.warn('[CLIENT] live feed error', payload);
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
      setLiveSocketConnected(false);
      setLiveSubscriptionActive(false);
    };
  }, []);

  // Manage live feed events for the active contract + near-the-money strip.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !liveSocketConnected) return;
    const activeSymbol = activeContractSymbol?.toUpperCase() ?? null;
    if (!activeSymbol) {
      setLiveSubscriptionActive(false);
    }

    const resolveSymbol = (payload: any) =>
      typeof payload === 'string' ? payload.toUpperCase() : normalizeLiveSymbol(payload);

    const handleSubscribed = (payload: any) => {
      const ackSymbol = resolveSymbol(payload?.symbol ?? payload?.sym ?? payload);
      if (ackSymbol && activeSymbol && ackSymbol === activeSymbol) {
        setLiveSubscriptionActive(true);
      }
    };

    const handleUnsubscribed = (payload: any) => {
      const ackSymbol = resolveSymbol(payload?.symbol ?? payload?.sym ?? payload);
      if (ackSymbol && activeSymbol && ackSymbol === activeSymbol) {
        setLiveSubscriptionActive(false);
      }
    };

    const handleQuote = (payload: any) => {
      const normalized = normalizeLiveQuote(payload);
      if (!normalized) return;
      setLiveChainQuotes(prev => ({ ...prev, [normalized.ticker]: normalized }));
      if (activeSymbol && normalized.ticker === activeSymbol) {
        setQuote(normalized);
        setLastLiveQuoteAt(Date.now());
        setLiveSubscriptionActive(true);
      }
    };

    const handleTrade = (payload: any) => {
      const normalized = normalizeLiveTrade(payload);
      if (!normalized) return;
      if (!normalized.ticker) return;
      setLiveChainTrades(prev => ({ ...prev, [normalized.ticker]: normalized }));
      if (activeSymbol && normalized.ticker === activeSymbol) {
        setTrades(prev => {
          if (prev.length > 0 && prev[0]?.id === normalized.id) return prev;
          return [normalized, ...prev].slice(0, MAX_TRADE_HISTORY);
        });
        setLastLiveTradeAt(Date.now());
        setLiveSubscriptionActive(true);
      }
    };

    socket.on('live:subscribed', handleSubscribed);
    socket.on('live:unsubscribed', handleUnsubscribed);
    socket.on('live:quote', handleQuote);
    socket.on('live:trades', handleTrade);

    return () => {
      socket.off('live:subscribed', handleSubscribed);
      socket.off('live:unsubscribed', handleUnsubscribed);
      socket.off('live:quote', handleQuote);
      socket.off('live:trades', handleTrade);
    };
  }, [activeContractSymbol, liveSocketConnected]);

  // Reset scanner data when the watchlist changes; run scans on demand.
  useEffect(() => {
    if (!watchlistSignature) {
      setScannerReports([]);
      setChecklistHighlights({});
      setScannerLoading(false);
      setChecklistLoading(false);
      return;
    }
    setScannerReports([]);
    setChecklistHighlights({});
  }, [watchlistSignature]);

  // Load the AI desk insight for the active ticker.
  useEffect(() => {
    if (!deskInsightSymbol) {
      setDeskInsight(null);
      setDeskInsightLoading(false);
      setDeskInsightUpdatedAt(null);
      return;
    }
    const now = Date.now();
    const cachedEntry = deskInsightCacheRef.current.get(deskInsightSymbol);
    const cacheFresh = cachedEntry ? now - cachedEntry.fetchedAt < DESK_INSIGHT_TTL_MS : false;
    if (cachedEntry) {
      setDeskInsight(cachedEntry.insight);
      setDeskInsightUpdatedAt(cachedEntry.fetchedAt);
    } else {
      setDeskInsightUpdatedAt(null);
    }
    const refreshRequested = deskInsightRefreshRef.current !== deskInsightRefreshId;
    if (refreshRequested) {
      deskInsightRefreshRef.current = deskInsightRefreshId;
    }
    const shouldFetch = refreshRequested || (autoDeskInsights && !cacheFresh);
    if (!shouldFetch) {
      setDeskInsightLoading(false);
      return;
    }
    const lastFetchAt = deskInsightThrottleRef.current.get(deskInsightSymbol) ?? 0;
    if (now - lastFetchAt < DESK_INSIGHT_THROTTLE_MS) {
      setDeskInsightLoading(false);
      return;
    }
    if (deskInsightDebounceRef.current) {
      clearTimeout(deskInsightDebounceRef.current);
    }
    let cancelled = false;
    const controller = new AbortController();
    setDeskInsightLoading(true);
    deskInsightDebounceRef.current = setTimeout(() => {
      const startedAt = Date.now();
      deskInsightThrottleRef.current.set(deskInsightSymbol, startedAt);
      analysisApi
        .getDeskInsight(deskInsightSymbol, controller.signal)
        .then(response => {
          if (cancelled) return;
          deskInsightCacheRef.current.set(deskInsightSymbol, { insight: response, fetchedAt: startedAt });
          setDeskInsight(response);
          setDeskInsightUpdatedAt(startedAt);
        })
        .catch(error => {
          if (cancelled) return;
          if (isAbortError(error)) return;
          if (handleAiLimit(error)) return;
          console.warn('Failed to load AI desk insight', error);
          setDeskInsight(null);
        })
        .finally(() => {
          if (!cancelled) {
            setDeskInsightLoading(false);
          }
        });
    }, DESK_INSIGHT_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      if (deskInsightDebounceRef.current) {
        clearTimeout(deskInsightDebounceRef.current);
      }
      controller.abort();
    };
  }, [deskInsightSymbol, deskInsightRefreshId, autoDeskInsights, handleAiLimit]);

  useEffect(() => {
    if (!scannerRefreshId) return;
    if (lastScannerRefreshRef.current === scannerRefreshId) return;
    lastScannerRefreshRef.current = scannerRefreshId;
    if (!watchlistSignature) {
      setScannerReports([]);
      setScannerLoading(false);
      return;
    }
    const requestId = ++scannerRequestIdRef.current;
    let cancelled = false;
    const controller = new AbortController();
    setScannerLoading(true);
    analysisApi
      .getWatchlistReports(watchlistSymbols, controller.signal)
      .then(response => {
        if (cancelled || requestId !== scannerRequestIdRef.current) return;
        setScannerReports(response.reports ?? []);
      })
      .catch(error => {
        if (cancelled || requestId !== scannerRequestIdRef.current) return;
        if (isAbortError(error)) return;
        if (handleAiLimit(error)) return;
        console.warn('Failed to load watchlist reports', error);
        setScannerReports([]);
      })
      .finally(() => {
        if (!cancelled && requestId === scannerRequestIdRef.current) {
          setScannerLoading(false);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [scannerRefreshId, watchlistSignature, watchlistSymbols, handleAiLimit]);

  // Run the entry checklist scan for the current watchlist on demand.
  useEffect(() => {
    if (!scannerRefreshId) return;
    if (lastChecklistRefreshRef.current === scannerRefreshId) return;
    lastChecklistRefreshRef.current = scannerRefreshId;
    if (!watchlistSignature) {
      setChecklistHighlights({});
      setChecklistLoading(false);
      return;
    }
    const requestId = ++checklistRequestIdRef.current;
    let cancelled = false;
    const controller = new AbortController();
    setChecklistLoading(true);
    analysisApi
      .runChecklist(watchlistSymbols, false, controller.signal)
      .then(response => {
        if (cancelled || requestId !== checklistRequestIdRef.current) return;
        const nextMap: Record<string, ChecklistResult> = {};
        (response.results ?? []).forEach(result => {
          if (!result?.symbol) return;
          nextMap[result.symbol.toUpperCase()] = result;
        });
        setChecklistHighlights(nextMap);
      })
      .catch(error => {
        if (cancelled || requestId !== checklistRequestIdRef.current) return;
        if (isAbortError(error)) return;
        if (handleAiLimit(error)) return;
        console.warn('Failed to load checklist highlights', error);
        setChecklistHighlights({});
      })
      .finally(() => {
        if (!cancelled && requestId === checklistRequestIdRef.current) {
          setChecklistLoading(false);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [scannerRefreshId, watchlistSignature, watchlistSymbols, handleAiLimit]);


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
      selectionSourceRef.current = 'auto';
      setSelectedLeg(matching);
      if (pendingSelectionRef.current.contract?.toUpperCase() === desiredContract.toUpperCase()) {
        pendingSelectionRef.current.contract = null;
      }
    }
  }, [chainExpirations, desiredContract, selectedLeg]);

  // If the selected leg no longer exists in the current chain, clear it so auto-select can run.
  useEffect(() => {
    if (!selectedLeg) return;
    if (!chainExpirations.length) return;
    const normalizedUnderlying = normalizedTicker.startsWith('O:')
      ? extractUnderlyingFromOptionTicker(normalizedTicker)
      : normalizedTicker;
    const selectedUnderlying =
      selectedLeg.underlying ?? extractUnderlyingFromOptionTicker(selectedLeg.ticker);
    if (
      normalizedUnderlying &&
      selectedUnderlying &&
      selectedUnderlying.toUpperCase() !== normalizedUnderlying.toUpperCase()
    ) {
      setSelectedLeg(null);
      return;
    }
    const inChain = findLegByTicker(chainExpirations, selectedLeg.ticker);
    if (!inChain) {
      setSelectedLeg(null);
    }
  }, [selectedLeg, chainExpirations, normalizedTicker]);

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
    const baseDetail = optionLegToContractDetail(selectedLeg);
    setContractDetail(baseDetail);

    const symbol = selectedLeg.ticker.toUpperCase();
    const cached = contractDetailCacheRef.current.get(symbol);
    if (cached) {
      setContractDetail(mergeContractDetail(baseDetail, cached));
      return;
    }

    const needsGreeks = !hasGreekValues(baseDetail.greeks);
    const needsIv = baseDetail.impliedVolatility == null;
    const needsOi = baseDetail.openInterest == null;
    if (!needsGreeks && !needsIv && !needsOi) return;

    let cancelled = false;
    marketApi
      .getOptionContractDetail(symbol)
      .then(detail => {
        if (cancelled) return;
        const merged = mergeContractDetail(baseDetail, detail);
        contractDetailCacheRef.current.set(symbol, merged);
        setContractDetail(merged);
      })
      .catch(error => {
        if (cancelled) return;
        console.warn('Failed to load contract details', error);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedLeg]);

  const chartTicker = useMemo(() => {
    if (!normalizedTicker) return null;
    if (!normalizedTicker.startsWith('O:')) {
      return normalizedTicker;
    }
    const legUnderlying = selectedLeg?.underlying?.toUpperCase();
    if (legUnderlying) return legUnderlying;
    const detailUnderlying = contractDetail?.underlying?.toUpperCase();
    if (detailUnderlying) return detailUnderlying;
    const parsed = extractUnderlyingFromOptionTicker(normalizedTicker);
    if (parsed) return parsed;
    if (underlyingSnapshot && underlyingSnapshot.entryType === 'underlying') {
      return underlyingSnapshot.ticker.toUpperCase();
    }
    return normalizedTicker.slice(2);
  }, [normalizedTicker, selectedLeg?.underlying, contractDetail?.underlying, underlyingSnapshot]);

  useEffect(() => {
    const symbol = chartTicker;
    const contractSymbol = activeContractSymbol?.trim().toUpperCase() ?? null;
    const config = TIMEFRAME_MAP[timeframe] ?? TIMEFRAME_MAP['5/minute'];
    const isIntraday = config.timespan === 'minute' || config.timespan === 'hour';
    const requestSymbol = symbol ?? contractSymbol;
    if (!requestSymbol) {
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
    const cacheKey = `${requestSymbol}-${timeframe}`;
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
      const intradaySourceNote = isIntraday ? `Intraday candles are rendered from ${requestSymbol}.` : null;

      const fetchAggregates = async () => {
        const response = await marketApi.getAggregates({
          ticker: requestSymbol,
          multiplier: config.multiplier,
          timespan: config.timespan,
          window: config.window ?? 180,
        });
        return response;
      };

      const runFetch = async () => {
        const aggregates = await fetchAggregates();
        if (chartRequestIdRef.current !== requestId) return;
        const bars = (aggregates.results ?? [])
          .map(entry => {
            const timestamp = parseAggregateTimestamp(entry.t);
            if (timestamp == null) return null;
            return {
              timestamp,
              open: entry.o,
              high: entry.h,
              low: entry.l,
              close: entry.c,
              volume: entry.v
            };
          })
          .filter((bar): bar is AggregateBar => Boolean(bar));
        const indicatorBundle = buildIndicatorBundle(requestSymbol, bars);
        setBars(bars);
        setIndicators(indicatorBundle);
        const nextError =
          aggregates.note ?? (bars.length === 0 ? `No aggregate data available for ${requestSymbol} (${timeframe}).` : null);
        const note = nextError ?? intradaySourceNote;
        const sessionMeta: MarketSessionMeta = {
          marketClosed: Boolean(aggregates.marketClosed),
          afterHours: Boolean(aggregates.afterHours),
          usingLastSession: Boolean(aggregates.usingLastSession),
          resultGranularity: aggregates.resultGranularity ?? 'intraday',
          note,
          state: aggregates.marketStatus?.state,
          nextOpen: aggregates.marketStatus?.nextOpen ?? null,
          nextClose: aggregates.marketStatus?.nextClose ?? null,
          fetchedAt: aggregates.marketStatus?.asOf ?? aggregates.fetchedAt ?? undefined
        };
        chartCacheRef.current.set(cacheKey, {
          bars,
          indicators: indicatorBundle,
          timestamp: Date.now(),
          note,
          session: sessionMeta
        });
        setMarketSessionMeta(sessionMeta);
        setMarketError(note);
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
    const refreshMs =
      config.timespan === 'minute'
        ? Math.max(30_000, config.multiplier * 60_000)
        : config.timespan === 'hour'
        ? config.multiplier * 3_600_000
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
  }, [chartTicker, timeframe, activeContractSymbol]);

  useEffect(() => {
    if (!activeContractSymbol) {
      setQuote(null);
      setTrades([]);
      return;
    }
    const symbol = activeContractSymbol.toUpperCase();
    let cancelled = false;
    let fetching = false;

    const loadSnapshots = async (reason: 'initial' | 'fallback') => {
      if (cancelled || fetching) return;
      fetching = true;
      try {
        const [tradesPayload, quotePayload] = await Promise.all([
          marketApi.getTrades(symbol),
          marketApi.getQuote(symbol),
        ]);
        if (!cancelled) {
          setTrades((tradesPayload.trades ?? []).slice(0, MAX_TRADE_HISTORY));
          setQuote(quotePayload);
          if (reason === 'fallback') {
            console.debug('[CLIENT] fallback snapshot refreshed', { symbol, trades: tradesPayload.trades?.length ?? 0 });
          }
        }
      } catch (error: any) {
        if (!cancelled) {
          const message = error?.response?.data?.error ?? error?.message ?? 'Failed to load market snapshots';
          setMarketError(message);
        }
      } finally {
        fetching = false;
      }
    };

    const shouldFallback = () => {
      const marketClosed = Boolean(marketSessionMeta?.marketClosed);
      const allowFallbackWhileClosed = !marketClosed || !liveSubscriptionActive;
      if (!allowFallbackWhileClosed) return false;
      if (!liveSocketConnected || !liveSubscriptionActive) return true;
      const now = Date.now();
      const lastUpdate = Math.max(lastLiveQuoteAt ?? 0, lastLiveTradeAt ?? 0);
      if (!lastUpdate) return true;
      return now - lastUpdate > LIVE_STALE_TTL_MS;
    };

    const interval = setInterval(() => {
      if (cancelled) return;
      if (shouldFallback()) {
        void loadSnapshots('fallback');
      }
    }, LIVE_HEALTH_CHECK_INTERVAL_MS);

    void loadSnapshots('initial');

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    activeContractSymbol,
    liveSocketConnected,
    liveSubscriptionActive,
    lastLiveQuoteAt,
    lastLiveTradeAt,
    marketSessionMeta?.marketClosed
  ]);

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

  async function handleConversationDelete(id: string) {
    const convo = conversations.find(item => item.id === id);
    if (!convo) return;
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Delete this chat? This cannot be undone.');
      if (!confirmed) return;
    }
    try {
      await chatApi.deleteConversation(convo.sessionId);
    } catch (error) {
      console.warn('Failed to delete conversation', error);
    }
    const remaining = conversations.filter(item => item.id !== id);
    setConversations(remaining);
    setTranscripts(prev => {
      const next = { ...prev };
      delete next[convo.sessionId];
      transcriptsRef.current = next;
      return next;
    });
    if (activeConversationId === id) {
      const nextActive = remaining[0]?.id ?? null;
      setActiveConversationId(nextActive);
      setLatestInsight(nextActive ? remaining[0]?.preview ?? '' : '');
      if (nextActive) {
        void ensureTranscriptLoaded(remaining[0].sessionId);
      }
    }
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
      onRequestAutoSelect={handleContractSelectionRequest}
      autoSelectDisabled={contractSelectionLoading || !chainExpirations.length}
    />
  );

  // When the user chooses a contract in the chain, sync selection + expiration state.
  const handleContractSelection = useCallback(
    (leg: OptionLeg | null, source: 'auto' | 'user' = 'user') => {
      selectionSourceRef.current = source;
      setSelectedLeg(leg);
      if (source === 'user') {
        setContractSelection(null);
      }
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

  const preferredOptionSide = useMemo(() => {
    const sentiment = deskInsight?.sentiment?.label?.toLowerCase() ?? null;
    const shortBias = deskInsight?.shortBias?.label?.toLowerCase() ?? null;
    if (sentiment === 'bullish') return 'call';
    if (sentiment === 'bearish') return 'put';
    if (shortBias === 'bullish') return 'call';
    if (shortBias === 'bearish') return 'put';
    return null;
  }, [deskInsight]);

  useEffect(() => {
    if (!chainExpirations.length || !preferredOptionSide) return;
    const selectedType = selectedLeg?.type?.toLowerCase() ?? null;
    const biasMismatch =
      preferredOptionSide && selectedType ? preferredOptionSide !== selectedType : false;
    if (selectedLeg && selectionSourceRef.current === 'user') return;
    if (selectedLeg && !biasMismatch) return;

    const candidates = buildContractCandidates(
      chainExpirations,
      selectedExpiration,
      resolvedUnderlyingPrice,
      preferredOptionSide
    );
    const filtered = applyContractConstraints(candidates);
    const fallback = findPreferredLeg(
      chainExpirations,
      selectedExpiration,
      resolvedUnderlyingPrice,
      preferredOptionSide
    );
    if (!fallback) return;
    if (fallback.ticker !== selectedLeg?.ticker) {
      const warnings = filtered.length
        ? ['Baseline selection applied. Use AI selection for a refined pick.']
        : ['No candidates met liquidity/delta constraints. Baseline selection used.'];
      setContractSelection({
        selectedContract: fallback.ticker,
        side: preferredOptionSide,
        confidence: null,
        reasons: ['Deterministic selection (AI not invoked).'],
        warnings,
        source: 'fallback'
      });
      handleContractSelection(fallback, 'auto');
    }
  }, [
    selectedLeg,
    chainExpirations,
    selectedExpiration,
    preferredOptionSide,
    resolvedUnderlyingPrice,
    handleContractSelection,
    deskInsightSymbol,
    deskInsight?.sentiment?.label
  ]);

  useEffect(() => {
    if (!autoContractSelection) return;
    if (!chainExpirations.length || !preferredOptionSide) return;
    if (selectedLeg && selectionSourceRef.current === 'user') return;
    const selectionKey = `${deskInsightSymbol}-${preferredOptionSide}-${selectedExpiration ?? 'auto'}`;
    if (autoContractSelectionKeyRef.current === selectionKey) return;
    autoContractSelectionKeyRef.current = selectionKey;
    setContractSelectionRequestId(prev => prev + 1);
  }, [
    autoContractSelection,
    chainExpirations,
    preferredOptionSide,
    selectedExpiration,
    deskInsightSymbol,
    selectedLeg
  ]);

  useEffect(() => {
    if (!contractSelectionRequestId) return;
    if (lastContractSelectionRequestRef.current === contractSelectionRequestId) return;
    lastContractSelectionRequestRef.current = contractSelectionRequestId;
    if (!chainExpirations.length || !preferredOptionSide) return;

    const candidates = buildContractCandidates(
      chainExpirations,
      selectedExpiration,
      resolvedUnderlyingPrice,
      preferredOptionSide
    );
    const filtered = applyContractConstraints(candidates);
    if (!filtered.length) {
      const fallback = findPreferredLeg(
        chainExpirations,
        selectedExpiration,
        resolvedUnderlyingPrice,
        preferredOptionSide
      );
      setContractSelection({
        selectedContract: fallback?.ticker ?? null,
        side: preferredOptionSide,
        confidence: null,
        reasons: ['No candidates met liquidity/delta constraints.'],
        warnings: ['Using baseline selection instead of AI.'],
        source: 'fallback'
      });
      if (fallback && fallback.ticker !== selectedLeg?.ticker) {
        handleContractSelection(fallback, 'auto');
      }
      return;
    }

    const selectionKey = `${deskInsightSymbol}-${preferredOptionSide}-${selectedExpiration ?? 'auto'}`;
    const now = Date.now();
    const lastRequestedAt = contractSelectionThrottleRef.current.get(selectionKey) ?? 0;
    if (now - lastRequestedAt < CONTRACT_SELECTION_THROTTLE_MS) {
      setContractSelectionLoading(false);
      return;
    }
    contractSelectionThrottleRef.current.set(selectionKey, now);

    const requestId = ++contractSelectionRequestRef.current;
    let cancelled = false;
    const controller = new AbortController();
    setContractSelectionLoading(true);
    analysisApi
      .selectContract({
        ticker: deskInsightSymbol,
        underlyingPrice: resolvedUnderlyingPrice ?? null,
        sentiment: (deskInsight?.sentiment?.label?.toLowerCase() as 'bullish' | 'bearish' | 'neutral') ?? 'neutral',
        candidates: filtered
      }, controller.signal)
      .then(selection => {
        if (cancelled || requestId !== contractSelectionRequestRef.current) return;
        setContractSelection(selection);
        const selectedSymbol = selection.selectedContract?.toUpperCase();
        if (!selectedSymbol) return;
        const match = findLegByTicker(chainExpirations, selectedSymbol);
        if (match && match.ticker !== selectedLeg?.ticker) {
          handleContractSelection(match, 'auto');
        }
      })
      .catch(error => {
        if (cancelled || requestId !== contractSelectionRequestRef.current) return;
        if (isAbortError(error)) return;
        if (handleAiLimit(error)) return;
        console.warn('AI contract selection failed', error);
        setContractSelection({
          selectedContract: null,
          side: preferredOptionSide,
          confidence: null,
          reasons: ['AI selection failed.'],
          warnings: ['Using fallback selection.'],
          source: 'fallback'
        });
        const fallback = findPreferredLeg(
          chainExpirations,
          selectedExpiration,
          resolvedUnderlyingPrice,
          preferredOptionSide
        );
        if (fallback && fallback.ticker !== selectedLeg?.ticker) {
          handleContractSelection(fallback, 'auto');
        }
      })
      .finally(() => {
        if (!cancelled && requestId === contractSelectionRequestRef.current) {
          setContractSelectionLoading(false);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    contractSelectionRequestId,
    chainExpirations,
    selectedExpiration,
    resolvedUnderlyingPrice,
    preferredOptionSide,
    deskInsightSymbol,
    deskInsight?.sentiment?.label,
    handleContractSelection,
    selectedLeg,
    handleAiLimit
  ]);

  const deskSummary = deskInsight?.summary || latestInsight;
  const sentimentLabel = deskInsight?.sentiment?.label ?? null;
  const sentimentScore = deskInsight?.sentiment?.score ?? null;
  const sentimentTone = sentimentLabel ? sentimentLabel.toLowerCase() : 'neutral';
  const sentimentStyles =
    sentimentTone === 'bullish'
      ? 'border-emerald-500/30 text-emerald-200 bg-emerald-500/10'
      : sentimentTone === 'bearish'
      ? 'border-rose-500/30 text-rose-200 bg-rose-500/10'
      : 'border-gray-800 text-gray-300 bg-gray-900/60';
  const sentimentDot =
    sentimentTone === 'bullish' ? 'bg-emerald-400' : sentimentTone === 'bearish' ? 'bg-rose-400' : 'bg-gray-500';
  const sentimentText =
    sentimentLabel && sentimentScore != null
      ? `${sentimentLabel} (${sentimentScore.toFixed(2)})`
      : sentimentLabel ?? (sentimentScore != null ? sentimentScore.toFixed(2) : null);
  const fedEvent = deskInsight?.fedEvent ?? null;
  const deskHighlights = (deskInsight?.highlights ?? []).slice(0, 3);
  const deskInsightUpdatedLabel = deskInsightUpdatedAt ? new Date(deskInsightUpdatedAt).toLocaleTimeString() : null;

  // Subscribe to a near-the-money strip so the chain shows live prices.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !liveSocketConnected) return;
    const nextSymbols = buildNearMoneySymbols(
      chainExpirations,
      selectedExpiration,
      resolvedUnderlyingPrice,
      LIVE_CHAIN_STRIKE_ROWS
    );
    if (activeContractSymbol?.startsWith('O:')) {
      nextSymbols.add(activeContractSymbol.toUpperCase());
    }

    const prevSymbols = liveChainSymbolsRef.current;
    const removed: string[] = [];
    nextSymbols.forEach(symbol => {
      if (!prevSymbols.has(symbol)) {
        socket.emit('live:subscribe', { symbol });
      }
    });
    prevSymbols.forEach(symbol => {
      if (!nextSymbols.has(symbol)) {
        socket.emit('live:unsubscribe', { symbol });
        removed.push(symbol);
      }
    });
    if (removed.length) {
      setLiveChainQuotes(prev => {
        const next = { ...prev };
        removed.forEach(symbol => delete next[symbol]);
        return next;
      });
      setLiveChainTrades(prev => {
        const next = { ...prev };
        removed.forEach(symbol => delete next[symbol]);
        return next;
      });
    }
    liveChainSymbolsRef.current = nextSymbols;
  }, [
    liveSocketConnected,
    activeContractSymbol,
    chainExpirations,
    selectedExpiration,
    resolvedUnderlyingPrice
  ]);

  const aiContext = useMemo(
    () =>
      buildAiContext({
        view,
        selectedTicker: displayTicker,
        chartTicker,
        timeframe,
        bars,
        indicators,
        selectedLeg,
        contractDetail,
        watchlistSymbols,
        marketSessionMeta,
        underlyingPrice: resolvedUnderlyingPrice,
      }),
    [
      view,
      displayTicker,
      chartTicker,
      timeframe,
      bars,
      indicators,
      selectedLeg,
      contractDetail,
      watchlistSymbols,
      marketSessionMeta,
      resolvedUnderlyingPrice,
    ]
  );

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
        <div className="bg-gray-950 border border-gray-900 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Latest Insight</p>
              <p className="text-sm text-gray-400">AI desk notes for {deskInsightSymbol}</p>
              {deskInsightUpdatedLabel && (
                <p className="text-[11px] text-gray-500">Last updated {deskInsightUpdatedLabel}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDeskInsightRefresh}
                disabled={deskInsightLoading}
                className="px-3 py-1 rounded-full border border-gray-800 text-xs text-gray-300 hover:border-emerald-500/40 hover:text-white disabled:opacity-60"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => setIsChatOpen(true)}
                className="px-3 py-1 rounded-full border border-emerald-500/40 text-xs text-emerald-300 hover:bg-emerald-500/10"
              >
                Ask AI
              </button>
            </div>
          </div>
          {deskInsightLoading ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-3 w-3/4 rounded bg-gray-800" />
              <div className="h-3 w-1/2 rounded bg-gray-800" />
              <div className="h-3 w-2/3 rounded bg-gray-800" />
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-200 whitespace-pre-line">
                {deskSummary || `No notes yet. Open the AI desk to ask about ${deskInsightSymbol} or any spread.`}
              </p>
              {(sentimentText || fedEvent) && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {sentimentText && (
                    <span className={`inline-flex items-center gap-2 rounded-full border px-2 py-1 ${sentimentStyles}`}>
                      <span className={`h-2 w-2 rounded-full ${sentimentDot}`} />
                      Sentiment: {sentimentText}
                    </span>
                  )}
                  {fedEvent && (
                    <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-200">
                      Fed: {fedEvent.title ?? fedEvent.name ?? 'Upcoming event'} · {fedEvent.date ?? 'TBD'}
                    </span>
                  )}
                </div>
              )}
              {deskHighlights.length ? (
                <ul className="space-y-1 text-xs text-gray-300">
                  {deskHighlights.map(item => (
                    <li key={item} className="flex items-start gap-2">
                      <span className="text-emerald-300">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>
        <GreeksPanel
          contract={contractDetail}
          leg={selectedLeg}
          label={displayTicker}
          underlyingPrice={greeksUnderlyingPrice}
          insight={deskInsight}
          selection={contractSelection}
          selectionLoading={contractSelectionLoading}
          onRequestSelection={handleContractSelectionRequest}
          analysisRequestId={contractAnalysisRequestId}
        />
      </div>
      <div className="lg:col-span-1 min-h-[26rem] min-w-0">
        <OrderTicketPanel
          contract={contractDetail}
          quote={quote}
          trades={trades}
          isLoading={false}
          label={displayTicker}
          spotPrice={resolvedUnderlyingPrice}
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
          liveQuotes={liveChainQuotes}
          liveTrades={liveChainTrades}
          selectedContractDetail={contractDetail}
          preferredSide={preferredOptionSide}
          onRequestAnalysis={handleContractAnalysisRequest}
          analysisDisabled={!selectedLeg && !contractDetail}
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
        onToggleSettings={() => setSettingsOpen(prev => !prev)}
        isSettingsOpen={settingsOpen}
      />
      {settingsOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-950 p-5 space-y-4"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Settings</p>
                <h2 className="text-lg font-semibold">AI Request Controls</h2>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-full border border-gray-800 px-3 py-1 text-xs text-gray-300 hover:border-emerald-500/40 hover:text-white"
              >
                Close
              </button>
            </div>
            <div className="space-y-4 text-sm text-gray-300">
              <label className="flex items-center justify-between gap-4 rounded-2xl border border-gray-900 bg-gray-950/60 px-4 py-3">
                <span>
                  <span className="block text-sm font-semibold text-white">Auto desk insights</span>
                  <span className="block text-xs text-gray-500">Automatically fetch AI insight when you change tickers.</span>
                </span>
                <input
                  type="checkbox"
                  checked={autoDeskInsights}
                  onChange={event => setAutoDeskInsights(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-700 bg-gray-900 text-emerald-500 focus:ring-emerald-500"
                />
              </label>
              <label className="flex items-center justify-between gap-4 rounded-2xl border border-gray-900 bg-gray-950/60 px-4 py-3">
                <span>
                  <span className="block text-sm font-semibold text-white">Auto contract selection</span>
                  <span className="block text-xs text-gray-500">Let AI pick a contract when the chain loads.</span>
                </span>
                <input
                  type="checkbox"
                  checked={autoContractSelection}
                  onChange={event => setAutoContractSelection(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-700 bg-gray-900 text-emerald-500 focus:ring-emerald-500"
                />
              </label>
            </div>
          </div>
        </div>
      )}

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
            {aiRequestWarning && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 text-sm text-amber-100 px-4 py-3 flex items-start justify-between gap-4">
                <span>{aiRequestWarning}</span>
                <button
                  type="button"
                  onClick={() => setAiRequestWarning(null)}
                  className="text-xs uppercase tracking-[0.2em] text-amber-200 hover:text-white"
                >
                  Dismiss
                </button>
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
                  onRunScan={handleScannerRefresh}
                  runDisabled={!watchlistSymbols.length}
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
        onConversationDelete={handleConversationDelete}
        latestInsight={latestInsight}
        selectedTicker={displayTicker}
        context={aiContext}
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

type OptionSidePreference = 'call' | 'put' | null;

function scoreLeg(leg: OptionLeg, underlyingPrice: number | null) {
  let score = 0;
  const delta = typeof leg.delta === 'number' ? Math.abs(leg.delta) : null;
  if (delta != null) {
    const deltaGap = Math.abs(delta - 0.6);
    score += Math.max(0, 1 - deltaGap / 0.4) * 4;
  }
  const spread =
    typeof leg.bid === 'number' && typeof leg.ask === 'number' ? leg.ask - leg.bid : null;
  if (spread != null) {
    score += spread <= 0.3 ? 2 : spread <= 0.6 ? 1 : 0;
  }
  if (typeof leg.openInterest === 'number') {
    score += leg.openInterest >= 500 ? 2 : leg.openInterest >= 200 ? 1 : 0;
  }
  if (underlyingPrice != null && typeof leg.strike === 'number') {
    const distance = Math.abs(leg.strike - underlyingPrice);
    const range = underlyingPrice * 0.1;
    score += range > 0 ? Math.max(0, 1 - distance / range) : 0;
  }
  if (typeof leg.iv === 'number') {
    const ivPct = leg.iv * 100;
    if (ivPct > 120) score -= 1;
  }
  return score;
}

function findPreferredLeg(
  groups: OptionChainExpirationGroup[],
  preferredExpiration: string | null,
  underlyingPrice: number | null,
  preferredSide: OptionSidePreference
): OptionLeg | null {
  if (!groups.length) return null;
  const ordered = preferredExpiration
    ? [
        ...groups.filter(group => group.expiration === preferredExpiration),
        ...groups.filter(group => group.expiration !== preferredExpiration),
      ]
    : groups;
  for (const group of ordered) {
    let bestLeg: OptionLeg | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const row of group.strikes) {
      const candidates: OptionLeg[] = [];
      if (preferredSide === 'call' && row.call) candidates.push(row.call);
      if (preferredSide === 'put' && row.put) candidates.push(row.put);
      if (preferredSide == null) {
        if (row.call) candidates.push(row.call);
        if (row.put) candidates.push(row.put);
      }
      for (const leg of candidates) {
        const score = scoreLeg(leg, underlyingPrice);
        if (score > bestScore) {
          bestScore = score;
          bestLeg = leg;
        }
      }
    }
    if (bestLeg) return bestLeg;
  }
  return null;
}

function buildContractCandidates(
  groups: OptionChainExpirationGroup[],
  preferredExpiration: string | null,
  underlyingPrice: number | null,
  preferredSide: PreferredSide
) {
  if (!groups.length) return [];
  const activeGroup =
    preferredExpiration != null
      ? groups.find(group => group.expiration === preferredExpiration) ?? groups[0]
      : groups[0];
  if (!activeGroup) return [];
  const strikes = activeGroup.strikes
    .map(row => ({
      strike: row.strike ?? row.call?.strike ?? row.put?.strike ?? null,
      call: row.call ?? null,
      put: row.put ?? null
    }))
    .filter(entry => entry.strike != null)
    .sort((a, b) => {
      if (underlyingPrice == null) return 0;
      return Math.abs((a.strike ?? 0) - underlyingPrice) - Math.abs((b.strike ?? 0) - underlyingPrice);
    })
    .slice(0, 10);

  const candidates: Array<{
    symbol: string;
    type: 'call' | 'put';
    strike: number;
    expiration: string;
    delta: number | null;
    bid: number | null;
    ask: number | null;
    spread: number | null;
    openInterest: number | null;
    volume: number | null;
    iv: number | null;
    dte: number | null;
  }> = [];

  strikes.forEach(entry => {
    if (entry.call && (!preferredSide || preferredSide === 'call')) {
      const spread =
        typeof entry.call.bid === 'number' && typeof entry.call.ask === 'number'
          ? entry.call.ask - entry.call.bid
          : null;
      candidates.push({
        symbol: entry.call.ticker,
        type: 'call',
        strike: entry.call.strike ?? entry.strike ?? 0,
        expiration: entry.call.expiration,
        delta: typeof entry.call.delta === 'number' ? entry.call.delta : null,
        bid: typeof entry.call.bid === 'number' ? entry.call.bid : null,
        ask: typeof entry.call.ask === 'number' ? entry.call.ask : null,
        spread,
        openInterest: typeof entry.call.openInterest === 'number' ? entry.call.openInterest : null,
        volume: typeof entry.call.volume === 'number' ? entry.call.volume : null,
        iv: typeof entry.call.iv === 'number' ? entry.call.iv : null,
        dte: computeExpirationDte(entry.call.expiration)
      });
    }
    if (entry.put && (!preferredSide || preferredSide === 'put')) {
      const spread =
        typeof entry.put.bid === 'number' && typeof entry.put.ask === 'number'
          ? entry.put.ask - entry.put.bid
          : null;
      candidates.push({
        symbol: entry.put.ticker,
        type: 'put',
        strike: entry.put.strike ?? entry.strike ?? 0,
        expiration: entry.put.expiration,
        delta: typeof entry.put.delta === 'number' ? entry.put.delta : null,
        bid: typeof entry.put.bid === 'number' ? entry.put.bid : null,
        ask: typeof entry.put.ask === 'number' ? entry.put.ask : null,
        spread,
        openInterest: typeof entry.put.openInterest === 'number' ? entry.put.openInterest : null,
        volume: typeof entry.put.volume === 'number' ? entry.put.volume : null,
        iv: typeof entry.put.iv === 'number' ? entry.put.iv : null,
        dte: computeExpirationDte(entry.put.expiration)
      });
    }
  });

  return candidates;
}

function applyContractConstraints(candidates: ReturnType<typeof buildContractCandidates>) {
  return candidates.filter(candidate => {
    if (candidate.spread != null && candidate.spread > 0.5) return false;
    if (candidate.openInterest != null && candidate.openInterest < 250) return false;
    if (candidate.delta != null) {
      const absDelta = Math.abs(candidate.delta);
      if (absDelta < 0.4 || absDelta > 0.7) return false;
    }
    if (candidate.dte != null && (candidate.dte < 7 || candidate.dte > 45)) return false;
    return true;
  });
}

function buildNearMoneySymbols(
  groups: OptionChainExpirationGroup[],
  selectedExpiration: string | null,
  underlyingPrice: number | null,
  maxRows: number
): Set<string> {
  if (!groups.length || underlyingPrice == null) return new Set();
  const activeGroup =
    selectedExpiration != null
      ? groups.find(group => group.expiration === selectedExpiration) ?? groups[0]
      : groups[0];
  if (!activeGroup) return new Set();
  const ranked = activeGroup.strikes
    .map(row => {
      const strike = row.strike ?? row.call?.strike ?? row.put?.strike ?? null;
      const distance = strike != null ? Math.abs(strike - underlyingPrice) : Number.POSITIVE_INFINITY;
      return { row, strike, distance };
    })
    .filter(entry => entry.strike != null)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.max(1, maxRows));

  const symbols = new Set<string>();
  ranked.forEach(entry => {
    const callTicker = entry.row.call?.ticker;
    const putTicker = entry.row.put?.ticker;
    if (callTicker) symbols.add(callTicker.toUpperCase());
    if (putTicker) symbols.add(putTicker.toUpperCase());
  });
  return symbols;
}

type AiContextInput = {
  view: View;
  selectedTicker: string;
  chartTicker: string | null;
  timeframe: TimeframeKey;
  bars: AggregateBar[];
  indicators?: IndicatorBundle;
  selectedLeg?: OptionLeg | null;
  contractDetail?: OptionContractDetail | null;
  watchlistSymbols: string[];
  marketSessionMeta?: MarketSessionMeta | null;
  underlyingPrice: number | null;
};

function buildAiContext({
  view,
  selectedTicker,
  chartTicker,
  timeframe,
  bars,
  indicators,
  selectedLeg,
  contractDetail,
  watchlistSymbols,
  marketSessionMeta,
  underlyingPrice,
}: AiContextInput): ChatContext {
  const lastClose = bars.length ? bars[bars.length - 1].close : null;
  const indicatorSummary = summarizeIndicators(indicators);
  const chartContext = {
    symbol: chartTicker ?? selectedTicker,
    timeframe,
    barCount: bars.length,
    lastClose,
    underlyingPrice,
    indicators: indicatorSummary ?? undefined,
  };

  const optionContext = buildOptionContext(selectedLeg, contractDetail);
  const marketContext = marketSessionMeta
    ? {
        state: marketSessionMeta.state,
        marketClosed: marketSessionMeta.marketClosed,
        afterHours: marketSessionMeta.afterHours,
      }
    : undefined;

  return {
    view,
    selectedTicker,
    chart: chartContext,
    option: optionContext ?? undefined,
    market: marketContext,
    watchlist: watchlistSymbols.length ? watchlistSymbols.slice(0, 12) : undefined,
  };
}

function summarizeIndicators(
  indicators?: IndicatorBundle
): { name: string; latest: number | null; trend: string | null }[] | null {
  if (!indicators) return null;
  const summary: { name: string; latest: number | null; trend: string | null }[] = [];
  for (const [key, value] of Object.entries(indicators)) {
    if (key === 'ticker') continue;
    if (!value || typeof value !== 'object') continue;
    const latest = typeof value.latest === 'number' ? value.latest : null;
    const trend = typeof value.trend === 'string' ? value.trend : null;
    if (latest == null && trend == null) continue;
    summary.push({ name: key.toUpperCase(), latest, trend });
  }
  return summary.length ? summary : null;
}

function buildOptionContext(
  leg?: OptionLeg | null,
  detail?: OptionContractDetail | null
): ChatContext['option'] | null {
  if (!leg && !detail) return null;
  const greeks = summarizeGreeks(leg, detail);
  return {
    ticker: detail?.ticker ?? leg?.ticker,
    underlying: detail?.underlying ?? leg?.underlying,
    expiration: detail?.expiration ?? leg?.expiration,
    strike: detail?.strike ?? leg?.strike,
    type: detail?.type ?? leg?.type,
    iv: pickNumber(detail?.impliedVolatility, leg?.iv),
    openInterest: pickNumber(detail?.openInterest, leg?.openInterest),
    greeks: greeks ?? undefined,
  };
}

function summarizeGreeks(
  leg?: OptionLeg | null,
  detail?: OptionContractDetail | null
): { delta: number | null; gamma: number | null; theta: number | null; vega: number | null; rho: number | null } | null {
  const delta = pickNumber(detail?.greeks?.delta, leg?.delta, leg?.greeks?.delta);
  const gamma = pickNumber(detail?.greeks?.gamma, leg?.gamma, leg?.greeks?.gamma);
  const theta = pickNumber(detail?.greeks?.theta, leg?.theta, leg?.greeks?.theta);
  const vega = pickNumber(detail?.greeks?.vega, leg?.vega, leg?.greeks?.vega);
  const rho = pickNumber(detail?.greeks?.rho, leg?.rho, leg?.greeks?.rho);
  if ([delta, gamma, theta, vega, rho].every(value => value == null)) {
    return null;
  }
  return { delta, gamma, theta, vega, rho };
}

function pickNumber(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
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

function hasGreekValues(greeks?: Record<string, number>): boolean {
  if (!greeks) return false;
  return (['delta', 'gamma', 'theta', 'vega', 'rho'] as const).some(key => {
    const value = greeks[key];
    return typeof value === 'number' && Number.isFinite(value);
  });
}

function mergeContractDetail(base: OptionContractDetail, incoming?: OptionContractDetail | null): OptionContractDetail {
  if (!incoming) return base;
  const mergedGreeks = { ...(base.greeks ?? {}), ...(incoming.greeks ?? {}) };
  const mergedDay = { ...(base.day ?? {}), ...(incoming.day ?? {}) };
  const mergedQuote = { ...(base.lastQuote ?? {}), ...(incoming.lastQuote ?? {}) };
  const mergedTrade = { ...(base.lastTrade ?? {}), ...(incoming.lastTrade ?? {}) };

  return {
    ticker: incoming.ticker ?? base.ticker,
    underlying: incoming.underlying ?? base.underlying,
    expiration: incoming.expiration ?? base.expiration,
    type: incoming.type ?? base.type,
    strike: incoming.strike ?? base.strike,
    openInterest: incoming.openInterest ?? base.openInterest,
    breakEvenPrice: incoming.breakEvenPrice ?? base.breakEvenPrice,
    impliedVolatility: incoming.impliedVolatility ?? base.impliedVolatility,
    day: Object.keys(mergedDay).length ? mergedDay : base.day,
    greeks: Object.keys(mergedGreeks).length ? mergedGreeks : base.greeks,
    lastQuote: Object.keys(mergedQuote).length ? mergedQuote : base.lastQuote,
    lastTrade: Object.keys(mergedTrade).length ? mergedTrade : base.lastTrade,
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

function extractUnderlyingFromOptionTicker(symbol: string | null | undefined): string | null {
  if (!symbol) return null;
  const match = symbol.toUpperCase().match(/^O:([A-Z0-9\.]+)\d{6}[CP]/);
  if (match) return match[1];
  if (symbol.startsWith('O:')) {
    return symbol.slice(2).replace(/\d.*$/, '') || null;
  }
  return null;
}

function normalizeLiveQuote(event: any): QuoteSnapshot | null {
  if (!event) return null;
  const ticker = normalizeLiveSymbol(event);
  if (!ticker) return null;
  const bidPrice = coerceNumber(event.bp ?? event.bidPrice);
  const askPrice = coerceNumber(event.ap ?? event.askPrice);
  const bidSize = coerceNumber(event.bs ?? event.bidSize);
  const askSize = coerceNumber(event.as ?? event.askSize);
  const timestamp = coerceTimestamp(event.t ?? event.ts ?? event.timestamp ?? event.receivedAt);
  const spread = bidPrice != null && askPrice != null ? Math.max(0, askPrice - bidPrice) : null;
  const midpoint =
    bidPrice != null && askPrice != null ? (bidPrice + askPrice) / 2 : bidPrice ?? askPrice ?? null;

  return {
    ticker,
    timestamp,
    bidPrice,
    askPrice,
    bidSize,
    askSize,
    bidExchange: event.bx ?? event.bidExchange ?? undefined,
    askExchange: event.ax ?? event.askExchange ?? undefined,
    spread,
    midpoint,
    updated: timestamp,
    quotes: undefined,
  };
}

function normalizeLiveTrade(event: any): LiveTradePrint | null {
  if (!event) return null;
  const ticker = normalizeLiveSymbol(event);
  if (!ticker) return null;
  const price = coerceNumber(event.p ?? event.price);
  if (price == null) return null;
  const size = coerceNumber(event.s ?? event.size) ?? 0;
  const timestamp = coerceTimestamp(event.t ?? event.ts ?? event.timestamp ?? event.receivedAt);
  const exchange = event.x ?? event.exchange ?? null;
  const idSource = event.i ?? event.id ?? `${ticker}-${timestamp}-${price}-${size}`;
  const conditionsSource = Array.isArray(event.c) ? event.c : Array.isArray(event.conditions) ? event.conditions : null;

  return {
    id: String(idSource),
    ticker,
    price,
    size,
    timestamp,
    exchange: exchange != null ? String(exchange) : undefined,
    conditions: conditionsSource ? conditionsSource.map((value: any) => String(value)) : undefined,
  };
}

function normalizeLiveSymbol(event: any): string | null {
  if (!event) return null;
  const candidate = event.symbol ?? event.sym ?? event.ticker;
  if (typeof candidate !== 'string') return null;
  const normalized = candidate.trim().toUpperCase();
  return normalized ? normalized : null;
}

function coerceNumber(value: any): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coerceTimestamp(value: any): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > 10_000_000_000 ? numeric : numeric * 1000;
    }
  }
  return Date.now();
}
