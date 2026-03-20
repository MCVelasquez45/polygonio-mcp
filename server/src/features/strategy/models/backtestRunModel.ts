import mongoose, { Schema, type Document } from 'mongoose';
import type { StrategyPipelineStage } from '../types';

export interface BacktestRunDocument extends Document {
  strategyId: mongoose.Types.ObjectId;
  versionId: mongoose.Types.ObjectId;
  version: string;
  status: 'completed';
  pipelineStage: Extract<StrategyPipelineStage, 'backtested'>;
  seedKey: string;
  executionSnapshot: Record<string, unknown>;
  results: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const BacktestRunSchema = new Schema<BacktestRunDocument>(
  {
    strategyId: { type: Schema.Types.ObjectId, ref: 'Strategy', required: true, index: true },
    versionId: { type: Schema.Types.ObjectId, ref: 'StrategyVersion', required: true, index: true },
    version: { type: String, required: true },
    status: { type: String, enum: ['completed'], default: 'completed' },
    pipelineStage: { type: String, enum: ['backtested'], default: 'backtested' },
    seedKey: { type: String, required: true },
    // Store as Mixed to accept both the pipeline engine format (entryTime/exitTime/side)
    // and the strategy backtest engine format (timestamp/fillPrice/contracts/reason)
    executionSnapshot: { type: Schema.Types.Mixed, required: true },
    results: { type: Schema.Types.Mixed, required: true }
  },
  { timestamps: true }
);

BacktestRunSchema.index({ versionId: 1, createdAt: -1 });

export const BacktestRunModel =
  mongoose.models.BacktestRun || mongoose.model<BacktestRunDocument>('BacktestRun', BacktestRunSchema);
