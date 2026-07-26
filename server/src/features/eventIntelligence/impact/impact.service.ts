import type { MarketImpactEstimate, NormalizedMarketEvent } from '../types/eventTypes';

const ETF_BY_SECTOR: Record<string, string[]> = {
  Energy: ['XLE', 'USO'],
  Technology: ['XLK', 'QQQ'],
  Healthcare: ['XLV'],
  Financial: ['XLF'],
  Consumer: ['XLY', 'XLP'],
  Transportation: ['IYT', 'XLI'],
};

const SYMBOLS_BY_THEME: Record<string, string[]> = {
  Oil: ['USO', 'XLE', 'CVX', 'XOM', 'OXY'],
  Energy: ['XLE', 'CVX', 'XOM', 'OXY'],
  AI: ['NVDA', 'AMD', 'MSFT', 'QQQ', 'XLK'],
  Technology: ['AAPL', 'MSFT', 'NVDA', 'AMD', 'QQQ', 'XLK'],
  Financial: ['JPM', 'BAC', 'XLF'],
  Healthcare: ['UNH', 'XLV'],
};

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean).map(value => value.toUpperCase()))].sort();
}

export function estimateMarketImpact(event: NormalizedMarketEvent): MarketImpactEstimate {
  const themeSymbols = SYMBOLS_BY_THEME[event.category] ?? [];
  const sectorEtfs = event.sectors.flatMap(sector => ETF_BY_SECTOR[sector] ?? []);
  const affectedSymbols = uniq([...event.symbols, ...themeSymbols]);
  const affectedEtfs = uniq([...sectorEtfs, ...affectedSymbols.filter(symbol => ['SPY', 'QQQ', 'XLE', 'USO', 'XLK', 'XLF', 'XLV', 'XLY', 'XLP', 'IYT', 'XLI'].includes(symbol))]);
  const affectedCommodities = event.category === 'Oil' || event.category === 'Commodity' ? ['Oil'] : [];
  const isBullish = event.sentiment.score != null ? event.sentiment.score > 0.15 : event.sentiment.label === 'bullish';
  const isBearish = event.sentiment.score != null ? event.sentiment.score < -0.15 : event.sentiment.label === 'bearish';
  return {
    eventId: event.id,
    potentialBullishImpact: isBullish ? affectedSymbols : [],
    potentialBearishImpact: isBearish ? affectedSymbols : [],
    affectedSymbols,
    affectedEtfs,
    affectedSectors: event.sectors,
    affectedCommodities,
    confidence: Number(Math.min(1, event.confidence + affectedSymbols.length * 0.02).toFixed(4)),
    importance: event.importance,
    explanation: `Impact maps ${event.category} to ${affectedSymbols.length} symbols, ${affectedEtfs.length} ETFs, and ${event.sectors.length} sectors.`,
  };
}

export { ETF_BY_SECTOR, SYMBOLS_BY_THEME };
