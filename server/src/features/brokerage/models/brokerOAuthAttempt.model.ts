import mongoose, { Document, Schema, Types } from 'mongoose';
import type { EnvelopeCiphertext } from '../../../shared/identity/crypto';
import type { BrokerProvider } from '../../identity/models/brokerConnection.model';

export interface BrokerOAuthAttemptDocument extends Document {
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  provider: BrokerProvider;
  environment: 'paper' | 'live';
  stateHash: string;
  verifierCiphertext: EnvelopeCiphertext;
  returnTo: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

const EnvelopeSchema = new Schema<EnvelopeCiphertext>({
  v: { type: Number, required: true },
  iv: { type: String, required: true },
  tag: { type: String, required: true },
  data: { type: String, required: true },
}, { _id: false });

const BrokerOAuthAttemptSchema = new Schema<BrokerOAuthAttemptDocument>({
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  workspaceId: { type: Schema.Types.ObjectId, required: true, index: true },
  provider: { type: String, enum: ['alpaca', 'tradier', 'ibkr', 'tastytrade'], required: true },
  environment: { type: String, enum: ['paper', 'live'], required: true },
  stateHash: { type: String, required: true, unique: true },
  verifierCiphertext: { type: EnvelopeSchema, required: true },
  returnTo: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  consumedAt: { type: Date, default: null },
}, { timestamps: true, collection: 'broker_oauth_attempts' });

export const BrokerOAuthAttemptModel =
  (mongoose.models.BrokerOAuthAttempt as mongoose.Model<BrokerOAuthAttemptDocument>) ||
  mongoose.model<BrokerOAuthAttemptDocument>('BrokerOAuthAttempt', BrokerOAuthAttemptSchema);
