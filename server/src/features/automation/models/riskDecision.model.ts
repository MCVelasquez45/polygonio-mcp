import mongoose, { Document, Schema } from 'mongoose';

// Persistent record of every risk-engine run: each check, its observation,
// the limit it was compared against, the sizing math, and the verdict.
// The risk engine is pure and deterministic; AI output is not an input.

export type RiskCheckRecord = {
  name: string;
  passed: boolean;
  detail: string;
  observed?: number | string | boolean | null;
  limit?: number | string | null;
};

export interface RiskDecisionDocument extends Document {
  tradeCandidateId: string;
  automationSessionId: string;
  approved: boolean;
  reasonCodes: string[];
  checks: RiskCheckRecord[];
  sizing: {
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
  } | null;
  decidedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RiskDecisionSchema = new Schema<RiskDecisionDocument>(
  {
    tradeCandidateId: { type: String, required: true },
    automationSessionId: { type: String, required: true, index: true },
    approved: { type: Boolean, required: true },
    reasonCodes: { type: [String], required: true, default: [] },
    checks: [
      {
        _id: false,
        name: { type: String, required: true },
        passed: { type: Boolean, required: true },
        detail: { type: String, required: true },
        observed: { type: Schema.Types.Mixed, default: null },
        limit: { type: Schema.Types.Mixed, default: null },
      },
    ],
    sizing: { type: Schema.Types.Mixed, default: null },
    decidedAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'automation_risk_decisions' }
);

RiskDecisionSchema.index({ tradeCandidateId: 1 }, { unique: true });
RiskDecisionSchema.index({ automationSessionId: 1, createdAt: -1 });

export const RiskDecisionModel =
  (mongoose.models.AutomationRiskDecision as mongoose.Model<RiskDecisionDocument>) ||
  mongoose.model<RiskDecisionDocument>('AutomationRiskDecision', RiskDecisionSchema);
