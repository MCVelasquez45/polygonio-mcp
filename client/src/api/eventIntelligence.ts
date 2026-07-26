import { http } from './http';

export type EventIntelligenceRecord = {
  event: {
    id: string;
    timestamp: string;
    title: string;
    summary: string | null;
    category: string;
    sentiment: { label: 'bullish' | 'bearish' | 'neutral' | 'unknown'; score: number | null; explanation: string | null };
    symbols: string[];
    sectors: string[];
    confidence: number;
    importance: number;
    importanceExplanation: string;
    source: string | null;
    url: string | null;
  };
  impact: {
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
  historicalSimilarity: {
    previousTrades: number;
    historicalWinRate: number | null;
    averageHoldingTimeMinutes: number | null;
    averageReturn: number | null;
    explanation: string;
  };
  decisionTrigger: {
    triggered: boolean;
    status: string;
    triggeredAt: string | null;
    decisionScanId: string | null;
  };
  createdAt: string;
};

export type EventMarketContext = {
  generatedAt: string;
  highImportanceEvents: EventIntelligenceRecord[];
  affectedSymbols: string[];
  affectedEtfs: string[];
  affectedSectors: string[];
  sentiment: { bullish: number; bearish: number; neutral: number };
  latestTrigger: EventIntelligenceRecord['decisionTrigger'] | null;
};

export async function getEventIntelligenceContext(): Promise<EventMarketContext | null> {
  try {
    const res = await http.get('/api/event-intelligence/context');
    return res.data?.context ?? null;
  } catch (error: any) {
    if (error?.response?.status === 404) return null;
    throw error;
  }
}
