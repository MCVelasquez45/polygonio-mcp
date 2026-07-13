import mongoose, { Document, Schema } from 'mongoose';

// Full contract-ranking record for one trade candidate: every contract
// considered, every rejection reason, all score components, and the final
// deterministic selection (or the reason none passed). AI is never involved.

export type RankedContract = {
  symbol: string;
  type: 'call' | 'put';
  strike: number | null;
  expiration: string | null;
  dte: number | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  delta: number | null;
  iv: number | null;
  openInterest: number | null;
  volume: number | null;
  quoteTimestamp: Date | null;
  spreadDollars: number | null;
  spreadPct: number | null;
  passed: boolean;
  rejectionReasons: string[];
  score: number | null;
  scoreComponents: {
    delta: number;
    spread: number;
    liquidity: number;
    dte: number;
  } | null;
};

export interface ContractSelectionDocument extends Document {
  tradeCandidateId: string;
  automationSessionId: string;
  direction: 'BULLISH' | 'BEARISH';
  optionSide: 'call' | 'put';
  underlying: string;
  underlyingPrice: number | null;
  chainFetchedAt: Date;
  filtersSnapshot: Record<string, unknown>;
  candidates: RankedContract[];
  consideredCount: number;
  passedCount: number;
  selected: RankedContract | null;
  noSelectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const RankedContractSchema = new Schema(
  {
    symbol: { type: String, required: true },
    type: { type: String, enum: ['call', 'put'], required: true },
    strike: { type: Number, default: null },
    expiration: { type: String, default: null },
    dte: { type: Number, default: null },
    bid: { type: Number, default: null },
    ask: { type: Number, default: null },
    mid: { type: Number, default: null },
    delta: { type: Number, default: null },
    iv: { type: Number, default: null },
    openInterest: { type: Number, default: null },
    volume: { type: Number, default: null },
    quoteTimestamp: { type: Date, default: null },
    spreadDollars: { type: Number, default: null },
    spreadPct: { type: Number, default: null },
    passed: { type: Boolean, required: true },
    rejectionReasons: { type: [String], default: [] },
    score: { type: Number, default: null },
    scoreComponents: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const ContractSelectionSchema = new Schema<ContractSelectionDocument>(
  {
    tradeCandidateId: { type: String, required: true },
    automationSessionId: { type: String, required: true, index: true },
    direction: { type: String, enum: ['BULLISH', 'BEARISH'], required: true },
    optionSide: { type: String, enum: ['call', 'put'], required: true },
    underlying: { type: String, required: true },
    underlyingPrice: { type: Number, default: null },
    chainFetchedAt: { type: Date, required: true },
    filtersSnapshot: { type: Schema.Types.Mixed, required: true },
    candidates: { type: [RankedContractSchema], required: true, default: [] },
    consideredCount: { type: Number, required: true },
    passedCount: { type: Number, required: true },
    selected: { type: RankedContractSchema, default: null },
    noSelectionReason: { type: String, default: null },
  },
  { timestamps: true, collection: 'automation_contract_selections' }
);

ContractSelectionSchema.index({ tradeCandidateId: 1 }, { unique: true });
ContractSelectionSchema.index({ automationSessionId: 1, createdAt: -1 });

export const ContractSelectionModel =
  (mongoose.models.AutomationContractSelection as mongoose.Model<ContractSelectionDocument>) ||
  mongoose.model<ContractSelectionDocument>('AutomationContractSelection', ContractSelectionSchema);
