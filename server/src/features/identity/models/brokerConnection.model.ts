import mongoose, { Document, Schema, Types } from 'mongoose';
import { IDENTITY_COLLECTIONS } from './identity.constants';
import type { EnvelopeCiphertext } from '../../../shared/identity/crypto';

// SCAFFOLD (Phase 1): the framework for user-owned broker connections. Broker
// connections belong to USERS, never globally. Secrets are stored ONLY as
// AES-256-GCM envelope ciphertext (see shared/identity/crypto). No live broker
// calls and no credential-capture UI ship in Phase 1 — the trading engine's
// existing Alpaca façade is untouched.

export type BrokerProvider = 'alpaca' | 'tradier' | 'ibkr' | 'tastytrade' | 'paper';
export type BrokerConnectionStatus = 'unconfigured' | 'connected' | 'error' | 'revoked';

export interface BrokerConnectionDocument extends Document {
  userId: Types.ObjectId;
  provider: BrokerProvider;
  label: string;
  status: BrokerConnectionStatus;
  secretCiphertext: EnvelopeCiphertext | null; // never plaintext
  meta: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const EnvelopeSchema = new Schema<EnvelopeCiphertext>(
  {
    v: { type: Number, required: true, default: 1 },
    iv: { type: String, required: true },
    tag: { type: String, required: true },
    data: { type: String, required: true },
  },
  { _id: false }
);

const BrokerConnectionSchema = new Schema<BrokerConnectionDocument>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    provider: { type: String, enum: ['alpaca', 'tradier', 'ibkr', 'tastytrade', 'paper'], required: true },
    label: { type: String, required: true, trim: true, default: '' },
    status: {
      type: String,
      enum: ['unconfigured', 'connected', 'error', 'revoked'],
      required: true,
      default: 'unconfigured',
    },
    secretCiphertext: { type: EnvelopeSchema, default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: IDENTITY_COLLECTIONS.brokerConnections }
);

BrokerConnectionSchema.index({ userId: 1, provider: 1 }, { unique: true });

export const BrokerConnectionModel =
  (mongoose.models.IdentityBrokerConnection as mongoose.Model<BrokerConnectionDocument>) ||
  mongoose.model<BrokerConnectionDocument>('IdentityBrokerConnection', BrokerConnectionSchema);
