import mongoose, { Schema } from 'mongoose';
import type { StrategyOrchestratorRun } from '../types/orchestratorTypes';

export interface StrategyOrchestratorDocument extends Omit<StrategyOrchestratorRun, 'timestamp'> {
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

const StrategyOrchestratorSchema = new Schema<StrategyOrchestratorDocument>(
  {
    runId: { type: String, required: true, unique: true, index: true },
    timestamp: { type: Date, required: true, index: true },
    strategiesEvaluated: { type: [Schema.Types.Mixed], required: true, default: [] } as any,
    rankings: { type: [Schema.Types.Mixed], required: true, default: [] } as any,
    winner: { type: Schema.Types.Mixed, default: null },
    conflicts: { type: Schema.Types.Mixed, required: true },
    recommendation: { type: Schema.Types.Mixed, required: true },
    evidence: { type: Schema.Types.Mixed, required: true },
    marketContext: { type: Schema.Types.Mixed, required: true },
    decisionEngineContext: { type: Schema.Types.Mixed, required: true },
    eventContext: { type: Schema.Types.Mixed, required: true },
    portfolioContext: { type: Schema.Types.Mixed, required: true },
    schemaVersion: { type: Number, required: true, default: 1 },
  },
  { timestamps: true, collection: 'strategy_orchestrator_runs' }
);

StrategyOrchestratorSchema.index({ timestamp: -1, runId: 1 });

export const StrategyOrchestratorModel =
  (mongoose.models.StrategyOrchestratorRun as mongoose.Model<StrategyOrchestratorDocument>) ||
  mongoose.model<StrategyOrchestratorDocument>('StrategyOrchestratorRun', StrategyOrchestratorSchema);
