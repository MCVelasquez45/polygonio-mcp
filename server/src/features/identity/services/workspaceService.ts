import { Types } from 'mongoose';
import { BrokerConnectionModel, type BrokerConnectionStatus, type BrokerProvider } from '../models/brokerConnection.model';
import { MembershipModel } from '../models/membership.model';
import { OrganizationModel, type OrganizationDocument } from '../models/organization.model';
import { WorkspaceProfileModel, type WorkspaceProfileDocument } from '../models/workspaceProfile.model';
import type { UserDocument } from '../models/user.model';
import { UserModel } from '../models/user.model';
import { normalizeRoles, type IdentityRole } from '../../../shared/identity/rbac';

const DEFAULT_WATCHLIST = [
  { symbol: 'SPY', label: 'S&P 500 ETF', enabled: true },
  { symbol: 'QQQ', label: 'Nasdaq 100 ETF', enabled: true },
  { symbol: 'AAPL', label: 'Apple', enabled: true },
  { symbol: 'NVDA', label: 'NVIDIA', enabled: true },
  { symbol: 'TSLA', label: 'Tesla', enabled: true },
] as const;

const BROKER_PROVIDERS: { provider: BrokerProvider; label: string; enabled: boolean }[] = [
  { provider: 'alpaca', label: 'Alpaca', enabled: true },
  { provider: 'tradier', label: 'Tradier', enabled: false },
  { provider: 'ibkr', label: 'Interactive Brokers', enabled: false },
  { provider: 'tastytrade', label: 'Tastytrade', enabled: false },
  { provider: 'paper', label: 'Paper Trading', enabled: true },
];

export type PublicWorkspace = {
  organization: {
    id: string;
    name: string;
    slug: string;
    status: OrganizationDocument['status'];
  };
  membership: {
    roles: IdentityRole[];
  };
  defaults: {
    watchlist: WorkspaceProfileDocument['defaultWatchlist'];
    aiMemory: WorkspaceProfileDocument['aiMemory'];
    journal: WorkspaceProfileDocument['journal'];
  };
  brokerOnboarding: WorkspaceProfileDocument['brokerOnboarding'] & {
    connections: Array<{
      provider: BrokerProvider;
      label: string;
      status: BrokerConnectionStatus;
      accountId: string | null;
      accountType: string | null;
      paper: boolean;
      buyingPower: number | null;
      currency: string | null;
    }>;
  };
  onboarding: WorkspaceProfileDocument['onboarding'];
  aiProfile: WorkspaceProfileDocument['aiProfile'];
  riskProfile: WorkspaceProfileDocument['riskProfile'];
  notifications: WorkspaceProfileDocument['notifications'];
  layouts: WorkspaceProfileDocument['layouts'];
};

function userObjectId(user: UserDocument): Types.ObjectId {
  return new Types.ObjectId(String(user._id));
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'workspace';
}

function organizationName(user: UserDocument): string {
  return user.profile?.workspaceName?.trim() || `${user.email.split('@')[0]}'s Workspace`;
}

async function findOrCreateOrganization(user: UserDocument): Promise<OrganizationDocument> {
  const userId = userObjectId(user);
  const existingMembership = await MembershipModel.findOne({ userId }).sort({ createdAt: 1 });
  if (existingMembership) {
    const existingOrg = await OrganizationModel.findById(existingMembership.orgId);
    if (existingOrg) return existingOrg;
  }

  const name = organizationName(user);
  const slug = `${slugify(name)}-${String(user._id).slice(-6)}`;
  const org = await OrganizationModel.findOneAndUpdate(
    { ownerId: userId },
    { $setOnInsert: { name, slug, ownerId: userId, status: 'active' } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
  return org!;
}

async function ensureMembership(user: UserDocument, org: OrganizationDocument): Promise<void> {
  const userId = userObjectId(user);
  await MembershipModel.updateOne(
    { userId, orgId: org._id },
    { $setOnInsert: { userId, orgId: org._id, roles: normalizeRoles(user.roles) } },
    { upsert: true }
  );
}

async function ensureBrokerPlaceholders(user: UserDocument): Promise<void> {
  const userId = userObjectId(user);
  await Promise.all(
    BROKER_PROVIDERS.map(provider =>
      BrokerConnectionModel.updateOne(
        { userId, provider: provider.provider },
        {
          $setOnInsert: {
            userId,
            provider: provider.provider,
            label: provider.label,
            status: 'unconfigured',
            accountId: null,
            accountType: null,
            paper: provider.provider === 'paper',
            secretCiphertext: null,
            meta: { onboarding: true },
          },
        },
        { upsert: true }
      )
    )
  );
}

async function ensureWorkspaceProfile(user: UserDocument, org: OrganizationDocument): Promise<WorkspaceProfileDocument> {
  const userId = userObjectId(user);
  const profile = await WorkspaceProfileModel.findOneAndUpdate(
    { userId },
    {
      $setOnInsert: {
        userId,
        orgId: org._id,
        defaultWatchlist: DEFAULT_WATCHLIST,
        aiMemory: {
          status: 'ready',
          seedVersion: 'identity-workspace-v1',
          preferences: {
            riskPosture: 'balanced',
            automationMode: 'paper',
            assistantTone: 'institutional',
          },
        },
        journal: {
          status: 'ready',
          seedVersion: 'identity-journal-v1',
          firstEntry: 'Identity workspace initialized.',
        },
        brokerOnboarding: {
          status: 'not_started',
          providers: BROKER_PROVIDERS,
        },
        onboarding: { status: 'not_started', currentStep: 0, completedAt: null },
        aiProfile: {
          riskTolerance: 'balanced',
          preferredMarkets: ['stocks', 'options'],
          preferredStrategies: ['research'],
          personality: 'institutional',
          marketHours: 'regular',
        },
        riskProfile: {
          maximumDailyLoss: 500,
          maximumPositionSize: 5000,
          instruments: 'stocks_options',
          paperTrading: true,
          automationAllowed: false,
          defaultStrategy: 'manual',
          emergencyStop: true,
        },
        notifications: {
          emailAlerts: true,
          tradeAlerts: true,
          automationAlerts: true,
          aiSuggestions: true,
          brokerDisconnect: true,
          marginCalls: true,
          systemMaintenance: true,
        },
        layouts: [
          { key: 'trading', label: 'Trading Layout', version: 1 },
          { key: 'ai', label: 'AI Layout', version: 1 },
          { key: 'research', label: 'Research Layout', version: 1 },
          { key: 'portfolio', label: 'Portfolio Layout', version: 1 },
          { key: 'automation', label: 'Automation Layout', version: 1 },
        ],
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
  return profile!;
}

export async function ensureUserWorkspace(user: UserDocument): Promise<PublicWorkspace> {
  const org = await findOrCreateOrganization(user);
  await Promise.all([ensureMembership(user, org), ensureBrokerPlaceholders(user)]);
  const profile = await ensureWorkspaceProfile(user, org);
  return toPublicWorkspace(org, normalizeRoles(user.roles), profile, await publicBrokerConnections(user));
}

export async function getUserWorkspace(user: UserDocument): Promise<PublicWorkspace> {
  return ensureUserWorkspace(user);
}

export type OnboardingConfiguration = {
  timezone?: string;
  tradingExperience?: UserDocument['profile']['tradingExperience'];
  aiProfile?: Partial<WorkspaceProfileDocument['aiProfile']>;
  riskProfile?: Partial<WorkspaceProfileDocument['riskProfile']>;
  notifications?: Partial<WorkspaceProfileDocument['notifications']>;
  currentStep?: number;
};

export async function updateOnboardingConfiguration(
  user: UserDocument,
  patch: OnboardingConfiguration
): Promise<PublicWorkspace> {
  const workspace = await ensureWorkspaceProfile(user, await findOrCreateOrganization(user));
  if (patch.timezone !== undefined) user.profile.timezone = patch.timezone;
  if (patch.tradingExperience !== undefined) user.profile.tradingExperience = patch.tradingExperience;
  if (patch.timezone !== undefined || patch.tradingExperience !== undefined) {
    user.markModified('profile');
    await user.save();
  }
  if (patch.aiProfile) Object.assign(workspace.aiProfile, patch.aiProfile);
  if (patch.riskProfile) Object.assign(workspace.riskProfile, patch.riskProfile);
  if (patch.notifications) Object.assign(workspace.notifications, patch.notifications);
  workspace.onboarding.status = 'in_progress';
  if (patch.currentStep !== undefined) workspace.onboarding.currentStep = patch.currentStep;
  workspace.markModified('aiProfile');
  workspace.markModified('riskProfile');
  workspace.markModified('notifications');
  workspace.markModified('onboarding');
  await workspace.save();
  const org = await OrganizationModel.findById(workspace.orgId);
  return toPublicWorkspace(org!, normalizeRoles(user.roles), workspace, await publicBrokerConnections(user));
}

async function publicBrokerConnections(user: UserDocument): Promise<PublicWorkspace['brokerOnboarding']['connections']> {
  const connections = await BrokerConnectionModel.find({ userId: userObjectId(user) }).sort({ provider: 1 });
  return connections.map(connection => ({
    provider: connection.provider,
    label: connection.label,
    status: connection.status,
    accountId: connection.accountId,
    accountType: connection.accountType,
    paper: connection.paper,
    buyingPower: Number.isFinite(Number(connection.meta?.buyingPower)) ? Number(connection.meta.buyingPower) : null,
    currency: typeof connection.meta?.currency === 'string' ? connection.meta.currency : null,
  }));
}

export async function connectPaperBroker(user: UserDocument): Promise<PublicWorkspace> {
  const userId = userObjectId(user);
  await ensureUserWorkspace(user);
  await BrokerConnectionModel.updateOne(
    { userId, provider: 'paper' },
    {
      $set: {
        status: 'connected',
        accountId: `paper-${String(user._id)}`,
        accountType: 'paper',
        paper: true,
        meta: { onboarding: true, buyingPower: 100_000, currency: 'USD' },
      },
    }
  );
  await WorkspaceProfileModel.updateOne(
    { userId },
    { $set: { 'brokerOnboarding.status': 'connected', 'onboarding.status': 'in_progress', 'onboarding.currentStep': 2 } }
  );
  return getUserWorkspace(user);
}

export type AlpacaAccountSnapshot = {
  id?: unknown;
  account_number?: unknown;
  status?: unknown;
  buying_power?: unknown;
  currency?: unknown;
  account_type?: unknown;
  pattern_day_trader?: unknown;
};

export async function connectAlpacaBroker(
  user: UserDocument,
  account: AlpacaAccountSnapshot,
  paper: boolean
): Promise<PublicWorkspace> {
  const userId = userObjectId(user);
  await ensureUserWorkspace(user);
  const accountId = String(account.id ?? account.account_number ?? '').trim();
  if (!accountId) throw new Error('ALPACA_ACCOUNT_INVALID');
  const buyingPower = Number(account.buying_power);
  await BrokerConnectionModel.updateOne(
    { userId, provider: 'alpaca' },
    {
      $set: {
        status: 'connected',
        accountId,
        accountType: String(account.account_type ?? (paper ? 'paper' : 'live')),
        paper,
        meta: {
          onboarding: true,
          credentialSource: 'deployment',
          brokerStatus: String(account.status ?? 'ACTIVE'),
          buyingPower: Number.isFinite(buyingPower) ? buyingPower : null,
          currency: String(account.currency ?? 'USD'),
          patternDayTrader: account.pattern_day_trader === true,
        },
      },
    }
  );
  await WorkspaceProfileModel.updateOne(
    { userId },
    { $set: { 'brokerOnboarding.status': 'connected', 'onboarding.status': 'in_progress', 'onboarding.currentStep': 2 } }
  );
  return getUserWorkspace(user);
}

export async function completeUserOnboarding(user: UserDocument): Promise<PublicWorkspace | null> {
  const userId = userObjectId(user);
  const connectedBroker = await BrokerConnectionModel.exists({ userId, status: 'connected' });
  if (!connectedBroker) return null;
  const completedAt = new Date();
  await WorkspaceProfileModel.updateOne(
    { userId },
    { $set: { 'onboarding.status': 'complete', 'onboarding.currentStep': 5, 'onboarding.completedAt': completedAt } }
  );
  await UserModel.updateOne(
    { _id: userId },
    { $set: { firstLogin: false, onboardingCompletedAt: completedAt } }
  );
  user.firstLogin = false;
  user.onboardingCompletedAt = completedAt;
  return getUserWorkspace(user);
}

function toPublicWorkspace(
  org: OrganizationDocument,
  roles: IdentityRole[],
  profile: WorkspaceProfileDocument,
  connections: PublicWorkspace['brokerOnboarding']['connections']
): PublicWorkspace {
  return {
    organization: {
      id: String(org._id),
      name: org.name,
      slug: org.slug,
      status: org.status,
    },
    membership: { roles },
    defaults: {
      watchlist: profile.defaultWatchlist,
      aiMemory: profile.aiMemory,
      journal: profile.journal,
    },
    brokerOnboarding: {
      status: profile.brokerOnboarding.status,
      providers: profile.brokerOnboarding.providers,
      connections,
    },
    onboarding: profile.onboarding,
    aiProfile: profile.aiProfile,
    riskProfile: profile.riskProfile,
    notifications: profile.notifications,
    layouts: profile.layouts,
  };
}

export { BROKER_PROVIDERS, DEFAULT_WATCHLIST };
