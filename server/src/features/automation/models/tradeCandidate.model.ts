import mongoose, { Document, Schema } from 'mongoose';

// One document per (session, strategyVersion, underlying, closed bar).
// The unique index makes double-evaluation of the same bar structurally
// impossible: whichever delivery inserts first owns the evaluation; every
// later delivery reads the existing record.

export type TradeCandidateStatus =
  | 'SIGNAL_FOUND'
  | 'NO_TRADE'
  | 'DATA_REJECTED'
  | 'CLOCK_REJECTED'
  | 'DUPLICATE_SUPPRESSED'
  | 'RISK_REJECTED'
  | 'RISK_APPROVED'
  // Phase 2.6: a valid setup that ranked below the selected opportunity in a
  // universe evaluation. Recorded, never traded.
  | 'RANKED_NOT_SELECTED';

export type SignalDirection = 'BULLISH' | 'BEARISH';

export interface TradeCandidateDocument extends Document {
  automationSessionId: string;
  strategyVersionId: string;
  underlying: string;
  barTimestamp: Date;
  signalDirection: SignalDirection | null;
  status: TradeCandidateStatus;
  reasonCodes: string[];
  indicatorSnapshot: {
    close: number | null;
    vwap: number | null;
    emaFast: number | null;
    emaSlow: number | null;
    rsi: number | null;
    atr: number | null;
    barVolume: number | null;
    rollingVolumeAvg: number | null;
  } | null;
  marketClockDecision: Record<string, unknown> | null;
  marketDataHealth: Record<string, unknown> | null;
  strategyConfigSnapshot: Record<string, unknown>;
  conditions: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

const CANDIDATE_STATUSES: TradeCandidateStatus[] = [
  'SIGNAL_FOUND',
  'NO_TRADE',
  'DATA_REJECTED',
  'CLOCK_REJECTED',
  'DUPLICATE_SUPPRESSED',
  'RISK_REJECTED',
  'RISK_APPROVED',
  'RANKED_NOT_SELECTED',
];

const TradeCandidateSchema = new Schema<TradeCandidateDocument>(
  {
    automationSessionId: { type: String, required: true, index: true },
    strategyVersionId: { type: String, required: true },
    underlying: { type: String, required: true, uppercase: true, trim: true },
    barTimestamp: { type: Date, required: true },
    signalDirection: { type: String, enum: ['BULLISH', 'BEARISH', null], default: null },
    status: { type: String, enum: CANDIDATE_STATUSES, required: true, index: true },
    reasonCodes: { type: [String], required: true, default: [] },
    indicatorSnapshot: { type: Schema.Types.Mixed, default: null },
    marketClockDecision: { type: Schema.Types.Mixed, default: null },
    marketDataHealth: { type: Schema.Types.Mixed, default: null },
    strategyConfigSnapshot: { type: Schema.Types.Mixed, required: true },
    conditions: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: 'automation_trade_candidates' }
);

// THE closed-bar dedupe guarantee (spec: sessionId+strategyVersionId+underlying+barTimestamp).
TradeCandidateSchema.index(
  { automationSessionId: 1, strategyVersionId: 1, underlying: 1, barTimestamp: 1 },
  { unique: true }
);
TradeCandidateSchema.index({ automationSessionId: 1, createdAt: -1 });

export const TradeCandidateModel =
  (mongoose.models.AutomationTradeCandidate as mongoose.Model<TradeCandidateDocument>) ||
  mongoose.model<TradeCandidateDocument>('AutomationTradeCandidate', TradeCandidateSchema);
