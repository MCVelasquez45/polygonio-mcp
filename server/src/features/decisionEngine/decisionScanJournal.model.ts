import mongoose, { Schema } from 'mongoose';
import type { DecisionScan } from './types';

export interface DecisionScanJournalDocument extends Omit<DecisionScan, 'timestamp'> {
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DecisionScanJournalSchema = new Schema<DecisionScanJournalDocument>(
  {
    scanId: { type: String, required: true, unique: true, index: true },
    timestamp: { type: Date, required: true, index: true },
    watchlist: { type: [String], required: true, default: [] },
    relatedEvents: { type: [Schema.Types.Mixed], required: true, default: [] } as any,
    candidates: { type: [Schema.Types.Mixed], required: true, default: [] } as any,
    ranking: { type: Schema.Types.Mixed, required: true },
    winner: { type: Schema.Types.Mixed, default: null },
    rejections: { type: [Schema.Types.Mixed], required: true, default: [] } as any,
    aiReasoning: { type: [Schema.Types.Mixed], required: true, default: [] } as any,
    noTradeReason: { type: String, default: null },
    dataSources: { type: [String], required: true, default: [] },
    schemaVersion: { type: Number, required: true, default: 1 },
  },
  { timestamps: true, collection: 'decision_engine_scans' }
);

DecisionScanJournalSchema.index({ timestamp: -1, scanId: 1 });

export const DecisionScanJournalModel =
  (mongoose.models.DecisionScanJournal as mongoose.Model<DecisionScanJournalDocument>) ||
  mongoose.model<DecisionScanJournalDocument>('DecisionScanJournal', DecisionScanJournalSchema);
