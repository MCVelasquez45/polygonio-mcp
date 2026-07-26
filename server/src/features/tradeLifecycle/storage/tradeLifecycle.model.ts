import mongoose, { Document, Schema } from 'mongoose';
import {
  MONITORING_ACTIONS,
  TRADE_LIFECYCLE_STATES,
  type ConfidenceTrend,
  type MonitoringAction,
  type TradeLifecycleState,
} from '../types/lifecycleTypes';

export interface TradeLifecycleDocument extends Document {
  tradeId: string;
  automationPositionId: string | null;
  automationSessionId: string | null;
  strategyVersionId: string | null;
  underlying: string;
  optionSymbol: string;
  state: TradeLifecycleState;
  previousState: TradeLifecycleState | null;
  entryIntentId: string | null;
  exitIntentId: string | null;
  riskDecisionId: string | null;
  recommendationId: string | null;
  evaluationReportId: string | null;
  confidence: {
    entry: number | null;
    current: number | null;
    trend: ConfidenceTrend;
    delta: number | null;
    changedAt: Date | null;
  };
  currentAction: MonitoringAction;
  reasoning: string[];
  exitReason: string | null;
  evaluationSummary: Record<string, unknown> | null;
  lastEvaluatedAt: Date | null;
  nextEvaluationAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TradeLifecycleJournalDocument extends Document {
  tradeId: string;
  at: Date;
  eventType: string;
  state: TradeLifecycleState;
  previousState: TradeLifecycleState | null;
  source: string;
  reason: string;
  confidence: {
    entry: number | null;
    current: number | null;
    trend: ConfidenceTrend;
    delta: number | null;
  };
  payload: Record<string, unknown>;
}

const ConfidenceSchema = new Schema(
  {
    entry: { type: Number, default: null },
    current: { type: Number, default: null },
    trend: { type: String, enum: ['Improving', 'Weakening', 'Stable', 'Unknown'], required: true, default: 'Unknown' },
    delta: { type: Number, default: null },
    changedAt: { type: Date, default: null },
  },
  { _id: false }
);

const TradeLifecycleSchema = new Schema<TradeLifecycleDocument>(
  {
    tradeId: { type: String, required: true, unique: true, index: true },
    automationPositionId: { type: String, default: null, index: true },
    automationSessionId: { type: String, default: null, index: true },
    strategyVersionId: { type: String, default: null },
    underlying: { type: String, required: true, uppercase: true, trim: true },
    optionSymbol: { type: String, required: true, uppercase: true, trim: true },
    state: { type: String, enum: TRADE_LIFECYCLE_STATES, required: true, default: 'NEW', index: true },
    previousState: { type: String, enum: [...TRADE_LIFECYCLE_STATES, null], default: null },
    entryIntentId: { type: String, default: null },
    exitIntentId: { type: String, default: null },
    riskDecisionId: { type: String, default: null },
    recommendationId: { type: String, default: null },
    evaluationReportId: { type: String, default: null },
    confidence: { type: ConfidenceSchema, required: true, default: () => ({}) },
    currentAction: { type: String, enum: MONITORING_ACTIONS, required: true, default: 'NO_ACTION' },
    reasoning: { type: [String], default: [] },
    exitReason: { type: String, default: null },
    evaluationSummary: { type: Schema.Types.Mixed, default: null },
    lastEvaluatedAt: { type: Date, default: null },
    nextEvaluationAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'trade_lifecycle_records' }
);

TradeLifecycleSchema.index({ state: 1, updatedAt: -1 });
TradeLifecycleSchema.index({ automationSessionId: 1, state: 1 });

const JournalConfidenceSchema = new Schema(
  {
    entry: { type: Number, default: null },
    current: { type: Number, default: null },
    trend: { type: String, enum: ['Improving', 'Weakening', 'Stable', 'Unknown'], required: true, default: 'Unknown' },
    delta: { type: Number, default: null },
  },
  { _id: false }
);

const TradeLifecycleJournalSchema = new Schema<TradeLifecycleJournalDocument>(
  {
    tradeId: { type: String, required: true, index: true },
    at: { type: Date, required: true, default: () => new Date(), index: true },
    eventType: { type: String, required: true, index: true },
    state: { type: String, enum: TRADE_LIFECYCLE_STATES, required: true },
    previousState: { type: String, enum: [...TRADE_LIFECYCLE_STATES, null], default: null },
    source: { type: String, required: true },
    reason: { type: String, required: true },
    confidence: { type: JournalConfidenceSchema, required: true, default: () => ({}) },
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  { collection: 'trade_lifecycle_journal', versionKey: false }
);

TradeLifecycleJournalSchema.index({ tradeId: 1, at: 1 });

TradeLifecycleJournalSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany'], function preventMutation() {
  throw new Error('trade lifecycle journal is append only');
});

export const TradeLifecycleModel =
  (mongoose.models.TradeLifecycle as mongoose.Model<TradeLifecycleDocument>) ||
  mongoose.model<TradeLifecycleDocument>('TradeLifecycle', TradeLifecycleSchema);

export const TradeLifecycleJournalModel =
  (mongoose.models.TradeLifecycleJournal as mongoose.Model<TradeLifecycleJournalDocument>) ||
  mongoose.model<TradeLifecycleJournalDocument>('TradeLifecycleJournal', TradeLifecycleJournalSchema);
