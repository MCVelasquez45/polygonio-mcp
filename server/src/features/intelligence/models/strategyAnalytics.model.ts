import mongoose, { Schema } from 'mongoose';

export const STRATEGY_ANALYTICS_WINDOW_TYPES = ['DAILY', 'WEEKLY', 'MONTHLY', 'ROLLING'] as const;
export const STRATEGY_ANALYTICS_STATUSES = ['GENERATED', 'GENERATION_FAILED'] as const;

export type StrategyAnalyticsWindowType = (typeof STRATEGY_ANALYTICS_WINDOW_TYPES)[number];
export type StrategyAnalyticsStatus = (typeof STRATEGY_ANALYTICS_STATUSES)[number];
export type StrategyAnalyticsEnvironment = 'PAPER' | 'LIVE';

export type StrategyAnalyticsWarning = {
  code: string;
  message: string;
  source?: string | null;
};

export type StrategyAnalyticsBucket = {
  key: string;
  label: string;
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  netPnl: number | null;
  winRate: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  averageWinner: number | null;
  averageLoser: number | null;
  averageInputValue: number | null;
  sampleTradeIds: string[];
  sampleReportIds: string[];
  sampleDecisionIds: string[];
  notes: string[];
};

export interface StrategyAnalyticsDocument {
  _id?: unknown;
  analyticsId: string;
  tradingDate: string;
  windowType: StrategyAnalyticsWindowType;
  windowStart: Date;
  windowEnd: Date;
  generatedAt: Date;
  environment: StrategyAnalyticsEnvironment;
  status: StrategyAnalyticsStatus;
  performance: {
    totalTrades: number;
    wins: number;
    losses: number;
    breakeven: number;
    netPnl: number | null;
    winRate: number | null;
    expectancy: number | null;
    profitFactor: number | null;
    averageWinner: number | null;
    averageLoser: number | null;
    drawdown: number | null;
    capitalEfficiency: number | null;
  };
  strategyBreakdown: StrategyAnalyticsBucket[];
  underlyingBreakdown: StrategyAnalyticsBucket[];
  sectorBreakdown: StrategyAnalyticsBucket[];
  marketRegimeBreakdown: StrategyAnalyticsBucket[];
  confidenceBreakdown: StrategyAnalyticsBucket[];
  dteBreakdown: StrategyAnalyticsBucket[];
  deltaBreakdown: StrategyAnalyticsBucket[];
  ivBreakdown: StrategyAnalyticsBucket[];
  weekdayBreakdown: StrategyAnalyticsBucket[];
  timeOfDayBreakdown: StrategyAnalyticsBucket[];
  exitReasonBreakdown: StrategyAnalyticsBucket[];
  riskProfileBreakdown: StrategyAnalyticsBucket[];
  evidenceQuality: {
    availableEvidencePercent: number;
    missingEvidence: string[];
  };
  warnings: StrategyAnalyticsWarning[];
  references: {
    sessionIds: string[];
    dailyReportIds: string[];
    tradeReportIds: string[];
    decisionJournalIds: string[];
  };
  generation: {
    schemaVersion: number;
    generatorVersion: string;
    generatedBy: string;
    generatedFromPersistedEvidence: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

export type StrategyAnalyticsHydratedDocument = mongoose.HydratedDocument<StrategyAnalyticsDocument>;

const WarningSchema = new Schema<StrategyAnalyticsWarning>(
  {
    code: { type: String, required: true },
    message: { type: String, required: true },
    source: { type: String, default: null },
  },
  { _id: false }
);

const BucketSchema = new Schema<StrategyAnalyticsBucket>(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    totalTrades: { type: Number, required: true, default: 0 },
    wins: { type: Number, required: true, default: 0 },
    losses: { type: Number, required: true, default: 0 },
    breakeven: { type: Number, required: true, default: 0 },
    netPnl: { type: Number, default: null },
    winRate: { type: Number, default: null },
    expectancy: { type: Number, default: null },
    profitFactor: { type: Number, default: null },
    averageWinner: { type: Number, default: null },
    averageLoser: { type: Number, default: null },
    averageInputValue: { type: Number, default: null },
    sampleTradeIds: { type: [String], required: true, default: [] },
    sampleReportIds: { type: [String], required: true, default: [] },
    sampleDecisionIds: { type: [String], required: true, default: [] },
    notes: { type: [String], required: true, default: [] },
  },
  { _id: false }
);

const StrategyAnalyticsSchema = new Schema<StrategyAnalyticsDocument>(
  {
    analyticsId: { type: String, required: true, unique: true, index: true },
    tradingDate: { type: String, required: true, index: true },
    windowType: { type: String, enum: STRATEGY_ANALYTICS_WINDOW_TYPES, required: true, index: true },
    windowStart: { type: Date, required: true, index: true },
    windowEnd: { type: Date, required: true, index: true },
    generatedAt: { type: Date, required: true, default: () => new Date(), index: true },
    environment: { type: String, enum: ['PAPER', 'LIVE'], required: true, default: 'PAPER', index: true },
    status: { type: String, enum: STRATEGY_ANALYTICS_STATUSES, required: true, default: 'GENERATED', index: true },
    performance: {
      totalTrades: { type: Number, required: true, default: 0 },
      wins: { type: Number, required: true, default: 0 },
      losses: { type: Number, required: true, default: 0 },
      breakeven: { type: Number, required: true, default: 0 },
      netPnl: { type: Number, default: null },
      winRate: { type: Number, default: null },
      expectancy: { type: Number, default: null },
      profitFactor: { type: Number, default: null },
      averageWinner: { type: Number, default: null },
      averageLoser: { type: Number, default: null },
      drawdown: { type: Number, default: null },
      capitalEfficiency: { type: Number, default: null },
    },
    strategyBreakdown: { type: [BucketSchema], required: true, default: [] },
    underlyingBreakdown: { type: [BucketSchema], required: true, default: [] },
    sectorBreakdown: { type: [BucketSchema], required: true, default: [] },
    marketRegimeBreakdown: { type: [BucketSchema], required: true, default: [] },
    confidenceBreakdown: { type: [BucketSchema], required: true, default: [] },
    dteBreakdown: { type: [BucketSchema], required: true, default: [] },
    deltaBreakdown: { type: [BucketSchema], required: true, default: [] },
    ivBreakdown: { type: [BucketSchema], required: true, default: [] },
    weekdayBreakdown: { type: [BucketSchema], required: true, default: [] },
    timeOfDayBreakdown: { type: [BucketSchema], required: true, default: [] },
    exitReasonBreakdown: { type: [BucketSchema], required: true, default: [] },
    riskProfileBreakdown: { type: [BucketSchema], required: true, default: [] },
    evidenceQuality: {
      availableEvidencePercent: { type: Number, required: true, default: 0 },
      missingEvidence: { type: [String], required: true, default: [] },
    },
    warnings: { type: [WarningSchema], required: true, default: [] },
    references: {
      sessionIds: { type: [String], required: true, default: [] },
      dailyReportIds: { type: [String], required: true, default: [] },
      tradeReportIds: { type: [String], required: true, default: [] },
      decisionJournalIds: { type: [String], required: true, default: [] },
    },
    generation: {
      schemaVersion: { type: Number, required: true, default: 1 },
      generatorVersion: { type: String, required: true, default: 'strategy-analytics-v1' },
      generatedBy: { type: String, required: true, default: 'server:intelligence:strategy-analytics' },
      generatedFromPersistedEvidence: { type: Boolean, required: true, default: true },
    },
  },
  { timestamps: true, collection: 'intelligence_strategy_analytics' }
);

StrategyAnalyticsSchema.index(
  { windowType: 1, tradingDate: 1, environment: 1 },
  { unique: true, name: 'uniq_strategy_analytics_window_date_environment' }
);
StrategyAnalyticsSchema.index({ windowType: 1, generatedAt: -1 });
StrategyAnalyticsSchema.index({ generatedAt: -1 });

StrategyAnalyticsSchema.pre('save', async function preventStrategyAnalyticsMutation() {
  if (this.isNew || !this.isModified()) {
    return;
  }
  const existing = await StrategyAnalyticsModel.findById(this._id).select('_id').lean();
  if (existing) {
    throw new Error('STRATEGY_ANALYTICS_ENTRY_IMMUTABLE');
  }
});

StrategyAnalyticsSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function preventStrategyAnalyticsQueryMutation() {
  this.setQuery({ $and: [this.getQuery(), { _id: { $exists: false } }] });
});

export const StrategyAnalyticsModel =
  (mongoose.models.IntelligenceStrategyAnalytics as mongoose.Model<StrategyAnalyticsDocument>) ||
  mongoose.model<StrategyAnalyticsDocument>('IntelligenceStrategyAnalytics', StrategyAnalyticsSchema);
