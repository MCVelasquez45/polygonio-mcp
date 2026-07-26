import type { CorrelationResult, RiskPortfolioSnapshot, RiskRecommendationInput } from '../types/riskTypes';

const CORRELATION_GROUPS: Record<string, string[]> = {
  Energy: ['OXY', 'CVX', 'XLE', 'XOM', 'USO', 'COP', 'SLB'],
  Technology: ['AAPL', 'MSFT', 'NVDA', 'QQQ', 'XLK', 'AMD', 'META', 'GOOGL'],
  Financial: ['JPM', 'BAC', 'GS', 'XLF', 'MS', 'WFC'],
  Healthcare: ['UNH', 'PFE', 'JNJ', 'XLV', 'MRK', 'ABBV'],
  BroadMarket: ['SPY', 'QQQ', 'IWM', 'DIA'],
};

function groupFor(symbol: string | null, sector: string | null): string | null {
  if (sector && CORRELATION_GROUPS[sector]) return sector;
  if (!symbol) return null;
  const upper = symbol.toUpperCase();
  return Object.entries(CORRELATION_GROUPS).find(([, symbols]) => symbols.includes(upper))?.[0] ?? null;
}

export function estimateCorrelationRisk(
  input: RiskRecommendationInput,
  portfolio: RiskPortfolioSnapshot
): CorrelationResult {
  const targetGroup = groupFor(input.symbol, input.sector);
  if (!targetGroup) {
    return {
      score: 0,
      correlatedSymbols: [],
      explanation: 'No known high-correlation group matched this recommendation.',
    };
  }
  const groupSymbols = new Set(CORRELATION_GROUPS[targetGroup]);
  const correlated = portfolio.currentPositions
    .filter(position => {
      const symbol = position.underlying ?? position.symbol;
      return groupSymbols.has(symbol) || position.sector === targetGroup;
    })
    .map(position => position.underlying ?? position.symbol);
  const exposure = correlated.reduce((sum, symbol) => sum + (portfolio.exposure.tickerExposure[symbol] ?? 0), 0);
  const exposureScore = portfolio.portfolioSize > 0 ? Math.min(0.9, exposure / portfolio.portfolioSize) : 0;
  const densityScore = Math.min(0.85, correlated.length * 0.22);
  const score = Number(Math.max(exposureScore, densityScore).toFixed(2));
  return {
    score,
    correlatedSymbols: Array.from(new Set(correlated)),
    explanation: correlated.length
      ? `${input.symbol ?? 'Recommendation'} overlaps with ${targetGroup} exposure: ${Array.from(new Set(correlated)).join(', ')}.`
      : `${input.symbol ?? 'Recommendation'} maps to ${targetGroup}, but no existing correlated positions were found.`,
  };
}
