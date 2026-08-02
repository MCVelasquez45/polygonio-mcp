import mongoose, { Document, Schema, Types } from 'mongoose';
import type { BrokerProvider } from '../../identity/models/brokerConnection.model';

export interface BrokerPortfolioDocument extends Document {
  connectionId: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  provider: BrokerProvider;
  accountId: string;
  account: Record<string, unknown>;
  balances: { buyingPower: number | null; cash: number | null; equity: number | null; portfolioValue: number | null };
  positions: unknown[];
  optionPositions: unknown[];
  openOrders: unknown[];
  watchlists: unknown[];
  accountConfiguration: Record<string, unknown>;
  syncedAt: Date;
}

const BrokerPortfolioSchema = new Schema<BrokerPortfolioDocument>({
  connectionId: { type: Schema.Types.ObjectId, required: true, unique: true, index: true },
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  workspaceId: { type: Schema.Types.ObjectId, required: true, index: true },
  provider: { type: String, enum: ['alpaca', 'tradier', 'ibkr', 'tastytrade', 'paper'], required: true },
  accountId: { type: String, required: true },
  account: { type: Schema.Types.Mixed, required: true, default: {} },
  balances: {
    buyingPower: { type: Number, default: null }, cash: { type: Number, default: null },
    equity: { type: Number, default: null }, portfolioValue: { type: Number, default: null },
  },
  positions: { type: [Schema.Types.Mixed], required: true, default: [] },
  optionPositions: { type: [Schema.Types.Mixed], required: true, default: [] },
  openOrders: { type: [Schema.Types.Mixed], required: true, default: [] },
  watchlists: { type: [Schema.Types.Mixed], required: true, default: [] },
  accountConfiguration: { type: Schema.Types.Mixed, required: true, default: {} },
  syncedAt: { type: Date, required: true },
}, { timestamps: true, collection: 'broker_portfolios' });

BrokerPortfolioSchema.index({ userId: 1, provider: 1, accountId: 1 }, { unique: true });

export const BrokerPortfolioModel =
  (mongoose.models.BrokerPortfolio as mongoose.Model<BrokerPortfolioDocument>) ||
  mongoose.model<BrokerPortfolioDocument>('BrokerPortfolio', BrokerPortfolioSchema);
