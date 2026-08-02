import mongoose, { Document, Schema } from 'mongoose';
import { IDENTITY_COLLECTIONS } from './identity.constants';
import type { EnvelopeCiphertext } from '../../../shared/identity/crypto';

export interface OAuthAttemptDocument extends Document {
  provider: 'google';
  stateHash: string;
  codeVerifierCiphertext: EnvelopeCiphertext;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const EnvelopeCiphertextSchema = new Schema<EnvelopeCiphertext>(
  {
    v: { type: Number, enum: [1], required: true },
    iv: { type: String, required: true },
    tag: { type: String, required: true },
    data: { type: String, required: true },
  },
  { _id: false }
);

const OAuthAttemptSchema = new Schema<OAuthAttemptDocument>(
  {
    provider: { type: String, enum: ['google'], required: true },
    stateHash: { type: String, required: true, unique: true, index: true },
    codeVerifierCiphertext: { type: EnvelopeCiphertextSchema, required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true, collection: IDENTITY_COLLECTIONS.oauthAttempts }
);

export const OAuthAttemptModel =
  (mongoose.models.IdentityOAuthAttempt as mongoose.Model<OAuthAttemptDocument>) ||
  mongoose.model<OAuthAttemptDocument>('IdentityOAuthAttempt', OAuthAttemptSchema);
