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
import { chatApi, marketApi } from './api';
import { DEFAULT_ASSISTANT_MESSAGE } from './constants';
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
import type { ChatMessage, ConversationMeta, ConversationPayload, ConversationResponse } from './types';

const TIMEFRAME_MAP = {
  '1/day': { multiplier: 1, timespan: 'day' as const },
  '1/hour': { multiplier: 1, timespan: 'hour' as const },
  '5/minute': { multiplier: 5, timespan: 'minute' as const },
};

const SMA_WINDOW = 50;

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

function buildIndicatorBundle(symbol: string, bars: AggregateBar[]): IndicatorBundle | undefined {
  if (!bars.length) return undefined;
  return {
    ticker: symbol,
    sma: computeSMA(bars),
  };
}

type View = 'trading' | 'scanner' | 'portfolio';
type TimeframeKey = keyof typeof TIMEFRAME_MAP;
const STORAGE_KEY = 'market-copilot.conversations';

function App() {
  const [view, setView] = useState<View>('trading');
  const [ticker, setTicker] = useState('SPY');
  const normalizedTicker = ticker.trim().toUpperCase() || 'SPY';

  const [sidebarOpen, setSidebarOpen] = useState(false);

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
  const [contractLoading, setContractLoading] = useState(false);

  const [timeframe, setTimeframe] = useState<TimeframeKey>('1/day');
  const [bars, setBars] = useState<AggregateBar[]>([]);
  const [indicators, setIndicators] = useState<IndicatorBundle>();
  const [chartLoading, setChartLoading] = useState(false);

  const [quote, setQuote] = useState<QuoteSnapshot | null>(null);
  const [trades, setTrades] = useState<TradePrint[]>([]);
  const [underlyingSnapshot, setUnderlyingSnapshot] = useState<WatchlistSnapshot | null>(null);
  const underlyingSnapshotRef = useRef<WatchlistSnapshot | null>(null);

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
  const chartCacheRef = useRef<
    Map<string, { timestamp: number; bars: AggregateBar[]; indicators?: IndicatorBundle }>
  >(new Map());
  const chartFetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chartRequestIdRef = useRef(0);
  const displayTicker = normalizedTicker;

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

  const mergedExpirations = useMemo(() => {
    const merged = new Set<string>();
    availableExpirations.forEach(value => merged.add(value));
    customExpirations.forEach(value => merged.add(value));
    return Array.from(merged).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  }, [availableExpirations, customExpirations]);

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

  useEffect(() => {
    hydrateConversations();
  }, [hydrateConversations]);

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

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    if (!activeConversationId && conversations.length) {
      setActiveConversationId(conversations[0].id);
    }
  }, [conversations, activeConversationId]);

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
            const fallbackUnderlying =
              response?.underlyingPrice ??
              (underlyingSnapshotRef.current?.entryType === 'underlying'
                ? underlyingSnapshotRef.current.price ?? null
                : null);
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

  useEffect(() => {
    setCustomExpirations([]);
    invalidExpirationsRef.current.clear();
  }, [normalizedTicker]);

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

  useEffect(() => {
    if (activeContractSymbol) {
      setMarketError(null);
    }
  }, [activeContractSymbol]);

  useEffect(() => {
    if (!activeContractSymbol) {
      setContractDetail(null);
      setContractLoading(false);
      return;
    }
    const symbol = activeContractSymbol!;
    let cancelled = false;
    async function loadDetail() {
      setContractLoading(true);
      try {
        const detail = await marketApi.getOptionContract(symbol);
        if (!cancelled) {
          setContractDetail(detail);
        }
      } catch (error: any) {
        if (!cancelled) {
          const message = error?.response?.data?.error ?? error?.message ?? 'Failed to load contract details';
          setMarketError(message);
          setContractDetail(null);
        }
      } finally {
        if (!cancelled) setContractLoading(false);
      }
    }
    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [activeContractSymbol]);

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
    const cacheKey = `${symbol}-${timeframe}`;
    const cached = chartCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 15_000) {
      setBars(cached.bars);
      setIndicators(cached.indicators);
      return;
    }

    setChartLoading(true);
    setMarketError(null);

    const scheduleFetch = () => {
      chartRequestIdRef.current += 1;
      const requestId = chartRequestIdRef.current;
      const config = TIMEFRAME_MAP[timeframe];

      const fetchAggregates = async () => {
        const response = await marketApi.getAggregates({
          ticker: symbol,
          multiplier: config.multiplier,
          timespan: config.timespan,
          window: 180,
        });
        return response;
      };

      const runFetch = async () => {
        const aggregates = await fetchAggregates();
        if (chartRequestIdRef.current !== requestId) return;
        const bars = aggregates.results ?? [];
        const indicatorBundle = buildIndicatorBundle(symbol, bars);
        setBars(bars);
        setIndicators(indicatorBundle);
        chartCacheRef.current.set(cacheKey, {
          bars,
          indicators: indicatorBundle,
          timestamp: Date.now(),
        });
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

    chartFetchTimeoutRef.current = setTimeout(scheduleFetch, 200);

    return () => {
      if (chartFetchTimeoutRef.current) {
        clearTimeout(chartFetchTimeoutRef.current);
        chartFetchTimeoutRef.current = null;
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
    timer = setInterval(loadSnapshots, 60_000);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [activeContractSymbol]);

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

  async function handleConversationSelect(id: string) {
    setActiveConversationId(id);
    const convo = conversations.find(c => c.id === id);
    if (convo) {
      setLatestInsight(convo.preview);
      await ensureTranscriptLoaded(convo.sessionId);
    }
  }

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

  function handleConversationUpdate(payload: ConversationPayload) {
    const normalized = normalizeConversation(payload);
    setConversations(prev => {
      const filtered = prev.filter(convo => convo.sessionId !== normalized.sessionId);
      return [normalized, ...filtered];
    });
    setLatestInsight(normalized.preview);
  }

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
    />
  );

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

  const handleExpirationChange = useCallback((value: string | null) => {
    pendingSelectionRef.current.expiration = null;
    if (value) {
      invalidExpirationsRef.current.delete(value);
    }
    setSelectedExpiration(value);
    setSelectedLeg(null);
    setDesiredContract(null);
  }, []);

  const tradingView = (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pb-24 lg:pb-8">
      <div className="lg:col-span-2 flex flex-col gap-4 min-h-[26rem] min-w-0">
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
        <GreeksPanel contract={contractDetail} label={displayTicker} />
      </div>
      <div className="lg:col-span-1 min-h-[26rem] min-w-0">
        <OrderTicketPanel
          contract={contractDetail}
          quote={quote}
          trades={trades}
          isLoading={contractLoading}
          label={displayTicker}
        />
      </div>
      <div className="lg:col-span-3 min-w-0">
        <OptionsChainPanel
          ticker={displayTicker}
          groups={chainExpirations}
          underlyingPrice={chainUnderlyingPrice}
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

function mapMessages(response: ConversationResponse): ChatMessage[] {
  return (response.messages ?? []).map(message => ({
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: Date.parse(message.timestamp),
  }));
}

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
