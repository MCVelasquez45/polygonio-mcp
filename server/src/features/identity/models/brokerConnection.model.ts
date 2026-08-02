import mongoose, { Document, Schema, Types } from 'mongoose';
import { IDENTITY_COLLECTIONS } from './identity.constants';
import type { EnvelopeCiphertext } from '../../../shared/identity/crypto';

// SCAFFOLD (Phase 1): the framework for user-owned broker connections. Broker
// connections belong to USERS, never globally. Secrets are stored ONLY as
// AES-256-GCM envelope ciphertext (see shared/identity/crypto). No live broker
// calls and no credential-capture UI ship in Phase 1 — the trading engine's
// existing Alpaca façade is untouched.

export type BrokerProvider = 'alpaca' | 'tradier' | 'ibkr' | 'tastytrade' | 'paper';
export type BrokerConnectionStatus = 'unconfigured' | 'connecting' | 'connected' | 'syncing' | 'error' | 'revoked';

export interface BrokerConnectionDocument extends Document {
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId | null;
  provider: BrokerProvider;
  label: string;
  nickname: string;
  status: BrokerConnectionStatus;
  accountId: string | null;
  brokerUserId: string | null;
  accountType: string | null;
  paper: boolean;
  live: boolean;
  primary: boolean;
  environment: 'paper' | 'live';
  encryptedAccessToken: EnvelopeCiphertext | null;
  encryptedRefreshToken: EnvelopeCiphertext | null;
  expiresAt: Date | null;
  scopes: string[];
  permissions: string[];
  connectedAt: Date | null;
  lastSync: Date | null;
  lastRefresh: Date | null;
  reconnectStatus: 'not_required' | 'required' | 'in_progress';
  oauthStatus: 'not_configured' | 'authorized' | 'expired' | 'revoked' | 'error';
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
    workspaceId: { type: Schema.Types.ObjectId, default: null, index: true },
    provider: { type: String, enum: ['alpaca', 'tradier', 'ibkr', 'tastytrade', 'paper'], required: true },
    label: { type: String, required: true, trim: true, default: '' },
    nickname: { type: String, required: true, trim: true, default: '' },
    status: {
      type: String,
      enum: ['unconfigured', 'connecting', 'connected', 'syncing', 'error', 'revoked'],
      required: true,
      default: 'unconfigured',
    },
    accountId: { type: String, default: null },
    brokerUserId: { type: String, default: null },
    accountType: { type: String, default: null },
    paper: { type: Boolean, required: true, default: false },
    live: { type: Boolean, required: true, default: false },
    primary: { type: Boolean, required: true, default: false },
    environment: { type: String, enum: ['paper', 'live'], required: true, default: 'paper' },
    encryptedAccessToken: { type: EnvelopeSchema, default: null, select: false },
    encryptedRefreshToken: { type: EnvelopeSchema, default: null, select: false },
    expiresAt: { type: Date, default: null },
    scopes: { type: [String], required: true, default: [] },
    permissions: { type: [String], required: true, default: [] },
    connectedAt: { type: Date, default: null },
    lastSync: { type: Date, default: null },
    lastRefresh: { type: Date, default: null },
    reconnectStatus: { type: String, enum: ['not_required', 'required', 'in_progress'], required: true, default: 'not_required' },
    oauthStatus: { type: String, enum: ['not_configured', 'authorized', 'expired', 'revoked', 'error'], required: true, default: 'not_configured' },
    secretCiphertext: { type: EnvelopeSchema, default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: IDENTITY_COLLECTIONS.brokerConnections }
);

BrokerConnectionSchema.index({ userId: 1, provider: 1, status: 1 });
BrokerConnectionSchema.index(
  { userId: 1, provider: 1, accountId: 1 },
  { unique: true, partialFilterExpression: { accountId: { $type: 'string' } } }
);
BrokerConnectionSchema.index({ expiresAt: 1, status: 1 });

export const BrokerConnectionModel =
  (mongoose.models.IdentityBrokerConnection as mongoose.Model<BrokerConnectionDocument>) ||
  mongoose.model<BrokerConnectionDocument>('IdentityBrokerConnection', BrokerConnectionSchema);
