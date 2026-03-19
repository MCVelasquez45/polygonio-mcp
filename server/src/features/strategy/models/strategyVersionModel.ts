import mongoose, { Schema, type Document } from 'mongoose';
import type { StrategyAst, StrategyPipelineStage, StrategyRiskManagement, StrategyRuntimeSpec, StrategySourceType, StrategyStatus, StructuredStrategy } from '../types';
import {
  CONDITION_OPERATORS,
  CONDITION_PROVENANCE_SOURCES,
  STRATEGY_ACTIONS,
  STRATEGY_FIELDS,
  STRATEGY_INSTRUMENTS,
  STRATEGY_PIPELINE_STAGES,
  STRATEGY_SOURCE_TYPES,
  STRATEGY_STATUSES
} from '../types';

export interface StrategyVersionDocument extends Document {
  strategyId: mongoose.Types.ObjectId;
  version: string;
  status: StrategyStatus;
  pipelineStage: StrategyPipelineStage;
  inputArtifacts: {
    rawInput: string;
    sourceType: StrategySourceType;
    structured: StructuredStrategy;
  };
  compiledArtifacts: {
    ast: StrategyAst;
    dsl: string;
    runtimeSpec: StrategyRuntimeSpec;
  };
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

const riskManagementSchema = new Schema<StrategyRiskManagement>(
  {
    stopLossPct: { type: Number, required: true },
    takeProfitPct: { type: Number, required: true },
    maxBarsInTrade: { type: Number, required: true }
  },
  { _id: false }
);

const structuredConditionSchema = new Schema(
  {
    field: { type: String, enum: STRATEGY_FIELDS, required: true },
    operator: { type: String, enum: CONDITION_OPERATORS, required: true },
    value: { type: Schema.Types.Mixed, default: undefined },
    raw: { type: String, required: true },
    provenance: { type: provenanceSchema, required: true }
  },
  { _id: false }
);

const conditionNodeSchema = new Schema(
  {
    id: { type: String, required: true },
    type: { type: String, enum: ['condition'], required: true },
    field: { type: String, enum: STRATEGY_FIELDS, required: true },
    operator: { type: String, enum: CONDITION_OPERATORS, required: true },
    value: { type: Schema.Types.Mixed, default: undefined },
    raw: { type: String, required: true },
    provenance: { type: provenanceSchema, required: true }
  },
  { _id: false }
);

const structuredStrategySchema = new Schema(
  {
    name: { type: String, required: true },
    sourceText: { type: String, required: true },
    sourceType: { type: String, enum: STRATEGY_SOURCE_TYPES, required: true },
    action: { type: String, enum: STRATEGY_ACTIONS, required: true },
    instrument: { type: String, enum: STRATEGY_INSTRUMENTS, required: true },
    entry: { type: [structuredConditionSchema], required: true },
    exit: { type: [structuredConditionSchema], required: true },
    riskManagement: { type: riskManagementSchema, required: true },
    warnings: { type: [String], default: [] }
  },
  { _id: false }
);

const strategyAstSchema = new Schema(
  {
    type: { type: String, enum: ['strategy'], required: true },
    name: { type: String, required: true },
    meta: {
      type: new Schema(
        {
          action: { type: String, enum: STRATEGY_ACTIONS, required: true },
          instrument: { type: String, enum: STRATEGY_INSTRUMENTS, required: true }
        },
        { _id: false }
      ),
      required: true
    },
    entry: { type: [conditionNodeSchema], required: true },
    exit: { type: [conditionNodeSchema], required: true },
    riskManagement: { type: riskManagementSchema, required: true }
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

const strategyRuntimeSpecSchema = new Schema(
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

const StrategyVersionSchema = new Schema<StrategyVersionDocument>(
  {
    strategyId: { type: Schema.Types.ObjectId, ref: 'Strategy', required: true, index: true },
    version: { type: String, required: true },
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
    inputArtifacts: {
      rawInput: { type: String, required: true },
      sourceType: { type: String, enum: STRATEGY_SOURCE_TYPES, default: 'text' },
      structured: { type: structuredStrategySchema, required: true }
    },
    compiledArtifacts: {
      ast: { type: strategyAstSchema, required: true },
      dsl: { type: String, required: true },
      runtimeSpec: { type: strategyRuntimeSpecSchema, required: true }
    }
  },
  { timestamps: true }
);

StrategyVersionSchema.index({ strategyId: 1, version: 1 }, { unique: true });

export const StrategyVersionModel =
  mongoose.models.StrategyVersion || mongoose.model<StrategyVersionDocument>('StrategyVersion', StrategyVersionSchema);
