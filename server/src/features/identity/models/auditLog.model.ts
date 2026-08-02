import mongoose, { Document, Schema } from 'mongoose';
import { IDENTITY_COLLECTIONS } from './identity.constants';

// Append-only security/audit trail. Never mutated after write. Captures who did
// what, from where, and whether it succeeded.

export type AuditOutcome = 'success' | 'failure' | 'denied';

export interface AuditLogDocument extends Document {
  actorId: string; // userId or 'anonymous'/'legacy-operator'
  action: string; // e.g. LOGIN, LOGOUT, PASSWORD_RESET, REFRESH_REUSE_DETECTED
  targetType: string | null; // e.g. 'user', 'session'
  targetId: string | null;
  ip: string;
  ua: string;
  outcome: AuditOutcome;
  meta: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const AuditLogSchema = new Schema<AuditLogDocument>(
  {
    actorId: { type: String, required: true, index: true },
    action: { type: String, required: true, index: true },
    targetType: { type: String, default: null },
    targetId: { type: String, default: null },
    ip: { type: String, default: '' },
    ua: { type: String, default: '' },
    outcome: { type: String, enum: ['success', 'failure', 'denied'], required: true, default: 'success' },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: IDENTITY_COLLECTIONS.auditLogs }
);

AuditLogSchema.index({ createdAt: -1 });

export const AuditLogModel =
  (mongoose.models.IdentityAuditLog as mongoose.Model<AuditLogDocument>) ||
  mongoose.model<AuditLogDocument>('IdentityAuditLog', AuditLogSchema);
