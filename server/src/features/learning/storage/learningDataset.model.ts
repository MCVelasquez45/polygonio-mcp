import mongoose, { Schema } from 'mongoose';
import type { LearningDatasetRecord } from '../types/learningTypes';

export type LearningDatasetDocument = LearningDatasetRecord & {
  _id?: unknown;
  createdAt: Date;
  updatedAt: Date;
};

const LearningDatasetSchema = new Schema<LearningDatasetDocument>(
  {
    datasetId: { type: String, required: true, unique: true, index: true },
    schemaVersion: { type: Number, required: true, default: 1 },
    sourceReportId: { type: String, required: true, index: true },
    sourceTradeId: { type: String, required: true, index: true },
    generatedAt: { type: Date, required: true, default: () => new Date() },
    version: { type: String, required: true, default: 'learning-dataset-v1' },
    marketSnapshot: { type: Schema.Types.Mixed, default: null },
    technicalIndicators: { type: Schema.Types.Mixed, default: null },
    massiveData: { type: Schema.Types.Mixed, default: null },
    news: { type: Schema.Types.Mixed, default: null },
    sentiment: { type: Schema.Types.Mixed, default: null },
    eventIntelligence: { type: Schema.Types.Mixed, default: null },
    decisionIntelligence: { type: Schema.Types.Mixed, default: null },
    strategyRankings: { type: Schema.Types.Mixed, default: null },
    riskPackage: { type: Schema.Types.Mixed, default: null },
    lifecycle: { type: Schema.Types.Mixed, default: null },
    executionResult: { type: Schema.Types.Mixed, default: null },
    tradeEvaluation: { type: Schema.Types.Mixed, default: null },
    outcome: {
      label: { type: String, enum: ['WIN', 'LOSS', 'PARTIAL_WIN', 'BREAKEVEN', 'UNKNOWN'], required: true },
      actualReturn: { type: Number, default: null },
      realizedPnl: { type: Number, default: null },
    },
  },
  { timestamps: true, collection: 'learning_datasets' }
);

LearningDatasetSchema.pre('save', async function preventMutation() {
  if (this.isNew || !this.isModified()) return;
  throw new Error('LEARNING_DATASET_APPEND_ONLY');
});

LearningDatasetSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function preventQueryMutation() {
  this.setQuery({ $and: [this.getQuery(), { _id: null }] });
});

export const LearningDatasetModel =
  (mongoose.models.LearningDataset as mongoose.Model<LearningDatasetDocument>) ||
  mongoose.model<LearningDatasetDocument>('LearningDataset', LearningDatasetSchema);
