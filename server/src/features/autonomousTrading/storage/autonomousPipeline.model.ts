import mongoose, { Schema } from 'mongoose';
import type { AutonomousTradePipelineRecord } from '../types/pipelineTypes';

export interface AutonomousPipelineDocument extends Omit<AutonomousTradePipelineRecord, 'createdAt' | 'updatedAt'> {
  createdAt: Date;
  updatedAt: Date;
}

const AutonomousPipelineSchema = new Schema<AutonomousPipelineDocument>(
  {
    pipelineId: { type: String, required: true, unique: true, index: true },
    schemaVersion: { type: Number, required: true },
    mode: { type: String, enum: ['MANUAL', 'SHADOW', 'AUTONOMOUS_PAPER'], required: true, index: true },
    state: { type: String, required: true, index: true },
    executionSource: { type: String, required: true, index: true },
    symbol: { type: String, default: null, index: true },
    optionContract: { type: String, default: null, index: true },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    eventContext: { type: Schema.Types.Mixed, required: true },
    decisionContext: { type: Schema.Types.Mixed, required: true },
    strategyContext: { type: Schema.Types.Mixed, required: true },
    riskContext: { type: Schema.Types.Mixed, required: true },
    lifecycleContext: { type: Schema.Types.Mixed, required: true },
    executionContext: { type: Schema.Types.Mixed, required: true },
    evaluationContext: { type: Schema.Types.Mixed, required: true },
    blockingReasons: { type: [String], default: [] },
    plainLanguageStatus: { type: String, required: true },
    timeline: { type: [Schema.Types.Mixed] as any, default: [] },
  },
  { timestamps: true, collection: 'autonomous_trade_pipelines' }
);

AutonomousPipelineSchema.index({ updatedAt: -1 });
AutonomousPipelineSchema.index({ state: 1, updatedAt: -1 });

export const AutonomousPipelineModel =
  (mongoose.models.AutonomousTradePipeline as mongoose.Model<AutonomousPipelineDocument>) ||
  mongoose.model<AutonomousPipelineDocument>('AutonomousTradePipeline', AutonomousPipelineSchema);
