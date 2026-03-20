import mongoose, { Document, Schema } from 'mongoose';

export interface AlpacaPaperSession extends Document {
  strategyId: string;
  strategyName: string;
  backtestId?: string;
  versionLabel?: string;
  symbol: string; // equity symbol to trade (e.g. SPY, QQQ, AAPL)
  status: 'running' | 'paused' | 'stopped';
  config: {
    qty: number; // shares per trade
    initialCapital: number;
    maxDailyLoss: number;
    maxDrawdownPct: number;
    intervalSeconds: number; // how often to evaluate signals
  };
  state: {
    lastPrice: number;
    equity: number;
    cash: number;
    unrealizedPnl: number;
    realizedPnl: number;
    dailyPnl: number;
    positionSide: 'long' | 'short' | 'flat';
    positionQty: number;
    positionAvgEntry: number;
    riskUtilizationPct: number;
    lastSignal: string;
    lastSignalReason: string;
    lastUpdatedAt: string;
  };
  orders: Array<{
    alpacaOrderId: string;
    symbol: string;
    side: 'buy' | 'sell';
    qty: number;
    type: string;
    status: string;
    filledPrice: number | null;
    filledAt: string | null;
    reason: string;
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

const alpacaPaperSessionSchema = new Schema<AlpacaPaperSession>(
  {
    strategyId: { type: String, required: true, index: true },
    strategyName: { type: String, required: true },
    backtestId: { type: String, default: null },
    versionLabel: { type: String, default: null },
    symbol: { type: String, required: true },
    status: { type: String, enum: ['running', 'paused', 'stopped'], default: 'running' },
    config: {
      qty: { type: Number, default: 1 },
      initialCapital: { type: Number, default: 100000 },
      maxDailyLoss: { type: Number, default: 5000 },
      maxDrawdownPct: { type: Number, default: 0.08 },
      intervalSeconds: { type: Number, default: 60 },
    },
    state: {
      lastPrice: { type: Number, default: 0 },
      equity: { type: Number, default: 0 },
      cash: { type: Number, default: 0 },
      unrealizedPnl: { type: Number, default: 0 },
      realizedPnl: { type: Number, default: 0 },
      dailyPnl: { type: Number, default: 0 },
      positionSide: { type: String, enum: ['long', 'short', 'flat'], default: 'flat' },
      positionQty: { type: Number, default: 0 },
      positionAvgEntry: { type: Number, default: 0 },
      riskUtilizationPct: { type: Number, default: 0 },
      lastSignal: { type: String, default: '' },
      lastSignalReason: { type: String, default: '' },
      lastUpdatedAt: { type: String, default: '' },
    },
    orders: [
      {
        alpacaOrderId: { type: String },
        symbol: { type: String },
        side: { type: String },
        qty: { type: Number },
        type: { type: String },
        status: { type: String },
        filledPrice: { type: Number, default: null },
        filledAt: { type: String, default: null },
        reason: { type: String },
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

export const AlpacaPaperSessionModel = mongoose.model<AlpacaPaperSession>(
  'AlpacaPaperSession',
  alpacaPaperSessionSchema,
);
