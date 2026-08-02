import mongoose, { Document, Schema } from 'mongoose';
import { IDENTITY_COLLECTIONS } from './identity.constants';
import { IDENTITY_ROLES, PERMISSIONS, type IdentityRole, type Permission } from '../../../shared/identity/rbac';

// Queryable mirror of the code-defined RBAC catalog (shared/identity/rbac.ts is
// the source of truth). Seeded at startup so admin tooling can enumerate roles
// and their permissions without importing server code.

export interface RoleDocument extends Document {
  key: IdentityRole;
  label: string;
  permissions: Permission[];
  createdAt: Date;
  updatedAt: Date;
}

const RoleSchema = new Schema<RoleDocument>(
  {
    key: { type: String, enum: IDENTITY_ROLES, required: true, unique: true },
    label: { type: String, required: true },
    permissions: { type: [String], enum: PERMISSIONS, required: true, default: [] },
  },
  { timestamps: true, collection: IDENTITY_COLLECTIONS.roles }
);

export const RoleModel =
  (mongoose.models.IdentityRole as mongoose.Model<RoleDocument>) ||
  mongoose.model<RoleDocument>('IdentityRole', RoleSchema);
