import mongoose, { Schema } from 'mongoose';
import type { LearningTradeReview } from '../types/learningTypes';

export type LearningTradeReviewDocument = LearningTradeReview & {
  _id?: unknown;
  createdAt: Date;
  updatedAt: Date;
};

const LearningTradeReviewSchema = new Schema<LearningTradeReviewDocument>(
  {
    reviewId: { type: String, required: true, unique: true, index: true },
    schemaVersion: { type: Number, required: true, default: 1 },
    sourceReportId: { type: String, required: true, index: true },
    sourceTradeId: { type: String, required: true, index: true },
    generatedAt: { type: Date, required: true, default: () => new Date() },
    entryTimestamp: { type: Date, default: null },
    exitTimestamp: { type: Date, default: null, index: true },
    entryStrategy: { type: String, default: null, index: true },
    winningStrategy: { type: String, default: null, index: true },
    marketRegime: { type: String, default: null, index: true },
    fedEvent: { type: String, default: null, index: true },
    newsEvent: { type: String, default: null },
    sector: { type: String, default: null, index: true },
    symbol: { type: String, default: null, index: true },
    contract: { type: String, default: null },
    direction: { type: String, default: null },
    confidence: { type: Number, default: null },
    evidenceScore: { type: Number, default: null },
    riskScore: { type: Number, default: null },
    entryReason: { type: String, default: null },
    exitReason: { type: String, default: null },
    maximumFavorableExcursion: { type: Number, default: null },
    maximumAdverseExcursion: { type: Number, default: null },
    holdingTimeMinutes: { type: Number, default: null },
    expectedReturn: { type: Number, default: null },
    actualReturn: { type: Number, default: null },
    realizedPnl: { type: Number, default: null },
    outcome: { type: String, enum: ['WIN', 'LOSS', 'PARTIAL_WIN', 'BREAKEVEN', 'UNKNOWN'], required: true, index: true },
    win: { type: Boolean, required: true, default: false },
    loss: { type: Boolean, required: true, default: false },
    partialWin: { type: Boolean, required: true, default: false },
    whySucceeded: { type: [String], required: true, default: [] },
    whyFailed: { type: [String], required: true, default: [] },
    whatCouldImprove: { type: [String], required: true, default: [] },
    evidence: {
      eventIds: { type: [String], required: true, default: [] },
      positionId: { type: String, default: null },
      riskDecisionId: { type: String, default: null },
      tradeCandidateId: { type: String, default: null },
      contractSelectionId: { type: String, default: null },
      universeEvaluationIds: { type: [String], required: true, default: [] },
      tradeReportId: { type: String, required: true },
    },
  },
  { timestamps: true, collection: 'learning_trade_reviews' }
);

LearningTradeReviewSchema.index({ winningStrategy: 1, exitTimestamp: -1 });
LearningTradeReviewSchema.index({ marketRegime: 1, exitTimestamp: -1 });
LearningTradeReviewSchema.index({ sector: 1, exitTimestamp: -1 });

LearningTradeReviewSchema.pre('save', async function preventMutation() {
  if (this.isNew || !this.isModified()) return;
  throw new Error('LEARNING_TRADE_REVIEW_APPEND_ONLY');
});

LearningTradeReviewSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function preventQueryMutation() {
  this.setQuery({ $and: [this.getQuery(), { _id: null }] });
});

export const LearningTradeReviewModel =
  (mongoose.models.LearningTradeReview as mongoose.Model<LearningTradeReviewDocument>) ||
  mongoose.model<LearningTradeReviewDocument>('LearningTradeReview', LearningTradeReviewSchema);
