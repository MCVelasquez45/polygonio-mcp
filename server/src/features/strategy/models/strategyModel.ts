import mongoose, { Schema, type Document } from 'mongoose';
import type { StrategyPipelineStage, StrategyStatus } from '../types';
import { STRATEGY_PIPELINE_STAGES, STRATEGY_STATUSES } from '../types';

export interface StrategyDocument extends Document {
  name: string;
  description: string;
  status: StrategyStatus;
  pipelineStage: StrategyPipelineStage;
  versionSequence: number;
  latestVersion: string;
  currentVersionId?: mongoose.Types.ObjectId | null;
  latestBacktestRunId?: mongoose.Types.ObjectId | null;
  latestInput?: string | null;
  tradingMethod?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const StrategySchema = new Schema<StrategyDocument>(
  {
    name: { type: String, required: true },
    description: { type: String, default: '' },
    status: {
      type: String,
      enum: STRATEGY_STATUSES,
      default: 'draft'
    },
    pipelineStage: {
      type: String,
      enum: STRATEGY_PIPELINE_STAGES,
      default: 'draft'
    },
    versionSequence: { type: Number, default: 0 },
    latestVersion: { type: String, default: '1.0.0' },
    currentVersionId: { type: Schema.Types.ObjectId, ref: 'StrategyVersion', default: null },
    latestBacktestRunId: { type: Schema.Types.ObjectId, ref: 'BacktestRun', default: null },
    latestInput: { type: String, default: null },
    tradingMethod: { type: String, enum: ['equities', 'options', 'futures'], default: null }
  },
  { timestamps: true }
);

export const StrategyModel = mongoose.models.Strategy || mongoose.model<StrategyDocument>('Strategy', StrategySchema);
