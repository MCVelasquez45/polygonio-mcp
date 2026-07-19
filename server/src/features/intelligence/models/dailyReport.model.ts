import mongoose, { Schema } from 'mongoose';

export const DAILY_REPORT_STATUSES = ['GENERATED', 'GENERATION_FAILED'] as const;
export const DAILY_REPORT_GRADES = [
  'A+',
  'A',
  'A-',
  'B+',
  'B',
  'B-',
  'C+',
  'C',
  'C-',
  'D',
  'F',
  'UNAVAILABLE',
] as const;

export type DailyReportStatus = (typeof DAILY_REPORT_STATUSES)[number];
export type DailyReportGrade = (typeof DAILY_REPORT_GRADES)[number];
export type DailyReportEnvironment = 'PAPER' | 'LIVE';

export type DailyReportWarning = {
  code: string;
  message: string;
  source?: string | null;
};

export type DailyGradeBreakdown = {
  grade: DailyReportGrade;
  score: number | null;
  reasons: string[];
  unavailableInputs: string[];
};

export type DailyReportTradeReference = {
  reportId: string;
  tradeId: string;
  underlying: string;
  direction: 'BULLISH' | 'BEARISH';
  realizedPnl: number | null;
  overallGrade: string;
  exitReason: string | null;
};

export type DailyReportTimelineEvent = {
  at: Date;
  label: string;
  source: string;
  sourceId: string | null;
  severity: 'info' | 'warning' | 'critical';
};

export interface DailyReportDocument {
  _id?: unknown;
  reportId: string;
  sessionId: string;
  tradingDate: string;
  environment: DailyReportEnvironment;
  status: DailyReportStatus;
  executiveSummary: {
    overallGrade: DailyReportGrade;
    marketSummary: string;
    sessionSummary: string;
    primaryLesson: string | null;
    bestDecision: string | null;
    worstDecision: string | null;
    highlights: string[];
    keyFindings: string[];
  };
  tradingSummary: {
    watchlistSize: number;
    symbolsEvaluated: number;
    signalsGenerated: number;
    signalsApproved: number;
    signalsRejected: number;
    riskRejects: number;
    dataRejects: number;
    tradesOpened: number;
    tradesClosed: number;
    wins: number;
    losses: number;
    breakeven: number;
  };
  performance: {
    realizedPnl: number | null;
    unrealizedPnl: number | null;
    netPnl: number | null;
    averageWinner: number | null;
    averageLoser: number | null;
    largestWinner: {
      tradeReportId: string;
      underlying: string;
      realizedPnl: number;
    } | null;
    largestLoser: {
      tradeReportId: string;
      underlying: string;
      realizedPnl: number;
    } | null;
    averageHoldTimeMinutes: number | null;
    profitFactor: number | null;
    expectancy: number | null;
  };
  capital: {
    equity: number | null;
    cash: number | null;
    buyingPower: number | null;
    drawdown: number | null;
    capitalEfficiency: number | null;
  };
  execution: {
    ordersSubmitted: number;
    fills: number;
    partialFills: number;
    cancelled: number;
    rejected: number;
    timeouts: number | null;
    retryCount: number;
    fillRate: number | null;
  };
  market: {
    marketStatus: string | null;
    marketRegime: string | null;
    spyTrend: string | null;
    vix: number | null;
    sectorLeadership: string | null;
  };
  grades: {
    execution: DailyGradeBreakdown;
    risk: DailyGradeBreakdown;
    market: DailyGradeBreakdown;
    tradeQuality: DailyGradeBreakdown;
    performance: DailyGradeBreakdown;
    evidence: DailyGradeBreakdown;
    overall: DailyGradeBreakdown;
  };
  evidenceQuality: {
    availableEvidencePercent: number;
    expectedClosedTrades: number;
    generatedTradeReports: number;
    missingEvidence: string[];
    warnings: DailyReportWarning[];
  };
  tradeReports: DailyReportTradeReference[];
  tradeReportIds: string[];
  sessionReference: {
    sessionId: string;
    tradingDate: string;
    status: string;
  };
  timeline: DailyReportTimelineEvent[];
  warnings: DailyReportWarning[];
  generation: {
    schemaVersion: number;
    generatorVersion: string;
    generatedBy: string;
    generatedAt: Date;
    generatedFromPersistedEvidence: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

export type DailyReportHydratedDocument = mongoose.HydratedDocument<DailyReportDocument>;

const WarningSchema = new Schema<DailyReportWarning>(
  {
    code: { type: String, required: true },
    message: { type: String, required: true },
    source: { type: String, default: null },
  },
  { _id: false }
);

const GradeSchema = new Schema<DailyGradeBreakdown>(
  {
    grade: { type: String, enum: DAILY_REPORT_GRADES, required: true },
    score: { type: Number, default: null },
    reasons: { type: [String], required: true, default: [] },
    unavailableInputs: { type: [String], required: true, default: [] },
  },
  { _id: false }
);

const TradeReferenceSchema = new Schema<DailyReportTradeReference>(
  {
    reportId: { type: String, required: true },
    tradeId: { type: String, required: true },
    underlying: { type: String, required: true },
    direction: { type: String, enum: ['BULLISH', 'BEARISH'], required: true },
    realizedPnl: { type: Number, default: null },
    overallGrade: { type: String, required: true },
    exitReason: { type: String, default: null },
  },
  { _id: false }
);

const TimelineEventSchema = new Schema<DailyReportTimelineEvent>(
  {
    at: { type: Date, required: true },
    label: { type: String, required: true },
    source: { type: String, required: true },
    sourceId: { type: String, default: null },
    severity: { type: String, enum: ['info', 'warning', 'critical'], required: true, default: 'info' },
  },
  { _id: false }
);

const DailyReportSchema = new Schema<DailyReportDocument>(
  {
    reportId: { type: String, required: true, unique: true, index: true },
    sessionId: { type: String, required: true, unique: true, index: true },
    tradingDate: { type: String, required: true, index: true },
    environment: { type: String, enum: ['PAPER', 'LIVE'], required: true, index: true },
    status: { type: String, enum: DAILY_REPORT_STATUSES, required: true, default: 'GENERATED', index: true },
    executiveSummary: {
      overallGrade: { type: String, enum: DAILY_REPORT_GRADES, required: true },
      marketSummary: { type: String, required: true },
      sessionSummary: { type: String, required: true },
      primaryLesson: { type: String, default: null },
      bestDecision: { type: String, default: null },
      worstDecision: { type: String, default: null },
      highlights: { type: [String], required: true, default: [] },
      keyFindings: { type: [String], required: true, default: [] },
    },
    tradingSummary: {
      watchlistSize: { type: Number, required: true, default: 0 },
      symbolsEvaluated: { type: Number, required: true, default: 0 },
      signalsGenerated: { type: Number, required: true, default: 0 },
      signalsApproved: { type: Number, required: true, default: 0 },
      signalsRejected: { type: Number, required: true, default: 0 },
      riskRejects: { type: Number, required: true, default: 0 },
      dataRejects: { type: Number, required: true, default: 0 },
      tradesOpened: { type: Number, required: true, default: 0 },
      tradesClosed: { type: Number, required: true, default: 0 },
      wins: { type: Number, required: true, default: 0 },
      losses: { type: Number, required: true, default: 0 },
      breakeven: { type: Number, required: true, default: 0 },
    },
    performance: {
      realizedPnl: { type: Number, default: null },
      unrealizedPnl: { type: Number, default: null },
      netPnl: { type: Number, default: null },
      averageWinner: { type: Number, default: null },
      averageLoser: { type: Number, default: null },
      largestWinner: {
        type: new Schema(
          {
            tradeReportId: { type: String, required: true },
            underlying: { type: String, required: true },
            realizedPnl: { type: Number, required: true },
          },
          { _id: false }
        ),
        default: null,
      },
      largestLoser: {
        type: new Schema(
          {
            tradeReportId: { type: String, required: true },
            underlying: { type: String, required: true },
            realizedPnl: { type: Number, required: true },
          },
          { _id: false }
        ),
        default: null,
      },
      averageHoldTimeMinutes: { type: Number, default: null },
      profitFactor: { type: Number, default: null },
      expectancy: { type: Number, default: null },
    },
    capital: {
      equity: { type: Number, default: null },
      cash: { type: Number, default: null },
      buyingPower: { type: Number, default: null },
      drawdown: { type: Number, default: null },
      capitalEfficiency: { type: Number, default: null },
    },
    execution: {
      ordersSubmitted: { type: Number, required: true, default: 0 },
      fills: { type: Number, required: true, default: 0 },
      partialFills: { type: Number, required: true, default: 0 },
      cancelled: { type: Number, required: true, default: 0 },
      rejected: { type: Number, required: true, default: 0 },
      timeouts: { type: Number, default: null },
      retryCount: { type: Number, required: true, default: 0 },
      fillRate: { type: Number, default: null },
    },
    market: {
      marketStatus: { type: String, default: null },
      marketRegime: { type: String, default: null },
      spyTrend: { type: String, default: null },
      vix: { type: Number, default: null },
      sectorLeadership: { type: String, default: null },
    },
    grades: {
      execution: { type: GradeSchema, required: true },
      risk: { type: GradeSchema, required: true },
      market: { type: GradeSchema, required: true },
      tradeQuality: { type: GradeSchema, required: true },
      performance: { type: GradeSchema, required: true },
      evidence: { type: GradeSchema, required: true },
      overall: { type: GradeSchema, required: true },
    },
    evidenceQuality: {
      availableEvidencePercent: { type: Number, required: true, default: 0 },
      expectedClosedTrades: { type: Number, required: true, default: 0 },
      generatedTradeReports: { type: Number, required: true, default: 0 },
      missingEvidence: { type: [String], required: true, default: [] },
      warnings: { type: [WarningSchema], required: true, default: [] },
    },
    tradeReports: { type: [TradeReferenceSchema], required: true, default: [] },
    tradeReportIds: { type: [String], required: true, default: [] },
    sessionReference: {
      sessionId: { type: String, required: true },
      tradingDate: { type: String, required: true },
      status: { type: String, required: true },
    },
    timeline: { type: [TimelineEventSchema], required: true, default: [] },
    warnings: { type: [WarningSchema], required: true, default: [] },
    generation: {
      schemaVersion: { type: Number, required: true, default: 1 },
      generatorVersion: { type: String, required: true, default: 'daily-report-generator-v1' },
      generatedBy: { type: String, required: true, default: 'server:intelligence:daily-report-generator' },
      generatedAt: { type: Date, required: true, default: () => new Date() },
      generatedFromPersistedEvidence: { type: Boolean, required: true, default: true },
    },
  },
  { timestamps: true, collection: 'intelligence_daily_reports' }
);

DailyReportSchema.index({ tradingDate: -1, environment: 1 });
DailyReportSchema.index({ 'grades.overall.grade': 1, tradingDate: -1 });

DailyReportSchema.pre('save', async function preventGeneratedDailyReportMutation() {
  if (this.isNew || !this.isModified()) {
    return;
  }
  const existing = await DailyReportModel.findById(this._id).select('status').lean();
  if (existing?.status === 'GENERATED') {
    throw new Error('GENERATED_DAILY_REPORT_IMMUTABLE');
  }
});

DailyReportSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function preventGeneratedReportQueryMutation() {
  this.setQuery({ $and: [this.getQuery(), { status: { $ne: 'GENERATED' } }] });
});

export const DailyReportModel =
  (mongoose.models.IntelligenceDailyReport as mongoose.Model<DailyReportDocument>) ||
  mongoose.model<DailyReportDocument>('IntelligenceDailyReport', DailyReportSchema);
