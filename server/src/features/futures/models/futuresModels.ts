import mongoose, { Document, Schema } from 'mongoose';

export type FuturesSymbol = 'ES' | 'NQ' | 'CL' | 'GC' | string;

export interface FuturesContractSpec extends Document {
  symbol: FuturesSymbol;
  exchange: string;
  venue: string;
  description: string;
  tickSize: number;
  tickValue: number;
  contractMultiplier: number;
  currency: string;
  sessionTemplate: 'globex' | 'pit' | 'custom';
  maintenanceBreak: {
    start: string;
    end: string;
    timezone: string;
  };
  defaultInitialMargin: number;
  defaultMaintenanceMargin: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FuturesBacktest extends Document {
  strategyId: string;
  strategyName: string;
  symbol: FuturesSymbol;
  provider: 'databento' | 'synthetic' | 'quandl' | 'polygon';
  config: {
    startDate: string;
    endDate: string;
    initialCapital: number;
    contracts: number;
    rollPolicy: 'volume' | 'calendar' | 'open_interest';
    rollDaysBefore: number;
    slippageBps: number;
    feePerContract: number;
  };
  diagnostics: {
    usedFallbackData: boolean;
    sourceMessage: string;
    barsLoaded: number;
  };
  metrics: {
    totalReturnPct: number;
    sharpeRatio: number;
    maxDrawdownPct: number;
    winRatePct: number;
    totalPnl: number;
    tradeCount: number;
  };
  equityCurve: Array<{ timestamp: string; equity: number }>;
  tradeLedger: Array<{
    timestamp: string;
    side: 'buy' | 'sell';
    contracts: number;
    fillPrice: number;
    pnl: number;
    reason: string;
  }>;
  rollEvents: Array<{
    timestamp: string;
    fromContract: string;
    toContract: string;
    reason: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface FuturesPaperSession extends Document {
  strategyId: string;
  strategyName: string;
  backtestId?: string;
  versionLabel?: string;
  symbol: FuturesSymbol;
  status: 'running' | 'paused' | 'stopped' | 'deployed';
  mode: 'lab-paper' | 'engine-paper';
  config: {
    contracts: number;
    initialCapital: number;
    maxDailyLoss: number;
    maxDrawdown: number;
    slippageBps: number;
    feePerContract: number;
  };
  state: {
    markPrice: number;
    lastPriceUpdateAt: string;
    cash: number;
    equity: number;
    unrealizedPnl: number;
    realizedPnl: number;
    dailyPnl: number;
    marginUsed: number;
    marginUtilizationPct: number;
    riskUtilizationPct: number;
    readinessScore: number;
    position: {
      side: 'long' | 'short' | 'flat';
      contracts: number;
      avgEntryPrice: number;
      currentContract: string;
      openedAt: string | null;
    };
  };
  events: Array<{
    type:
      | 'session_started'
      | 'market_update'
      | 'order_filled'
      | 'risk_update'
      | 'roll_event'
      | 'session_paused'
      | 'session_resumed'
      | 'session_stopped';
    timestamp: string;
    payload: Record<string, any>;
  }>;
  startedAt: Date;
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface FuturesPromotionReport extends Document {
  sessionId: string;
  strategyId: string;
  status: 'eligible' | 'blocked';
  score: number;
  checks: Array<{
    key: string;
    label: string;
    passed: boolean;
    value: string;
    threshold: string;
  }>;
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface FuturesEngineSession extends Document {
  sessionId: string;
  strategyId: string;
  symbol: FuturesSymbol;
  status: 'active' | 'paused' | 'stopped';
  controls: {
    emergencyStop: boolean;
    eodReconcileRequestedAt?: Date;
  };
  summary: {
    todayPnl: number;
    mtdPnl: number;
    ytdPnl: number;
    riskUtilizationPct: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const FuturesContractSpecSchema = new Schema<FuturesContractSpec>(
  {
    symbol: { type: String, required: true, unique: true, uppercase: true, trim: true },
    exchange: { type: String, required: true },
    venue: { type: String, required: true },
    description: { type: String, required: true },
    tickSize: { type: Number, required: true },
    tickValue: { type: Number, required: true },
    contractMultiplier: { type: Number, required: true },
    currency: { type: String, default: 'USD' },
    sessionTemplate: { type: String, enum: ['globex', 'pit', 'custom'], default: 'globex' },
    maintenanceBreak: {
      start: { type: String, default: '17:00' },
      end: { type: String, default: '18:00' },
      timezone: { type: String, default: 'America/New_York' }
    },
    defaultInitialMargin: { type: Number, required: true },
    defaultMaintenanceMargin: { type: Number, required: true },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

const FuturesEquityPointSchema = new Schema(
  {
    timestamp: { type: String, required: true },
    equity: { type: Number, required: true }
  },
  { _id: false }
);

const FuturesTradeLedgerEntrySchema = new Schema(
  {
    timestamp: { type: String, required: true },
    side: { type: String, enum: ['buy', 'sell'], required: true },
    contracts: { type: Number, required: true },
    fillPrice: { type: Number, required: true },
    pnl: { type: Number, required: true },
    reason: { type: String, required: true }
  },
  { _id: false }
);

const FuturesRollEventSchema = new Schema(
  {
    timestamp: { type: String, required: true },
    fromContract: { type: String, required: true },
    toContract: { type: String, required: true },
    reason: { type: String, required: true }
  },
  { _id: false }
);

const FuturesPaperEventSchema = new Schema(
  {
    type: {
      type: String,
      enum: [
        'session_started',
        'market_update',
        'order_filled',
        'risk_update',
        'roll_event',
        'session_paused',
        'session_resumed',
        'session_stopped'
      ],
      required: true
    },
    timestamp: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} }
  },
  { _id: false }
);

const FuturesPromotionCheckSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    passed: { type: Boolean, required: true },
    value: { type: String, required: true },
    threshold: { type: String, required: true }
  },
  { _id: false }
);

const FuturesBacktestSchema = new Schema<FuturesBacktest>(
  {
    strategyId: { type: String, required: true },
    strategyName: { type: String, required: true },
    symbol: { type: String, required: true },
    provider: { type: String, enum: ['databento', 'synthetic', 'quandl', 'polygon'], required: true },
    config: { type: Schema.Types.Mixed, required: true },
    diagnostics: { type: Schema.Types.Mixed, required: true },
    metrics: { type: Schema.Types.Mixed, required: true },
    equityCurve: { type: [FuturesEquityPointSchema], default: [] },
    tradeLedger: { type: [FuturesTradeLedgerEntrySchema], default: [] },
    rollEvents: { type: [FuturesRollEventSchema], default: [] }
  },
  { timestamps: true }
);

const FuturesPaperSessionSchema = new Schema<FuturesPaperSession>(
  {
    strategyId: { type: String, required: true, index: true },
    strategyName: { type: String, required: true },
    backtestId: { type: String, default: null },
    versionLabel: { type: String, default: null },
    symbol: { type: String, required: true },
    status: { type: String, enum: ['running', 'paused', 'stopped', 'deployed'], default: 'running' },
    mode: { type: String, enum: ['lab-paper', 'engine-paper'], default: 'lab-paper' },
    config: { type: Schema.Types.Mixed, required: true },
    state: { type: Schema.Types.Mixed, required: true },
    events: { type: [FuturesPaperEventSchema], default: [] },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date }
  },
  { timestamps: true }
);

const FuturesPromotionReportSchema = new Schema<FuturesPromotionReport>(
  {
    sessionId: { type: String, required: true, index: true },
    strategyId: { type: String, required: true },
    status: { type: String, enum: ['eligible', 'blocked'], required: true },
    score: { type: Number, required: true },
    checks: { type: [FuturesPromotionCheckSchema], default: [] },
    generatedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

const FuturesEngineSessionSchema = new Schema<FuturesEngineSession>(
  {
    sessionId: { type: String, required: true, unique: true },
    strategyId: { type: String, required: true },
    symbol: { type: String, required: true },
    status: { type: String, enum: ['active', 'paused', 'stopped'], default: 'active' },
    controls: { type: Schema.Types.Mixed, default: { emergencyStop: false } },
    summary: { type: Schema.Types.Mixed, default: { todayPnl: 0, mtdPnl: 0, ytdPnl: 0, riskUtilizationPct: 0 } }
  },
  { timestamps: true }
);

export const FuturesContractSpecModel =
  mongoose.models.FuturesContractSpec || mongoose.model<FuturesContractSpec>('FuturesContractSpec', FuturesContractSpecSchema);
export const FuturesBacktestModel =
  mongoose.models.FuturesBacktest || mongoose.model<FuturesBacktest>('FuturesBacktest', FuturesBacktestSchema);
export const FuturesPaperSessionModel =
  mongoose.models.FuturesPaperSession ||
  mongoose.model<FuturesPaperSession>('FuturesPaperSession', FuturesPaperSessionSchema);
export const FuturesPromotionReportModel =
  mongoose.models.FuturesPromotionReport ||
  mongoose.model<FuturesPromotionReport>('FuturesPromotionReport', FuturesPromotionReportSchema);
export const FuturesEngineSessionModel =
  mongoose.models.FuturesEngineSession ||
  mongoose.model<FuturesEngineSession>('FuturesEngineSession', FuturesEngineSessionSchema);
