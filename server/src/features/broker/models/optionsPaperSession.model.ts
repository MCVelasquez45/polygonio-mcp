import mongoose, { Document, Schema } from 'mongoose';

export interface OptionsPaperSession extends Document {
  strategyId: string;
  strategyName: string;
  backtestId?: string;
  versionLabel?: string;
  underlying: string;          // SPX
  status: 'waiting' | 'running' | 'paused' | 'stopped' | 'expired';
  config: {
    underlying: string;
    intervalSeconds: number;
    qty: number;               // number of spreads
    spreadWidth: number;
    targetDelta: number;
    maxDailyLoss: number;
    profitTargetPct: number;   // close at X% of max profit (e.g. 50)
    stopLossMultiplier: number;
    entryWindowStart: string;  // "14:00"
    entryWindowEnd: string;    // "14:30"
    analysisWindowStart: string; // "12:30"
  };
  regime: {
    current: 'risk_on' | 'risk_off' | 'mixed' | 'unknown';
    confidence: number;
    action: string;
    lastClassifiedAt: string;
    tickerChanges: Array<{ symbol: string; changePct: number; group: string }>;
  };
  spread: {
    active: boolean;
    direction: string;             // "put_credit_spread" | "call_credit_spread"
    shortLeg: {
      symbol: string;
      strike: number;
      type: string;                // "call" | "put"
      delta: number;
      entryBid: number;
      entryAsk: number;
      currentBid: number;
      currentAsk: number;
    };
    longLeg: {
      symbol: string;
      strike: number;
      type: string;
      delta: number;
      entryBid: number;
      entryAsk: number;
      currentBid: number;
      currentAsk: number;
    };
    entryCredit: number;
    currentValue: number;      // current cost to close
    unrealizedPnl: number;
    maxLoss: number;
    enteredAt: string;
    alpacaOrderId: string;
  };
  state: {
    underlyingPrice: number;
    equity: number;
    cash: number;
    dailyPnl: number;
    realizedPnl: number;
    riskUtilizationPct: number;
    lastUpdatedAt: string;
    phase: 'pre_analysis' | 'analyzing' | 'entry_window' | 'in_trade' | 'monitoring' | 'closing' | 'done';
  };
  orders: Array<{
    alpacaOrderId: string;
    type: string;
    legs: Array<{ symbol: string; side: string; strike: number }>;
    status: string;
    credit: number;
    createdAt: string;
  }>;
  events: Array<{
    type: string;
    timestamp: string;
    payload: Record<string, any>;
  }>;
  startedAt: Date;
  endedAt: Date | null;
}

const legSchema = {
  symbol: { type: String, default: '' },
  strike: { type: Number, default: 0 },
  type: { type: String, default: '' },
  delta: { type: Number, default: 0 },
  entryBid: { type: Number, default: 0 },
  entryAsk: { type: Number, default: 0 },
  currentBid: { type: Number, default: 0 },
  currentAsk: { type: Number, default: 0 },
};

const optionsPaperSessionSchema = new Schema<OptionsPaperSession>(
  {
    strategyId: { type: String, required: true, index: true },
    backtestId: { type: String, default: null },
    versionLabel: { type: String, default: null },
    strategyName: { type: String, required: true },
    underlying: { type: String, required: true },
    status: {
      type: String,
      enum: ['waiting', 'running', 'paused', 'stopped', 'expired'],
      default: 'waiting',
    },
    config: {
      underlying: { type: String },
      intervalSeconds: { type: Number, default: 30 },
      qty: { type: Number, default: 1 },
      spreadWidth: { type: Number, default: 5 },
      targetDelta: { type: Number, default: 0.2 },
      maxDailyLoss: { type: Number, default: 5000 },
      profitTargetPct: { type: Number, default: 50 },
      stopLossMultiplier: { type: Number, default: 2 },
      entryWindowStart: { type: String, default: '14:00' },
      entryWindowEnd: { type: String, default: '14:30' },
      analysisWindowStart: { type: String, default: '12:30' },
    },
    regime: {
      current: { type: String, enum: ['risk_on', 'risk_off', 'mixed', 'unknown'], default: 'unknown' },
      confidence: { type: Number, default: 0 },
      action: { type: String, default: '' },
      lastClassifiedAt: { type: String, default: '' },
      tickerChanges: [{ symbol: String, changePct: Number, group: String }],
    },
    spread: {
      active: { type: Boolean, default: false },
      direction: { type: String, default: '' },
      shortLeg: legSchema,
      longLeg: legSchema,
      entryCredit: { type: Number, default: 0 },
      currentValue: { type: Number, default: 0 },
      unrealizedPnl: { type: Number, default: 0 },
      maxLoss: { type: Number, default: 0 },
      enteredAt: { type: String, default: '' },
      alpacaOrderId: { type: String, default: '' },
    },
    state: {
      underlyingPrice: { type: Number, default: 0 },
      equity: { type: Number, default: 0 },
      cash: { type: Number, default: 0 },
      dailyPnl: { type: Number, default: 0 },
      realizedPnl: { type: Number, default: 0 },
      riskUtilizationPct: { type: Number, default: 0 },
      lastUpdatedAt: { type: String, default: '' },
      phase: {
        type: String,
        enum: ['pre_analysis', 'analyzing', 'entry_window', 'in_trade', 'monitoring', 'closing', 'done'],
        default: 'pre_analysis',
      },
    },
    orders: [
      {
        alpacaOrderId: { type: String },
        type: { type: String },
        legs: [{ symbol: { type: String }, side: { type: String }, strike: { type: Number } }],
        status: { type: String },
        credit: { type: Number },
        createdAt: { type: String },
      },
    ],
    events: [
      {
        type: { type: String },
        timestamp: { type: String },
        payload: { type: Schema.Types.Mixed },
      },
    ],
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const OptionsPaperSessionModel = mongoose.model<OptionsPaperSession>(
  'OptionsPaperSession',
  optionsPaperSessionSchema,
);
