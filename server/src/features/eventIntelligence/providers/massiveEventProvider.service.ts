import { createHash } from 'crypto';
import { massiveGet, REQUEST_PRIORITY } from '../../../shared/data/massive';
import { getInflation, getLaborMarket, getTickerNews, getTreasuryYields } from '../../../shared/data/massiveMacro';
import { getMarketStatusSnapshot } from '../../market/services/marketStatus';
import { classifyEventText, enrichEventClassification, inferSentiment } from '../classification/classifier.service';
import type { EventProvider, NormalizedMarketEvent } from '../types/eventTypes';

const EVENT_NEWS_TTL_MS = 5 * 60_000;
const EVENT_REFERENCE_TTL_MS = 15 * 60_000;

function eventId(provider: EventProvider, parts: Array<string | null | undefined>): string {
  const hash = createHash('sha256').update([provider, ...parts].join('|')).digest('hex').slice(0, 24);
  return `${provider}:${hash}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeSymbols(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(value => String(value ?? '').trim().toUpperCase()).filter(Boolean))].sort();
}

function normalizeNewsArticle(article: {
  id: string;
  title: string;
  description: string | null;
  publisher: string | null;
  publishedUtc: string | null;
  articleUrl: string | null;
  tickers: string[];
  sentiment: { ticker: string; sentiment: string; reasoning: string | null }[];
}, provider: EventProvider): NormalizedMarketEvent {
  const classified = classifyEventText(article.title, article.description);
  const primarySentiment = article.sentiment[0] ?? null;
  const event: NormalizedMarketEvent = {
    id: eventId(provider, [article.id, article.title, article.publishedUtc]),
    provider,
    timestamp: article.publishedUtc ?? nowIso(),
    title: article.title,
    summary: article.description,
    category: classified.category,
    sentiment: inferSentiment(primarySentiment?.sentiment, article.title, article.description),
    symbols: normalizeSymbols(article.tickers),
    sectors: classified.sectors,
    confidence: classified.confidence,
    importance: 0,
    importanceExplanation: 'Importance is assigned by the Event Importance Engine.',
    source: article.publisher,
    url: article.articleUrl,
    raw: { article },
  };
  return enrichEventClassification(event);
}

async function fetchMarketNews(limit: number): Promise<NormalizedMarketEvent[]> {
  const payload = await massiveGet<any>(
    '/v2/reference/news',
    { limit, order: 'desc', sort: 'published_utc' },
    { cacheTtlMs: EVENT_NEWS_TTL_MS, priority: REQUEST_PRIORITY.SCANNER }
  );
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results.map((item: any) => normalizeNewsArticle({
    id: String(item?.id ?? ''),
    title: String(item?.title ?? ''),
    description: item?.description ?? null,
    publisher: item?.publisher?.name ?? null,
    publishedUtc: item?.published_utc ?? null,
    articleUrl: item?.article_url ?? null,
    tickers: normalizeSymbols(item?.tickers),
    sentiment: Array.isArray(item?.insights)
      ? item.insights.map((insight: any) => ({
          ticker: String(insight?.ticker ?? ''),
          sentiment: String(insight?.sentiment ?? 'unknown'),
          reasoning: insight?.sentiment_reasoning ?? null,
        }))
      : [],
  }, 'massive-market-news'));
}

async function fetchCompanyNews(symbols: string[], limit: number): Promise<NormalizedMarketEvent[]> {
  const articles = await Promise.all(symbols.map(symbol => getTickerNews(symbol, limit).catch(() => [])));
  return articles.flat().map(article => normalizeNewsArticle(article, 'massive-news'));
}

async function fetchSentiment(symbols: string[]): Promise<NormalizedMarketEvent[]> {
  const events = await Promise.all(symbols.map(async symbol => {
    const payload = await massiveGet<any>(
      `/v1/sentiment/${symbol.toUpperCase()}`,
      {},
      { cacheTtlMs: EVENT_REFERENCE_TTL_MS, priority: REQUEST_PRIORITY.SCANNER }
    ).catch(() => null);
    const raw = Array.isArray(payload?.results) ? payload.results[0] : payload?.result ?? payload ?? null;
    if (!raw) return null;
    const score = typeof raw.score === 'number' ? raw.score : typeof raw.sentiment_score === 'number' ? raw.sentiment_score : typeof raw.net_sentiment === 'number' ? raw.net_sentiment : null;
    const label = raw.label ?? raw.sentiment ?? (score != null ? score > 0.2 ? 'bullish' : score < -0.2 ? 'bearish' : 'neutral' : 'unknown');
    const title = `${symbol.toUpperCase()} sentiment ${label}`;
    const classified = classifyEventText(title, null);
    return enrichEventClassification({
      id: eventId('massive-sentiment', [symbol, String(label), String(score)]),
      provider: 'massive-sentiment',
      timestamp: nowIso(),
      title,
      summary: raw.summary ?? raw.reasoning ?? null,
      category: classified.category,
      sentiment: { label, score, explanation: 'Sentiment supplied by Massive sentiment endpoint.' },
      symbols: [symbol.toUpperCase()],
      sectors: classified.sectors,
      confidence: score == null ? 0.55 : Math.min(0.95, Math.abs(score) + 0.45),
      importance: 0,
      importanceExplanation: 'Importance is assigned by the Event Importance Engine.',
      source: 'Massive sentiment',
      url: null,
      raw: { payload: raw },
    } as NormalizedMarketEvent);
  }));
  return events.filter((event): event is NormalizedMarketEvent => event != null);
}

async function fetchMarketStatusEvent(): Promise<NormalizedMarketEvent[]> {
  const status = await getMarketStatusSnapshot();
  const title = `Market status is ${status.market}`;
  return [{
    id: eventId('massive-market-status', [status.market, status.serverTime.toISOString()]),
    provider: 'massive-market-status',
    timestamp: status.serverTime.toISOString(),
    title,
    summary: `Market=${status.market}; preMarket=${status.preMarket}; afterHours=${status.afterHours}; weekend=${status.isWeekend}; holiday=${status.isHoliday}.`,
    category: 'Market Status',
    sentiment: { label: status.market === 'open' ? 'neutral' : 'unknown', score: null, explanation: 'Market status is contextual, not directional.' },
    symbols: ['SPY', 'QQQ'],
    sectors: [],
    confidence: 0.9,
    importance: 0,
    importanceExplanation: 'Importance is assigned by the Event Importance Engine.',
    source: 'Massive market status',
    url: null,
    raw: { status },
  }];
}

async function fetchEconomicEvents(): Promise<NormalizedMarketEvent[]> {
  const [yields, inflation, labor] = await Promise.all([
    getTreasuryYields(2).catch(() => []),
    getInflation(2).catch(() => []),
    getLaborMarket(2).catch(() => []),
  ]);
  const events: NormalizedMarketEvent[] = [];
  for (const row of yields.slice(0, 1)) {
    events.push({
      id: eventId('massive-economic', ['treasury-yields', row.date]),
      provider: 'massive-economic',
      timestamp: `${row.date}T12:00:00.000Z`,
      title: 'Treasury yield update',
      summary: `2Y=${row.yield2Year ?? 'n/a'}, 10Y=${row.yield10Year ?? 'n/a'}, 30Y=${row.yield30Year ?? 'n/a'}.`,
      category: 'Economic',
      sentiment: { label: 'neutral', score: null, explanation: 'Yield events require downstream strategy interpretation.' },
      symbols: ['SPY', 'QQQ', 'XLF'],
      sectors: ['Financial'],
      confidence: 0.8,
      importance: 0,
      importanceExplanation: 'Importance is assigned by the Event Importance Engine.',
      source: 'Massive economy',
      url: null,
      raw: { row },
    });
  }
  for (const [name, rows] of [['Inflation', inflation], ['Labor market', labor]] as const) {
    const row = rows[0];
    if (!row) continue;
    events.push({
      id: eventId('massive-economic', [name, row.date]),
      provider: 'massive-economic',
      timestamp: `${row.date}T12:00:00.000Z`,
      title: `${name} update`,
      summary: Object.entries(row.values).slice(0, 4).map(([key, value]) => `${key}=${value}`).join(', '),
      category: 'Economic',
      sentiment: { label: 'neutral', score: null, explanation: 'Macro events are stored as context unless provider sentiment is supplied.' },
      symbols: ['SPY', 'QQQ'],
      sectors: [],
      confidence: 0.75,
      importance: 0,
      importanceExplanation: 'Importance is assigned by the Event Importance Engine.',
      source: 'Massive economy',
      url: null,
      raw: { row },
    });
  }
  return events;
}

async function fetchReferenceEndpoint(path: string, provider: EventProvider, category: NormalizedMarketEvent['category'], symbols: string[], limit: number): Promise<NormalizedMarketEvent[]> {
  const payload = await massiveGet<any>(
    path,
    { limit, order: 'desc' },
    { cacheTtlMs: EVENT_REFERENCE_TTL_MS, priority: REQUEST_PRIORITY.SCANNER }
  ).catch(() => null);
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results.map((row: any) => {
    const symbol = String(row?.ticker ?? row?.symbol ?? row?.underlying_ticker ?? '').toUpperCase();
    const date = row?.execution_date ?? row?.declaration_date ?? row?.pay_date ?? row?.date ?? row?.report_date ?? nowIso();
    const title = `${category}: ${symbol || path}`;
    return enrichEventClassification({
      id: eventId(provider, [path, symbol, String(date), JSON.stringify(row).slice(0, 128)]),
      provider,
      timestamp: String(date).includes('T') ? String(date) : `${date}T12:00:00.000Z`,
      title,
      summary: row?.description ?? row?.type ?? null,
      category,
      sentiment: inferSentiment(row?.sentiment, title, row?.description ?? null),
      symbols: normalizeSymbols(symbol ? [symbol] : symbols),
      sectors: [],
      confidence: 0.65,
      importance: 0,
      importanceExplanation: 'Importance is assigned by the Event Importance Engine.',
      source: 'Massive reference',
      url: null,
      raw: { row },
    });
  });
}

export async function fetchMassiveEvents(args: { symbols?: string[]; limit?: number } = {}): Promise<NormalizedMarketEvent[]> {
  const symbols = normalizeSymbols(args.symbols ?? ['SPY', 'QQQ', 'XLE', 'OXY', 'CVX', 'NVDA', 'AMD']);
  const limit = Math.max(1, Math.min(50, args.limit ?? 10));
  const batches = await Promise.all([
    fetchMarketNews(limit).catch(() => []),
    fetchCompanyNews(symbols.slice(0, 8), Math.min(5, limit)).catch(() => []),
    fetchSentiment(symbols.slice(0, 8)).catch(() => []),
    fetchMarketStatusEvent().catch(() => []),
    fetchEconomicEvents().catch(() => []),
    fetchReferenceEndpoint('/vX/reference/financials', 'massive-earnings', 'Earnings', symbols, limit).catch(() => []),
    fetchReferenceEndpoint('/v3/reference/dividends', 'massive-corporate-actions', 'Corporate Action', symbols, limit).catch(() => []),
    fetchReferenceEndpoint('/v3/reference/splits', 'massive-corporate-actions', 'Corporate Action', symbols, limit).catch(() => []),
  ]);
  const byId = new Map<string, NormalizedMarketEvent>();
  for (const event of batches.flat()) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}
