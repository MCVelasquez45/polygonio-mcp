import type { HistoricalSimilarity, MarketImpactEstimate, NormalizedMarketEvent } from '../types/eventTypes';

function hoursSince(timestamp: string, now = Date.now()): number {
  const ms = Date.parse(timestamp);
  return Number.isNaN(ms) ? 999 : Math.max(0, (now - ms) / 3_600_000);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}

export function scoreEventImportance(args: {
  event: NormalizedMarketEvent;
  impact: MarketImpactEstimate;
  historicalSimilarity?: HistoricalSimilarity | null;
  now?: number;
}): { importance: number; explanation: string } {
  const recencyScore = Math.max(0, 25 - hoursSince(args.event.timestamp, args.now) * 2);
  const providerScore = args.event.provider.startsWith('massive') ? 12 : 6;
  const sentimentScore = args.event.sentiment.score == null ? 6 : Math.min(15, Math.abs(args.event.sentiment.score) * 15);
  const impactScore = Math.min(22, args.impact.affectedSymbols.length * 2 + args.impact.affectedEtfs.length * 2 + args.impact.affectedCommodities.length * 4);
  const breadthScore = Math.min(12, args.impact.affectedSectors.length * 4);
  const historyScore = args.historicalSimilarity?.similarEvents.length ? 8 : 0;
  const categoryScore = ['Geopolitical', 'Federal Reserve', 'Economic', 'Oil', 'Earnings'].includes(args.event.category) ? 10 : 0;
  const confidenceScore = Math.min(8, args.event.confidence * 8);
  const importance = clamp(recencyScore + providerScore + sentimentScore + impactScore + breadthScore + historyScore + categoryScore + confidenceScore);
  return {
    importance,
    explanation: `Importance ${importance}/100 from recency ${recencyScore.toFixed(1)}, provider ${providerScore}, sentiment ${sentimentScore.toFixed(1)}, impact ${impactScore}, sector breadth ${breadthScore}, historical similarity ${historyScore}, category ${categoryScore}, confidence ${confidenceScore.toFixed(1)}.`,
  };
}
