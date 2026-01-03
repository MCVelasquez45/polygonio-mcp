import { agentAnalyze } from '../assistant/agentClient';
import { getMassiveOptionsSnapshot, getMassiveShortInterest, getMassiveShortVolume } from '../../shared/data/massive';
import { getRecentAggregateBars } from '../market/services/aggregatesStore';

type SentimentSnapshot = {
  label?: string | null;
  score?: number | null;
};

type FedEventSnapshot = {
  title?: string;
  name?: string;
  date?: string;
  impact?: string;
} | null;

export type DeskInsight = {
  symbol: string;
  summary: string | null;
  sentiment: SentimentSnapshot | null;
  fedEvent: FedEventSnapshot | null;
  highlights: string[];
  shortBias?: { label?: 'bullish' | 'bearish' | 'neutral' | null; reasons?: string[] } | null;
  source: 'agent' | 'snapshot';
  updatedAt: string;
};

type DeskContext = {
  symbol: string;
  snapshot?: Record<string, any> | null;
  dailyBars?: { t: string; o: number; h: number; l: number; c: number; v: number }[];
  minuteBars?: { t: string; o: number; h: number; l: number; c: number; v: number }[];
  metrics?: Record<string, any>;
};

type ShortInterestSnapshot = {
  settlementDate: string | null;
  shortInterest: number | null;
  avgDailyVolume: number | null;
  daysToCover: number | null;
  changePct: number | null;
};

type ShortVolumeSnapshot = {
  date: string | null;
  shortVolume: number | null;
  shortVolumeRatio: number | null;
  averageShortVolume: number | null;
  spike: boolean | null;
};

function normalizeBars(bars: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[]) {
  return bars
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(bar => ({
      t: new Date(bar.timestamp).toISOString(),
      o: bar.open,
      h: bar.high,
      l: bar.low,
      c: bar.close,
      v: bar.volume
    }));
}

function formatNumber(value: number | null | undefined, options: Intl.NumberFormatOptions = {}) {
  if (value == null || Number.isNaN(value)) return null;
  return new Intl.NumberFormat('en-US', options).format(value);
}

function deriveShortInterestBias(
  shortInterest?: ShortInterestSnapshot | null,
  shortVolume?: ShortVolumeSnapshot | null
): { label: 'bullish' | 'bearish' | 'neutral' | null; reasons: string[] } {
  if (!shortInterest && !shortVolume) return { label: null, reasons: [] };
  const reasons: string[] = [];
  const shortInterestBearish =
    (typeof shortInterest?.changePct === 'number' && shortInterest.changePct >= 20) ||
    (typeof shortInterest?.daysToCover === 'number' && shortInterest.daysToCover >= 5);
  const shortInterestBullish =
    typeof shortInterest?.changePct === 'number' &&
    shortInterest.changePct <= -20 &&
    (shortInterest.daysToCover == null || shortInterest.daysToCover <= 3);
  const shortVolumeBearish =
    shortVolume?.spike === true ||
    (typeof shortVolume?.shortVolumeRatio === 'number' && shortVolume.shortVolumeRatio >= 50);

  if (shortInterestBearish) reasons.push('Short interest elevated');
  if (shortVolumeBearish) reasons.push('Short volume elevated');

  if (shortInterestBearish || shortVolumeBearish) {
    return { label: 'bearish', reasons };
  }
  if (shortInterestBullish) {
    return { label: 'bullish', reasons };
  }
  return { label: 'neutral', reasons };
}

function summarizeShortInterest(payload: { results: any[] } | null): ShortInterestSnapshot | null {
  const latest = payload?.results?.[0];
  if (!latest) return null;
  const previous = payload?.results?.[1];
  const latestValue = typeof latest.shortInterest === 'number' ? latest.shortInterest : null;
  const previousValue = typeof previous?.shortInterest === 'number' ? previous.shortInterest : null;
  const changePct =
    typeof latestValue === 'number' && typeof previousValue === 'number' && previousValue !== 0
      ? ((latestValue - previousValue) / previousValue) * 100
      : null;
  return {
    settlementDate: latest.settlementDate ?? null,
    shortInterest: latestValue,
    avgDailyVolume: typeof latest.avgDailyVolume === 'number' ? latest.avgDailyVolume : null,
    daysToCover: typeof latest.daysToCover === 'number' ? latest.daysToCover : null,
    changePct
  };
}

function summarizeShortVolume(payload: { results: any[] } | null): ShortVolumeSnapshot | null {
  const latest = payload?.results?.[0];
  if (!latest) return null;
  const recentValues = payload?.results
    ?.slice(1, 11)
    .map((entry: any) => entry.shortVolume)
    .filter((value: unknown): value is number => typeof value === 'number');
  const averageShortVolume =
    recentValues && recentValues.length
      ? recentValues.reduce((sum, value) => sum + value, 0) / recentValues.length
      : null;
  const latestShortVolume = typeof latest.shortVolume === 'number' ? latest.shortVolume : null;
  const spike =
    typeof latestShortVolume === 'number' && typeof averageShortVolume === 'number' && averageShortVolume > 0
      ? latestShortVolume >= averageShortVolume * 2
      : null;
  return {
    date: latest.date ?? null,
    shortVolume: latestShortVolume,
    shortVolumeRatio: typeof latest.shortVolumeRatio === 'number' ? latest.shortVolumeRatio : null,
    averageShortVolume,
    spike
  };
}

async function buildDeskContext(symbol: string): Promise<DeskContext> {
  const [snapshot, dailyBars, minuteBars] = await Promise.all([
    getMassiveOptionsSnapshot(symbol).catch(() => null),
    getRecentAggregateBars(symbol, 1, 'day', 10).catch(() => []),
    getRecentAggregateBars(symbol, 5, 'minute', 20).catch(() => [])
  ]);
  const shortTicker =
    typeof snapshot?.underlying === 'string'
      ? snapshot.underlying.toUpperCase()
      : symbol.startsWith('O:')
      ? null
      : symbol;
  const [shortInterestPayload, shortVolumePayload] = shortTicker
    ? await Promise.all([
        getMassiveShortInterest({ ticker: shortTicker, limit: 2, sort: 'settlement_date', order: 'desc' }).catch(() => null),
        getMassiveShortVolume({ ticker: shortTicker, limit: 12, sort: 'date', order: 'desc' }).catch(() => null)
      ])
    : [null, null];
  const shortInterest = summarizeShortInterest(shortInterestPayload);
  const shortVolume = summarizeShortVolume(shortVolumePayload);
  return {
    symbol,
    snapshot,
    dailyBars: normalizeBars(dailyBars),
    minuteBars: normalizeBars(minuteBars),
    metrics: {
      lastClose: dailyBars.at(-1)?.close ?? null,
      dayChange: snapshot?.changePercent ?? null,
      refContract: snapshot?.referenceContract ?? null,
      iv: snapshot?.iv ?? null,
      vol: snapshot?.volume ?? null,
      oi: snapshot?.openInterest ?? null,
      shortInterest,
      shortVolume
    }
  };
}

function sanitizeHighlights(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter(item => typeof item === 'string' && item.trim().length > 0).slice(0, 4);
}

function buildFallbackInsight(symbol: string, context: DeskContext): DeskInsight {
  const snapshot = context.snapshot ?? null;
  const shortInterest = context.metrics?.shortInterest as ShortInterestSnapshot | undefined;
  const shortVolume = context.metrics?.shortVolume as ShortVolumeSnapshot | undefined;
  const shortBias = deriveShortInterestBias(shortInterest, shortVolume);
  const priceLabel =
    typeof snapshot?.price === 'number' ? `$${snapshot.price.toFixed(2)}` : 'Price unavailable';
  const changePercent =
    typeof snapshot?.changePercent === 'number' ? snapshot.changePercent : null;
  const sentimentLabel =
    shortBias.label && shortBias.label !== 'neutral'
      ? shortBias.label
      : typeof changePercent === 'number'
      ? changePercent > 0
        ? 'bullish'
        : changePercent < 0
        ? 'bearish'
        : 'neutral'
      : 'neutral';
  const changeLabel = changePercent != null ? `${changePercent.toFixed(2)}%` : '—';
  const sentimentNote =
    shortBias.label && shortBias.label !== 'neutral'
      ? `${shortBias.label === 'bearish' ? 'Bearish' : 'Bullish'} short-interest signal`
      : null;
  const highlights = [
    `Spot ${priceLabel} (${changeLabel})`,
    snapshot?.iv != null ? `IV ${Number(snapshot.iv).toFixed(2)}%` : null,
    snapshot?.openInterest != null ? `OI ${formatNumber(snapshot.openInterest, { maximumFractionDigits: 0 })}` : null,
    snapshot?.volume != null ? `Volume ${formatNumber(snapshot.volume, { maximumFractionDigits: 0 })}` : null,
    shortInterest?.shortInterest != null
      ? `Short interest ${formatNumber(shortInterest.shortInterest, { maximumFractionDigits: 0 })}`
      : null,
    shortInterest?.daysToCover != null
      ? `Days to cover ${Number(shortInterest.daysToCover).toFixed(2)}`
      : null,
    shortVolume?.spike ? 'Short volume spike vs recent avg' : null,
    sentimentNote
  ].filter(Boolean) as string[];

  return {
    symbol,
    summary: `Spot move ${changeLabel}. Ref contract ${snapshot?.referenceContract ?? 'n/a'}.${
      sentimentNote ? ` ${sentimentNote}.` : ''
    }`,
    sentiment: { label: sentimentLabel, score: null },
    fedEvent: null,
    highlights,
    shortBias: { label: shortBias.label, reasons: shortBias.reasons },
    source: 'snapshot',
    updatedAt: new Date().toISOString()
  };
}

function parseAgentInsight(symbol: string, parsed: any): DeskInsight | null {
  const payload = Array.isArray(parsed) ? parsed[0] : parsed?.insight ?? parsed;
  if (!payload || typeof payload !== 'object') return null;
  const resolvedSymbol =
    typeof payload.symbol === 'string' && payload.symbol.trim().length > 0
      ? payload.symbol.toUpperCase()
      : symbol;
  const summary = typeof payload.summary === 'string' ? payload.summary : null;
  const sentiment =
    payload.sentiment && typeof payload.sentiment === 'object'
      ? {
          label: typeof payload.sentiment.label === 'string' ? payload.sentiment.label : null,
          score: typeof payload.sentiment.score === 'number' ? payload.sentiment.score : null
        }
      : null;
  const fedEvent =
    payload.fedEvent && typeof payload.fedEvent === 'object'
      ? {
          title: typeof payload.fedEvent.title === 'string' ? payload.fedEvent.title : undefined,
          name: typeof payload.fedEvent.name === 'string' ? payload.fedEvent.name : undefined,
          date: typeof payload.fedEvent.date === 'string' ? payload.fedEvent.date : undefined,
          impact: typeof payload.fedEvent.impact === 'string' ? payload.fedEvent.impact : undefined
        }
      : null;
  const highlights = sanitizeHighlights(payload.highlights);
  return {
    symbol: resolvedSymbol,
    summary,
    sentiment,
    fedEvent,
    highlights,
    source: 'agent',
    updatedAt: new Date().toISOString()
  };
}

async function fetchAgentInsight(symbol: string, context: DeskContext): Promise<DeskInsight | null> {
  const prompt = [
    'You are the AI desk for a trading app.',
    `Provide a concise insight for ${symbol}.`,
    '',
    'Use the structured JSON context below. Use your tools to fetch sentiment and Fed calendar data; do not invent values.',
    JSON.stringify(context, null, 2),
    '',
    'Return ONLY valid JSON with this shape:',
    '{"symbol":"AMD","summary":"...","sentiment":{"label":"bullish|bearish|neutral","score":0.1},"fedEvent":{"title":"...","date":"YYYY-MM-DD","impact":"high"},"highlights":["..."]}',
    'Rules:',
    '- summary under 200 characters',
    '- highlights: 2-4 short bullets',
    '- sentiment.score between -1 and 1 (or null if unavailable)',
    '- fedEvent can be null if nothing notable in the next 14 days',
    '- if tools are unavailable, set sentiment and fedEvent to null',
    '- consider shortInterest and shortVolume metrics when framing sentiment or risks',
    '- flag if shortInterest changePct >= 20 or daysToCover >= 5',
    '- flag if shortVolume spike is true or shortVolumeRatio >= 50',
    '- if shortInterest is elevated (changePct >= 20 or daysToCover >= 5), sentiment should lean bearish unless strong positive price action contradicts it',
    '- if shortInterest is falling (changePct <= -20) and daysToCover <= 3, sentiment can lean bullish'
  ].join('\n');

  try {
    const data = await agentAnalyze(prompt);
    const output = data?.output ?? data?.result ?? '';
    if (typeof output !== 'string') return null;
    const parsed = JSON.parse(output);
    return parseAgentInsight(symbol, parsed);
  } catch (error) {
    console.warn('[DESK INSIGHT] agent fetch failed', error);
    return null;
  }
}

export async function getDeskInsight(symbol: string): Promise<DeskInsight> {
  const upper = symbol.toUpperCase();
  const context = await buildDeskContext(upper);
  const shortBias = deriveShortInterestBias(
    context.metrics?.shortInterest as ShortInterestSnapshot | undefined,
    context.metrics?.shortVolume as ShortVolumeSnapshot | undefined
  );
  const agentInsight = await fetchAgentInsight(upper, context);
  if (agentInsight) {
    return { ...agentInsight, shortBias: { label: shortBias.label, reasons: shortBias.reasons } };
  }
  return buildFallbackInsight(upper, context);
}
