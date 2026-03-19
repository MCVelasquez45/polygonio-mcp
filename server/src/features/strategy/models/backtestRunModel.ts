import mongoose, { Schema, type Document } from 'mongoose';
import type { BacktestResult, StrategyPipelineStage, StrategyRuntimeSpec } from '../types';
import {
  CONDITION_OPERATORS,
  CONDITION_PROVENANCE_SOURCES,
  STRATEGY_ACTIONS,
  STRATEGY_FIELDS,
  STRATEGY_INSTRUMENTS
} from '../types';

export interface BacktestRunDocument extends Document {
  strategyId: mongoose.Types.ObjectId;
  versionId: mongoose.Types.ObjectId;
  version: string;
  status: 'completed';
  pipelineStage: Extract<StrategyPipelineStage, 'backtested'>;
  seedKey: string;
  executionSnapshot: StrategyRuntimeSpec;
  results: BacktestResult;
  createdAt: Date;
  updatedAt: Date;
}

const provenanceSchema = new Schema(
  {
    source: { type: String, enum: CONDITION_PROVENANCE_SOURCES, required: true },
    reason: { type: String, default: null }
  },
  { _id: false }
);

const riskManagementSchema = new Schema(
  {
    stopLossPct: { type: Number, required: true },
    takeProfitPct: { type: Number, required: true },
    maxBarsInTrade: { type: Number, required: true }
  },
  { _id: false }
);

const runtimeRuleSchema = new Schema(
  {
    field: { type: String, enum: STRATEGY_FIELDS, required: true },
    operator: { type: String, enum: CONDITION_OPERATORS, required: true },
    value: { type: Schema.Types.Mixed, default: undefined },
    raw: { type: String, required: true },
    provenance: { type: provenanceSchema, required: true }
  },
  { _id: false }
);

const runtimeSpecSchema = new Schema(
  {
    name: { type: String, required: true },
    indicators: { type: [{ type: String, enum: STRATEGY_FIELDS }], required: true },
    rules: {
      type: new Schema(
        {
          entry: { type: [runtimeRuleSchema], required: true },
          exit: { type: [runtimeRuleSchema], required: true }
        },
        { _id: false }
      ),
      required: true
    },
    execution: {
      type: new Schema(
        {
          action: { type: String, enum: STRATEGY_ACTIONS, required: true },
          instrument: { type: String, enum: STRATEGY_INSTRUMENTS, required: true }
        },
        { _id: false }
      ),
      required: true
    },
    riskManagement: { type: riskManagementSchema, required: true }
  },
  { _id: false }
);

const backtestTradeSchema = new Schema(
  {
    entryTime: { type: String, required: true },
    exitTime: { type: String, required: true },
    side: { type: String, enum: ['long', 'short'], required: true },
    entryAction: { type: String, enum: STRATEGY_ACTIONS, required: true },
    exitAction: { type: String, enum: ['EXIT'], required: true },
    entryPrice: { type: Number, required: true },
    exitPrice: { type: Number, required: true },
    pnl: { type: Number, required: true },
    barsHeld: { type: Number, required: true },
    reason: { type: String, required: true }
  },
  { _id: false }
);

const backtestResultSchema = new Schema<BacktestResult>(
  {
    pnl: { type: Number, required: true },
    winRate: { type: Number, required: true },
    totalTrades: { type: Number, required: true },
    trades: { type: [backtestTradeSchema], default: [] }
  },
  { _id: false }
);

const BacktestRunSchema = new Schema<BacktestRunDocument>(
  {
    strategyId: { type: Schema.Types.ObjectId, ref: 'Strategy', required: true, index: true },
    versionId: { type: Schema.Types.ObjectId, ref: 'StrategyVersion', required: true, index: true },
    version: { type: String, required: true },
    status: { type: String, enum: ['completed'], default: 'completed' },
    pipelineStage: { type: String, enum: ['backtested'], default: 'backtested' },
    seedKey: { type: String, required: true },
    executionSnapshot: { type: runtimeSpecSchema, required: true },
    results: { type: backtestResultSchema, required: true }
  },
  { timestamps: true }
);

BacktestRunSchema.index({ versionId: 1, createdAt: -1 });

export const BacktestRunModel =
  mongoose.models.BacktestRun || mongoose.model<BacktestRunDocument>('BacktestRun', BacktestRunSchema);
