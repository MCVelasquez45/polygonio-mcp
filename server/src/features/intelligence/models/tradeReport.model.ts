import mongoose, { Schema } from 'mongoose';

export const TRADE_REPORT_STATUSES = ['GENERATED', 'GENERATION_FAILED'] as const;
export const TRADE_REPORT_GRADES = ['A+', 'A', 'B', 'C', 'D', 'F', 'UNAVAILABLE'] as const;

export type TradeReportStatus = (typeof TRADE_REPORT_STATUSES)[number];
export type TradeReportGrade = (typeof TRADE_REPORT_GRADES)[number];
export type TradeReportEnvironment = 'PAPER' | 'LIVE';

export type TradeReportWarning = {
  code: string;
  message: string;
  source?: string | null;
};

export type GradeBreakdown = {
  grade: TradeReportGrade;
  score: number | null;
  reasons: string[];
  unavailableInputs: string[];
};

export type TradeTimelineEvent = {
  at: Date;
  label: string;
  source: string;
  sourceId: string | null;
  severity: 'info' | 'warning' | 'critical';
  details: Record<string, unknown> | null;
};

export interface TradeReportDocument {
  _id?: unknown;
  reportId: string;
  tradeId: string;
  sessionId: string;
  automationSessionId: string;
  status: TradeReportStatus;
  environment: TradeReportEnvironment;
  tradingDate: string;
  identity: {
    underlying: string;
    optionSymbol: string;
    direction: 'BULLISH' | 'BEARISH';
    strategyVersionId: string;
    strategy: string | null;
    contractType: 'call' | 'put' | null;
    contractStrike: number | null;
    contractExpiration: string | null;
  };
  lifecycle: {
    openedAt: Date | null;
    closedAt: Date | null;
    holdTimeMinutes: number | null;
    exitReason: string | null;
    overnightRecoveryRequired: boolean;
    manualReviewReason: string | null;
  };
  execution: {
    entryOrder: Record<string, unknown> | null;
    exitOrder: Record<string, unknown> | null;
    entryIntent: Record<string, unknown> | null;
    exitIntent: Record<string, unknown> | null;
    fillCount: number;
    partialFillCount: number;
    cancellationCount: number;
    rejectionCount: number;
    retryCount: number;
    entrySlippage: number | null;
    exitSlippage: number | null;
    totalEstimatedSlippage: number | null;
    fillQuality: string;
  };
  marketContext: {
    marketStatus: string | null;
    underlyingPriceAtSelection: number | null;
    spyContext: Record<string, unknown> | null;
    sectorContext: Record<string, unknown> | null;
    vixContext: Record<string, unknown> | null;
    trend: string | null;
    marketRegime: string | null;
    liquidity: Record<string, unknown> | null;
  };
  greeks: {
    delta: number | null;
    theta: number | null;
    gamma: number | null;
    vega: number | null;
    iv: number | null;
  };
  signal: {
    confidence: number | null;
    flowScore: number | null;
    momentumScore: number | null;
    trendScore: number | null;
    riskScore: number | null;
    candidateRank: number | null;
    candidateStatus: string | null;
    riskApproved: boolean | null;
    riskReasonCodes: string[];
    selectedContractScore: number | null;
    selectedContractRank: number | null;
  };
  performance: {
    entryPrice: number | null;
    exitPrice: number | null;
    contracts: number;
    realizedPnl: number | null;
    returnPct: number | null;
    maxFavorableExcursion: number | null;
    maxAdverseExcursion: number | null;
    drawdown: number | null;
    fees: number | null;
  };
  grades: {
    entry: GradeBreakdown;
    exit: GradeBreakdown;
    risk: GradeBreakdown;
    execution: GradeBreakdown;
    market: GradeBreakdown;
    overall: GradeBreakdown;
  };
  lessons: {
    strengths: string[];
    weaknesses: string[];
    improvementSuggestions: string[];
  };
  timeline: TradeTimelineEvent[];
  evidence: {
    positionId: string;
    tradingSessionId: string;
    brokerOrderIds: string[];
    orderIntentIds: string[];
    riskDecisionId: string | null;
    tradeCandidateId: string | null;
    contractSelectionId: string | null;
    universeEvaluationIds: string[];
    eventIds: string[];
  };
  warnings: TradeReportWarning[];
  generation: {
    schemaVersion: number;
    generatorVersion: string;
    generatedBy: string;
    sourceWindowStart: Date | null;
    sourceWindowEnd: Date | null;
    generatedAt: Date;
    generatedFromPersistedEvidence: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

export type TradeReportHydratedDocument = mongoose.HydratedDocument<TradeReportDocument>;

const WarningSchema = new Schema<TradeReportWarning>(
  {
    code: { type: String, required: true },
    message: { type: String, required: true },
    source: { type: String, default: null },
  },
  { _id: false }
);

const GradeSchema = new Schema<GradeBreakdown>(
  {
    grade: { type: String, enum: TRADE_REPORT_GRADES, required: true },
    score: { type: Number, default: null },
    reasons: { type: [String], required: true, default: [] },
    unavailableInputs: { type: [String], required: true, default: [] },
  },
  { _id: false }
);

const TimelineEventSchema = new Schema<TradeTimelineEvent>(
  {
    at: { type: Date, required: true },
    label: { type: String, required: true },
    source: { type: String, required: true },
    sourceId: { type: String, default: null },
    severity: { type: String, enum: ['info', 'warning', 'critical'], required: true, default: 'info' },
    details: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const TradeReportSchema = new Schema<TradeReportDocument>(
  {
    reportId: { type: String, required: true, unique: true, index: true },
    tradeId: { type: String, required: true, unique: true, index: true },
    sessionId: { type: String, required: true, index: true },
    automationSessionId: { type: String, required: true, index: true },
    status: { type: String, enum: TRADE_REPORT_STATUSES, required: true, default: 'GENERATED', index: true },
    environment: { type: String, enum: ['PAPER', 'LIVE'], required: true, default: 'PAPER', index: true },
    tradingDate: { type: String, required: true, index: true },
    identity: {
      underlying: { type: String, required: true },
      optionSymbol: { type: String, required: true },
      direction: { type: String, enum: ['BULLISH', 'BEARISH'], required: true },
      strategyVersionId: { type: String, required: true },
      strategy: { type: String, default: null },
      contractType: { type: String, enum: ['call', 'put', null], default: null },
      contractStrike: { type: Number, default: null },
      contractExpiration: { type: String, default: null },
    },
    lifecycle: {
      openedAt: { type: Date, default: null },
      closedAt: { type: Date, default: null },
      holdTimeMinutes: { type: Number, default: null },
      exitReason: { type: String, default: null },
      overnightRecoveryRequired: { type: Boolean, required: true, default: false },
      manualReviewReason: { type: String, default: null },
    },
    execution: {
      entryOrder: { type: Schema.Types.Mixed, default: null },
      exitOrder: { type: Schema.Types.Mixed, default: null },
      entryIntent: { type: Schema.Types.Mixed, default: null },
      exitIntent: { type: Schema.Types.Mixed, default: null },
      fillCount: { type: Number, required: true, default: 0 },
      partialFillCount: { type: Number, required: true, default: 0 },
      cancellationCount: { type: Number, required: true, default: 0 },
      rejectionCount: { type: Number, required: true, default: 0 },
      retryCount: { type: Number, required: true, default: 0 },
      entrySlippage: { type: Number, default: null },
      exitSlippage: { type: Number, default: null },
      totalEstimatedSlippage: { type: Number, default: null },
      fillQuality: { type: String, required: true, default: 'Unavailable from captured evidence' },
    },
    marketContext: {
      marketStatus: { type: String, default: null },
      underlyingPriceAtSelection: { type: Number, default: null },
      spyContext: { type: Schema.Types.Mixed, default: null },
      sectorContext: { type: Schema.Types.Mixed, default: null },
      vixContext: { type: Schema.Types.Mixed, default: null },
      trend: { type: String, default: null },
      marketRegime: { type: String, default: null },
      liquidity: { type: Schema.Types.Mixed, default: null },
    },
    greeks: {
      delta: { type: Number, default: null },
      theta: { type: Number, default: null },
      gamma: { type: Number, default: null },
      vega: { type: Number, default: null },
      iv: { type: Number, default: null },
    },
    signal: {
      confidence: { type: Number, default: null },
      flowScore: { type: Number, default: null },
      momentumScore: { type: Number, default: null },
      trendScore: { type: Number, default: null },
      riskScore: { type: Number, default: null },
      candidateRank: { type: Number, default: null },
      candidateStatus: { type: String, default: null },
      riskApproved: { type: Boolean, default: null },
      riskReasonCodes: { type: [String], required: true, default: [] },
      selectedContractScore: { type: Number, default: null },
      selectedContractRank: { type: Number, default: null },
    },
    performance: {
      entryPrice: { type: Number, default: null },
      exitPrice: { type: Number, default: null },
      contracts: { type: Number, required: true, default: 0 },
      realizedPnl: { type: Number, default: null },
      returnPct: { type: Number, default: null },
      maxFavorableExcursion: { type: Number, default: null },
      maxAdverseExcursion: { type: Number, default: null },
      drawdown: { type: Number, default: null },
      fees: { type: Number, default: null },
    },
    grades: {
      entry: { type: GradeSchema, required: true },
      exit: { type: GradeSchema, required: true },
      risk: { type: GradeSchema, required: true },
      execution: { type: GradeSchema, required: true },
      market: { type: GradeSchema, required: true },
      overall: { type: GradeSchema, required: true },
    },
    lessons: {
      strengths: { type: [String], required: true, default: [] },
      weaknesses: { type: [String], required: true, default: [] },
      improvementSuggestions: { type: [String], required: true, default: [] },
    },
    timeline: { type: [TimelineEventSchema], required: true, default: [] },
    evidence: {
      positionId: { type: String, required: true },
      tradingSessionId: { type: String, required: true },
      brokerOrderIds: { type: [String], required: true, default: [] },
      orderIntentIds: { type: [String], required: true, default: [] },
      riskDecisionId: { type: String, default: null },
      tradeCandidateId: { type: String, default: null },
      contractSelectionId: { type: String, default: null },
      universeEvaluationIds: { type: [String], required: true, default: [] },
      eventIds: { type: [String], required: true, default: [] },
    },
    warnings: { type: [WarningSchema], required: true, default: [] },
    generation: {
      schemaVersion: { type: Number, required: true, default: 1 },
      generatorVersion: { type: String, required: true, default: 'trade-report-generator-v1' },
      generatedBy: { type: String, required: true, default: 'server:intelligence:trade-report-generator' },
      sourceWindowStart: { type: Date, default: null },
      sourceWindowEnd: { type: Date, default: null },
      generatedAt: { type: Date, required: true, default: () => new Date() },
      generatedFromPersistedEvidence: { type: Boolean, required: true, default: true },
    },
  },
  { timestamps: true, collection: 'intelligence_trade_reports' }
);

TradeReportSchema.index({ sessionId: 1, tradingDate: -1 });
TradeReportSchema.index({ tradingDate: -1, 'identity.underlying': 1 });
TradeReportSchema.index({ 'grades.overall.grade': 1, tradingDate: -1 });

TradeReportSchema.pre('save', async function preventGeneratedReportMutation() {
  if (this.isNew || !this.isModified()) {
    return;
  }
  const existing = await TradeReportModel.findById(this._id).select('status').lean();
  if (existing?.status === 'GENERATED') {
    throw new Error('GENERATED_TRADE_REPORT_IMMUTABLE');
  }
});

TradeReportSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function preventGeneratedReportQueryMutation() {
  this.setQuery({ $and: [this.getQuery(), { status: { $ne: 'GENERATED' } }] });
});

export const TradeReportModel =
  (mongoose.models.IntelligenceTradeReport as mongoose.Model<TradeReportDocument>) ||
  mongoose.model<TradeReportDocument>('IntelligenceTradeReport', TradeReportSchema);
