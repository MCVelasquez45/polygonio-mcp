import mongoose, { Schema } from 'mongoose';

export const TRADING_SESSION_STATUSES = [
  'INITIALIZING',
  'OPEN',
  'CLOSING',
  'FINALIZING',
  'FINALIZED',
  'FINALIZATION_FAILED',
] as const;

export type TradingSessionStatus = (typeof TRADING_SESSION_STATUSES)[number];
export type TradingSessionEnvironment = 'PAPER' | 'LIVE';

export type SessionWarning = {
  code: string;
  message: string;
  firstObservedAt?: Date | null;
  lastObservedAt?: Date | null;
  count?: number | null;
};

export type SessionError = {
  code: string;
  message: string;
  component?: string | null;
  occurredAt?: Date | null;
  recoverable?: boolean | null;
};

export interface TradingSessionDocument {
  _id?: unknown;
  sessionId: string;
  tradingDate: string;
  timezone: string;
  status: TradingSessionStatus;
  environment: TradingSessionEnvironment;
  marketStatus: string;
  startedAt: Date;
  marketOpenedAt: Date | null;
  marketClosedAt: Date | null;
  finalizationStartedAt: Date | null;
  finalizedAt: Date | null;
  automationSessionId: string | null;
  watchlist: {
    symbols: string[];
    size: number;
  };
  evaluationSummary: {
    windowsEvaluated: number;
    symbolsEvaluated: number;
    signalsGenerated: number;
    noSignalCount: number;
    dataRejectCount: number;
    riskRejectCount: number;
    approvedCount: number;
  };
  tradeSummary: {
    tradesOpened: number;
    tradesClosed: number;
    winningTrades: number;
    losingTrades: number;
    breakevenTrades: number;
    realizedPnl: number;
    unrealizedPnlAtClose: number | null;
    totalPnl: number | null;
  };
  orderSummary: {
    intentsCreated: number;
    ordersSubmitted: number;
    fills: number;
    partialFills: number;
    cancellations: number;
    rejections: number;
    manualReviewCount: number;
  };
  portfolioSnapshot: {
    equity?: number | null;
    cash?: number | null;
    buyingPower?: number | null;
    netUnrealizedPnl?: number | null;
    capturedAt: Date;
    source: string;
  } | null;
  providerSummary: {
    totalRequests: number;
    cacheHits: number;
    cacheHitRate: number | null;
    rateLimitCount: number;
    providerErrors: number | null;
    entitlementRejects: number;
  };
  automationHealth: {
    schedulerHealthy?: boolean | null;
    monitorHealthy?: boolean | null;
    reconciliationClean?: boolean | null;
    brokerConnected?: boolean | null;
    marketDataConnected?: boolean | null;
    mongoConnected?: boolean | null;
    emergencyStopActivated: boolean;
  };
  references: {
    candidateIds: string[];
    riskDecisionIds: string[];
    orderIntentIds: string[];
    brokerOrderIds: string[];
    positionIds: string[];
    eventIds: string[];
    closedTradeIds: string[];
  };
  warnings: SessionWarning[];
  errors: SessionError[];
  generation: {
    schemaVersion: number;
    generatorVersion: string;
    generatedBy: string;
    sourceWindowStart: Date;
    sourceWindowEnd: Date;
    finalizedFromPersistedEvidence: boolean;
    lastAttemptAt: Date | null;
    attemptCount: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

export type TradingSessionHydratedDocument = mongoose.HydratedDocument<TradingSessionDocument>;

const WarningSchema = new Schema<SessionWarning>(
  {
    code: { type: String, required: true },
    message: { type: String, required: true },
    firstObservedAt: { type: Date, default: null },
    lastObservedAt: { type: Date, default: null },
    count: { type: Number, default: null },
  },
  { _id: false }
);

const ErrorSchema = new Schema<SessionError>(
  {
    code: { type: String, required: true },
    message: { type: String, required: true },
    component: { type: String, default: null },
    occurredAt: { type: Date, default: null },
    recoverable: { type: Boolean, default: null },
  },
  { _id: false }
);

const TradingSessionSchema = new Schema<TradingSessionDocument>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    tradingDate: { type: String, required: true, index: true },
    timezone: { type: String, required: true, default: 'America/New_York' },
    status: { type: String, enum: TRADING_SESSION_STATUSES, required: true, default: 'INITIALIZING', index: true },
    environment: { type: String, enum: ['PAPER', 'LIVE'], required: true, default: 'PAPER', index: true },
    marketStatus: { type: String, required: true, default: 'UNAVAILABLE' },
    startedAt: { type: Date, required: true, default: () => new Date() },
    marketOpenedAt: { type: Date, default: null },
    marketClosedAt: { type: Date, default: null },
    finalizationStartedAt: { type: Date, default: null },
    finalizedAt: { type: Date, default: null },
    automationSessionId: { type: String, default: null, index: true },
    watchlist: {
      symbols: { type: [String], required: true, default: [] },
      size: { type: Number, required: true, default: 0 },
    },
    evaluationSummary: {
      windowsEvaluated: { type: Number, required: true, default: 0 },
      symbolsEvaluated: { type: Number, required: true, default: 0 },
      signalsGenerated: { type: Number, required: true, default: 0 },
      noSignalCount: { type: Number, required: true, default: 0 },
      dataRejectCount: { type: Number, required: true, default: 0 },
      riskRejectCount: { type: Number, required: true, default: 0 },
      approvedCount: { type: Number, required: true, default: 0 },
    },
    tradeSummary: {
      tradesOpened: { type: Number, required: true, default: 0 },
      tradesClosed: { type: Number, required: true, default: 0 },
      winningTrades: { type: Number, required: true, default: 0 },
      losingTrades: { type: Number, required: true, default: 0 },
      breakevenTrades: { type: Number, required: true, default: 0 },
      realizedPnl: { type: Number, required: true, default: 0 },
      unrealizedPnlAtClose: { type: Number, default: null },
      totalPnl: { type: Number, default: null },
    },
    orderSummary: {
      intentsCreated: { type: Number, required: true, default: 0 },
      ordersSubmitted: { type: Number, required: true, default: 0 },
      fills: { type: Number, required: true, default: 0 },
      partialFills: { type: Number, required: true, default: 0 },
      cancellations: { type: Number, required: true, default: 0 },
      rejections: { type: Number, required: true, default: 0 },
      manualReviewCount: { type: Number, required: true, default: 0 },
    },
    portfolioSnapshot: {
      type: new Schema(
        {
          equity: { type: Number, default: null },
          cash: { type: Number, default: null },
          buyingPower: { type: Number, default: null },
          netUnrealizedPnl: { type: Number, default: null },
          capturedAt: { type: Date, required: true },
          source: { type: String, required: true },
        },
        { _id: false }
      ),
      default: null,
    },
    providerSummary: {
      totalRequests: { type: Number, required: true, default: 0 },
      cacheHits: { type: Number, required: true, default: 0 },
      cacheHitRate: { type: Number, default: null },
      rateLimitCount: { type: Number, required: true, default: 0 },
      providerErrors: { type: Number, default: null },
      entitlementRejects: { type: Number, required: true, default: 0 },
    },
    automationHealth: {
      schedulerHealthy: { type: Boolean, default: null },
      monitorHealthy: { type: Boolean, default: null },
      reconciliationClean: { type: Boolean, default: null },
      brokerConnected: { type: Boolean, default: null },
      marketDataConnected: { type: Boolean, default: null },
      mongoConnected: { type: Boolean, default: null },
      emergencyStopActivated: { type: Boolean, required: true, default: false },
    },
    references: {
      candidateIds: { type: [String], required: true, default: [] },
      riskDecisionIds: { type: [String], required: true, default: [] },
      orderIntentIds: { type: [String], required: true, default: [] },
      brokerOrderIds: { type: [String], required: true, default: [] },
      positionIds: { type: [String], required: true, default: [] },
      eventIds: { type: [String], required: true, default: [] },
      closedTradeIds: { type: [String], required: true, default: [] },
    },
    warnings: { type: [WarningSchema], required: true, default: [] },
    errors: { type: [ErrorSchema], required: true, default: [] },
    generation: {
      schemaVersion: { type: Number, required: true, default: 1 },
      generatorVersion: { type: String, required: true, default: 'trading-session-capture-v1' },
      generatedBy: { type: String, required: true, default: 'server:intelligence:session-capture' },
      sourceWindowStart: { type: Date, required: true },
      sourceWindowEnd: { type: Date, required: true },
      finalizedFromPersistedEvidence: { type: Boolean, required: true, default: false },
      lastAttemptAt: { type: Date, default: null },
      attemptCount: { type: Number, required: true, default: 0 },
    },
  },
  { timestamps: true, collection: 'intelligence_trading_sessions', suppressReservedKeysWarning: true }
);

TradingSessionSchema.index(
  { tradingDate: 1, environment: 1, automationSessionId: 1 },
  { unique: true, name: 'uniq_trading_date_environment_automation_session' }
);
TradingSessionSchema.index({ tradingDate: -1, updatedAt: -1 });
TradingSessionSchema.index({ status: 1, tradingDate: -1 });

TradingSessionSchema.pre('save', async function preventFinalizedSessionMutation() {
  if (this.isNew || !this.isModified()) {
    return;
  }
  const existing = await TradingSessionModel.findById(this._id).select('status').lean();
  if (existing?.status === 'FINALIZED') {
    throw new Error('FINALIZED_TRADING_SESSION_IMMUTABLE');
  }
});

TradingSessionSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function preventQueryMutationOfFinalizedSessions() {
  this.setQuery({ $and: [this.getQuery(), { status: { $ne: 'FINALIZED' } }] });
});

export const TradingSessionModel =
  (mongoose.models.IntelligenceTradingSession as mongoose.Model<TradingSessionDocument>) ||
  mongoose.model<TradingSessionDocument>('IntelligenceTradingSession', TradingSessionSchema);
