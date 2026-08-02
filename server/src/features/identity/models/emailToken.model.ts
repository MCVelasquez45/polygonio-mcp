import mongoose, { Document, Schema, Types } from 'mongoose';
import { IDENTITY_COLLECTIONS } from './identity.constants';

// One-time tokens for email verification and password reset. Stored as a
// SHA-256 hash; the raw token only ever appears in the emailed link. Consumed
// tokens set `usedAt`; unused tokens are reaped by TTL at `expiresAt`.

export type EmailTokenType = 'verify' | 'reset';

export interface EmailTokenDocument extends Document {
  userId: Types.ObjectId;
  type: EmailTokenType;
  tokenHash: string;
  usedAt: Date | null;
  expiresAt: Date; // TTL
  createdAt: Date;
  updatedAt: Date;
}

const EmailTokenSchema = new Schema<EmailTokenDocument>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    type: { type: String, enum: ['verify', 'reset'], required: true },
    tokenHash: { type: String, required: true, unique: true },
    usedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: IDENTITY_COLLECTIONS.emailTokens }
);

EmailTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const EmailTokenModel =
  (mongoose.models.IdentityEmailToken as mongoose.Model<EmailTokenDocument>) ||
  mongoose.model<EmailTokenDocument>('IdentityEmailToken', EmailTokenSchema);
