import { resolveAggregates } from '../../market/services/aggregatesService';
import {
  getMassiveOptionContractSnapshot,
  getMassiveStockSnapshot,
  listOptionExpirations,
  REQUEST_PRIORITY,
} from '../../../shared/data/massive';
import {
  getIndicesSnapshot,
  getInflation,
  getLaborMarket,
  getTickerNews,
  getTreasuryYields,
} from '../../../shared/data/massiveMacro';
import {
  getAlpacaAccount,
  listAlpacaOptionOrders,
  listAlpacaOptionPositions,
  listAlpacaPositions,
} from '../../broker/services/alpaca';
import { getAutomationVisibility, getLatestUniverseEvaluations } from '../../portfolio/portfolio.service';
import { getLatestDailyReport } from '../../intelligence/services/dailyReportGenerator.service';
import { listTradeReports } from '../../intelligence/services/tradeReportGenerator.service';
import { getLatestTradingSession } from '../../intelligence/services/tradingSessionCapture.service';
import { getCapitolTrades, getEarnings, getFredCalendar } from './agentData';
import { summarizeTechnicals, type StudyBar } from './studies';

export type ContextStatus = 'ok' | 'unavailable' | 'error';

export type ContextSection = {
  source: string;
  label: string;
  status: ContextStatus;
  note?: string;
  data?: unknown;
};

export type AgentParams = {
  symbol: string;
  timeframe?: string | null;
  contract?: string | null;
};

type Builder = (params: AgentParams) => Promise<ContextSection>;

const BUILDER_TIMEOUT_MS = Math.max(5_000, Number(process.env.AI_CONTEXT_TIMEOUT_MS ?? 20_000));

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      if (typeof timer.unref === 'function') timer.unref();
    }),
  ]);
}

function section(source: string, label: string, run: (params: AgentParams) => Promise<Omit<ContextSection, 'source' | 'label'>>): Builder {
  return async params => {
    try {
      const result = await withTimeout(run(params), BUILDER_TIMEOUT_MS, label);
      return { source, label, ...result };
    } catch (error: any) {
      return { source, label, status: 'error', note: String(error?.message ?? error).slice(0, 200) };
    }
  };
}

/** Map a client timeframe key like '15/min', '1/hour', '1/day' to aggregates params. */
export function timeframeToAggregates(timeframe: string | null | undefined): {
  multiplier: number;
  timespan: 'minute' | 'hour' | 'day';
  window: number;
} {
  const raw = String(timeframe ?? '').toLowerCase();
  const match = raw.match(/^(\d+)\s*\/\s*(min|minute|hour|day)/);
  if (!match) return { multiplier: 15, timespan: 'minute', window: 120 };
  const multiplier = Math.max(1, Number(match[1]) || 1);
  const unit = match[2].startsWith('min') ? 'minute' : match[2] === 'hour' ? 'hour' : 'day';
  const window = unit === 'day' ? 120 : unit === 'hour' ? 120 : 150;
  return { multiplier, timespan: unit, window };
}

function toStudyBars(results: Array<{ t: string; o: number; h: number; l: number; c: number; v: number }>): StudyBar[] {
  return results
    .map(bar => ({ t: Date.parse(bar.t), o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v }))
    .filter(bar => Number.isFinite(bar.t))
    .sort((a, b) => a.t - b.t);
}

export const buildTechnicalContext = section('technical', 'Technical (candles + studies)', async params => {
  const { multiplier, timespan, window } = timeframeToAggregates(params.timeframe);
  const aggregates = await resolveAggregates({ ticker: params.symbol, multiplier, timespan, window });
  const bars = toStudyBars(aggregates.results ?? []);
  if (!bars.length) {
    return { status: 'unavailable' as const, note: aggregates.note ?? 'no candle data returned' };
  }
  return {
    status: 'ok' as const,
    data: {
      symbol: params.symbol,
      timeframe: `${multiplier}/${timespan}`,
      marketClosed: aggregates.marketClosed,
      usingLastSession: aggregates.usingLastSession,
      studies: summarizeTechnicals(bars),
      recentBars: bars.slice(-20).map(bar => ({
        t: new Date(bar.t).toISOString(),
        o: bar.o,
        h: bar.h,
        l: bar.l,
        c: bar.c,
        v: bar.v,
      })),
    },
  };
});

export const buildOptionsContext = section('options', 'Options (contract, IV, greeks, chain)', async params => {
  const [snapshotResult, expirationsResult, contractResult] = await Promise.allSettled([
    getMassiveStockSnapshot(params.symbol, { priority: REQUEST_PRIORITY.VISIBLE_UI }),
    listOptionExpirations(params.symbol, { limit: 250, maxPages: 1 }),
    params.contract
      ? getMassiveOptionContractSnapshot(params.contract, { priority: REQUEST_PRIORITY.VISIBLE_UI })
      : Promise.resolve(null),
  ]);
  const underlying = snapshotResult.status === 'fulfilled' ? snapshotResult.value : null;
  const expirations = expirationsResult.status === 'fulfilled' ? expirationsResult.value : null;
  const contract = contractResult.status === 'fulfilled' ? contractResult.value : null;
  if (!underlying && !contract) {
    const reason = snapshotResult.status === 'rejected' ? String(snapshotResult.reason?.message ?? '') : 'no data';
    return { status: 'unavailable' as const, note: `options data unavailable: ${reason}`.slice(0, 200) };
  }

  const spot = extractNumber(underlying, ['day', 'c']) ?? extractNumber(underlying, ['prevDay', 'c']);
  const iv = extractNumber(contract, ['implied_volatility']) ?? extractNumber(contract, ['iv']);
  const dte = daysToExpiration(extractString(contract, ['details', 'expiration_date']) ?? extractString(contract, ['expiration_date']));
  const expectedMove =
    spot !== null && iv !== null && dte !== null ? Number((spot * iv * Math.sqrt(dte / 365)).toFixed(2)) : null;

  return {
    status: 'ok' as const,
    data: {
      underlying: compact(underlying, 1200),
      selectedContract: params.contract ? compact(contract, 2400) : null,
      expectedMove: expectedMove !== null ? { dollars: expectedMove, basis: 'spot * IV * sqrt(DTE/365)' } : null,
      nearestExpirations: Array.isArray((expirations as any)?.expirations)
        ? (expirations as any).expirations.slice(0, 6)
        : Array.isArray(expirations)
          ? (expirations as any).slice(0, 6)
          : null,
    },
  };
});

export const buildPortfolioContext = section('portfolio', 'Portfolio (account, positions, orders)', async () => {
  const [account, optionPositions, equityPositions, orders] = await Promise.all([
    getAlpacaAccount(),
    listAlpacaOptionPositions(),
    listAlpacaPositions(),
    listAlpacaOptionOrders({ status: 'open', limit: 10 }),
  ]);
  const acct = account as any;
  return {
    status: 'ok' as const,
    data: {
      account: {
        equity: toNum(acct?.equity),
        cash: toNum(acct?.cash),
        buyingPower: toNum(acct?.buying_power ?? acct?.buyingPower),
        dayTradeCount: toNum(acct?.daytrade_count),
      },
      optionPositions: (Array.isArray(optionPositions) ? optionPositions : []).slice(0, 20).map((p: any) => ({
        symbol: p?.symbol,
        qty: toNum(p?.qty),
        avgEntry: toNum(p?.avg_entry_price),
        marketValue: toNum(p?.market_value),
        unrealizedPl: toNum(p?.unrealized_pl),
      })),
      equityPositions: (Array.isArray(equityPositions) ? equityPositions : []).slice(0, 20).map((p: any) => ({
        symbol: p?.symbol,
        qty: toNum(p?.qty),
        avgEntry: toNum(p?.avg_entry_price),
        unrealizedPl: toNum(p?.unrealized_pl),
      })),
      openOrders: (Array.isArray(orders) ? orders : []).slice(0, 10).map((o: any) => ({
        symbol: o?.symbol,
        side: o?.side,
        type: o?.type,
        qty: toNum(o?.qty),
        limitPrice: toNum(o?.limit_price),
        status: o?.status,
      })),
    },
  };
});

export const buildAutomationContext = section('automation', 'Automation (state, evaluations, risk)', async () => {
  const [visibility, evaluations] = await Promise.allSettled([
    getAutomationVisibility(),
    getLatestUniverseEvaluations(5),
  ]);
  if (visibility.status === 'rejected' && evaluations.status === 'rejected') {
    return { status: 'unavailable' as const, note: 'automation state unavailable' };
  }
  return {
    status: 'ok' as const,
    data: {
      visibility: visibility.status === 'fulfilled' ? compact(visibility.value, 3000) : null,
      recentUniverseEvaluations: evaluations.status === 'fulfilled' ? compact(evaluations.value, 3000) : null,
    },
  };
});

export const buildIntelligenceContext = section('intelligence', 'Intelligence (reports, journal)', async () => {
  const [daily, trades, session] = await Promise.allSettled([
    getLatestDailyReport(),
    listTradeReports(5),
    getLatestTradingSession(),
  ]);
  const anyOk = [daily, trades, session].some(result => result.status === 'fulfilled' && result.value);
  if (!anyOk) return { status: 'unavailable' as const, note: 'no stored intelligence reports yet' };
  return {
    status: 'ok' as const,
    data: {
      latestDailyReport: daily.status === 'fulfilled' ? compact(daily.value, 2500) : null,
      recentTradeReports: trades.status === 'fulfilled' ? compact(trades.value, 2500) : null,
      latestSession: session.status === 'fulfilled' ? compact(session.value, 1500) : null,
    },
  };
});

export const buildNewsContext = section('news', 'News + sentiment', async params => {
  const articles = await getTickerNews(params.symbol, 8);
  if (!articles.length) return { status: 'unavailable' as const, note: `no recent news for ${params.symbol}` };
  return {
    status: 'ok' as const,
    data: articles.map(article => ({
      title: article.title,
      publisher: article.publisher,
      publishedUtc: article.publishedUtc,
      sentiment: article.sentiment.find(s => s.ticker === params.symbol) ?? article.sentiment[0] ?? null,
    })),
  };
});

export const buildMacroContext = section('macro', 'Macro (yields, inflation, labor, indices)', async () => {
  const [yields, inflation, labor, indices] = await Promise.allSettled([
    getTreasuryYields(5),
    getInflation(4),
    getLaborMarket(4),
    getIndicesSnapshot(['I:VIX', 'I:SPX', 'I:NDX', 'I:DJI']),
  ]);
  const parts: Record<string, unknown> = {};
  const missing: string[] = [];
  assign(parts, missing, 'treasuryYields', yields);
  assign(parts, missing, 'inflation', inflation);
  assign(parts, missing, 'laborMarket', labor);
  assign(parts, missing, 'indices', indices);
  if (Object.keys(parts).length === 0) {
    return { status: 'unavailable' as const, note: `macro providers failed: ${missing.join(', ')}` };
  }
  return {
    status: 'ok' as const,
    note: missing.length ? `partial — missing: ${missing.join(', ')}` : undefined,
    data: parts,
  };
});

export const buildCongressContext = section('congress', 'Congressional trading (CapitolTrades)', async params => {
  const result = await getCapitolTrades(params.symbol, 10);
  if (!result.available) {
    return { status: 'unavailable' as const, note: result.error ?? 'congressional data provider unavailable' };
  }
  return { status: 'ok' as const, data: compact(result.data, 3500) };
});

export const buildCalendarContext = section('calendar', 'Economic release calendar (FRED)', async () => {
  const result = await getFredCalendar(20);
  if (!result.available) {
    return { status: 'unavailable' as const, note: result.error ?? 'FRED calendar unavailable (FRED_API_KEY required)' };
  }
  return { status: 'ok' as const, data: compact(result.data, 2500) };
});

export const buildEarningsContext = section('earnings', 'Earnings history', async params => {
  const result = await getEarnings(params.symbol, 6);
  if (!result.available) {
    return { status: 'unavailable' as const, note: result.error ?? 'earnings provider unavailable' };
  }
  return { status: 'ok' as const, data: compact(result.data, 2000) };
});

export const CONTEXT_BUILDERS: Record<string, Builder> = {
  technical: buildTechnicalContext,
  options: buildOptionsContext,
  portfolio: buildPortfolioContext,
  automation: buildAutomationContext,
  intelligence: buildIntelligenceContext,
  news: buildNewsContext,
  macro: buildMacroContext,
  congress: buildCongressContext,
  calendar: buildCalendarContext,
  earnings: buildEarningsContext,
};

// ---- helpers ----

function toNum(value: unknown): number | null {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return typeof numeric === 'number' && Number.isFinite(numeric) ? numeric : null;
}

function extractNumber(obj: unknown, path: string[]): number | null {
  let cursor: any = obj;
  for (const key of path) {
    if (cursor == null || typeof cursor !== 'object') return null;
    cursor = cursor[key];
  }
  return toNum(cursor);
}

function extractString(obj: unknown, path: string[]): string | null {
  let cursor: any = obj;
  for (const key of path) {
    if (cursor == null || typeof cursor !== 'object') return null;
    cursor = cursor[key];
  }
  return typeof cursor === 'string' ? cursor : null;
}

function daysToExpiration(expiration: string | null): number | null {
  if (!expiration) return null;
  const expiry = Date.parse(`${expiration}T21:00:00Z`);
  if (!Number.isFinite(expiry)) return null;
  return Math.max(0.5, (expiry - Date.now()) / 86_400_000);
}

/** Serialize + truncate a payload so one section can't blow up the prompt. */
function compact(value: unknown, maxChars: number): unknown {
  if (value == null) return null;
  try {
    const json = JSON.stringify(value);
    if (json.length <= maxChars) return JSON.parse(json);
    return { truncated: true, preview: json.slice(0, maxChars) };
  } catch {
    return String(value).slice(0, maxChars);
  }
}

function assign(
  parts: Record<string, unknown>,
  missing: string[],
  key: string,
  result: PromiseSettledResult<unknown>
): void {
  if (result.status === 'fulfilled' && result.value && (!Array.isArray(result.value) || result.value.length)) {
    parts[key] = result.value;
  } else {
    missing.push(key);
  }
}
