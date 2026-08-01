import mongoose, { Document, Schema } from 'mongoose';
import { IDENTITY_COLLECTIONS } from './identity.constants';
import { IDENTITY_ROLES, type IdentityRole } from '../../../shared/identity/rbac';

// Account of record. Additive-only: OAuth-only accounts have a null
// passwordHash; email/password accounts have a null-linked oauth array. Trading
// data is NOT stored here — this is identity only.

export type UserStatus = 'pending' | 'active' | 'disabled';

export type TradingExperience = 'none' | 'beginner' | 'intermediate' | 'advanced' | 'professional';
export type PreferredTheme = 'dark' | 'light' | 'system';

export interface UserProfile {
  name: string;
  avatarUrl: string | null;
  timezone: string;
  tradingExperience: TradingExperience;
  preferredTheme: PreferredTheme;
  workspaceName: string;
}

export interface OAuthLink {
  provider: 'google';
  subject: string; // provider's stable user id (sub)
  email: string;
  linkedAt: Date;
}

export interface UserDocument extends Document {
  email: string; // canonical, lowercased, unique
  emailVerified: boolean;
  passwordHash: string | null; // Argon2id; null for OAuth-only
  status: UserStatus;
  roles: IdentityRole[];
  profile: UserProfile;
  oauth: OAuthLink[];
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const OAuthLinkSchema = new Schema<OAuthLink>(
  {
    provider: { type: String, enum: ['google'], required: true },
    subject: { type: String, required: true },
    email: { type: String, required: true },
    linkedAt: { type: Date, required: true, default: () => new Date() },
  },
  { _id: false }
);

const UserProfileSchema = new Schema<UserProfile>(
  {
    name: { type: String, required: true, trim: true, default: '' },
    avatarUrl: { type: String, default: null },
    timezone: { type: String, required: true, default: 'UTC' },
    tradingExperience: {
      type: String,
      enum: ['none', 'beginner', 'intermediate', 'advanced', 'professional'],
      required: true,
      default: 'none',
    },
    preferredTheme: { type: String, enum: ['dark', 'light', 'system'], required: true, default: 'dark' },
    workspaceName: { type: String, required: true, trim: true, default: 'My Workspace' },
  },
  { _id: false }
);

const UserSchema = new Schema<UserDocument>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    emailVerified: { type: Boolean, required: true, default: false },
    passwordHash: { type: String, default: null },
    status: { type: String, enum: ['pending', 'active', 'disabled'], required: true, default: 'pending' },
    roles: { type: [String], enum: IDENTITY_ROLES, required: true, default: ['viewer'] },
    profile: { type: UserProfileSchema, required: true, default: () => ({}) },
    oauth: { type: [OAuthLinkSchema], required: true, default: [] },
    failedLoginCount: { type: Number, required: true, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true, collection: IDENTITY_COLLECTIONS.users }
);

// Fast lookup of an account by a linked OAuth identity; provider subjects must
// never belong to two identity users.
UserSchema.index({ 'oauth.provider': 1, 'oauth.subject': 1 }, { unique: true, sparse: true });

export const UserModel =
  (mongoose.models.IdentityUser as mongoose.Model<UserDocument>) ||
  mongoose.model<UserDocument>('IdentityUser', UserSchema);
