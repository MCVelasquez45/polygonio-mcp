import type { EventIntelligenceRecord, EventMarketContext, NormalizedMarketEvent } from '../types/eventTypes';
import { enrichEventClassification } from '../classification/classifier.service';
import { estimateMarketImpact } from '../impact/impact.service';
import { scoreEventImportance } from '../impact/importance.service';
import { findHistoricalSimilarity } from '../storage/historicalSimilarity.service';
import { upsertEventRecord, listEventRecords } from '../storage/eventJournal.service';
import { notifyDecisionEngineOfEvent } from './decisionTrigger.service';

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

export async function processMarketEvent(
  rawEvent: NormalizedMarketEvent,
  options: { triggerDecisionEngine?: boolean; persist?: boolean } = {}
): Promise<EventIntelligenceRecord> {
  const classified = enrichEventClassification(rawEvent);
  const initialImpact = estimateMarketImpact(classified);
  const historicalSimilarity = await findHistoricalSimilarity(classified, initialImpact);
  const importance = scoreEventImportance({ event: classified, impact: initialImpact, historicalSimilarity });
  const event = {
    ...classified,
    importance: importance.importance,
    importanceExplanation: importance.explanation,
  };
  const impact = {
    ...estimateMarketImpact(event),
    importance: importance.importance,
  };
  const decisionTrigger = await notifyDecisionEngineOfEvent({
    event,
    impact,
    historicalSimilarity,
    enabled: options.triggerDecisionEngine === true,
  });
  const record: EventIntelligenceRecord = {
    event,
    impact,
    historicalSimilarity,
    decisionTrigger,
    createdAt: new Date().toISOString(),
  };
  return options.persist === false ? record : upsertEventRecord(record);
}

export async function buildEventMarketContext(limit = 50): Promise<EventMarketContext> {
  const records = await listEventRecords(limit);
  const highImportanceEvents = records.filter(record => record.event.importance >= 70);
  return {
    generatedAt: new Date().toISOString(),
    highImportanceEvents,
    affectedSymbols: uniq(records.flatMap(record => record.impact.affectedSymbols)),
    affectedEtfs: uniq(records.flatMap(record => record.impact.affectedEtfs)),
    affectedSectors: uniq(records.flatMap(record => record.impact.affectedSectors)),
    sentiment: {
      bullish: records.filter(record => record.event.sentiment.label === 'bullish').length,
      bearish: records.filter(record => record.event.sentiment.label === 'bearish').length,
      neutral: records.filter(record => record.event.sentiment.label === 'neutral').length,
    },
    latestTrigger: records.find(record => record.decisionTrigger.triggered)?.decisionTrigger ?? null,
  };
}
