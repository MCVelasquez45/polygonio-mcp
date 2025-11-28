import { useCallback, useEffect, useRef, useState } from 'react';
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

  const [marketError, setMarketError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [transcripts, setTranscripts] = useState<Record<string, ChatMessage[]>>({});
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [latestInsight, setLatestInsight] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const transcriptsRef = useRef<Record<string, ChatMessage[]>>(transcripts);
  const activeConversationIdRef = useRef<string | null>(activeConversationId);
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
    let cancelled = false;
    async function loadChain() {
      setChainLoading(true);
      setChainError(null);
      try {
        const response = await marketApi.getOptionsChain({ ticker: normalizedTicker, limit: 150 });
        console.log('[CLIENT] options chain response', {
          ticker: normalizedTicker,
          expirations: response?.expirations?.length ?? 0,
          sample: response?.expirations?.[0]
        });
        if (!cancelled) {
          const groups = Array.isArray(response.expirations) ? response.expirations : [];
          if (!groups.length) {
            setChainError(`No option contracts found for ${normalizedTicker}.`);
            setChainExpirations([]);
            setChainUnderlyingPrice(response?.underlyingPrice ?? null);
          } else {
            setChainExpirations(groups);
            setChainUnderlyingPrice(response?.underlyingPrice ?? null);
          }
        }
      } catch (error: any) {
        if (!cancelled) {
          const message = error?.response?.data?.error ?? error?.message ?? 'Failed to load options chain';
          setChainError(message);
          setChainExpirations([]);
          setChainUnderlyingPrice(null);
        }
      } finally {
        if (!cancelled) setChainLoading(false);
      }
    }
    loadChain();
    return () => {
      cancelled = true;
    };
  }, [normalizedTicker]);

  useEffect(() => {
    setSelectedLeg(null);
    setDesiredContract(normalizedTicker.startsWith('O:') ? normalizedTicker : null);
    setContractDetail(null);
    setBars([]);
    setIndicators(undefined);
    setQuote(null);
    setTrades([]);
    setMarketError(null);
    setChainExpirations([]);
    setChainUnderlyingPrice(null);
    setChainError(null);
    setUnderlyingSnapshot(null);
  }, [normalizedTicker]);

  useEffect(() => {
    if (!desiredContract) return;
    if (!chainExpirations.length) return;
    if (selectedLeg?.ticker?.toUpperCase() === desiredContract.toUpperCase()) return;
    const matching = findLegByTicker(chainExpirations, desiredContract);
    if (matching) {
      setSelectedLeg(matching);
    }
  }, [chainExpirations, desiredContract, selectedLeg]);

  useEffect(() => {
    if (!normalizedTicker || normalizedTicker.startsWith('O:')) {
      setUnderlyingSnapshot(null);
      return;
    }
    let cancelled = false;
    async function loadSnapshot() {
      try {
        const payload = await marketApi.getWatchlistSnapshots([normalizedTicker]);
        if (!cancelled) {
          const snapshot = payload.entries?.[0] ?? null;
          setUnderlyingSnapshot(snapshot);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to load underlying snapshot', error);
          setUnderlyingSnapshot(null);
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
      onSelectTicker={next => {
        setTicker(next);
        setSidebarOpen(false);
      }}
    />
  );

  const handleContractSelection = useCallback(
    (leg: OptionLeg | null) => {
      setSelectedLeg(leg);
      if (leg?.ticker) {
        setDesiredContract(leg.ticker.toUpperCase());
      } else if (normalizedTicker.startsWith('O:')) {
        setDesiredContract(normalizedTicker);
      } else {
        setDesiredContract(null);
      }
    },
    [normalizedTicker]
  );

  const tradingView = (
    <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 p-3 md:p-6 pb-24 lg:pb-6 overflow-y-auto w-full max-w-7xl mx-auto">
      <div className="lg:col-span-8 flex flex-col gap-4 min-h-[26rem]">
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
      <div className="lg:col-span-4 min-h-[26rem]">
        <OrderTicketPanel
          contract={contractDetail}
          quote={quote}
          trades={trades}
          isLoading={contractLoading}
          label={displayTicker}
        />
      </div>
      <div className="lg:col-span-12">
        <OptionsChainPanel
          ticker={displayTicker}
          groups={chainExpirations}
          underlyingPrice={chainUnderlyingPrice}
          loading={chainLoading}
          error={chainError}
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
        onTickerSubmit={value => setTicker(value)}
        currentView={view}
        onViewChange={setView}
        onToggleSidebar={() => setSidebarOpen(prev => !prev)}
        onToggleChat={() => setIsChatOpen(prev => !prev)}
        isChatOpen={isChatOpen}
      />

      <div className="flex flex-1 overflow-hidden relative">
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/60 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        <div
          className={`fixed inset-y-0 left-0 z-30 w-72 transform transition-transform duration-300 lg:relative lg:z-0 lg:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          }`}
        >
          {sidebar}
        </div>

        <main className="flex-1 flex flex-col overflow-hidden bg-gray-950">
          {marketError && (
            <div className="mx-3 mt-3 rounded-2xl border border-red-500/30 bg-red-500/10 text-sm text-red-300 px-4 py-3">
              {marketError}
            </div>
          )}

          {view === 'trading' && tradingView}
          {view === 'scanner' && (
            <div className="flex-1 overflow-y-auto p-3 md:p-6 pb-20 w-full max-w-5xl mx-auto">
              <OptionsScanner onTickerSelect={value => {
                setTicker(value);
                setView('trading');
              }} />
            </div>
          )}
          {view === 'portfolio' && (
            <div className="flex-1 overflow-y-auto p-3 md:p-6 pb-20 w-full max-w-5xl mx-auto">
              <PortfolioPanel />
            </div>
          )}
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
