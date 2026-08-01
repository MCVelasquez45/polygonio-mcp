import mongoose, { Document, Schema, Types } from 'mongoose';
import { IDENTITY_COLLECTIONS } from './identity.constants';
import type { BrokerProvider } from './brokerConnection.model';

export type WorkspaceOnboardingStatus = 'ready' | 'pending';

export interface WorkspaceProfileDocument extends Document {
  userId: Types.ObjectId;
  orgId: Types.ObjectId;
  defaultWatchlist: { symbol: string; label: string; enabled: boolean }[];
  aiMemory: {
    status: WorkspaceOnboardingStatus;
    seedVersion: string;
    preferences: {
      riskPosture: 'balanced';
      automationMode: 'paper';
      assistantTone: 'institutional';
    };
  };
  journal: {
    status: WorkspaceOnboardingStatus;
    seedVersion: string;
    firstEntry: string;
  };
  brokerOnboarding: {
    status: 'not_started' | 'in_progress' | 'connected';
    providers: { provider: BrokerProvider; label: string; enabled: boolean }[];
  };
  createdAt: Date;
  updatedAt: Date;
}

const WatchlistSeedSchema = new Schema(
  {
    symbol: { type: String, required: true, uppercase: true, trim: true },
    label: { type: String, required: true, trim: true },
    enabled: { type: Boolean, required: true, default: true },
  },
  { _id: false }
);

const BrokerProviderSeedSchema = new Schema(
  {
    provider: { type: String, enum: ['alpaca', 'tradier', 'ibkr', 'tastytrade', 'paper'], required: true },
    label: { type: String, required: true, trim: true },
    enabled: { type: Boolean, required: true, default: true },
  },
  { _id: false }
);

const WorkspaceProfileSchema = new Schema<WorkspaceProfileDocument>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, unique: true, index: true },
    orgId: { type: Schema.Types.ObjectId, required: true, index: true },
    defaultWatchlist: { type: [WatchlistSeedSchema], required: true, default: [] },
    aiMemory: {
      status: { type: String, enum: ['ready', 'pending'], required: true, default: 'ready' },
      seedVersion: { type: String, required: true, default: 'identity-workspace-v1' },
      preferences: {
        riskPosture: { type: String, enum: ['balanced'], required: true, default: 'balanced' },
        automationMode: { type: String, enum: ['paper'], required: true, default: 'paper' },
        assistantTone: { type: String, enum: ['institutional'], required: true, default: 'institutional' },
      },
    },
    journal: {
      status: { type: String, enum: ['ready', 'pending'], required: true, default: 'ready' },
      seedVersion: { type: String, required: true, default: 'identity-journal-v1' },
      firstEntry: { type: String, required: true, default: 'Identity workspace initialized.' },
    },
    brokerOnboarding: {
      status: { type: String, enum: ['not_started', 'in_progress', 'connected'], required: true, default: 'not_started' },
      providers: { type: [BrokerProviderSeedSchema], required: true, default: [] },
    },
  },
  { timestamps: true, collection: IDENTITY_COLLECTIONS.workspaceProfiles }
);

export const WorkspaceProfileModel =
  (mongoose.models.IdentityWorkspaceProfile as mongoose.Model<WorkspaceProfileDocument>) ||
  mongoose.model<WorkspaceProfileDocument>('IdentityWorkspaceProfile', WorkspaceProfileSchema);
