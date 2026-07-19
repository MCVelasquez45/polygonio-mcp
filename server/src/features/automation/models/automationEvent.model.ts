import mongoose, { Document, Schema } from 'mongoose';
import { AUTOMATION_COLLECTIONS } from '../automation.constants';
import type { AutomationEventSeverity } from '../automation.types';

// Append-only structured event journal. Every automation decision, gate
// check, broker interaction, and reconciliation outcome lands here.
// Documents are never updated or deleted by application code.

export interface AutomationEventDocument extends Document {
  timestamp: Date;
  service: string;
  event: string;
  severity: AutomationEventSeverity;
  automationSessionId: string | null;
  intentId: string | null;
  brokerOrderId: string | null;
  symbol: string | null;
  payload: Record<string, unknown>;
}

const AutomationEventSchema = new Schema<AutomationEventDocument>(
  {
    timestamp: { type: Date, required: true, default: () => new Date() },
    service: { type: String, required: true },
    event: { type: String, required: true },
    severity: { type: String, enum: ['info', 'warning', 'critical'], required: true, default: 'info' },
    automationSessionId: { type: String, default: null },
    intentId: { type: String, default: null },
    brokerOrderId: { type: String, default: null },
    symbol: { type: String, default: null },
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  { collection: AUTOMATION_COLLECTIONS.events, versionKey: false }
);

AutomationEventSchema.index({ automationSessionId: 1, timestamp: -1 });
AutomationEventSchema.index({ event: 1, timestamp: -1 });
AutomationEventSchema.index({ severity: 1, timestamp: -1 });

export const AutomationEventModel =
  (mongoose.models.AutomationEvent as mongoose.Model<AutomationEventDocument>) ||
  mongoose.model<AutomationEventDocument>('AutomationEvent', AutomationEventSchema);
