import mongoose, { Schema } from 'mongoose';
import type { RiskJournalRecord } from '../types/riskTypes';

const RiskApprovalSchema = new Schema<RiskJournalRecord>(
  {
    approvalId: { type: String, required: true, unique: true, index: true },
    timestamp: { type: String, required: true, index: true },
    recommendation: { type: Schema.Types.Mixed, required: true },
    approval: { type: Schema.Types.Mixed, required: true },
    rejection: { type: Schema.Types.Mixed, required: true, default: [] },
    reasonCodes: { type: [String], required: true, default: [] },
    portfolioSnapshot: { type: Schema.Types.Mixed, required: true },
    exposure: { type: Schema.Types.Mixed, required: true },
    greeks: { type: Schema.Types.Mixed, required: true },
    buyingPower: { type: Number, default: null },
    riskBudget: { type: Schema.Types.Mixed, required: true },
    ruleVersion: { type: String, required: true, index: true },
    schemaVersion: { type: Number, required: true, default: 1 },
  },
  { timestamps: true, collection: 'risk_engine_approvals' }
);

RiskApprovalSchema.index({ timestamp: -1 });

export const RiskApprovalModel =
  (mongoose.models.RiskEngineApproval as mongoose.Model<RiskJournalRecord>) ||
  mongoose.model<RiskJournalRecord>('RiskEngineApproval', RiskApprovalSchema);
