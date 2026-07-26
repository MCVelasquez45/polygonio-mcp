import type { DecisionScan } from './types';
import { DecisionScanJournalModel } from './decisionScanJournal.model';

function serialize(doc: any): DecisionScan {
  const value = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    scanId: value.scanId,
    timestamp: value.timestamp instanceof Date ? value.timestamp.toISOString() : String(value.timestamp),
    watchlist: value.watchlist ?? [],
    relatedEvents: value.relatedEvents ?? [],
    candidates: value.candidates ?? [],
    ranking: value.ranking,
    winner: value.winner ?? null,
    rejections: value.rejections ?? [],
    aiReasoning: value.aiReasoning ?? [],
    noTradeReason: value.noTradeReason ?? null,
    dataSources: value.dataSources ?? [],
    schemaVersion: value.schemaVersion ?? 1,
  };
}

export async function appendDecisionScan(scan: DecisionScan): Promise<DecisionScan> {
  const created = await DecisionScanJournalModel.create({
    ...scan,
    timestamp: new Date(scan.timestamp),
  });
  return serialize(created);
}

export async function getLatestDecisionScan(): Promise<DecisionScan | null> {
  const doc = await DecisionScanJournalModel.findOne().sort({ timestamp: -1, createdAt: -1 });
  return doc ? serialize(doc) : null;
}

export async function listDecisionScans(limit = 50): Promise<DecisionScan[]> {
  const safeLimit = Math.max(1, Math.min(250, Math.floor(limit)));
  const docs = await DecisionScanJournalModel.find().sort({ timestamp: -1, createdAt: -1 }).limit(safeLimit);
  return docs.map(serialize);
}

export async function getDecisionScanById(scanId: string): Promise<DecisionScan | null> {
  const doc = await DecisionScanJournalModel.findOne({ scanId });
  return doc ? serialize(doc) : null;
}
