import mongoose, { Schema, Document } from 'mongoose';

// --- Shared Types ---

export interface QuantModelConfig {
  type: 'AR1' | 'LinearRegression' | 'Classification';
  features: string[];
  parameters: {
    weights: number[];
    bias: number;
    [key: string]: any;
  };
  timeframe: string;
  lookback: number;
}

export interface ScreenerConfig {
  screener_type: '0dte_covered_call' | 'advanced_covered_call';
  endpoint: string; // e.g., 'http://localhost:8001/api/screen/0dte-covered-calls'
  params: {
    symbol?: string;
    min_otm_pct?: number;
    max_otm_pct?: number;
    delta_lo?: number;
    delta_hi?: number;
    min_bid?: number;
    min_open_interest?: number;
    max_spread_to_mid?: number;
    rank_metric?: string;
    [key: string]: any;
  };
  schedule?: string; // e.g., 'daily_at_935', 'hourly', 'manual'
}

export interface JesseConfig {
  code: string;
}

export interface StrategyBase extends Document {
  name: string;
  description: string;
  version: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

// --- Lab Strategy (Development) ---

export interface LabStrategy extends StrategyBase {
  strategyType: 'quant' | 'screener' | 'jesse';
  status: 'development' | 'validated' | 'failed';

  // For quant strategies
  modelConfig?: QuantModelConfig;

  // For screener strategies
  screenerConfig?: ScreenerConfig;

  // For jesse strategies
  jesseConfig?: JesseConfig;

  backtestResults?: {
    period: { start: Date; end: Date };
    metrics: {
      sharpeRatio: number;
      expectedValue: number;
      winRate: number;
      drawdown: number;
    };
    tradeCount: number;
  };
}

const LabStrategySchema = new Schema({
  name: { type: String, required: true },
  description: { type: String },
  version: { type: String, default: '1.0.0' },
  ownerId: { type: String, required: true },
  strategyType: { type: String, enum: ['quant', 'screener', 'jesse'], required: true },
  status: { type: String, enum: ['development', 'validated', 'failed'], default: 'development' },

  // Quant Model Config (optional, required if strategyType = 'quant')
  modelConfig: {
    type: { type: String },
    features: [String],
    parameters: Schema.Types.Mixed,
    timeframe: String,
    lookback: Number
  },

  // Screener Config (optional, required if strategyType = 'screener')
  screenerConfig: {
    screener_type: { type: String },
    endpoint: { type: String },
    params: Schema.Types.Mixed,
    schedule: { type: String }
  },

  // Jesse Config (optional, required if strategyType = 'jesse')
  jesseConfig: {
    code: { type: String }
  },

  backtestResults: {
    period: { start: Date, end: Date },
    metrics: {
      sharpeRatio: Number,
      expectedValue: Number,
      winRate: Number,
      drawdown: Number
    },
    tradeCount: Number
  }
}, { timestamps: true });

// --- Engine Strategy (Live) ---

export interface EngineStrategy extends StrategyBase {
  labStrategyId: string; // Link back to Lab
  strategyType: 'quant' | 'screener' | 'jesse';
  status: 'active' | 'paused' | 'stopped';
  runtimeConfig: {
    maxCapital: number;
    riskLimits: {
      maxDrawdown: number;
      maxDailyLoss: number;
    };
    symbols: string[];
  };
  state: {
    lastRun: Date;
    currentPosition: number;
    dailyPnL: number;
  };
}

const EngineStrategySchema = new Schema({
  name: { type: String, required: true },
  description: { type: String },
  version: { type: String },
  ownerId: { type: String, required: true },
  labStrategyId: { type: Schema.Types.ObjectId, ref: 'LabStrategy', required: true },
  strategyType: { type: String, enum: ['quant', 'screener', 'jesse'], required: true },
  status: { type: String, enum: ['active', 'paused', 'stopped'], default: 'active' },
  runtimeConfig: {
    maxCapital: Number,
    riskLimits: {
      maxDrawdown: Number,
      maxDailyLoss: Number
    },
    symbols: [String]
  },
  state: {
    lastRun: Date,
    currentPosition: { type: Number, default: 0 },
    dailyPnL: { type: Number, default: 0 }
  }
}, { timestamps: true });

export const LabStrategyModel = mongoose.model<LabStrategy>('LabStrategy', LabStrategySchema);
export const EngineStrategyModel = mongoose.model<EngineStrategy>('EngineStrategy', EngineStrategySchema);
