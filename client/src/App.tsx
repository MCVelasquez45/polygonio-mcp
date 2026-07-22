import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Info, RotateCcw, X } from 'lucide-react';
import type { Socket } from 'socket.io-client';
import { Toaster } from 'sonner';
import { getSharedSocket } from './lib/socket';
import {
  publishQuote,
  publishTrade,
  replaceTradeHistory,
  removeSymbols as removeLiveSymbols,
} from './lib/liveMarketStore';
import type { UTCTimestamp, SeriesMarker } from 'lightweight-charts';
import { TradingHeader } from './components/layout/TradingHeader';
import { TradingSidebar } from './components/layout/TradingSidebar';
import { NavRail } from './components/layout/NavRail';
import { MobileShell } from './components/layout/MobileShell';
import type { MobileTab } from './components/layout/MobileTabBar';
import { MarketContextBar } from './components/layout/MarketContextBar';
import { CommandPalette } from './components/layout/CommandPalette';
import { ChatBot } from './components/chat/ChatBot';
import { useIsMobile } from './hooks/useMediaQuery';
import { ChartPanel } from './components/trading/ChartPanel';
import { GreeksPanel } from './components/options/GreeksPanel';
import { OrderTicketPanel } from './components/trading/OrderTicketPanel';
import { OptionsChainPanel } from './components/options/OptionsChainPanel';
import { PriceLadder } from './components/options/PriceLadder';
import { ChatDock } from './components/chat/ChatDock';

// Route-level code splitting: the heavy switchable views load on demand, so the
// initial (trading) bundle no longer ships Scanner + Portfolio + Cockpit +
// Intelligence + Operations up front. Named exports are adapted to the
// default-export shape React.lazy expects.
const OptionsScanner = lazy(() => import('./components/screener/OptionsScanner').then(m => ({ default: m.OptionsScanner })));
const PortfolioPanel = lazy(() => import('./components/portfolio/PortfolioPanel').then(m => ({ default: m.PortfolioPanel })));
const CockpitLayout = lazy(() => import('./components/cockpit/CockpitLayout').then(m => ({ default: m.CockpitLayout })));
const TradingIntelligencePage = lazy(() => import('./components/intelligence/TradingIntelligencePage').then(m => ({ default: m.TradingIntelligencePage })));
const SystemOperationsPage = lazy(() => import('./components/operations/SystemOperationsPage').then(m => ({ default: m.SystemOperationsPage })));
import { analysisApi, chatApi, marketApi } from './api';
import {
  LEGACY_SUBMISSION_DISABLED_MESSAGE,
  classifyOrderHistoryError,
  getOptionOrdersForPolling,
} from './api/orderHistory';
import { computeExpirationDte } from './utils/expirations';
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
import { acquireLiveMarketSubscription } from './hooks/useCockpitLiveSubscription';

// Map timeframe choices in the UI to the aggregate query parameters expected by the API.
const TIMEFRAME_MAP = {
  '1/minute': { multiplier: 1, timespan: 'minute' as const, window: 390 },
  '3/minute': { multiplier: 3, timespan: 'minute' as const, window: 130 },
  '5/minute': { multiplier: 5, timespan: 'minute' as const, window: 78 },
  '15/minute': { multiplier: 15, timespan: 'minute' as const, window: 26 },
  '30/minute': { multiplier: 30, timespan: 'minute' as const, window: 13 },
  '1/hour': { multiplier: 1, timespan: 'hour' as const, window: 24 },
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
const CHART_ANALYSIS_MINUTE_WINDOW = 1_200;
const AI_FEATURES_ENABLED_KEY = 'market-copilot.aiEnabled';
const AI_DESK_INSIGHTS_ENABLED_KEY = 'market-copilot.aiDeskInsightsEnabled';
const AI_CONTRACT_SELECTION_ENABLED_KEY = 'market-copilot.aiContractSelectionEnabled';
const AI_CONTRACT_ANALYSIS_ENABLED_KEY = 'market-copilot.aiContractAnalysisEnabled';
const AI_SCANNER_ENABLED_KEY = 'market-copilot.aiScannerEnabled';
const AI_PORTFOLIO_SENTIMENT_ENABLED_KEY = 'market-copilot.aiPortfolioSentimentEnabled';
const AI_CHAT_ENABLED_KEY = 'market-copilot.aiChatEnabled';
const AI_CHART_ANALYSIS_ENABLED_KEY = 'market-copilot.aiChartAnalysisEnabled';
const CHART_SESSION_MODE_KEY = 'market-copilot.chartSessionMode';
const AUTO_DESK_INSIGHTS_KEY = 'market-copilot.autoDeskInsights';
const AUTO_CONTRACT_SELECTION_KEY = 'market-copilot.autoContractSelection';
const AUTO_SCANNER_ENABLED_KEY = 'market-copilot.autoScannerEnabled';
const OPENING_RANGE_START_MINUTES = 9 * 60 + 30;
const OPENING_RANGE_END_MINUTES = 9 * 60 + 35;
const NY_TIMEZONE = 'America/New_York';

type ChartAnalysis = {
  headline: string;
  bullets: string[];
};

const NY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});



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

function normalizeAggregateBars(results: Array<{ t: string | number; o: number; h: number; l: number; c: number; v: number }>) {
  return (results ?? [])
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
}

function normalizeChartBars(bars: ChartCandle[]): AggregateBar[] {
  return (bars ?? [])
    .map(bar => toAggregateBar(bar))
    .filter((bar): bar is AggregateBar => Boolean(bar))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function toAggregateBar(candle: ChartCandle | null | undefined): AggregateBar | null {
  if (!candle) return null;
  if (![candle.o, candle.h, candle.l, candle.c, candle.v].every(value => Number.isFinite(value))) return null;
  if (!Number.isFinite(candle.t)) return null;
  return {
    timestamp: candle.t,
    open: candle.o,
    high: candle.h,
    low: candle.l,
    close: candle.c,
    volume: candle.v,
    isFinal: candle.isFinal,
    source: candle.source,
    lastUpdatedAt: candle.lastUpdatedAt
  };
}

function upsertChartBar(current: AggregateBar[], nextBar: AggregateBar): AggregateBar[] {
  if (!current.length) return [nextBar];
  const next = current.slice();
  const index = next.findIndex(bar => bar.timestamp === nextBar.timestamp);
  if (index >= 0) {
    next[index] = nextBar;
  } else {
    next.push(nextBar);
  }
  next.sort((a, b) => a.timestamp - b.timestamp);
  return next;
}

function getNyParts(timestamp: number) {
  const parts = NY_FORMATTER.formatToParts(new Date(timestamp));
  const bucket: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      bucket[part.type] = part.value;
    }
  }
  const year = bucket.year ?? '';
  const month = bucket.month ?? '';
  const day = bucket.day ?? '';
  const hour = Number(bucket.hour);
  const minute = Number(bucket.minute);
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) {
    return null;
  }
  return {
    dateKey: `${year}-${month}-${day}`,
    hour,
    minute
  };
}

function computeOpeningRange(bars: AggregateBar[]) {
  if (!bars.length) return null;
  const ranges = new Map<string, { high: number; low: number }>();
  for (const bar of bars) {
    const parts = getNyParts(bar.timestamp);
    if (!parts) continue;
    const minuteOfDay = parts.hour * 60 + parts.minute;
    if (minuteOfDay < OPENING_RANGE_START_MINUTES || minuteOfDay >= OPENING_RANGE_END_MINUTES) continue;
    const existing = ranges.get(parts.dateKey);
    if (!existing) {
      ranges.set(parts.dateKey, { high: bar.high, low: bar.low });
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
    }
  }
  if (!ranges.size) return null;
  const sessionKey = Array.from(ranges.keys()).sort().at(-1);
  if (!sessionKey) return null;
  const range = ranges.get(sessionKey);
  if (!range) return null;
  return { sessionKey, high: range.high, low: range.low };
}

type FiveMinuteBucket = {
  index: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function buildFiveMinuteBuckets(bars: AggregateBar[], sessionKey: string): FiveMinuteBucket[] {
  const buckets = new Map<number, FiveMinuteBucket>();
  for (const bar of bars) {
    const parts = getNyParts(bar.timestamp);
    if (!parts || parts.dateKey !== sessionKey) continue;
    const minuteOfDay = parts.hour * 60 + parts.minute;
    const minutesSinceOpen = minuteOfDay - OPENING_RANGE_START_MINUTES;
    if (minutesSinceOpen < 0) continue;
    const index = Math.floor(minutesSinceOpen / 5);
    const existing = buckets.get(index);
    if (!existing) {
      buckets.set(index, {
        index,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume
      });
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      existing.volume += bar.volume;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.index - b.index);
}

function computeTrend(bars: AggregateBar[], thresholdPct = 0.4) {
  if (bars.length < 2) return 'unknown';
  const first = bars[0]?.close ?? null;
  const last = bars.at(-1)?.close ?? null;
  if (first == null || last == null || first === 0) return 'unknown';
  const pct = ((last - first) / first) * 100;
  if (pct > thresholdPct) return 'up';
  if (pct < -thresholdPct) return 'down';
  return 'flat';
}

function formatPrice(value: number | null | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return `$${value.toFixed(2)}`;
}

function selectRegularSessionBars(bars: AggregateBar[]) {
  const sessions = new Map<string, AggregateBar[]>();
  for (const bar of bars) {
    const parts = getNyParts(bar.timestamp);
    if (!parts) continue;
    const minuteOfDay = parts.hour * 60 + parts.minute;
    if (minuteOfDay < OPENING_RANGE_START_MINUTES || minuteOfDay >= 16 * 60) continue;
    const bucket = sessions.get(parts.dateKey);
    if (bucket) {
      bucket.push(bar);
    } else {
      sessions.set(parts.dateKey, [bar]);
    }
  }
  if (!sessions.size) return [];
  const latestSessionKey = Array.from(sessions.keys()).sort().at(-1);
  if (!latestSessionKey) return [];
  return sessions.get(latestSessionKey) ?? [];
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

function readStoredSessionMode(key: string, fallback: ChartSessionMode): ChartSessionMode {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value === 'regular' || value === 'extended' ? value : fallback;
  } catch {
    return fallback;
  }
}

type View = 'trading' | 'portfolio' | 'cockpit' | 'intelligence' | 'operations';
type TimeframeKey = keyof typeof TIMEFRAME_MAP;
type PreferredSide = 'call' | 'put' | null;
type LiveTradePrint = TradePrint & { ticker: string };
type ChartSessionMode = 'regular' | 'extended';
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
  health?: {
    mode: 'LIVE' | 'DEGRADED' | 'BACKFILLING' | 'FROZEN';
    source: 'rest' | 'cache' | 'snapshot' | 'ws';
    lastUpdateMsAgo: number | null;
    providerThrottled: boolean;
    gapsDetected: number;
  } | null;
};

type ChartCandle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  isFinal?: boolean;
  source?: AggregateBar['source'];
  lastUpdatedAt?: number;
};

type ChartSnapshotPayload = {
  symbol: string;
  timeframe: string;
  bars: ChartCandle[];
  health: MarketSessionMeta['health'] | null;
  session: MarketSessionMeta | null;
};

type ChartUpdatePayload = {
  symbol: string;
  timeframe: string;
  bar: ChartCandle;
  health: MarketSessionMeta['health'] | null;
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

// Root component controlling the workstation views. Manages data
// fetching, caches, and cross-panel selection state.
function App() {
  const [view, setView] = useState<View>('trading');
  const [ticker, setTicker] = useState('SPY');
  const normalizedTicker = ticker.trim().toUpperCase() || 'SPY';

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Phone companion shell: an entirely separate layout below `md`, not a
  // squeezed workstation. Desktop state (view) is untouched by mobile tabs.
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<MobileTab>('trade');
  const [agentLaunch, setAgentLaunch] = useState<{ agentId: string; label: string; nonce: number } | null>(null);

  // Keyboard-first navigation: ⌘K / Ctrl-K toggles the command palette from
  // anywhere in the workstation.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        setCommandPaletteOpen(open => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Option chain state (expirations + selected leg/contract).
  const [chainExpirations, setChainExpirations] = useState<OptionChainExpirationGroup[]>([]);
  const [chainUnderlyingPrice, setChainUnderlyingPrice] = useState<number | null>(null);
  const [chainLoading, setChainLoading] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  const lastChainRef = useRef<{
    ticker: string;
    groups: OptionChainExpirationGroup[];
    underlyingPrice: number | null;
  } | null>(null);
  const skipChainFetchRef = useRef(false);
  const [availableExpirations, setAvailableExpirations] = useState<string[]>([]);
  const [customExpirations, setCustomExpirations] = useState<string[]>([]);
  const [selectedExpiration, setSelectedExpiration] = useState<string | null>(null);
  const invalidExpirationsRef = useRef<Set<string>>(new Set());

  const [selectedLeg, setSelectedLeg] = useState<OptionLeg | null>(null);
  const [desiredContract, setDesiredContract] = useState<string | null>(null);
  const activeContractSymbol = selectedLeg?.ticker ?? null;
  const activeContractSymbolRef = useRef<string | null>(null);

  const [contractDetail, setContractDetail] = useState<OptionContractDetail | null>(null);

  // Chart + indicator caches for the selected underlying.
  const [timeframe, setTimeframe] = useState<TimeframeKey>('1/day');
  const [bars, setBars] = useState<AggregateBar[]>([]);
  const [indicators, setIndicators] = useState<IndicatorBundle>();
  const [chartLoading, setChartLoading] = useState(false);
  const [chartAnalysis, setChartAnalysis] = useState<ChartAnalysis | null>(null);
  const [chartAnalysisLoading, setChartAnalysisLoading] = useState(false);
  const [chartAnalysisError, setChartAnalysisError] = useState<string | null>(null);
  const [chartAnalysisUpdatedAt, setChartAnalysisUpdatedAt] = useState<number | null>(null);

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
  const [aiEnabled, setAiEnabled] = useState(() => readStoredBoolean(AI_FEATURES_ENABLED_KEY, true));
  const [aiDeskInsightsEnabled, setAiDeskInsightsEnabled] = useState(() => readStoredBoolean(AI_DESK_INSIGHTS_ENABLED_KEY, true));
  const [aiContractSelectionEnabled, setAiContractSelectionEnabled] = useState(() => readStoredBoolean(AI_CONTRACT_SELECTION_ENABLED_KEY, true));
  const [aiContractAnalysisEnabled, setAiContractAnalysisEnabled] = useState(() => readStoredBoolean(AI_CONTRACT_ANALYSIS_ENABLED_KEY, true));
  const [aiScannerEnabled, setAiScannerEnabled] = useState(() => readStoredBoolean(AI_SCANNER_ENABLED_KEY, true));
  const [aiPortfolioSentimentEnabled, setAiPortfolioSentimentEnabled] = useState(() => readStoredBoolean(AI_PORTFOLIO_SENTIMENT_ENABLED_KEY, true));
  const [aiChatEnabled, setAiChatEnabled] = useState(() => readStoredBoolean(AI_CHAT_ENABLED_KEY, true));
  const [aiChartAnalysisEnabled, setAiChartAnalysisEnabled] = useState(() => readStoredBoolean(AI_CHART_ANALYSIS_ENABLED_KEY, true));
  const [chartSessionMode, setChartSessionMode] = useState<ChartSessionMode>(
    () => readStoredSessionMode(CHART_SESSION_MODE_KEY, 'regular')
  );
  const [autoDeskInsights, setAutoDeskInsights] = useState(() => readStoredBoolean(AUTO_DESK_INSIGHTS_KEY, false));
  const [autoContractSelection, setAutoContractSelection] = useState(() => readStoredBoolean(AUTO_CONTRACT_SELECTION_KEY, false));
  const [autoScannerEnabled, setAutoScannerEnabled] = useState(() => readStoredBoolean(AUTO_SCANNER_ENABLED_KEY, false));
  const deskInsightsAllowed = aiEnabled && aiDeskInsightsEnabled;
  const contractSelectionAllowed = aiEnabled && aiContractSelectionEnabled;
  const contractAnalysisAllowed = aiEnabled && aiContractAnalysisEnabled;
  const scannerAllowed = aiEnabled && aiScannerEnabled;
  const chatAllowed = aiEnabled && aiChatEnabled;
  const chartAnalysisAllowed = aiEnabled && aiChartAnalysisEnabled;
  const useRegularHours = chartSessionMode === 'regular';
  const transcriptsRef = useRef<Record<string, ChatMessage[]>>(transcripts);
  const activeConversationIdRef = useRef<string | null>(activeConversationId);
  const selectionHydratedRef = useRef(false);
  const [selectionHydrated, setSelectionHydrated] = useState(false);
  const pendingSelectionRef = useRef<{ contract: string | null; expiration: string | null }>({ contract: null, expiration: null });
  const chartFocusRef = useRef<{ symbol: string | null; timeframe: string; sessionMode: ChartSessionMode } | null>(
    null
  );
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
  const [liveSubscriptionUnavailable, setLiveSubscriptionUnavailable] = useState(false);
  const liveSocketConnectedRef = useRef(false);
  const liveSubscriptionActiveRef = useRef(false);
  const marketClosedRef = useRef(false);
  // Tick timestamps are refs, not state: only the fallback logic reads them,
  // and holding them as state re-rendered the whole app on every market tick.
  const lastLiveQuoteAtRef = useRef<number | null>(null);
  const lastLiveTradeAtRef = useRef<number | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const liveChainSymbolsRef = useRef<Set<string>>(new Set());
  const liveChainReleaseRef = useRef<Map<string, () => void>>(new Map());
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
  const lastSnapshotSymbolRef = useRef<string | null>(null);
  const [tradeMarkers, setTradeMarkers] = useState<SeriesMarker<UTCTimestamp>[]>([]);


  useEffect(() => {
    liveSocketConnectedRef.current = liveSocketConnected;
    liveSubscriptionActiveRef.current = liveSubscriptionActive;
    marketClosedRef.current = Boolean(marketSessionMeta?.marketClosed);
    activeContractSymbolRef.current = activeContractSymbol?.toUpperCase() ?? null;
  }, [liveSocketConnected, liveSubscriptionActive, marketSessionMeta?.marketClosed, activeContractSymbol]);

  useEffect(() => {
    setLiveSubscriptionUnavailable(false);
  }, [activeContractSymbol]);

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
    if (!deskInsightsAllowed) {
      setAiRequestWarning('AI desk insights are disabled in Settings.');
      return;
    }
    setDeskInsightRefreshId((prev: number) => prev + 1);
  }, [deskInsightsAllowed]);

  const handleScannerRefresh = useCallback(() => {
    if (!scannerAllowed) {
      setAiRequestWarning('AI scanner is disabled in Settings.');
      return;
    }
    setScannerRefreshId((prev: number) => prev + 1);
  }, [scannerAllowed]);

  // Automated scanner loop
  useEffect(() => {
    if (!autoScannerEnabled || !scannerAllowed) return;

    // Run once immediately if it's been a while or just enabled
    handleScannerRefresh();

    const intervalId = setInterval(() => {
      console.log('[CLIENT] Auto-triggering scanner refresh...');
      handleScannerRefresh();
    }, 300000); // 5 minutes

    return () => clearInterval(intervalId);
  }, [autoScannerEnabled, scannerAllowed, handleScannerRefresh]);


  const handleContractSelectionRequest = useCallback(() => {
    if (!contractSelectionAllowed) {
      setAiRequestWarning('AI contract selection is disabled in Settings.');
      return;
    }
    setContractSelectionRequestId((prev: number) => prev + 1);
  }, [contractSelectionAllowed]);

  const handleContractAnalysisRequest = useCallback(() => {
    if (!contractAnalysisAllowed) {
      setAiRequestWarning('AI contract analysis is disabled in Settings.');
      return;
    }
    setContractAnalysisRequestId((prev: number) => prev + 1);
  }, [contractAnalysisAllowed]);

  const handleToggleChat = useCallback(() => {
    if (!chatAllowed) {
      setAiRequestWarning('AI chat is disabled in Settings.');
      return;
    }
    if (isMobile) {
      setMobileTab('ai');
      return;
    }
    setIsChatOpen((prev: boolean) => !prev);
  }, [chatAllowed, isMobile]);

  // Quick Actions (mobile) hand an agent run to the AI tab's chat.
  const handleMobileAgentLaunch = useCallback((agentId: string, label: string) => {
    setAgentLaunch(prev => ({ agentId, label, nonce: (prev?.nonce ?? 0) + 1 }));
    setMobileTab('ai');
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
      window.localStorage.setItem(AI_FEATURES_ENABLED_KEY, String(aiEnabled));
    } catch {
      // ignore persistence failures
    }
  }, [aiEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(AI_DESK_INSIGHTS_ENABLED_KEY, String(aiDeskInsightsEnabled));
    } catch {
      // ignore persistence failures
    }
  }, [aiDeskInsightsEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(AI_CONTRACT_SELECTION_ENABLED_KEY, String(aiContractSelectionEnabled));
    } catch {
      // ignore persistence failures
    }
  }, [aiContractSelectionEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(AI_CONTRACT_ANALYSIS_ENABLED_KEY, String(aiContractAnalysisEnabled));
    } catch {
      // ignore persistence failures
    }
  }, [aiContractAnalysisEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(AI_SCANNER_ENABLED_KEY, String(aiScannerEnabled));
    } catch {
      // ignore persistence failures
    }
  }, [aiScannerEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(AI_PORTFOLIO_SENTIMENT_ENABLED_KEY, String(aiPortfolioSentimentEnabled));
    } catch {
      // ignore persistence failures
    }
  }, [aiPortfolioSentimentEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(AI_CHAT_ENABLED_KEY, String(aiChatEnabled));
    } catch {
      // ignore persistence failures
    }
  }, [aiChatEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(AI_CHART_ANALYSIS_ENABLED_KEY, String(aiChartAnalysisEnabled));
    } catch {
      // ignore persistence failures
    }
  }, [aiChartAnalysisEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(CHART_SESSION_MODE_KEY, chartSessionMode);
    } catch {
      // ignore persistence failures
    }
  }, [chartSessionMode]);

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
      window.localStorage.setItem(AUTO_SCANNER_ENABLED_KEY, String(autoScannerEnabled));
    } catch {
      // ignore persistence failures
    }
  }, [autoContractSelection]);

  useEffect(() => {
    if (!chatAllowed && isChatOpen) {
      setIsChatOpen(false);
    }
  }, [chatAllowed, isChatOpen]);

  useEffect(() => {
    if (!contractSelectionAllowed) {
      setContractSelectionLoading(false);
    }
  }, [contractSelectionAllowed]);

  useEffect(() => {
    if (autoContractSelection) return;
    autoContractSelectionKeyRef.current = null;
  }, [autoContractSelection, autoScannerEnabled]);

  // Whenever the watchlist contents change, refresh the scanner reports for those tickers.
  // Fetch the option chain whenever the ticker or selected expiration changes.
  // Reset derived state when the user changes tickers (fresh bars, selection, etc.).
  // Persist the currently selected leg so it can be restored on next load.
  // Request chart focus updates over the socket (server-owned candles).
  // Establish Socket.IO connection for live Massive feed.
  useEffect(() => {
    // Attach to the app-wide shared socket. The connection itself outlives this
    // component; we only own our listeners and subscriptions.
    const socket = getSharedSocket();
    socketRef.current = socket;

    const handleConnect = () => {
      setLiveSocketConnected(true);
    };
    const handleDisconnect = () => {
      setLiveSocketConnected(false);
      setLiveSubscriptionActive(false);
      setLiveSubscriptionUnavailable(false);
    };
    const handleLiveError = (payload: any) => {
      console.warn('[CLIENT] live feed error', payload);
      const errorSymbol = normalizeLiveSymbol(payload);
      const activeSymbol = activeContractSymbolRef.current;
      if (errorSymbol && activeSymbol && errorSymbol === activeSymbol) {
        setLiveSubscriptionUnavailable(true);
      }
    };
    const handleLiveStatus = (payload: any) => {
      console.debug('[CLIENT] live feed status', payload);
      if (payload?.authenticated === true && payload?.lastStatus === 'auth_success') {
        setLiveSubscriptionUnavailable(false);
      }
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('live:error', handleLiveError);
    socket.on('live:status', handleLiveStatus);
    if (socket.connected) {
      setLiveSocketConnected(true);
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('live:error', handleLiveError);
      socket.off('live:status', handleLiveStatus);
      // Release everything this view subscribed to on the shared connection:
      // residual near-the-money strip symbols and the chart focus.
      liveChainReleaseRef.current.forEach(release => release());
      liveChainReleaseRef.current.clear();
      liveChainSymbolsRef.current = new Set();
      socket.emit('chart:focus', { symbol: null });
      socketRef.current = null;
      setLiveSocketConnected(false);
      setLiveSubscriptionActive(false);
      setLiveSubscriptionUnavailable(false);
    };
  }, []);

  // Manage live feed events for the active contract + near-the-money strip.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !liveSocketConnected) return;
    const activeSymbol = activeContractSymbol?.toUpperCase() ?? null;
      if (!activeSymbol) {
        setLiveSubscriptionActive(false);
        setLiveSubscriptionUnavailable(false);
      }

    const resolveSymbol = (payload: any) =>
      typeof payload === 'string' ? payload.toUpperCase() : normalizeLiveSymbol(payload);

    const handleSubscribed = (payload: any) => {
      const ackSymbol = resolveSymbol(payload?.symbol ?? payload?.sym ?? payload);
      const matches = Boolean(ackSymbol && activeSymbol && ackSymbol === activeSymbol);
      // TEMPORARY: production-stabilization debug logging (see sprint task).
      // eslint-disable-next-line no-console
      console.debug('[LIVE_SUBSCRIBE_ACK]', { ts: new Date().toISOString(), activeSymbol, ackSymbol, matches, payload });
      if (matches) {
        const accepted = payload?.accepted !== false;
        setLiveSubscriptionActive(accepted);
        setLiveSubscriptionUnavailable(!accepted);
      }
    };

    const handleUnsubscribed = (payload: any) => {
      const ackSymbol = resolveSymbol(payload?.symbol ?? payload?.sym ?? payload);
      if (ackSymbol && activeSymbol && ackSymbol === activeSymbol) {
        setLiveSubscriptionActive(false);
        setLiveSubscriptionUnavailable(false);
      }
    };

    const handleQuote = (payload: any) => {
      const normalized = normalizeLiveQuote(payload);
      if (!normalized) return;
      // Publish into the live store: only panels rendering this symbol
      // re-render. No App state is touched on the hot tick path.
      publishQuote(normalized);
      const matches = Boolean(activeSymbol && normalized.ticker === activeSymbol);
      // TEMPORARY: production-stabilization debug logging (see sprint task).
      // eslint-disable-next-line no-console
      console.debug('[LIVE_QUOTE_RX]', {
        ts: new Date().toISOString(),
        activeSymbol,
        quoteTicker: normalized.ticker,
        matches,
        rawSym: payload?.sym ?? payload?.symbol ?? null,
        dataMode: normalized.dataMode,
        providerTimestamp: normalized.timestamp,
      });
      if (matches) {
        lastLiveQuoteAtRef.current = Date.now();
        setLiveSubscriptionActive(true);
        setLiveSubscriptionUnavailable(false);
      }
    };

    const handleTrade = (payload: any) => {
      const normalized = normalizeLiveTrade(payload);
      if (!normalized) return;
      if (!normalized.ticker) return;
      publishTrade(normalized);
      if (activeSymbol && normalized.ticker === activeSymbol) {
        lastLiveTradeAtRef.current = Date.now();
        setLiveSubscriptionActive(true);
        setLiveSubscriptionUnavailable(false);
      }
    };

    socket.on('live:subscribed', handleSubscribed);
    socket.on('live:unsubscribed', handleUnsubscribed);
    socket.on('live:quote', handleQuote);
    socket.on('live:trade', handleTrade);
    socket.on('live:trades', handleTrade);

    return () => {
      socket.off('live:subscribed', handleSubscribed);
      socket.off('live:unsubscribed', handleUnsubscribed);
      socket.off('live:quote', handleQuote);
      socket.off('live:trade', handleTrade);
      socket.off('live:trades', handleTrade);
    };
  }, [activeContractSymbol, liveSocketConnected]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const matchesFocus = (payload?: { symbol?: string; timeframe?: string }) => {
      const focus = chartFocusRef.current;
      if (!focus?.symbol) return false;
      const symbol = payload?.symbol?.toUpperCase() ?? '';
      return symbol === focus.symbol && payload?.timeframe === focus.timeframe;
    };

    const handleSnapshot = (payload: ChartSnapshotPayload) => {
      if (!matchesFocus(payload)) return;
      const focus = chartFocusRef.current;
      if (!focus?.symbol) return;
      const symbol = focus.symbol;
      const nextBars = normalizeChartBars(payload.bars ?? []);
      setBars(nextBars);
      setIndicators(buildIndicatorBundle(symbol, nextBars));
      setMarketSessionMeta(payload.session ?? null);
      setMarketError(null);
      setChartLoading(false);
    };

    const handleUpdate = (payload: ChartUpdatePayload) => {
      if (!matchesFocus(payload)) return;
      const focus = chartFocusRef.current;
      if (!focus?.symbol) return;
      const symbol = focus.symbol;
      const nextBar = toAggregateBar(payload.bar);
      if (!nextBar) return;
      setBars((prev: AggregateBar[]) => {
        const next = upsertChartBar(prev, nextBar);
        setIndicators(buildIndicatorBundle(symbol, next));
        return next;
      });
      if (payload.health) {
        setMarketSessionMeta((prev: MarketSessionMeta | null) => (prev ? { ...prev, health: payload.health } : prev));
      }
      setChartLoading(false);
    };

    const handleError = (payload: { message?: string }) => {
      if (!chartFocusRef.current?.symbol) return;
      setMarketError(payload?.message ?? 'Chart data is unavailable.');
      setChartLoading(false);
    };

    const handleCleared = () => {
      setBars([]);
      setIndicators(undefined);
      setMarketSessionMeta(null);
      setChartLoading(false);
    };

    socket.on('chart:snapshot', handleSnapshot);
    socket.on('chart:update', handleUpdate);
    socket.on('chart:error', handleError);
    socket.on('chart:cleared', handleCleared);

    return () => {
      socket.off('chart:snapshot', handleSnapshot);
      socket.off('chart:update', handleUpdate);
      socket.off('chart:error', handleError);
      socket.off('chart:cleared', handleCleared);
    };
  }, []);

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
    if (!deskInsightsAllowed) {
      setDeskInsightLoading(false);
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
  }, [deskInsightSymbol, deskInsightRefreshId, autoDeskInsights, deskInsightsAllowed, handleAiLimit]);

  useEffect(() => {
    if (!scannerAllowed) {
      setScannerLoading(false);
      return;
    }
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
  }, [scannerRefreshId, watchlistSignature, watchlistSymbols, scannerAllowed, handleAiLimit]);

  // Run the entry checklist scan for the current watchlist on demand.
  useEffect(() => {
    if (!scannerAllowed) {
      setChecklistLoading(false);
      return;
    }
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
  }, [scannerRefreshId, watchlistSignature, watchlistSymbols, scannerAllowed, handleAiLimit]);


  // Lazily fetch conversation transcripts when the user re-opens a chat session.
  const ensureTranscriptLoaded = useCallback(async (sessionId: string) => {
    if (transcriptsRef.current[sessionId]) return;
    try {
      const payload = await chatApi.fetchConversationTranscript(sessionId);
      const mapped = mapMessages(payload);
      setTranscripts((prev: Record<string, ChatMessage[]>) => {
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
    availableExpirations.forEach((value: string) => merged.add(value));
    customExpirations.forEach((value: string) => merged.add(value));
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
  const hydrateConversations = useCallback(async (symbol = displayTicker) => {
    const normalizedSymbol = symbol.trim().toUpperCase() || 'SPY';
    setConversations([]);
    setActiveConversationId(null);
    setLatestInsight('');
    setTranscripts(() => {
      const next: Record<string, ChatMessage[]> = {};
      transcriptsRef.current = next;
      return next;
    });
    try {
      const payloads = await chatApi.listConversations(normalizedSymbol);
      const list: ConversationMeta[] = payloads
        .map(payload => normalizeConversation(payload))
        .filter(convo => convo.symbol === normalizedSymbol);
      if (list.length === 0) {
        const seeded = createConversation(undefined, undefined, normalizedSymbol);
        setConversations([seeded]);
        setActiveConversationId(seeded.id);
        setLatestInsight('');
        setTranscripts(() => {
          const next = { [seeded.sessionId]: [DEFAULT_ASSISTANT_MESSAGE] };
          transcriptsRef.current = next;
          return next;
        });
        return;
      }
      setConversations(list);
      setActiveConversationId(list[0].id);
      setLatestInsight(list[0].preview);
      await ensureTranscriptLoaded(list[0].sessionId);
    } catch (error) {
      console.warn('Failed to fetch conversations from API, using local cache if available.', error);
      let loadedFromCache = false;
      if (typeof window !== 'undefined') {
        const cached = window.localStorage.getItem(conversationStorageKey(normalizedSymbol));
        if (cached) {
          try {
            const parsed: ConversationMeta[] = JSON.parse(cached);
            const scoped = parsed.filter(convo => convo.symbol === normalizedSymbol);
            if (scoped.length) {
              setConversations(scoped);
              setActiveConversationId(scoped[0].id);
              setLatestInsight(scoped[0].preview);
              loadedFromCache = true;
            }
          } catch (parseError) {
            console.warn('Failed to parse cached conversations', parseError);
          }
        }
      }
      if (!loadedFromCache) {
        const seeded = createConversation(undefined, undefined, normalizedSymbol);
        setConversations([seeded]);
        setActiveConversationId(seeded.id);
        setLatestInsight('');
        setTranscripts(() => {
          const next = { [seeded.sessionId]: [DEFAULT_ASSISTANT_MESSAGE] };
          transcriptsRef.current = next;
          return next;
        });
      }
    }
  }, [displayTicker, ensureTranscriptLoaded]);

  // Kick off initial conversation fetch on mount.
  useEffect(() => {
    hydrateConversations(displayTicker);
  }, [hydrateConversations, displayTicker]);

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
      } finally {
        if (!cancelled) setSelectionHydrated(true);
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
      window.localStorage.setItem(conversationStorageKey(displayTicker), JSON.stringify(conversations));
    } catch (error) {
      console.warn('Failed to persist conversations to local storage', error);
    }
  }, [conversations, displayTicker]);

  useEffect(() => {
    if (!normalizedTicker) {
      setChainExpirations([]);
      setChainUnderlyingPrice(null);
      setChainLoading(false);
      return;
    }
    const shouldSkipFetch =
      skipChainFetchRef.current &&
      selectedExpiration &&
      chainExpirations.some((group: OptionChainExpirationGroup) => group.expiration === selectedExpiration);
    if (shouldSkipFetch) {
      skipChainFetchRef.current = false;
      return;
    }
    skipChainFetchRef.current = false;
    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let hasRetried = false;
    const controller = new AbortController();
    async function loadChain() {
      setChainLoading(true);
      setChainError(null);
      try {
        const response = await marketApi.getOptionsChain({
          ticker: normalizedTicker,
          limit: selectedExpiration ? 200 : 150,
          expiration: selectedExpiration ?? undefined
        }, controller.signal);
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
            setAvailableExpirations((prev: string[]) => {
              const merged = new Set(prev);
              groups.forEach((group: OptionChainExpirationGroup) => {
                if (group.expiration) merged.add(group.expiration);
              });
              return Array.from(merged).sort((a, b) => {
                const tsA = getExpirationTimestamp(a);
                const tsB = getExpirationTimestamp(b);
                if (tsA == null && tsB == null) return 0;
                if (tsA == null) return 1;
                if (tsB == null) return -1;
                return tsA - tsB;
              });
            });
            lastChainRef.current = {
              ticker: normalizedTicker,
              groups,
              underlyingPrice: response?.underlyingPrice ?? null
            };
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
        if (!cancelled && !isAbortError(error)) {
          const status = error?.response?.status;
          const isNetworkError = !error?.response;
          if (status === 404 && selectedExpiration) {
            console.warn('[CLIENT] expiration missing, reverting to full chain', selectedExpiration);
            pendingSelectionRef.current.expiration = null;
            invalidExpirationsRef.current.add(selectedExpiration);
            setCustomExpirations((prev: string[]) => prev.filter(value => value !== selectedExpiration));
            setSelectedExpiration(null);
          } else {
            const message = error?.response?.data?.error ?? error?.message ?? 'Failed to load options chain';
            if (!isNetworkError || !chainExpirations.length) {
              setChainError(message);
            }
            if (!isNetworkError) {
              setChainExpirations([]);
              setChainUnderlyingPrice(null);
            } else if (lastChainRef.current?.ticker === normalizedTicker) {
              setChainExpirations(lastChainRef.current.groups);
              setChainUnderlyingPrice(lastChainRef.current.underlyingPrice);
            }
            if (isNetworkError && !hasRetried) {
              hasRetried = true;
              retryTimeout = setTimeout(() => {
                if (!cancelled) {
                  loadChain();
                }
              }, 2000);
            }
          }
        }
      } finally {
        if (!cancelled) setChainLoading(false);
      }
    }
    loadChain();
    return () => {
      cancelled = true;
      controller.abort();
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
    };
  }, [normalizedTicker, selectedExpiration, selectionHydrated]);

  useEffect(() => {
    setSelectedLeg(null);
    setContractDetail(null);
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
    const controller = new AbortController();
    setChainError(null);
    setAvailableExpirations([]);
    setSelectedExpiration(null);
    async function loadExpirations() {
      try {
        const payload = await marketApi.getOptionExpirations(normalizedTicker, controller.signal);
        if (cancelled) return;
        const expirations = Array.isArray(payload?.expirations) ? payload.expirations : [];
        setAvailableExpirations(expirations);
        const pendingExpiration = pendingSelectionRef.current.expiration;
        if (pendingExpiration) {
          if (!expirations.includes(pendingExpiration)) {
            setCustomExpirations((prev: string[]) =>
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
        if (!cancelled && !isAbortError(error)) {
          const message = error?.response?.data?.error ?? error?.message ?? 'Failed to load expirations';
          setChainError(message);
        }
      }
    }
    loadExpirations();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [normalizedTicker, selectionHydrated]);

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
      setCustomExpirations((prev: string[]) =>
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
    const controller = new AbortController();
    async function loadSnapshot() {
      try {
        const payload = await marketApi.getWatchlistSnapshots([normalizedTicker], controller.signal);
        if (!cancelled) {
          const snapshot = payload.entries?.[0] ?? null;
          setUnderlyingSnapshot(snapshot);
          underlyingSnapshotRef.current = snapshot ?? null;
        }
      } catch (error) {
        if (!cancelled && !isAbortError(error)) {
          console.warn('Failed to load underlying snapshot', error);
          setUnderlyingSnapshot(null);
          underlyingSnapshotRef.current = null;
        }
      }
    }
    loadSnapshot();
    return () => {
      cancelled = true;
      controller.abort();
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
    const controller = new AbortController();
    marketApi
      .getOptionContractDetail(symbol, controller.signal)
      .then(detail => {
        if (cancelled) return;
        const merged = mergeContractDetail(baseDetail, detail);
        contractDetailCacheRef.current.set(symbol, merged);
        setContractDetail(merged);
      })
      .catch(error => {
        if (cancelled || isAbortError(error)) return;
        console.warn('Failed to load contract details', error);
      });
    return () => {
      cancelled = true;
      controller.abort();
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

  const chartDataSymbol = useMemo(() => {
    // Always chart the underlying equity, not the option contract
    // Option contracts have sparse trading data and create unusable charts
    return chartTicker?.toUpperCase() ?? null;
  }, [chartTicker]);

  // Fetch and map filled orders for visual journaling
  useEffect(() => {
    if (!chartDataSymbol || !displayTicker) {
      setTradeMarkers([]);
      return;
    }

    let isMounted = true;
    let structuralFailure = false;
    const controller = new AbortController();
    const fetchOrders = async () => {
      if (structuralFailure) return;
      try {
        const { orders } = await getOptionOrdersForPolling({ status: 'filled', limit: 50 }, controller.signal);
        if (!isMounted) return;

        // Filter and map orders for the current display ticker
        const relevantOrders = orders.filter(
          (o) => o.symbol === displayTicker || (o.symbol && o.symbol.startsWith(`O:${displayTicker}`))
        );

        const markers: SeriesMarker<UTCTimestamp>[] = relevantOrders
          .map((order) => {
            const timeStr = order.filled_at || order.created_at;
            const time = timeStr ? (Math.floor(new Date(timeStr).getTime() / 1000) as UTCTimestamp) : null;
            if (!time) return null;

            const isBuy = order.side === 'buy';
            return {
              time,
              position: isBuy ? 'belowBar' : 'aboveBar',
              color: isBuy ? '#10b981' : '#f43f5e',
              shape: isBuy ? 'arrowUp' : 'arrowDown',
              text: isBuy ? `BUY @ ${order.filled_avg_price}` : `SELL @ ${order.filled_avg_price}`,
            } as SeriesMarker<UTCTimestamp>;
          })
          .filter((m): m is SeriesMarker<UTCTimestamp> => m !== null);

        setTradeMarkers(markers);
      } catch (err: any) {
        if (!isMounted) return;
        const classification = classifyOrderHistoryError(err);
        if (classification === 'canceled') {
          console.debug('fetchOrders canceled');
          return;
        }
        if (classification === 'legacy-disabled') {
          structuralFailure = true;
          console.warn(LEGACY_SUBMISSION_DISABLED_MESSAGE);
          return;
        }
        if (classification === 'structural') {
          structuralFailure = true;
          console.warn('Order-history polling stopped after structural HTTP error', {
            status: err?.response?.status,
            url: err?.config?.url,
          });
          return;
        }
        if (err?.code === 'BACKEND_UNAVAILABLE' || classification === 'network') {
          console.debug('Order-history polling paused while backend health recovers');
          return;
        }
        console.error('Failed to fetch trade markers:', err);
      }
    };

    fetchOrders();
    const interval = setInterval(fetchOrders, 30000); // Poll every 30s
    return () => {
      isMounted = false;
      controller.abort();
      clearInterval(interval);
    };
  }, [displayTicker, chartDataSymbol]);

  const handleChartAnalysisRun = useCallback(async () => {
    if (!chartAnalysisAllowed) {
      setChartAnalysisError('Chart analysis is disabled in Settings.');
      return;
    }
    if (!chartTicker) {
      setChartAnalysisError('Select a ticker to analyze.');
      return;
    }
    const symbol = chartTicker.toUpperCase();
    setChartAnalysisLoading(true);
    setChartAnalysisError(null);
    try {
      const [
        minuteAggsResult,
        hourAggsResult,
        dayAggsResult,
        shortInterestResult,
        shortVolumeResult
      ] = await Promise.allSettled([
        marketApi.getAggregates({ ticker: symbol, multiplier: 1, timespan: 'minute', window: CHART_ANALYSIS_MINUTE_WINDOW }),
        marketApi.getAggregates({ ticker: symbol, multiplier: 1, timespan: 'hour', window: 24 }),
        marketApi.getAggregates({ ticker: symbol, multiplier: 1, timespan: 'day', window: 60 }),
        marketApi.getShortInterest({ ticker: symbol, limit: 2, sort: 'settlement_date', order: 'desc' }),
        marketApi.getShortVolume({ ticker: symbol, limit: 12, sort: 'date', order: 'desc' })
      ]);

      const minuteAggs = minuteAggsResult.status === 'fulfilled' ? minuteAggsResult.value : null;
      const hourAggs = hourAggsResult.status === 'fulfilled' ? hourAggsResult.value : null;
      const dayAggs = dayAggsResult.status === 'fulfilled' ? dayAggsResult.value : null;
      const shortInterest = shortInterestResult.status === 'fulfilled' ? shortInterestResult.value : null;
      const shortVolume = shortVolumeResult.status === 'fulfilled' ? shortVolumeResult.value : null;

      if (minuteAggs?.resultGranularity === 'daily') {
        throw new Error('Intraday minute bars are unavailable for this symbol right now.');
      }

      const minuteBars = normalizeAggregateBars(minuteAggs?.results ?? []).sort((a, b) => a.timestamp - b.timestamp);
      if (!minuteBars.length) {
        throw new Error('No intraday bars available for analysis.');
      }

      const openingRange = computeOpeningRange(useRegularHours ? selectRegularSessionBars(minuteBars) : minuteBars);
      if (!openingRange) {
        throw new Error('Unable to compute the opening 5-minute range.');
      }

      const buckets = buildFiveMinuteBuckets(minuteBars, openingRange.sessionKey);
      const latestClose = minuteBars.at(-1)?.close ?? null;
      const rangeHigh = openingRange.high;
      const rangeLow = openingRange.low;
      const range = rangeHigh - rangeLow;
      const breakoutStatus =
        latestClose != null && latestClose > rangeHigh
          ? 'above'
          : latestClose != null && latestClose < rangeLow
            ? 'below'
            : 'inside';

      let breakoutVolumeRatio: number | null = null;
      let breakoutStrength = 'neutral';
      if (buckets.length > 1) {
        const breakoutBucket = buckets.slice(1).find(bucket => bucket.close > rangeHigh || bucket.close < rangeLow);
        if (breakoutBucket) {
          const priorBuckets = buckets.filter(bucket => bucket.index < breakoutBucket.index);
          const avgVolume =
            priorBuckets.length > 0
              ? priorBuckets.reduce((sum, bucket) => sum + bucket.volume, 0) / priorBuckets.length
              : null;
          breakoutVolumeRatio = avgVolume ? breakoutBucket.volume / avgVolume : null;
          if (breakoutVolumeRatio != null) {
            breakoutStrength =
              breakoutVolumeRatio >= 1.5 ? 'strong' : breakoutVolumeRatio >= 1.1 ? 'moderate' : 'weak';
          }
        }
      }

      const hourlyTrend = computeTrend(normalizeAggregateBars(hourAggs?.results ?? []));
      const dailyTrend = computeTrend(normalizeAggregateBars(dayAggs?.results ?? []));

      const shortInterestLatest = shortInterest?.results?.[0] ?? null;
      const shortInterestPrev = shortInterest?.results?.[1] ?? null;
      const shortInterestChangePct =
        typeof shortInterestLatest?.shortInterest === 'number' &&
          typeof shortInterestPrev?.shortInterest === 'number' &&
          shortInterestPrev.shortInterest !== 0
          ? ((shortInterestLatest.shortInterest - shortInterestPrev.shortInterest) / shortInterestPrev.shortInterest) * 100
          : null;
      const daysToCover = typeof shortInterestLatest?.daysToCover === 'number' ? shortInterestLatest.daysToCover : null;
      const shortInterestElevated =
        (shortInterestChangePct != null && shortInterestChangePct >= 20) || (daysToCover != null && daysToCover >= 5);
      const shortInterestFalling =
        shortInterestChangePct != null && shortInterestChangePct <= -20 && (daysToCover == null || daysToCover <= 3);

      const shortVolumeLatest = shortVolume?.results?.[0] ?? null;
      const shortVolumeRecent = (shortVolume?.results ?? [])
        .slice(1, 11)
        .map(entry => entry.shortVolume)
        .filter((value): value is number => typeof value === 'number');
      const shortVolumeAverage =
        shortVolumeRecent.length > 0 ? shortVolumeRecent.reduce((sum, value) => sum + value, 0) / shortVolumeRecent.length : null;
      const shortVolumeSpike =
        typeof shortVolumeLatest?.shortVolume === 'number' &&
          typeof shortVolumeAverage === 'number' &&
          shortVolumeAverage > 0
          ? shortVolumeLatest.shortVolume >= shortVolumeAverage * 2
          : false;
      const shortVolumeRatio =
        typeof shortVolumeLatest?.shortVolumeRatio === 'number' ? shortVolumeLatest.shortVolumeRatio : null;

      const alignmentNote =
        hourlyTrend === dailyTrend && (hourlyTrend === 'up' || hourlyTrend === 'down')
          ? `Hourly and daily trends align (${hourlyTrend}).`
          : `Hourly trend is ${hourlyTrend}, daily trend is ${dailyTrend}.`;

      const breakoutLine =
        breakoutStatus === 'inside'
          ? 'Price is still inside the opening range — wait for a 5-minute close outside the range.'
          : `Price is ${breakoutStatus} the opening range with ${breakoutStrength} volume confirmation.`;

      const bullets = [
        `Opening 5-minute range (${openingRange.sessionKey}): ${formatPrice(rangeLow)}–${formatPrice(rangeHigh)} (range ${formatPrice(range)}).`,
        breakoutLine,
        alignmentNote,
        breakoutVolumeRatio != null
          ? `Breakout volume was ${breakoutVolumeRatio.toFixed(2)}x the prior 5-minute average.`
          : 'Volume confirmation is unavailable — watch for a higher-volume close outside the range.',
        shortInterestLatest
          ? shortInterestElevated
            ? `Short interest is elevated (days to cover ${daysToCover?.toFixed(1) ?? '—'}, change ${shortInterestChangePct?.toFixed(1) ?? '—'}%).`
            : shortInterestFalling
              ? `Short interest is easing (change ${shortInterestChangePct?.toFixed(1) ?? '—'}%).`
              : 'Short interest looks neutral versus recent history.'
          : 'Short interest data unavailable for this symbol.',
        shortVolumeLatest
          ? shortVolumeSpike || (shortVolumeRatio != null && shortVolumeRatio >= 50)
            ? `Short volume is elevated (ratio ${shortVolumeRatio?.toFixed(1) ?? '—'}%).`
            : 'Short volume looks normal for the last sessions.'
          : 'Short volume data unavailable for this symbol.',
        'Use the 15- or 30-minute range as a confirmation layer if the 5-minute break looks noisy.'
      ];

      const headline =
        breakoutStatus === 'above'
          ? 'Opening-range breakout bias is bullish.'
          : breakoutStatus === 'below'
            ? 'Opening-range breakout bias is bearish.'
            : 'Opening range is intact — no confirmed breakout yet.';

      setChartAnalysis({ headline, bullets });
      setChartAnalysisUpdatedAt(Date.now());
    } catch (error: any) {
      const message = error?.message ?? 'Unable to run chart analysis.';
      setChartAnalysisError(message);
    } finally {
      setChartAnalysisLoading(false);
    }
  }, [chartTicker, chartAnalysisAllowed, useRegularHours]);

  useEffect(() => {
    const socket = socketRef.current;
    const symbol = chartDataSymbol?.trim().toUpperCase() ?? null;
    const previousFocus = chartFocusRef.current;
    const symbolChanged = previousFocus?.symbol !== symbol;
    const timeframeChanged = previousFocus?.timeframe !== timeframe;
    const focusChanged = symbolChanged || timeframeChanged || previousFocus?.sessionMode !== chartSessionMode;
    chartFocusRef.current = { symbol, timeframe, sessionMode: chartSessionMode };
    if (symbolChanged) {
      setBars([]);
      setIndicators(undefined);
      setMarketSessionMeta(null);
    }
    if (timeframeChanged) {
      setChartAnalysis(null);
      setChartAnalysisError(null);
      setChartAnalysisUpdatedAt(null);
    }
    if (!socket || !liveSocketConnected) return;

    if (!symbol) {
      setChartLoading(false);
      socket.emit('chart:focus', { symbol: null });
      return;
    }

    setChartLoading(true);
    setMarketError(null);
    socket.emit('chart:focus', { symbol, timeframe, sessionMode: chartSessionMode });
  }, [chartDataSymbol, timeframe, chartSessionMode, liveSocketConnected]);

  useEffect(() => {
    if (!activeContractSymbol) {
      lastLiveQuoteAtRef.current = null;
      lastLiveTradeAtRef.current = null;
      lastSnapshotSymbolRef.current = null;
      return;
    }
    const symbol = activeContractSymbol.toUpperCase();
    let cancelled = false;
    let fetching = false;
    const controller = new AbortController();

    const loadSnapshots = async (reason: 'initial' | 'fallback') => {
      if (cancelled || fetching) return;
      fetching = true;
      try {
        const [tradesPayload, quotePayload] = await Promise.all([
          marketApi.getTrades(symbol, controller.signal),
          marketApi.getQuote(symbol, controller.signal),
        ]);
        if (!cancelled) {
          // REST snapshots land in the same live store the socket feeds, so
          // panels have one source of truth regardless of transport.
          replaceTradeHistory(symbol, (tradesPayload.trades ?? []).slice(0, MAX_TRADE_HISTORY));
          publishQuote({ ...quotePayload, ticker: symbol });
          if (reason === 'fallback') {
            console.debug('[CLIENT] fallback snapshot refreshed', { symbol, trades: tradesPayload.trades?.length ?? 0 });
          }
        }
      } catch (error: any) {
        if (!cancelled && !isAbortError(error)) {
          const message = error?.response?.data?.error ?? error?.message ?? 'Failed to load market snapshots';
          setMarketError(message);
        }
      } finally {
        fetching = false;
      }
    };

    const shouldFallback = () => {
      const marketClosed = marketClosedRef.current;
      const liveConnected = liveSocketConnectedRef.current;
      const subscriptionActive = liveSubscriptionActiveRef.current;
      const allowFallbackWhileClosed = !marketClosed || !subscriptionActive;
      if (!allowFallbackWhileClosed) return false;
      if (!liveConnected || !subscriptionActive) return true;
      const now = Date.now();
      const lastUpdate = Math.max(lastLiveQuoteAtRef.current ?? 0, lastLiveTradeAtRef.current ?? 0);
      if (!lastUpdate) return true;
      return now - lastUpdate > LIVE_STALE_TTL_MS;
    };

    const interval = setInterval(() => {
      if (cancelled) return;
      if (shouldFallback()) {
        void loadSnapshots('fallback');
      }
    }, LIVE_HEALTH_CHECK_INTERVAL_MS);

    if (lastSnapshotSymbolRef.current !== symbol) {
      lastSnapshotSymbolRef.current = symbol;
      void loadSnapshots('initial');
    }

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [activeContractSymbol]);

  // Spawn a brand new chat session in the dock and make it active.
  function startNewConversation() {
    const convo = createConversation(undefined, undefined, displayTicker);
    setConversations((prev: ConversationMeta[]) => [convo, ...prev]);
    setTranscripts((prev: Record<string, ChatMessage[]>) => {
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
    const convo = conversations.find((c: ConversationMeta) => c.id === id);
    if (convo) {
      setLatestInsight(convo.preview);
      await ensureTranscriptLoaded(convo.sessionId);
    }
  }

  // Allow dock components to push latest messages into the transcript cache.
  function handleMessagesChange(sessionId: string, nextMessages: ChatMessage[]) {
    setTranscripts((prev: Record<string, ChatMessage[]>) => {
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
    const normalized = normalizeConversation(payload, displayTicker);
    setConversations((prev: ConversationMeta[]) => {
      const filtered = prev.filter((convo: ConversationMeta) => convo.sessionId !== normalized.sessionId);
      return [normalized, ...filtered];
    });
    setLatestInsight(normalized.preview);
  }

  async function handleConversationDelete(id: string) {
    const convo = conversations.find((item: ConversationMeta) => item.id === id);
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
    const remaining = conversations.filter((item: ConversationMeta) => item.id !== id);
    setConversations(remaining);
    setTranscripts((prev: Record<string, ChatMessage[]>) => {
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

  // Stable handlers so memoized children don't re-render on unrelated updates.
  const handleSidebarSelectTicker = useCallback((next: string, snapshot?: WatchlistSnapshot | null) => {
    const normalized = next.toUpperCase();
    setTicker(normalized);
    // Selecting a new underlying legitimately resets the chart; the focus
    // effect will re-request candles for the new symbol.
    setBars([]);
    setIndicators(undefined);
    setMarketSessionMeta(null);
    setSelectedLeg(null);
    setContractDetail(null);
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
  }, []);

  const handleSidebarSnapshotUpdate = useCallback((ticker: string, snapshot?: WatchlistSnapshot | null) => {
    if (!ticker) return;
    if (ticker.toUpperCase() !== normalizedTicker.toUpperCase()) return;
    setUnderlyingSnapshot(snapshot ?? null);
    underlyingSnapshotRef.current = snapshot ?? null;
  }, [normalizedTicker]);

  // Sidebar component handles watchlist interactions + ticker selection.
  const sidebar = (
    <TradingSidebar
      selectedTicker={normalizedTicker}
      onSelectTicker={handleSidebarSelectTicker}
      onSnapshotUpdate={handleSidebarSnapshotUpdate}
      onWatchlistChange={handleWatchlistChange}
      onRequestAutoSelect={handleContractSelectionRequest}
      autoSelectDisabled={contractSelectionLoading || !chainExpirations.length || !contractSelectionAllowed}
    />
  );

  // When the user chooses a contract in the chain, sync selection + expiration state.
  const handleContractSelection = useCallback(
    (leg: OptionLeg | null, source: 'auto' | 'user' = 'user') => {
      selectionSourceRef.current = source;
      setSelectedLeg(leg);
      // NOTE: do NOT clear chart bars/indicators here. The chart tracks the
      // underlying equity (chartDataSymbol), which is unchanged when only the
      // selected contract changes. The chart-focus effect already resets bars
      // whenever the chart symbol or timeframe actually changes.
      if (source === 'user') {
        setContractSelection(null);
      }
      if (leg?.ticker) {
        setDesiredContract(leg.ticker.toUpperCase());
        if (leg.expiration) {
          if (chainExpirations.some((group: OptionChainExpirationGroup) => group.expiration === leg.expiration)) {
            skipChainFetchRef.current = true;
          }
          setCustomExpirations((prev: string[]) =>
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
    [normalizedTicker, chainExpirations]
  );

  // Update the selected expiration and reset leg selection when dropdown changes.
  const handleExpirationChange = useCallback((value: string | null) => {
    pendingSelectionRef.current.expiration = null;
    skipChainFetchRef.current = false;
    if (value) {
      invalidExpirationsRef.current.delete(value);
    }
    setSelectedExpiration(value);
    setSelectedLeg(null);
    setDesiredContract(null);
  }, []);

  const handleTimeframeChange = useCallback((value: string) => {
    setTimeframe(value as TimeframeKey);
  }, []);

  const handleOrderSubmitted = useCallback((ticker: string, side: string, qty: number, price: number) => {
    console.log(`[CLIENT] Order confirmed for ${ticker}: ${side} ${qty} at ${price}`);
    // Future: add to visual journaling history
  }, []);

  const handleHeaderTickerSubmit = useCallback((value: string) => {
    const normalized = value.trim().toUpperCase();
    if (!normalized) return;
    setTicker(normalized);
    setSelectedLeg(null);
    setContractDetail(null);
    if (normalized.startsWith('O:')) {
      pendingSelectionRef.current.contract = normalized;
      pendingSelectionRef.current.expiration = parseOptionExpirationFromTicker(normalized);
      setDesiredContract(normalized);
    } else {
      pendingSelectionRef.current.contract = null;
      pendingSelectionRef.current.expiration = null;
      setDesiredContract(null);
    }
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  const handleToggleSettings = useCallback(() => {
    setSettingsOpen(prev => !prev);
  }, []);

  // Scanner rows and Lab panels jump the workspace to a symbol's trading view.
  const handleWorkspaceTickerSelect = useCallback((value: string) => {
    setTicker(value);
    setView('trading');
  }, []);

  // Prefer the latest chain price for Greeks panel, fall back to watchlist snapshot.
  const greeksUnderlyingPrice =
    chainUnderlyingPrice ??
    (underlyingSnapshot && underlyingSnapshot.entryType === 'underlying' ? underlyingSnapshot.price ?? null : null);

  // Stable object identity so the memoized ChartPanel doesn't re-render on
  // every App render (a fresh object literal would defeat React.memo).
  const chartFallbackChange = useMemo(
    () =>
      underlyingSnapshot && underlyingSnapshot.entryType === 'underlying'
        ? { absolute: underlyingSnapshot.change ?? null, percent: underlyingSnapshot.changePercent ?? null }
        : undefined,
    [underlyingSnapshot]
  );

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
    if (!contractSelectionAllowed || !autoContractSelection) return;
    if (!chainExpirations.length || !preferredOptionSide) return;
    if (selectedLeg && selectionSourceRef.current === 'user') return;
    const selectionKey = `${deskInsightSymbol}-${preferredOptionSide}-${selectedExpiration ?? 'auto'}`;
    if (autoContractSelectionKeyRef.current === selectionKey) return;
    autoContractSelectionKeyRef.current = selectionKey;
    setContractSelectionRequestId((prev: number) => prev + 1);
  }, [
    autoContractSelection,
    contractSelectionAllowed,
    chainExpirations,
    preferredOptionSide,
    selectedExpiration,
    deskInsightSymbol,
    selectedLeg
  ]);

  useEffect(() => {
    if (!contractSelectionAllowed) return;
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
    contractSelectionAllowed,
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
      ? 'border-intel-pos/30 text-intel-pos bg-intel-pos/10'
      : sentimentTone === 'bearish'
        ? 'border-intel-neg/30 text-intel-neg bg-intel-neg/10'
        : 'border-intel-line text-intel-ink2 bg-intel-panel2';
  const sentimentDot =
    sentimentTone === 'bullish' ? 'bg-intel-pos' : sentimentTone === 'bearish' ? 'bg-intel-neg' : 'bg-intel-ink3';
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
    const releases = liveChainReleaseRef.current;
    const removed: string[] = [];
    nextSymbols.forEach(symbol => {
      if (!prevSymbols.has(symbol)) {
        const release = acquireLiveMarketSubscription(symbol);
        if (release) releases.set(symbol, release);
      }
    });
    prevSymbols.forEach((symbol: string) => {
      if (!nextSymbols.has(symbol)) {
        releases.get(symbol)?.();
        releases.delete(symbol);
        removed.push(symbol);
      }
    });
    if (removed.length) {
      removeLiveSymbols(removed);
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

  const deskInsightPanel = (
    <div className="ai-glass-panel ai-card-elevate rounded-panel p-3 space-y-3">
      <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
        <div>
          <p className="ai-section-title font-mono text-intel-ai">Latest Insight · AI</p>
          <p className="text-sm leading-relaxed text-intel-ink2">AI desk notes for {deskInsightSymbol}</p>
          {deskInsightUpdatedLabel && (
            <p className="ai-metadata">Last updated {deskInsightUpdatedLabel}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDeskInsightRefresh}
            disabled={deskInsightLoading || !deskInsightsAllowed}
            className="ai-glass-button ai-focus-ring rounded-md px-3 font-mono text-[10px] font-semibold text-intel-ink2 hover:text-intel-accent disabled:opacity-60"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={handleToggleChat}
            disabled={!chatAllowed}
            className="ai-glass-button ai-focus-ring rounded-md px-3 font-mono text-[10px] font-semibold text-intel-accent disabled:opacity-60"
          >
            Ask AI
          </button>
        </div>
      </div>
      {deskInsightLoading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 w-3/4 rounded bg-intel-panel2" />
          <div className="h-3 w-1/2 rounded bg-intel-panel2" />
          <div className="h-3 w-2/3 rounded bg-intel-panel2" />
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="ai-glass-panel-soft rounded-md px-3 py-2 shadow-none">
            <p className="ai-section-title font-mono text-[11px] text-intel-ai">Summary</p>
            <p className="mt-1 text-sm leading-relaxed text-intel-ink whitespace-pre-line">
              {deskSummary || `No notes yet. Open the AI desk to ask about ${deskInsightSymbol} or any spread.`}
            </p>
          </div>
          {(sentimentText || fedEvent) && (
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {sentimentText && (
                <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-[1px] font-mono ${sentimentStyles}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${sentimentDot}`} />
                  Sentiment: {sentimentText}
                </span>
              )}
              {fedEvent && (
                <span className="inline-flex items-center gap-1 rounded-md border border-intel-warn/30 bg-intel-warn/10 px-1.5 py-[1px] font-mono text-intel-warn">
                  Fed: {fedEvent.title ?? fedEvent.name ?? 'Upcoming event'} · {fedEvent.date ?? 'TBD'}
                </span>
              )}
            </div>
          )}
          {deskHighlights.length ? (
            <ul className="space-y-1 text-xs text-intel-ink2">
              {deskHighlights.map((item: string) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="text-intel-accent">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );

  // Panels shared by the desktop workstation grid and the mobile companion
  // shell — built once so props stay identical in both layouts.
  const sessionBanner =
    marketSessionMeta && (marketSessionMeta.marketClosed || marketSessionMeta.afterHours) ? (
      <div
        className={`flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-panel border-l-2 bg-intel-panel px-3 py-1.5 ${marketSessionMeta.marketClosed
          ? 'border-intel-warn text-intel-warn'
          : 'border-intel-info text-intel-info'
          }`}
        title={marketSessionMeta.note ?? undefined}
      >
        <span className="font-mono text-[11px] font-semibold uppercase tracking-label">
          {marketSessionMeta.marketClosed ? 'Market Closed' : 'After-Hours'}
          {marketSessionMeta.usingLastSession ? ' · Last Session' : ''}
        </span>
        <span className="font-mono text-[11px] text-intel-ink3">
          {marketSessionMeta.marketClosed
            ? 'Data reflects the last completed trading session.'
            : 'Prices update slower during the extended session.'}{' '}
          {marketSessionMeta.nextOpen && `Next session ${formatRelativeTime(marketSessionMeta.nextOpen) ?? ''}.`}
        </span>
      </div>
    ) : null;

  const chartPanelEl = (
    <ChartPanel
          ticker={displayTicker}
          chartKey={chartDataSymbol ?? displayTicker}
          timeframe={timeframe}
          data={bars}
          indicators={indicators}
          isLoading={chartLoading}
          onTimeframeChange={handleTimeframeChange}
          sessionMode={chartSessionMode}
          onSessionModeChange={setChartSessionMode}
          onRunAnalysis={handleChartAnalysisRun}
          analysis={chartAnalysis}
          analysisLoading={chartAnalysisLoading}
          analysisError={chartAnalysisError}
          analysisUpdatedAt={chartAnalysisUpdatedAt}
          analysisDisabled={!chartAnalysisAllowed}
          fallbackPrice={
            underlyingSnapshot && underlyingSnapshot.entryType === 'underlying'
              ? underlyingSnapshot.price ?? null
              : null
          }
          fallbackChange={chartFallbackChange}
          sessionMeta={marketSessionMeta}
          markers={tradeMarkers}
        />
  );

  const ticketPanelEl = (
    <OrderTicketPanel
      contract={contractDetail}
      isLoading={false}
      label={displayTicker}
      spotPrice={resolvedUnderlyingPrice}
      marketClosed={marketSessionMeta?.marketClosed}
      afterHours={marketSessionMeta?.afterHours}
      nextOpen={marketSessionMeta?.nextOpen ?? null}
      onOrderSubmitted={handleOrderSubmitted}
    />
  );

  const chainPanelEl = (
    <>
      {marketSessionMeta?.marketClosed && !liveSubscriptionActive && (
        <div className="mb-3 rounded-panel border border-intel-warn/30 bg-intel-warn/5 text-intel-warn px-4 py-2 text-xs">
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
        selectedContractDetail={contractDetail}
        preferredSide={preferredOptionSide}
        onRequestAnalysis={handleContractAnalysisRequest}
        analysisDisabled={!contractAnalysisAllowed || (!selectedLeg && !contractDetail)}
      />
    </>
  );

  const scannerPanelEl = (
    <OptionsScanner
      reports={scannerReports}
      isLoading={scannerLoading}
      highlights={checklistHighlights}
      highlightLoading={checklistLoading}
      onRunScan={handleScannerRefresh}
      runDisabled={!watchlistSymbols.length || !scannerAllowed}
      aiDisabled={!scannerAllowed}
      onTickerSelect={handleWorkspaceTickerSelect}
    />
  );

  // Main trading workspace layout (watchlist, search, chart, scanner, chain, contract analysis, order ticket).
  const tradingView = (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pb-24 lg:pb-8">
      <div className="lg:col-span-2 flex flex-col gap-4 min-h-[26rem] min-w-0">
        {sessionBanner}
        {chartPanelEl}
      </div>
      <div className="lg:col-span-1 lg:col-start-3 lg:row-start-1 lg:row-span-4 min-h-[26rem] min-w-0 flex flex-col gap-4">
        {ticketPanelEl}
        <PriceLadder
          symbol={activeContractSymbol}
          underlying={displayTicker}
          contractLabel={selectedLeg?.ticker ?? contractDetail?.ticker ?? null}
          socketConnected={liveSocketConnected}
          subscriptionActive={liveSubscriptionActive}
          providerUnavailable={liveSubscriptionUnavailable}
          marketClosed={marketSessionMeta?.marketClosed}
        />
      </div>
      <div className="lg:col-span-2 min-w-0">
        {chainPanelEl}
      </div>
      <div className="lg:col-span-2 min-w-0">
        {deskInsightPanel}
      </div>
      <div className="lg:col-span-2 min-w-0">
        <GreeksPanel
          contract={contractDetail}
          leg={selectedLeg}
          label={displayTicker}
          underlyingPrice={greeksUnderlyingPrice}
          insight={deskInsight}
          selection={contractSelection}
          selectionLoading={contractSelectionLoading}
          onRequestSelection={handleContractSelectionRequest}
          selectionDisabled={!contractSelectionAllowed}
          analysisRequestId={contractAnalysisRequestId}
          analysisDisabled={!contractAnalysisAllowed}
        />
      </div>
      <div className="lg:col-span-3 min-w-0">
        {scannerPanelEl}
      </div>
    </div>
  );

  const showTradingSidebar = view === 'trading';
  const aiControlRows = [
    { label: 'Enable AI', description: 'Master switch for all AI-powered tools.', checked: aiEnabled, disabled: false, onChange: setAiEnabled },
    { label: 'AI Desk', description: 'Enable the AI Desk chat dock.', checked: aiChatEnabled, disabled: !aiEnabled, onChange: setAiChatEnabled },
    { label: 'Desk Insights', description: 'Enable AI summaries, sentiment, and highlights.', checked: aiDeskInsightsEnabled, disabled: !aiEnabled, onChange: setAiDeskInsightsEnabled },
    { label: 'Auto Insights', description: 'Automatically fetch AI insight when you change tickers.', checked: autoDeskInsights, disabled: !deskInsightsAllowed, onChange: setAutoDeskInsights },
    { label: 'Contract Selection', description: 'Enable AI-driven contract picks on demand.', checked: aiContractSelectionEnabled, disabled: !aiEnabled, onChange: setAiContractSelectionEnabled },
    { label: 'Auto Contract Selection', description: 'Let AI pick a contract when the chain loads.', checked: autoContractSelection, disabled: !contractSelectionAllowed, onChange: setAutoContractSelection },
    { label: 'Contract Analysis', description: 'Enable Analyze with AI explanations.', checked: aiContractAnalysisEnabled, disabled: !aiEnabled, onChange: setAiContractAnalysisEnabled },
    { label: '5 Minute Analysis', description: 'Enable the opening-range analysis panel.', checked: aiChartAnalysisEnabled, disabled: !aiEnabled, onChange: setAiChartAnalysisEnabled },
    { label: 'Watchlist Scanner', description: 'Enable AI scanner reports and checklist highlights.', checked: aiScannerEnabled, disabled: !aiEnabled, onChange: setAiScannerEnabled },
    { label: 'Portfolio Sentiment', description: 'Enable AI sentiment refresh for positions.', checked: aiPortfolioSentimentEnabled, disabled: !aiEnabled, onChange: setAiPortfolioSentimentEnabled },
    { label: 'Auto Scanner Loop', description: 'Periodically refresh watchlist highlights.', checked: autoScannerEnabled, disabled: !aiEnabled, onChange: setAutoScannerEnabled },
  ];
  const enabledAiControls = aiControlRows.filter(control => control.checked).length;
  const totalAiControls = aiControlRows.length;
  const setAllAiControls = (enabled: boolean) => {
    setAiEnabled(enabled);
    setAiChatEnabled(enabled);
    setAiDeskInsightsEnabled(enabled);
    setAutoDeskInsights(enabled);
    setAiContractSelectionEnabled(enabled);
    setAutoContractSelection(enabled);
    setAiContractAnalysisEnabled(enabled);
    setAiChartAnalysisEnabled(enabled);
    setAiScannerEnabled(enabled);
    setAiPortfolioSentimentEnabled(enabled);
    setAutoScannerEnabled(enabled);
  };
  const resetAiControls = () => {
    setAiEnabled(true);
    setAiChatEnabled(true);
    setAiDeskInsightsEnabled(true);
    setAutoDeskInsights(false);
    setAiContractSelectionEnabled(true);
    setAutoContractSelection(false);
    setAiContractAnalysisEnabled(true);
    setAiChartAnalysisEnabled(true);
    setAiScannerEnabled(true);
    setAiPortfolioSentimentEnabled(true);
    setAutoScannerEnabled(false);
  };
  const renderAiControlRow = (control: typeof aiControlRows[number]) => (
    <label
      key={control.label}
      className={`group relative flex min-h-10 cursor-pointer items-center justify-between gap-3 border-b border-intel-line/70 px-3 py-2 text-sm transition last:border-b-0 hover:bg-intel-panel2/70 focus-within:bg-intel-panel2/70 ${control.disabled ? 'opacity-45' : ''
        }`}
      title={control.description}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${control.checked ? 'bg-intel-pos' : 'bg-intel-ink3'}`} />
        <span className="truncate font-medium text-intel-ink">{control.label}</span>
        <span className="relative flex-none text-intel-ink3">
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="pointer-events-none absolute left-1/2 top-6 z-10 hidden w-64 -translate-x-1/2 rounded-md border border-intel-line bg-intel-bg px-2.5 py-2 text-xs font-normal leading-relaxed text-intel-ink2 shadow-xl group-hover:block group-focus-within:block">
            {control.description}
          </span>
        </span>
      </span>
      <span className="flex flex-none items-center gap-2">
        <span className={`font-mono text-[10px] font-semibold uppercase tracking-label ${control.checked ? 'text-intel-pos' : 'text-intel-ink3'}`}>
          {control.checked ? 'On' : 'Off'}
        </span>
        <input
          type="checkbox"
          checked={control.checked}
          onChange={event => control.onChange(event.target.checked)}
          disabled={control.disabled}
          aria-label={`${control.label}: ${control.checked ? 'on' : 'off'}`}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className="h-5 w-9 rounded-full border border-intel-line bg-intel-panel2 p-0.5 transition peer-checked:border-intel-accentLine peer-checked:bg-intel-accentSoft peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-intel-accent"
        >
          <span className={`block h-3.5 w-3.5 rounded-full transition ${control.checked ? 'translate-x-4 bg-intel-accent' : 'bg-intel-ink3'}`} />
        </span>
      </span>
    </label>
  );

  // ── Phone companion shell: a different product, not a squeezed desktop. ──
  const mobileActiveConversation = activeConversationId
    ? conversations.find(convo => convo.id === activeConversationId) ?? conversations[0] ?? null
    : conversations[0] ?? null;

  if (isMobile) {
    const mobileBanners = (
      <>
        {marketError && (
          <div className="mb-2 rounded-panel border border-intel-neg/30 bg-intel-neg/10 px-3 py-2 text-sm text-intel-neg">
            {marketError}
          </div>
        )}
        {aiRequestWarning && (
          <div className="mb-2 flex items-start justify-between gap-3 rounded-panel border border-intel-warn/30 bg-intel-warn/10 px-3 py-2 text-sm text-intel-warn">
            <span>{aiRequestWarning}</span>
            <button type="button" onClick={() => setAiRequestWarning(null)} className="text-xs uppercase tracking-[0.2em]">
              ✕
            </button>
          </div>
        )}
        {sessionBanner ? <div className="mb-2">{sessionBanner}</div> : null}
      </>
    );

    const mobileChat = mobileActiveConversation ? (
      <ChatBot
        sessionId={mobileActiveConversation.sessionId}
        conversationTitle={mobileActiveConversation.title || 'Market Chat'}
        initialMessages={transcripts[mobileActiveConversation.sessionId] ?? [DEFAULT_ASSISTANT_MESSAGE]}
        selectedTicker={displayTicker}
        context={aiContext}
        onAssistantReply={setLatestInsight}
        onRequestNewChat={startNewConversation}
        onMessagesChange={messages => handleMessagesChange(mobileActiveConversation.sessionId, messages)}
        onConversationUpdate={handleConversationUpdate}
        launchRequest={agentLaunch}
      />
    ) : (
      <div className="flex h-full items-center justify-center text-sm text-intel-ink3">
        Start a conversation to chat with the desk.
      </div>
    );

    const suspenseFallback = (
      <div className="flex items-center justify-center py-16 text-sm text-intel-ink2">Loading…</div>
    );

    return (
      <>
        <MobileShell
          ticker={displayTicker}
          price={resolvedUnderlyingPrice}
          change={chartFallbackChange?.absolute ?? null}
          changePercent={chartFallbackChange?.percent ?? null}
          marketClosed={marketSessionMeta?.marketClosed}
          onTickerSubmit={handleHeaderTickerSubmit}
          tab={mobileTab}
          onTabChange={setMobileTab}
          onAgentLaunch={handleMobileAgentLaunch}
          chartPanel={chartPanelEl}
          insightPanel={deskInsightPanel}
          ticketPanel={ticketPanelEl}
          matrixPanel={chainPanelEl}
          scannerPanel={
            <Suspense fallback={suspenseFallback}>
              <div className="space-y-3">
                {sidebar}
                {scannerPanelEl}
              </div>
            </Suspense>
          }
          portfolioPanel={
            <Suspense fallback={suspenseFallback}>
              <PortfolioPanel
                aiEnabled={aiEnabled}
                sentimentEnabled={aiPortfolioSentimentEnabled}
                onOpenSystemOperations={() => undefined}
              />
            </Suspense>
          }
          cockpitPanel={
            <Suspense fallback={suspenseFallback}>
              <CockpitLayout />
            </Suspense>
          }
          chat={mobileChat}
          banners={mobileBanners}
        />
        <Toaster richColors position="top-center" theme="dark" />
      </>
    );
  }

  return (
    <div className="h-screen w-full overflow-x-hidden flex flex-col bg-intel-bg text-intel-ink">
      <TradingHeader
        selectedTicker={normalizedTicker}
        onTickerSubmit={handleHeaderTickerSubmit}
        onAddToWatchlist={addTickerToWatchlist}
        currentView={view}
        onViewChange={setView}
        onToggleSidebar={handleToggleSidebar}
        onToggleChat={handleToggleChat}
        isChatOpen={isChatOpen}
        onToggleSettings={handleToggleSettings}
        isSettingsOpen={settingsOpen}
        chatDisabled={!chatAllowed}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      />
      <MarketContextBar />
      {settingsOpen && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/70 sm:px-3 sm:py-3"
          onClick={() => setSettingsOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-settings-title"
            className="flex h-full w-full flex-col border-l border-intel-line bg-intel-panel shadow-2xl sm:max-w-[460px] sm:rounded-panel sm:border sm:border-intel-line"
            onClick={event => event.stopPropagation()}
            onKeyDown={event => {
              if (event.key === 'Escape') setSettingsOpen(false);
            }}
          >
            <div className="border-b border-intel-line px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-intel-ink3">Settings</p>
                  <h2 id="ai-settings-title" className="mt-1 text-lg font-semibold text-intel-ink">AI Operator Controls</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Close AI operator controls"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-intel-line text-intel-ink2 transition hover:border-intel-accentLine hover:text-intel-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between rounded-md border border-intel-line bg-intel-bg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${enabledAiControls ? 'bg-intel-pos' : 'bg-intel-ink3'}`} />
                  <span className="text-sm font-semibold text-intel-ink">{enabledAiControls} / {totalAiControls} Enabled</span>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-label text-intel-ink3">AI Systems</span>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <section className="overflow-visible rounded-md border border-intel-line bg-intel-bg">
                <div className="border-b border-intel-line bg-intel-panel2/60 px-3 py-2">
                  <h3 className="font-mono text-[11px] font-semibold uppercase tracking-label text-intel-ink3">General</h3>
                </div>
                {aiControlRows.slice(0, 3).map(renderAiControlRow)}
              </section>

              <section className="mt-3 overflow-visible rounded-md border border-intel-line bg-intel-bg">
                <div className="border-b border-intel-line bg-intel-panel2/60 px-3 py-2">
                  <h3 className="font-mono text-[11px] font-semibold uppercase tracking-label text-intel-ink3">Automation</h3>
                </div>
                {aiControlRows.slice(3, 6).map(renderAiControlRow)}
              </section>

              <section className="mt-3 overflow-visible rounded-md border border-intel-line bg-intel-bg">
                <div className="border-b border-intel-line bg-intel-panel2/60 px-3 py-2">
                  <h3 className="font-mono text-[11px] font-semibold uppercase tracking-label text-intel-ink3">Analysis</h3>
                </div>
                {aiControlRows.slice(6, 9).map(renderAiControlRow)}
              </section>

              <section className="mt-3 overflow-visible rounded-md border border-intel-line bg-intel-bg">
                <div className="border-b border-intel-line bg-intel-panel2/60 px-3 py-2">
                  <h3 className="font-mono text-[11px] font-semibold uppercase tracking-label text-intel-ink3">Advanced</h3>
                </div>
                {aiControlRows.slice(9).map(renderAiControlRow)}
                <div className="flex items-center justify-between gap-3 border-t border-intel-line/70 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-intel-ink">Order Execution</span>
                  </span>
                  <span className="flex flex-none items-center gap-1.5 rounded-md border border-intel-line bg-intel-panel2 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-label text-intel-ink3">
                    Locked
                  </span>
                </div>
                <details className="border-t border-intel-line/70">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium text-intel-ink transition hover:bg-intel-panel2/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-intel-accent">
                    Advanced Settings
                    <ChevronRight className="h-4 w-4 text-intel-ink3" aria-hidden="true" />
                  </summary>
                  <div className="border-t border-intel-line/70 px-3 py-2 text-xs leading-relaxed text-intel-ink3">
                    Future model routing, experimental features, and debug options are not enabled in this build.
                  </div>
                </details>
              </section>
            </div>

            <div className="border-t border-intel-line bg-intel-panel px-3 py-3">
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setAllAiControls(true)}
                  className="rounded-md border border-intel-line bg-intel-panel2 px-2 py-2 text-xs font-semibold text-intel-ink2 transition hover:border-intel-accentLine hover:text-intel-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent"
                >
                  Enable All
                </button>
                <button
                  type="button"
                  onClick={() => setAllAiControls(false)}
                  className="rounded-md border border-intel-line bg-intel-panel2 px-2 py-2 text-xs font-semibold text-intel-ink2 transition hover:border-intel-accentLine hover:text-intel-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent"
                >
                  Disable All
                </button>
                <button
                  type="button"
                  onClick={resetAiControls}
                  className="inline-flex items-center justify-center gap-1 rounded-md border border-intel-line bg-intel-panel2 px-2 py-2 text-xs font-semibold text-intel-ink2 transition hover:border-intel-accentLine hover:text-intel-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reset
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden bg-intel-bg relative">
        <NavRail
          currentView={view}
          onViewChange={setView}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        />
        {sidebarOpen && showTradingSidebar && (
          <div className="fixed inset-0 bg-black/60 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        <aside
          className={`fixed inset-y-0 left-0 z-30 w-72 transform transition-transform duration-300 bg-intel-bg border-r border-intel-line lg:static lg:z-0 lg:translate-x-0 ${sidebarOpen && showTradingSidebar ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
            } ${showTradingSidebar ? 'lg:w-72' : 'lg:w-0 lg:overflow-hidden lg:-translate-x-full'}`}
          aria-hidden={!showTradingSidebar}
        >
          <div className="h-full overflow-y-auto px-2">{sidebar}</div>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center py-20 text-sm text-intel-ink2">
                Loading workspace…
              </div>
            }
          >
            <div className="w-full max-w-screen-2xl mx-auto px-4 py-6 flex flex-col gap-4">
              {marketError && (
                <div className="rounded-panel border border-intel-neg/30 bg-intel-neg/10 text-sm text-intel-neg px-4 py-3">
                  {marketError}
                </div>
              )}
              {aiRequestWarning && (
                <div className="rounded-panel border border-intel-warn/30 bg-intel-warn/10 text-sm text-intel-warn px-4 py-3 flex items-start justify-between gap-4">
                  <span>{aiRequestWarning}</span>
                  <button
                    type="button"
                    onClick={() => setAiRequestWarning(null)}
                    className="text-xs uppercase tracking-[0.2em] text-intel-warn hover:text-intel-ink"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {view === 'trading' && tradingView}
              {view === 'portfolio' && (
                <div className="pb-24">
                  <PortfolioPanel
                    aiEnabled={aiEnabled}
                    sentimentEnabled={aiPortfolioSentimentEnabled}
                    onOpenSystemOperations={() => setView('operations')}
                  />
                </div>
              )}
              {view === 'cockpit' && (
                <div className="pb-24">
                  <CockpitLayout />
                </div>
              )}
              {view === 'intelligence' && <TradingIntelligencePage />}
              {view === 'operations' && <SystemOperationsPage />}
            </div>
          </Suspense>
        </main>
      </div>

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onViewChange={setView}
        onTickerSubmit={handleHeaderTickerSubmit}
      />

      <ChatDock
        isOpen={isChatOpen && chatAllowed}
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
      <Toaster richColors position="bottom-right" theme="dark" />
    </div>
  );
}

export default App;

// Initialize a new blank conversation entry the dock can display immediately.
function createConversation(
  title = 'New chat',
  preview = 'Ask the desk anything to get started.',
  symbol = 'SPY'
): ConversationMeta {
  const sessionId = crypto.randomUUID();
  const timestamp = Date.now();
  const normalizedSymbol = symbol.trim().toUpperCase() || 'SPY';
  return {
    id: sessionId,
    sessionId,
    symbol: normalizedSymbol,
    title,
    preview,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

// Clean API payloads to ensure the rest of the app sees consistent conversation data.
function normalizeConversation(payload: ConversationPayload, fallbackSymbol?: string): ConversationMeta {
  return {
    id: payload.sessionId,
    sessionId: payload.sessionId,
    symbol: (payload.symbol ?? fallbackSymbol ?? null)?.trim().toUpperCase() ?? null,
    title: payload.title || 'New chat',
    preview: payload.preview || 'Ask the agent anything to get started.',
    createdAt: Date.parse(payload.createdAt),
    updatedAt: Date.parse(payload.updatedAt),
  };
}

function conversationStorageKey(symbol: string): string {
  return `${STORAGE_KEY}.${symbol.trim().toUpperCase() || 'SPY'}`;
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
  const spread = bidPrice != null && askPrice != null ? Math.max(0, askPrice - bidPrice) : null;
  const midpoint =
    coerceNumber(event.midpoint ?? event.mid) ??
    (bidPrice != null && askPrice != null ? (bidPrice + askPrice) / 2 : bidPrice ?? askPrice ?? null);
  const providerTimestamp = coerceTimestamp(event.t ?? event.ts ?? event.timestamp ?? event.receivedAt);
  const lastTradeTimestamp = coerceTimestampNullable(event.lastTradeTimestamp);

  return {
    ticker,
    underlying: typeof event.underlying === 'string' ? event.underlying : extractUnderlyingFromOptionTicker(ticker),
    timestamp: providerTimestamp,
    bidPrice,
    askPrice,
    bidSize,
    askSize,
    bidExchange: event.bx ?? event.bidExchange ?? undefined,
    askExchange: event.ax ?? event.askExchange ?? undefined,
    spread,
    midpoint,
    mark: coerceNumber(event.mark) ?? midpoint,
    last: coerceNumber(event.last),
    lastSize: coerceNumber(event.lastSize),
    lastTradeTimestamp,
    sequenceNumber: coerceNumber(event.q ?? event.sequenceNumber),
    updated: providerTimestamp,
    receivedAt: coerceTimestamp(event.receivedAt ?? providerTimestamp),
    source: normalizeQuoteSource(event.source),
    dataMode: normalizeDataMode(event.dataMode),
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
  const sequenceNumber = event.q ?? event.sequenceNumber ?? null;
  const idSource = event.i ?? event.id ?? `${ticker}-${timestamp}-${sequenceNumber ?? 'na'}-${price}-${size}`;
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

function normalizeQuoteSource(value: any): QuoteSnapshot['source'] {
  if (value === 'websocket' || value === 'rest-snapshot' || value === 'delayed-websocket') return value;
  if (value === 'ws-cache' || value === 'rest-cache' || value === 'snapshot') return value;
  return undefined;
}

function normalizeDataMode(value: any): QuoteSnapshot['dataMode'] {
  if (value === 'live' || value === 'delayed' || value === 'snapshot') return value;
  return undefined;
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
  return coerceTimestampNullable(value) ?? Date.now();
}

function coerceTimestampNullable(value: any): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1_000_000_000_000_000) return Math.floor(value / 1_000_000);
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      if (numeric > 1_000_000_000_000_000) return Math.floor(numeric / 1_000_000);
      return numeric > 10_000_000_000 ? numeric : numeric * 1000;
    }
  }
  return null;
}
