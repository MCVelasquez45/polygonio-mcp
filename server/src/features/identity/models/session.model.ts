import mongoose, { Document, Schema, Types } from 'mongoose';
import { IDENTITY_COLLECTIONS } from './identity.constants';

// Refresh-token session (one per device/login). The raw refresh token is never
// stored — only its SHA-256 hash. Rotation lineage is tracked via `familyId` +
// `rotatedTo` to enable reuse detection (a replayed, already-rotated token
// revokes the whole family). Expired sessions are reaped by a TTL index.

export interface SessionDocument extends Document {
  userId: Types.ObjectId;
  familyId: string; // shared across a rotation lineage
  tokenHash: string; // sha256 of the current refresh token
  rotatedTo: string | null; // sha256 of the successor token, if rotated
  revokedAt: Date | null;
  rememberMe: boolean;
  device: { ua: string; ip: string };
  lastUsedAt: Date;
  expiresAt: Date; // TTL
  createdAt: Date;
  updatedAt: Date;
}

const SessionSchema = new Schema<SessionDocument>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    familyId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    rotatedTo: { type: String, default: null },
    revokedAt: { type: Date, default: null },
    rememberMe: { type: Boolean, required: true, default: false },
    device: {
      ua: { type: String, default: '' },
      ip: { type: String, default: '' },
    },
    lastUsedAt: { type: Date, required: true, default: () => new Date() },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: IDENTITY_COLLECTIONS.sessions }
);

// TTL: Mongo removes the doc once expiresAt passes.
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SessionModel =
  (mongoose.models.IdentitySession as mongoose.Model<SessionDocument>) ||
  mongoose.model<SessionDocument>('IdentitySession', SessionSchema);
