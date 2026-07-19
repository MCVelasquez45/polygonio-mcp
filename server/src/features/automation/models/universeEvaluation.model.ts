import mongoose, { Document, Schema } from 'mongoose';

// Phase 2.6 — one document per universe evaluation run. This is the
// dashboard's authoritative record: configured universe, per-symbol
// eligibility (with rejection reasons), deterministic ranking, the selected
// opportunity, and the risk outcome. The ranking is persisted verbatim so
// every automated decision is reproducible after the fact.

export type UniverseEvaluationOutcome =
  | 'INTENT_CREATED'
  | 'NO_TRADE'
  | 'NO_ELIGIBLE_SYMBOLS'
  | 'UNIVERSE_NOT_CONFIGURED'
  | 'GATES_REJECTED'
  | 'CLOCK_REJECTED'
  | 'RISK_REJECTED';

export type RankedOpportunity = {
  rank: number;
  symbol: string;
  direction: 'BULLISH' | 'BEARISH';
  contractSymbol: string | null;
  /** Deterministic opportunity score (contract score + symbol quality). */
  opportunityScore: number;
  contractScore: number | null;
  symbolScore: number;
  spreadPct: number | null;
  openInterest: number | null;
  volume: number | null;
  candidateId: string | null;
};

export type SymbolEvaluationRecord = {
  symbol: string;
  eligible: boolean;
  reasonCodes: string[];
  symbolScore: number;
  barCount: number;
  closedBarTimestamp: Date | null;
  liquidity: Record<string, unknown> | null;
  candidateId: string | null;
  candidateStatus: string | null;
  direction: 'BULLISH' | 'BEARISH' | null;
};

export interface UniverseEvaluationDocument extends Document {
  automationSessionId: string;
  strategyVersionId: string;
  evaluatedAt: Date;
  universeSource: string;
  configuredSymbols: string[];
  invalidSymbols: string[];
  eligibleSymbols: string[];
  symbolResults: SymbolEvaluationRecord[];
  ranking: RankedOpportunity[];
  selectedSymbol: string | null;
  selectedContractSymbol: string | null;
  selectedCandidateId: string | null;
  riskApproved: boolean | null;
  riskReasonCodes: string[];
  orderIntentId: string | null;
  outcome: UniverseEvaluationOutcome;
  reasonCodes: string[];
  marketClockDecision: Record<string, unknown> | null;
  dataHealth: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

const OUTCOMES: UniverseEvaluationOutcome[] = [
  'INTENT_CREATED',
  'NO_TRADE',
  'NO_ELIGIBLE_SYMBOLS',
  'UNIVERSE_NOT_CONFIGURED',
  'GATES_REJECTED',
  'CLOCK_REJECTED',
  'RISK_REJECTED',
];

const UniverseEvaluationSchema = new Schema<UniverseEvaluationDocument>(
  {
    automationSessionId: { type: String, required: true, index: true },
    strategyVersionId: { type: String, required: true },
    evaluatedAt: { type: Date, required: true },
    universeSource: { type: String, required: true },
    configuredSymbols: { type: [String], required: true, default: [] },
    invalidSymbols: { type: [String], required: true, default: [] },
    eligibleSymbols: { type: [String], required: true, default: [] },
    symbolResults: { type: [Schema.Types.Mixed] as any, required: true, default: [] },
    ranking: { type: [Schema.Types.Mixed] as any, required: true, default: [] },
    selectedSymbol: { type: String, default: null },
    selectedContractSymbol: { type: String, default: null },
    selectedCandidateId: { type: String, default: null },
    riskApproved: { type: Boolean, default: null },
    riskReasonCodes: { type: [String], required: true, default: [] },
    orderIntentId: { type: String, default: null },
    outcome: { type: String, enum: OUTCOMES, required: true, index: true },
    reasonCodes: { type: [String], required: true, default: [] },
    marketClockDecision: { type: Schema.Types.Mixed, default: null },
    dataHealth: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: 'automation_universe_evaluations' }
);

UniverseEvaluationSchema.index({ automationSessionId: 1, evaluatedAt: -1 });

export const UniverseEvaluationModel =
  (mongoose.models.AutomationUniverseEvaluation as mongoose.Model<UniverseEvaluationDocument>) ||
  mongoose.model<UniverseEvaluationDocument>('AutomationUniverseEvaluation', UniverseEvaluationSchema);
