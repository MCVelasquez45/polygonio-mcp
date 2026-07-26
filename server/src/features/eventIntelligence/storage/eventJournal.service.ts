import type { EventIntelligenceRecord } from '../types/eventTypes';
import { EventIntelligenceModel } from './eventIntelligence.model';

function serialize(doc: any): EventIntelligenceRecord {
  const value = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    event: value.event,
    impact: value.impact,
    historicalSimilarity: value.historicalSimilarity,
    decisionTrigger: value.decisionTrigger,
    createdAt: value.createdAt instanceof Date ? value.createdAt.toISOString() : String(value.createdAt),
  };
}

export async function upsertEventRecord(record: EventIntelligenceRecord): Promise<EventIntelligenceRecord> {
  const updated = await EventIntelligenceModel.findOneAndUpdate(
    { eventId: record.event.id },
    {
      $set: {
        eventId: record.event.id,
        timestamp: new Date(record.event.timestamp),
        symbols: record.impact.affectedSymbols,
        sectors: record.impact.affectedSectors,
        importance: record.event.importance,
        category: record.event.category,
        event: record.event,
        impact: record.impact,
        historicalSimilarity: record.historicalSimilarity,
        decisionTrigger: record.decisionTrigger,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return serialize(updated);
}

export async function listEventRecords(limit = 50): Promise<EventIntelligenceRecord[]> {
  const docs = await EventIntelligenceModel.find().sort({ timestamp: -1, importance: -1 }).limit(Math.max(1, Math.min(250, limit)));
  return docs.map(serialize);
}

export async function getLatestEventRecord(): Promise<EventIntelligenceRecord | null> {
  const doc = await EventIntelligenceModel.findOne().sort({ timestamp: -1, importance: -1 });
  return doc ? serialize(doc) : null;
}

export async function listEventRecordsBySymbol(symbol: string, limit = 50): Promise<EventIntelligenceRecord[]> {
  const docs = await EventIntelligenceModel.find({ symbols: symbol.toUpperCase() }).sort({ timestamp: -1, importance: -1 }).limit(Math.max(1, Math.min(250, limit)));
  return docs.map(serialize);
}

export async function listEventRecordsBySector(sector: string, limit = 50): Promise<EventIntelligenceRecord[]> {
  const docs = await EventIntelligenceModel.find({ sectors: new RegExp(`^${sector}$`, 'i') }).sort({ timestamp: -1, importance: -1 }).limit(Math.max(1, Math.min(250, limit)));
  return docs.map(serialize);
}
