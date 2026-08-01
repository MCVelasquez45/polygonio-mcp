import mongoose, { Document, Schema, Types } from 'mongoose';
import { IDENTITY_COLLECTIONS } from './identity.constants';

// SCAFFOLD (Phase 1): programmatic access tokens (for webhooks, service-to-
// service, CLI). Stored as a SHA-256 hash; the raw token is shown once at
// creation. Issuance UI/endpoints land in a later phase.

export interface ApiTokenDocument extends Document {
  userId: Types.ObjectId;
  name: string;
  tokenHash: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ApiTokenSchema = new Schema<ApiTokenDocument>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true },
    tokenHash: { type: String, required: true, unique: true },
    scopes: { type: [String], required: true, default: [] },
    lastUsedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: IDENTITY_COLLECTIONS.apiTokens }
);

export const ApiTokenModel =
  (mongoose.models.IdentityApiToken as mongoose.Model<ApiTokenDocument>) ||
  mongoose.model<ApiTokenDocument>('IdentityApiToken', ApiTokenSchema);
