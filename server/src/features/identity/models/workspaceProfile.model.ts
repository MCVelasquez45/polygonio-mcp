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
  onboarding: {
    status: 'not_started' | 'in_progress' | 'complete';
    currentStep: number;
    completedAt: Date | null;
  };
  aiProfile: {
    riskTolerance: 'conservative' | 'balanced' | 'aggressive';
    preferredMarkets: string[];
    preferredStrategies: string[];
    personality: 'institutional' | 'research' | 'execution' | 'automation';
    marketHours: 'regular' | 'extended';
  };
  riskProfile: {
    maximumDailyLoss: number;
    maximumPositionSize: number;
    instruments: 'stocks' | 'options' | 'stocks_options';
    paperTrading: boolean;
    automationAllowed: boolean;
    defaultStrategy: string;
    emergencyStop: boolean;
  };
  notifications: {
    emailAlerts: boolean;
    tradeAlerts: boolean;
    automationAlerts: boolean;
    aiSuggestions: boolean;
    brokerDisconnect: boolean;
    marginCalls: boolean;
    systemMaintenance: boolean;
  };
  layouts: { key: string; label: string; version: number }[];
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
    onboarding: {
      status: { type: String, enum: ['not_started', 'in_progress', 'complete'], required: true, default: 'not_started' },
      currentStep: { type: Number, required: true, default: 0, min: 0, max: 5 },
      completedAt: { type: Date, default: null },
    },
    aiProfile: {
      riskTolerance: { type: String, enum: ['conservative', 'balanced', 'aggressive'], required: true, default: 'balanced' },
      preferredMarkets: { type: [String], required: true, default: ['stocks', 'options'] },
      preferredStrategies: { type: [String], required: true, default: ['research'] },
      personality: { type: String, enum: ['institutional', 'research', 'execution', 'automation'], required: true, default: 'institutional' },
      marketHours: { type: String, enum: ['regular', 'extended'], required: true, default: 'regular' },
    },
    riskProfile: {
      maximumDailyLoss: { type: Number, required: true, default: 500, min: 0 },
      maximumPositionSize: { type: Number, required: true, default: 5000, min: 0 },
      instruments: { type: String, enum: ['stocks', 'options', 'stocks_options'], required: true, default: 'stocks_options' },
      paperTrading: { type: Boolean, required: true, default: true },
      automationAllowed: { type: Boolean, required: true, default: false },
      defaultStrategy: { type: String, required: true, default: 'manual' },
      emergencyStop: { type: Boolean, required: true, default: true },
    },
    notifications: {
      emailAlerts: { type: Boolean, required: true, default: true },
      tradeAlerts: { type: Boolean, required: true, default: true },
      automationAlerts: { type: Boolean, required: true, default: true },
      aiSuggestions: { type: Boolean, required: true, default: true },
      brokerDisconnect: { type: Boolean, required: true, default: true },
      marginCalls: { type: Boolean, required: true, default: true },
      systemMaintenance: { type: Boolean, required: true, default: true },
    },
    layouts: {
      type: [{ key: { type: String, required: true }, label: { type: String, required: true }, version: { type: Number, required: true, default: 1 }, _id: false }],
      required: true,
      default: [],
    },
  },
  { timestamps: true, collection: IDENTITY_COLLECTIONS.workspaceProfiles }
);

export const WorkspaceProfileModel =
  (mongoose.models.IdentityWorkspaceProfile as mongoose.Model<WorkspaceProfileDocument>) ||
  mongoose.model<WorkspaceProfileDocument>('IdentityWorkspaceProfile', WorkspaceProfileSchema);
