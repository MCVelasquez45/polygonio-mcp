import { runDecisionEngineEventReevaluation } from '../../decisionEngine/scanner.service';
import type {
  DecisionEngineEventTrigger,
  EventIntelligenceRecord,
  HistoricalSimilarity,
  MarketImpactEstimate,
  NormalizedMarketEvent,
} from '../types/eventTypes';

const HIGH_IMPORTANCE_THRESHOLD = Math.max(0, Math.min(100, Number(process.env.EVENT_INTELLIGENCE_TRIGGER_THRESHOLD ?? 80)));

export async function notifyDecisionEngineOfEvent(args: {
  event: NormalizedMarketEvent;
  impact: MarketImpactEstimate;
  historicalSimilarity: HistoricalSimilarity;
  enabled?: boolean;
}): Promise<DecisionEngineEventTrigger> {
  const affectedAssets = [...new Set([...args.impact.affectedSymbols, ...args.impact.affectedEtfs])].sort();
  const base = {
    eventId: args.event.id,
    importance: args.event.importance,
    confidence: args.impact.confidence,
    affectedAssets,
    supportingEvidence: [
      args.event.title,
      args.impact.explanation,
      args.historicalSimilarity.explanation,
    ],
  };
  if (args.event.importance < HIGH_IMPORTANCE_THRESHOLD) {
    return { ...base, triggered: false, status: 'SKIPPED_LOW_IMPORTANCE', triggeredAt: null, decisionScanId: null, error: null };
  }
  if (!affectedAssets.length) {
    return { ...base, triggered: false, status: 'SKIPPED_NO_AFFECTED_ASSETS', triggeredAt: null, decisionScanId: null, error: null };
  }
  if (args.enabled === false) {
    return { ...base, triggered: true, status: 'TRIGGERED', triggeredAt: new Date().toISOString(), decisionScanId: null, error: null };
  }
  try {
    const scan = await runDecisionEngineEventReevaluation([
      {
        eventId: args.event.id,
        title: args.event.title,
        category: args.event.category,
        importance: args.event.importance,
        sentiment: args.event.sentiment.score ?? args.event.sentiment.label,
        triggeredReevaluation: true,
        marketContext: {
          affectedSymbols: args.impact.affectedSymbols,
          affectedEtfs: args.impact.affectedEtfs,
          affectedSectors: args.impact.affectedSectors,
          affectedCommodities: args.impact.affectedCommodities,
          confidence: args.impact.confidence,
        },
        historicalSimilarity: args.historicalSimilarity,
      },
    ]);
    return { ...base, triggered: true, status: 'TRIGGERED', triggeredAt: new Date().toISOString(), decisionScanId: scan.scanId, error: null };
  } catch (error) {
    return { ...base, triggered: false, status: 'FAILED', triggeredAt: null, decisionScanId: null, error: (error as Error)?.message ?? 'decision trigger failed' };
  }
}

export function eventTriggeredDecision(record: EventIntelligenceRecord): boolean {
  return record.decisionTrigger.triggered && record.decisionTrigger.status === 'TRIGGERED';
}
