import { massiveGet } from '../../../shared/data/massive';
import type { FuturesBar, FuturesBarResponse } from './databentoGateway.service';

type FetchBarsInput = {
  symbol: string;
  startDate: string;
  endDate: string;
};

type PolygonAggResponse = {
  status?: string;
  resultsCount?: number;
  results?: Array<{
    t: number;  // unix ms timestamp
    o: number;  // open
    h: number;  // high
    l: number;  // low
    c: number;  // close
    v: number;  // volume
    vw?: number; // volume-weighted avg price
    n?: number;  // number of transactions
  }>;
};

/**
 * ETF proxy mapping — used ONLY when the actual symbol returns no data.
 * Includes an approximate price ratio so bars can be scaled to the
 * futures price level (avoids 10x PnL distortion).
 *
 * Ratios are approximate and based on typical 2024-2026 price relationships.
 * They don't need to be exact — the goal is to get PnL into the right order
 * of magnitude rather than being off by 10x.
 */
const ETF_PROXY_MAP: Record<string, { etf: string; priceRatio: number; description: string }> = {
  ES:  { etf: 'SPY', priceRatio: 10,   description: 'S&P 500 E-mini → SPDR S&P 500 ETF (÷10)' },
  NQ:  { etf: 'QQQ', priceRatio: 40,   description: 'Nasdaq E-mini → Invesco QQQ ETF (÷40)' },
  CL:  { etf: 'USO', priceRatio: 1,    description: 'Crude Oil → United States Oil Fund (WARNING: high tracking error)' },
  GC:  { etf: 'GLD', priceRatio: 10,   description: 'Gold → SPDR Gold Shares ETF (÷10)' },
  YM:  { etf: 'DIA', priceRatio: 100,  description: 'Dow E-mini → SPDR Dow Jones ETF (÷100)' },
  RTY: { etf: 'IWM', priceRatio: 10,   description: 'Russell 2000 E-mini → iShares Russell 2000 ETF (÷10)' },
  ZB:  { etf: 'TLT', priceRatio: 1.3,  description: '30-Year Bond → iShares 20+ Year Treasury ETF (~1.3x)' },
};

function toFuturesBar(agg: { t: number; o: number; h: number; l: number; c: number; v: number }): FuturesBar {
  const date = new Date(agg.t);
  return {
    timestamp: date.toISOString(),
    open: agg.o,
    high: agg.h,
    low: agg.l,
    close: agg.c,
    volume: agg.v,
  };
}

function scaleBars(bars: FuturesBar[], ratio: number): FuturesBar[] {
  if (ratio === 1) return bars;
  return bars.map(bar => ({
    ...bar,
    open: bar.open * ratio,
    high: bar.high * ratio,
    low: bar.low * ratio,
    close: bar.close * ratio,
    // volume stays the same — it's in shares/contracts, not dollars
  }));
}

async function fetchBarsForTicker(
  ticker: string,
  startDate: string,
  endDate: string,
): Promise<PolygonAggResponse['results'] | null> {
  const path = `/v2/aggs/ticker/${ticker}/range/1/day/${startDate}/${endDate}`;
  try {
    const response = await massiveGet<PolygonAggResponse>(path, {
      adjusted: 'true',
      sort: 'asc',
      limit: '5000',
    }, { cacheTtlMs: 300_000 });

    const results = response?.results;
    if (!results?.length) return null;
    return results;
  } catch (error: any) {
    console.warn(`[POLYGON-GATEWAY] Fetch failed for ${ticker}:`, error?.message ?? error);
    return null;
  }
}

export async function fetchPolygonDailyBars(input: FetchBarsInput): Promise<FuturesBarResponse> {
  const upperSymbol = input.symbol.toUpperCase();

  // 1. Try the actual symbol first (works for stocks, ETFs, and premium-plan futures)
  const directResults = await fetchBarsForTicker(upperSymbol, input.startDate, input.endDate);
  if (directResults?.length) {
    const bars = directResults
      .filter(r => Number.isFinite(r.o) && Number.isFinite(r.c))
      .map(toFuturesBar);
    return {
      provider: 'polygon',
      bars,
      usedFallbackData: false,
      requestedSymbol: upperSymbol,
      sourceMessage: `Loaded ${bars.length} daily bars from Polygon.io for ${upperSymbol}.`,
    };
  }

  // 2. If actual symbol returned nothing, try ETF proxy with price scaling
  const proxy = ETF_PROXY_MAP[upperSymbol];
  if (proxy) {
    console.warn(`[POLYGON-GATEWAY] No data for ${upperSymbol}, trying ETF proxy ${proxy.etf} (ratio: ${proxy.priceRatio}x)`);
    const proxyResults = await fetchBarsForTicker(proxy.etf, input.startDate, input.endDate);
    if (proxyResults?.length) {
      const rawBars = proxyResults
        .filter(r => Number.isFinite(r.o) && Number.isFinite(r.c))
        .map(toFuturesBar);
      const bars = scaleBars(rawBars, proxy.priceRatio);
      return {
        provider: 'polygon',
        bars,
        usedFallbackData: false,
        proxyTicker: proxy.etf,
        requestedSymbol: upperSymbol,
        sourceMessage:
          `Loaded ${bars.length} daily bars from Polygon.io using ETF proxy ${proxy.etf} ` +
          `(scaled ${proxy.priceRatio}x to approximate ${upperSymbol} price levels). ` +
          `${proxy.description}. Note: ETF proxy data may differ from actual futures prices.`,
      };
    }
  }

  // 3. Nothing worked
  return {
    provider: 'polygon',
    bars: [],
    usedFallbackData: false,
    requestedSymbol: upperSymbol,
    sourceMessage: `Polygon returned no results for ${upperSymbol} (${input.startDate} to ${input.endDate}).`,
  };
}
