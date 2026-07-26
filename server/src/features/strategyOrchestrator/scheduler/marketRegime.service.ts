import type { EventIntelligenceRecord } from '../../eventIntelligence/types/eventTypes';
import type { MarketRegime, MarketRegimeType } from '../types/orchestratorTypes';

export function detectMarketRegime(args: {
  events: EventIntelligenceRecord[];
  decisionConfidence: number | null;
  rejectedCount: number;
}): MarketRegime {
  const top = args.events[0];
  const categories = new Set(args.events.slice(0, 5).map(record => record.event.category));
  let current: MarketRegimeType = 'UNKNOWN';
  let confidence = 0.45;
  const historical: MarketRegimeType[] = [];
  if (categories.has('Federal Reserve') || categories.has('Economic')) {
    current = 'MACRO_DRIVEN';
    confidence = 0.82;
  } else if (top && top.event.importance >= 75) {
    current = 'NEWS_DRIVEN';
    confidence = 0.78;
  } else if (args.decisionConfidence != null && args.decisionConfidence >= 0.75) {
    current = 'TRENDING';
    confidence = 0.7;
  } else if (args.rejectedCount >= 5) {
    current = 'RANGE_BOUND';
    confidence = 0.62;
  }
  if (args.events.some(record => record.event.category === 'Oil')) historical.push('SECTOR_ROTATION');
  if (args.events.some(record => record.event.sentiment.label === 'bearish')) historical.push('RISK_OFF');
  if (args.events.some(record => record.event.sentiment.label === 'bullish')) historical.push('RISK_ON');
  return {
    current,
    historical: [...new Set(historical)],
    confidence,
    explanation: `Regime ${current} derived from ${args.events.length} events, decision confidence ${args.decisionConfidence ?? 'n/a'}, and ${args.rejectedCount} rejected opportunities.`,
  };
}
