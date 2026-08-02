import mongoose, { Document, Schema, Types } from 'mongoose';
import { IDENTITY_COLLECTIONS } from './identity.constants';
import { IDENTITY_ROLES, type IdentityRole } from '../../../shared/identity/rbac';

// SCAFFOLD (Phase 1): user<->organization membership with org-scoped roles.
// Phase 1 uses GLOBAL roles on the user; this collection exists so org-scoped
// authorization can be introduced without a schema rewrite.

export interface MembershipDocument extends Document {
  userId: Types.ObjectId;
  orgId: Types.ObjectId;
  roles: IdentityRole[];
  createdAt: Date;
  updatedAt: Date;
}

const MembershipSchema = new Schema<MembershipDocument>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    orgId: { type: Schema.Types.ObjectId, required: true, index: true },
    roles: { type: [String], enum: IDENTITY_ROLES, required: true, default: ['viewer'] },
  },
  { timestamps: true, collection: IDENTITY_COLLECTIONS.memberships }
);

MembershipSchema.index({ userId: 1, orgId: 1 }, { unique: true });

export const MembershipModel =
  (mongoose.models.IdentityMembership as mongoose.Model<MembershipDocument>) ||
  mongoose.model<MembershipDocument>('IdentityMembership', MembershipSchema);
