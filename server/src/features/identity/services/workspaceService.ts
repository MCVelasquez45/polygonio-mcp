import { Types } from 'mongoose';
import { BrokerConnectionModel, type BrokerProvider } from '../models/brokerConnection.model';
import { MembershipModel } from '../models/membership.model';
import { OrganizationModel, type OrganizationDocument } from '../models/organization.model';
import { WorkspaceProfileModel, type WorkspaceProfileDocument } from '../models/workspaceProfile.model';
import type { UserDocument } from '../models/user.model';
import { normalizeRoles, type IdentityRole } from '../../../shared/identity/rbac';

const DEFAULT_WATCHLIST = [
  { symbol: 'SPY', label: 'S&P 500 ETF', enabled: true },
  { symbol: 'QQQ', label: 'Nasdaq 100 ETF', enabled: true },
  { symbol: 'AAPL', label: 'Apple', enabled: true },
  { symbol: 'MSFT', label: 'Microsoft', enabled: true },
  { symbol: 'NVDA', label: 'NVIDIA', enabled: true },
] as const;

const BROKER_PROVIDERS: { provider: BrokerProvider; label: string; enabled: boolean }[] = [
  { provider: 'alpaca', label: 'Alpaca', enabled: true },
  { provider: 'tradier', label: 'Tradier', enabled: true },
  { provider: 'ibkr', label: 'Interactive Brokers', enabled: true },
  { provider: 'tastytrade', label: 'Tastytrade', enabled: true },
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
  brokerOnboarding: WorkspaceProfileDocument['brokerOnboarding'];
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
  return toPublicWorkspace(org, normalizeRoles(user.roles), profile);
}

export async function getUserWorkspace(user: UserDocument): Promise<PublicWorkspace> {
  return ensureUserWorkspace(user);
}

function toPublicWorkspace(
  org: OrganizationDocument,
  roles: IdentityRole[],
  profile: WorkspaceProfileDocument
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
    brokerOnboarding: profile.brokerOnboarding,
  };
}

export { BROKER_PROVIDERS, DEFAULT_WATCHLIST };
