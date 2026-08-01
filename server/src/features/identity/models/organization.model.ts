import mongoose, { Document, Schema, Types } from 'mongoose';
import { IDENTITY_COLLECTIONS } from './identity.constants';

// SCAFFOLD (Phase 1): tenancy root for the future Organizations/Teams layer.
// Created now so ownership can be modeled without a later rewrite; management
// endpoints and shared-resource semantics arrive in Phase 1.x.

export type OrganizationStatus = 'active' | 'suspended';

export interface OrganizationDocument extends Document {
  name: string;
  slug: string;
  ownerId: Types.ObjectId;
  status: OrganizationStatus;
  createdAt: Date;
  updatedAt: Date;
}

const OrganizationSchema = new Schema<OrganizationDocument>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    status: { type: String, enum: ['active', 'suspended'], required: true, default: 'active' },
  },
  { timestamps: true, collection: IDENTITY_COLLECTIONS.organizations }
);

export const OrganizationModel =
  (mongoose.models.IdentityOrganization as mongoose.Model<OrganizationDocument>) ||
  mongoose.model<OrganizationDocument>('IdentityOrganization', OrganizationSchema);
