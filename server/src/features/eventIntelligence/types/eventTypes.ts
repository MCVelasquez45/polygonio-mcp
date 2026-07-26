export const EVENT_CATEGORIES = [
  'Geopolitical',
  'Federal Reserve',
  'Economic',
  'Earnings',
  'Guidance',
  'Merger',
  'Acquisition',
  'SEC Filing',
  'Insider Activity',
  'Analyst Upgrade',
  'Analyst Downgrade',
  'Product Launch',
  'Supply Chain',
  'Commodity',
  'Oil',
  'Natural Disaster',
  'Cybersecurity',
  'Government Policy',
  'Tariffs',
  'Litigation',
  'AI',
  'Technology',
  'Healthcare',
  'Financial',
  'Energy',
  'Transportation',
  'Consumer',
  'Market Status',
  'Corporate Action',
  'News',
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export type EventSentimentLabel = 'bullish' | 'bearish' | 'neutral' | 'unknown';
export type EventProvider =
  | 'massive-news'
  | 'massive-market-news'
  | 'massive-sentiment'
  | 'massive-market-status'
  | 'massive-economic'
  | 'massive-earnings'
  | 'massive-corporate-actions';

export type NormalizedMarketEvent = {
  id: string;
  provider: EventProvider;
  timestamp: string;
  title: string;
  summary: string | null;
  category: EventCategory;
  sentiment: {
    label: EventSentimentLabel;
    score: number | null;
    explanation: string | null;
  };
  symbols: string[];
  sectors: string[];
  confidence: number;
  importance: number;
  importanceExplanation: string;
  source: string | null;
  url: string | null;
  raw: Record<string, unknown>;
};

export type MarketImpactEstimate = {
  eventId: string;
  potentialBullishImpact: string[];
  potentialBearishImpact: string[];
  affectedSymbols: string[];
  affectedEtfs: string[];
  affectedSectors: string[];
  affectedCommodities: string[];
  confidence: number;
  importance: number;
  explanation: string;
};

export type HistoricalSimilarity = {
  eventId: string;
  similarEvents: Array<{
    decisionId: string;
    timestamp: string;
    symbol: string | null;
    contract: string | null;
    reason: string;
  }>;
  previousTrades: number;
  previousOutcomes: Array<{ tradeId: string | null; outcome: string; returnPct: number | null }>;
  historicalWinRate: number | null;
  averageHoldingTimeMinutes: number | null;
  averageReturn: number | null;
  explanation: string;
};

export type DecisionEngineEventTrigger = {
  eventId: string;
  triggered: boolean;
  status: 'TRIGGERED' | 'SKIPPED_LOW_IMPORTANCE' | 'SKIPPED_NO_AFFECTED_ASSETS' | 'FAILED';
  triggeredAt: string | null;
  importance: number;
  confidence: number;
  affectedAssets: string[];
  supportingEvidence: string[];
  decisionScanId: string | null;
  error: string | null;
};

export type EventIntelligenceRecord = {
  event: NormalizedMarketEvent;
  impact: MarketImpactEstimate;
  historicalSimilarity: HistoricalSimilarity;
  decisionTrigger: DecisionEngineEventTrigger;
  createdAt: string;
};

export type EventMarketContext = {
  generatedAt: string;
  highImportanceEvents: EventIntelligenceRecord[];
  affectedSymbols: string[];
  affectedEtfs: string[];
  affectedSectors: string[];
  sentiment: {
    bullish: number;
    bearish: number;
    neutral: number;
  };
  latestTrigger: DecisionEngineEventTrigger | null;
};
