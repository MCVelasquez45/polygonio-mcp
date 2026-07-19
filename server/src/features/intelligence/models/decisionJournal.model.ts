import mongoose, { Schema } from 'mongoose';

export const DECISION_TYPES = [
  'BUY_APPROVED',
  'BUY_REJECTED',
  'SELL_APPROVED',
  'SELL_REJECTED',
  'SIGNAL_REJECTED',
  'NO_SIGNAL',
  'DATA_REJECTED',
  'RISK_REJECTED',
  'ORDER_CANCELLED',
  'ORDER_TIMEOUT',
  'EXIT_TRIGGERED',
  'EMERGENCY_STOP',
  'NO_ACTION',
] as const;

export const DECISION_ACTIONS = ['BUY', 'SELL', 'SKIP', 'REJECT', 'EXIT', 'CANCEL', 'EMERGENCY_STOP', 'NO_ACTION'] as const;

export type DecisionType = (typeof DECISION_TYPES)[number];
export type DecisionAction = (typeof DECISION_ACTIONS)[number];
export type DecisionEnvironment = 'PAPER' | 'LIVE';

export type DecisionJournalWarning = {
  code: string;
  message: string;
  source?: string | null;
};

export type DecisionTimelineEvent = {
  at: Date;
  label: string;
  source: string;
  sourceId?: string | null;
  severity: 'info' | 'warning' | 'critical';
};

export type DataAvailabilityStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_APPLICABLE' | 'NOT_RECORDED';

export type DecisionRiskCheck = {
  name: string;
  passed: boolean | null;
  observed?: number | string | boolean | null;
  limit?: number | string | null;
  reason: string | null;
  detail: string | null;
};

export interface DecisionJournalDocument {
  _id?: unknown;
  decisionId: string;
  sessionId: string | null;
  automationSessionId: string | null;
  tradeId: string | null;
  reportId: string | null;
  timestamp: Date;
  decisionType: DecisionType;
  source: {
    type: string;
    id: string;
    collection: string;
  };
  context: {
    symbol: string | null;
    contract: string | null;
    strategy: string | null;
    environment: DecisionEnvironment;
    marketRegime: string | null;
  };
  evaluation: {
    signal: string | null;
    signalStrength: number | null;
    confidence: number | null;
    flowScore: number | null;
    momentumScore: number | null;
    trendScore: number | null;
    riskScore: number | null;
    candidateRank: number | null;
    marketRegime: string | null;
  };
  inputs: {
    liquidity: Record<string, unknown> | null;
    spread: number | null;
    volume: number | null;
    iv: number | null;
    delta: number | null;
    theta: number | null;
    gamma: number | null;
    vega: number | null;
    marketClock: Record<string, unknown> | null;
    buyingPower: number | null;
    existingPositions: number | null;
    watchlistRank: number | null;
  };
  marketSnapshot: {
    underlying: string | null;
    underlyingPrice: number | null;
    bid: number | null;
    ask: number | null;
    mark: number | null;
    spread: number | null;
    iv: number | null;
    delta: number | null;
    volume: number | null;
    openInterest: number | null;
    dte: number | null;
    quoteTimestamp: Date | null;
    marketSession: string | null;
  };
  contractSnapshot: {
    contractSymbol: string | null;
    strike: number | null;
    expiration: string | null;
    type: string | null;
    contractScore: number | null;
    liquidityScore: number | null;
    spreadPct: number | null;
    scoreComponents: Record<string, unknown> | null;
  };
  decision: {
    decision: DecisionAction;
    approved: boolean;
    rejected: boolean;
    skipped: boolean;
    reasonCodes: string[];
    humanReadableReasons: string[];
  };
  riskSnapshot: {
    positionSize: number | null;
    buyingPowerUsed: number | null;
    riskPercent: number | null;
    maxLoss: number | null;
    estimatedReward: number | null;
    estimatedRR: number | null;
    quantity: number | null;
    entryPrice: number | null;
    limitPrice: number | null;
    orderType: string | null;
    timeInForce: string | null;
  };
  riskChecks: DecisionRiskCheck[];
  reasonSummary: {
    primaryReason: string | null;
    supportingReasons: string[];
    humanSummary: string | null;
    machineCodes: string[];
  };
  aiContext: {
    status: 'AI_NOT_USED' | 'USED' | 'UNAVAILABLE' | 'NOT_RECORDED';
    recommendation: string | null;
    confidence: number | null;
    summary: string | null;
    explanation: string | null;
    promptVersion: string | null;
    modelUsed: string | null;
  };
  dataAvailability: {
    fields: Record<string, DataAvailabilityStatus>;
  };
  executionReference: {
    orderIntentId: string | null;
    brokerOrderId: string | null;
    positionId: string | null;
  };
  evidenceQuality: {
    persistedFields: string[];
    missingFields: string[];
    warnings: DecisionJournalWarning[];
  };
  timeline: DecisionTimelineEvent[];
  generation: {
    schemaVersion: number;
    generatorVersion: string;
    generatedBy: string;
    generatedFromPersistedEvidence: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

export type DecisionJournalHydratedDocument = mongoose.HydratedDocument<DecisionJournalDocument>;

const WarningSchema = new Schema<DecisionJournalWarning>(
  {
    code: { type: String, required: true },
    message: { type: String, required: true },
    source: { type: String, default: null },
  },
  { _id: false }
);

const TimelineSchema = new Schema<DecisionTimelineEvent>(
  {
    at: { type: Date, required: true },
    label: { type: String, required: true },
    source: { type: String, required: true },
    sourceId: { type: String, default: null },
    severity: { type: String, enum: ['info', 'warning', 'critical'], required: true, default: 'info' },
  },
  { _id: false }
);

const RiskCheckSchema = new Schema<DecisionRiskCheck>(
  {
    name: { type: String, required: true },
    passed: { type: Boolean, default: null },
    observed: { type: Schema.Types.Mixed, default: null },
    limit: { type: Schema.Types.Mixed, default: null },
    reason: { type: String, default: null },
    detail: { type: String, default: null },
  },
  { _id: false }
);

const DecisionJournalSchema = new Schema<DecisionJournalDocument>(
  {
    decisionId: { type: String, required: true, unique: true, index: true },
    sessionId: { type: String, default: null, index: true },
    automationSessionId: { type: String, default: null, index: true },
    tradeId: { type: String, default: null, index: true },
    reportId: { type: String, default: null, index: true },
    timestamp: { type: Date, required: true, index: true },
    decisionType: { type: String, enum: DECISION_TYPES, required: true, index: true },
    source: {
      type: {
        type: String,
        required: true,
      },
      id: { type: String, required: true },
      collection: { type: String, required: true },
    },
    context: {
      symbol: { type: String, default: null, index: true },
      contract: { type: String, default: null },
      strategy: { type: String, default: null },
      environment: { type: String, enum: ['PAPER', 'LIVE'], required: true, default: 'PAPER', index: true },
      marketRegime: { type: String, default: null },
    },
    evaluation: {
      signal: { type: String, default: null },
      signalStrength: { type: Number, default: null },
      confidence: { type: Number, default: null },
      flowScore: { type: Number, default: null },
      momentumScore: { type: Number, default: null },
      trendScore: { type: Number, default: null },
      riskScore: { type: Number, default: null },
      candidateRank: { type: Number, default: null },
      marketRegime: { type: String, default: null },
    },
    inputs: {
      liquidity: { type: Schema.Types.Mixed, default: null },
      spread: { type: Number, default: null },
      volume: { type: Number, default: null },
      iv: { type: Number, default: null },
      delta: { type: Number, default: null },
      theta: { type: Number, default: null },
      gamma: { type: Number, default: null },
      vega: { type: Number, default: null },
      marketClock: { type: Schema.Types.Mixed, default: null },
      buyingPower: { type: Number, default: null },
      existingPositions: { type: Number, default: null },
      watchlistRank: { type: Number, default: null },
    },
    marketSnapshot: {
      underlying: { type: String, default: null },
      underlyingPrice: { type: Number, default: null },
      bid: { type: Number, default: null },
      ask: { type: Number, default: null },
      mark: { type: Number, default: null },
      spread: { type: Number, default: null },
      iv: { type: Number, default: null },
      delta: { type: Number, default: null },
      volume: { type: Number, default: null },
      openInterest: { type: Number, default: null },
      dte: { type: Number, default: null },
      quoteTimestamp: { type: Date, default: null },
      marketSession: { type: String, default: null },
    },
    contractSnapshot: {
      contractSymbol: { type: String, default: null },
      strike: { type: Number, default: null },
      expiration: { type: String, default: null },
      type: { type: String, default: null },
      contractScore: { type: Number, default: null },
      liquidityScore: { type: Number, default: null },
      spreadPct: { type: Number, default: null },
      scoreComponents: { type: Schema.Types.Mixed, default: null },
    },
    decision: {
      decision: { type: String, enum: DECISION_ACTIONS, required: true },
      approved: { type: Boolean, required: true, default: false },
      rejected: { type: Boolean, required: true, default: false },
      skipped: { type: Boolean, required: true, default: false },
      reasonCodes: { type: [String], required: true, default: [] },
      humanReadableReasons: { type: [String], required: true, default: [] },
    },
    riskSnapshot: {
      positionSize: { type: Number, default: null },
      buyingPowerUsed: { type: Number, default: null },
      riskPercent: { type: Number, default: null },
      maxLoss: { type: Number, default: null },
      estimatedReward: { type: Number, default: null },
      estimatedRR: { type: Number, default: null },
      quantity: { type: Number, default: null },
      entryPrice: { type: Number, default: null },
      limitPrice: { type: Number, default: null },
      orderType: { type: String, default: null },
      timeInForce: { type: String, default: null },
    },
    riskChecks: { type: [RiskCheckSchema], required: true, default: [] },
    reasonSummary: {
      primaryReason: { type: String, default: null },
      supportingReasons: { type: [String], required: true, default: [] },
      humanSummary: { type: String, default: null },
      machineCodes: { type: [String], required: true, default: [] },
    },
    aiContext: {
      status: { type: String, enum: ['AI_NOT_USED', 'USED', 'UNAVAILABLE', 'NOT_RECORDED'], required: true, default: 'AI_NOT_USED' },
      recommendation: { type: String, default: null },
      confidence: { type: Number, default: null },
      summary: { type: String, default: null },
      explanation: { type: String, default: null },
      promptVersion: { type: String, default: null },
      modelUsed: { type: String, default: null },
    },
    dataAvailability: {
      fields: { type: Schema.Types.Mixed, required: true, default: {} },
    },
    executionReference: {
      orderIntentId: { type: String, default: null },
      brokerOrderId: { type: String, default: null },
      positionId: { type: String, default: null },
    },
    evidenceQuality: {
      persistedFields: { type: [String], required: true, default: [] },
      missingFields: { type: [String], required: true, default: [] },
      warnings: { type: [WarningSchema], required: true, default: [] },
    },
    timeline: { type: [TimelineSchema], required: true, default: [] },
    generation: {
      schemaVersion: { type: Number, required: true, default: 1 },
      generatorVersion: { type: String, required: true, default: 'decision-journal-v1' },
      generatedBy: { type: String, required: true, default: 'server:intelligence:decision-journal' },
      generatedFromPersistedEvidence: { type: Boolean, required: true, default: true },
    },
  },
  { timestamps: true, collection: 'intelligence_decision_journal' }
);

DecisionJournalSchema.index({ sessionId: 1, timestamp: 1 });
DecisionJournalSchema.index({ automationSessionId: 1, timestamp: 1 });
DecisionJournalSchema.index({ tradeId: 1, timestamp: 1 });
DecisionJournalSchema.index({ 'context.symbol': 1, timestamp: -1 });

DecisionJournalSchema.pre('save', async function preventDecisionJournalMutation() {
  if (this.isNew || !this.isModified()) {
    return;
  }
  const existing = await DecisionJournalModel.findById(this._id).select('_id').lean();
  if (existing) {
    throw new Error('DECISION_JOURNAL_ENTRY_IMMUTABLE');
  }
});

DecisionJournalSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function preventDecisionJournalQueryMutation() {
  this.setQuery({ $and: [this.getQuery(), { _id: { $exists: false } }] });
});

export const DecisionJournalModel =
  (mongoose.models.IntelligenceDecisionJournal as mongoose.Model<DecisionJournalDocument>) ||
  mongoose.model<DecisionJournalDocument>('IntelligenceDecisionJournal', DecisionJournalSchema);
