import mongoose, { Schema } from 'mongoose';
import type { EventIntelligenceRecord } from '../types/eventTypes';

export interface EventIntelligenceDocument extends Omit<EventIntelligenceRecord, 'createdAt'> {
  eventId: string;
  timestamp: Date;
  symbols: string[];
  sectors: string[];
  importance: number;
  category: string;
  createdAt: Date;
  updatedAt: Date;
}

const EventIntelligenceSchema = new Schema<EventIntelligenceDocument>(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    timestamp: { type: Date, required: true, index: true },
    symbols: { type: [String], required: true, default: [], index: true },
    sectors: { type: [String], required: true, default: [], index: true },
    importance: { type: Number, required: true, index: true },
    category: { type: String, required: true, index: true },
    event: { type: Schema.Types.Mixed, required: true },
    impact: { type: Schema.Types.Mixed, required: true },
    historicalSimilarity: { type: Schema.Types.Mixed, required: true },
    decisionTrigger: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true, collection: 'event_intelligence_events' }
);

EventIntelligenceSchema.index({ timestamp: -1, importance: -1 });

export const EventIntelligenceModel =
  (mongoose.models.EventIntelligence as mongoose.Model<EventIntelligenceDocument>) ||
  mongoose.model<EventIntelligenceDocument>('EventIntelligence', EventIntelligenceSchema);
