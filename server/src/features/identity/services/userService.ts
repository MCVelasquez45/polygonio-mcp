// User lifecycle: registration, email verification, password reset, lockout,
// profile, and OAuth account linking. All persistence goes through Mongoose.

import { UserModel, type UserDocument, type UserProfile } from '../models/user.model';
import { EmailTokenModel, type EmailTokenType } from '../models/emailToken.model';
import { getIdentityConfig } from '../../../shared/identity/config';
import { generateOpaqueToken, sha256 } from '../../../shared/identity/crypto';
import { hashPassword } from '../../../shared/identity/password';
import { normalizeRoles, type IdentityRole } from '../../../shared/identity/rbac';

export function normalizeEmail(email: string): string {
  return String(email ?? '').trim().toLowerCase();
}

export type PublicUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  status: UserDocument['status'];
  roles: IdentityRole[];
  profile: UserProfile;
  hasPassword: boolean;
  oauthProviders: string[];
  lastLoginAt: string | null;
  createdAt: string;
  firstLogin: boolean;
  onboardingCompletedAt: string | null;
};

export function toPublicUser(user: UserDocument): PublicUser {
  return {
    id: String(user._id),
    email: user.email,
    emailVerified: user.emailVerified,
    status: user.status,
    roles: normalizeRoles(user.roles),
    profile: user.profile,
    hasPassword: Boolean(user.passwordHash),
    oauthProviders: (user.oauth ?? []).map(o => o.provider),
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    firstLogin: user.firstLogin !== false,
    onboardingCompletedAt: user.onboardingCompletedAt?.toISOString() ?? null,
  };
}

export async function findUserByEmail(email: string): Promise<UserDocument | null> {
  return UserModel.findOne({ email: normalizeEmail(email) });
}

export async function findUserById(id: string): Promise<UserDocument | null> {
  try {
    return await UserModel.findById(id);
  } catch {
    return null;
  }
}

export type CreateUserInput = {
  email: string;
  password: string;
  workspaceName?: string;
  name?: string;
};

/**
 * Creates a pending email/password user. Returns null if the email already
 * exists (caller returns a generic response to resist account enumeration).
 */
export async function createEmailPasswordUser(input: CreateUserInput): Promise<UserDocument | null> {
  const email = normalizeEmail(input.email);
  const existing = await UserModel.findOne({ email });
  if (existing) return null;
  const passwordHash = await hashPassword(input.password);
  const isFirstUser = (await UserModel.estimatedDocumentCount()) === 0;
  return UserModel.create({
    email,
    emailVerified: false,
    passwordHash,
    status: 'pending',
    firstLogin: true,
    // Bootstrap: the very first account provisions as admin so the deployment
    // has an operator. Every subsequent self-registration is a viewer.
    roles: isFirstUser ? ['admin'] : ['viewer'],
    profile: {
      name: input.name?.trim() || email.split('@')[0],
      workspaceName: input.workspaceName?.trim() || 'My Workspace',
    },
  });
}

// --- One-time email tokens (verify / reset) ---------------------------------

async function issueEmailToken(userId: string, type: EmailTokenType, ttlSec: number): Promise<string> {
  const raw = generateOpaqueToken();
  await EmailTokenModel.create({
    userId,
    type,
    tokenHash: sha256(raw),
    expiresAt: new Date(Date.now() + ttlSec * 1000),
  });
  return raw;
}

export async function issueVerificationToken(userId: string): Promise<string> {
  return issueEmailToken(userId, 'verify', getIdentityConfig().verifyTokenTtlSec);
}

export async function issueResetToken(userId: string): Promise<string> {
  return issueEmailToken(userId, 'reset', getIdentityConfig().resetTokenTtlSec);
}

async function consumeEmailToken(rawToken: string, type: EmailTokenType): Promise<UserDocument | null> {
  const tokenHash = sha256(String(rawToken ?? ''));
  const record = await EmailTokenModel.findOne({ tokenHash, type });
  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) return null;
  const user = await UserModel.findById(record.userId);
  if (!user) return null;
  record.usedAt = new Date();
  await record.save();
  return user;
}

export async function verifyEmailWithToken(rawToken: string): Promise<UserDocument | null> {
  const user = await consumeEmailToken(rawToken, 'verify');
  if (!user) return null;
  user.emailVerified = true;
  if (user.status === 'pending') user.status = 'active';
  await user.save();
  return user;
}

export async function resetPasswordWithToken(rawToken: string, newPassword: string): Promise<UserDocument | null> {
  const user = await consumeEmailToken(rawToken, 'reset');
  if (!user) return null;
  user.passwordHash = await hashPassword(newPassword);
  // A reset implies the email is controlled by the user.
  user.emailVerified = true;
  if (user.status === 'pending') user.status = 'active';
  user.failedLoginCount = 0;
  user.lockedUntil = null;
  await user.save();
  return user;
}

// --- Lockout ----------------------------------------------------------------

export function isLocked(user: UserDocument): boolean {
  return Boolean(user.lockedUntil && user.lockedUntil.getTime() > Date.now());
}

export async function recordFailedLogin(user: UserDocument): Promise<void> {
  const cfg = getIdentityConfig();
  user.failedLoginCount = (user.failedLoginCount ?? 0) + 1;
  if (user.failedLoginCount >= cfg.maxFailedLogins) {
    user.lockedUntil = new Date(Date.now() + cfg.lockoutMs);
    user.failedLoginCount = 0;
  }
  await user.save();
}

export async function recordSuccessfulLogin(user: UserDocument): Promise<void> {
  user.failedLoginCount = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();
  await user.save();
}

// --- Profile ----------------------------------------------------------------

export type ProfilePatch = Partial<Pick<
  UserProfile,
  'name' | 'avatarUrl' | 'timezone' | 'tradingExperience' | 'preferredTheme' | 'workspaceName'
>>;

export async function updateProfile(userId: string, patch: ProfilePatch): Promise<UserDocument | null> {
  const user = await UserModel.findById(userId);
  if (!user) return null;
  const profile = user.profile;
  if (patch.name !== undefined) profile.name = patch.name;
  if (patch.avatarUrl !== undefined) profile.avatarUrl = patch.avatarUrl;
  if (patch.timezone !== undefined) profile.timezone = patch.timezone;
  if (patch.tradingExperience !== undefined) profile.tradingExperience = patch.tradingExperience;
  if (patch.preferredTheme !== undefined) profile.preferredTheme = patch.preferredTheme;
  if (patch.workspaceName !== undefined) profile.workspaceName = patch.workspaceName;
  user.markModified('profile');
  await user.save();
  return user;
}

// --- OAuth linking ----------------------------------------------------------

export type OAuthProfile = {
  provider: 'google';
  subject: string;
  email: string;
  name?: string;
};

/**
 * Find-or-create a user for a verified OAuth identity. Links by provider
 * subject first, then by verified email (so an existing password user can also
 * sign in with Google). OAuth emails are treated as verified.
 */
export async function upsertOAuthUser(oauth: OAuthProfile): Promise<UserDocument> {
  const email = normalizeEmail(oauth.email);
  let user =
    (await UserModel.findOne({ 'oauth.provider': oauth.provider, 'oauth.subject': oauth.subject })) ||
    (await UserModel.findOne({ email }));

  if (!user) {
    const isFirstUser = (await UserModel.estimatedDocumentCount()) === 0;
    user = await UserModel.create({
      email,
      emailVerified: true,
      passwordHash: null,
      status: 'active',
      firstLogin: true,
      roles: isFirstUser ? ['admin'] : ['viewer'],
      profile: {
        name: oauth.name?.trim() || email.split('@')[0],
        workspaceName: 'My Workspace',
      },
      oauth: [{ provider: oauth.provider, subject: oauth.subject, email, linkedAt: new Date() }],
    });
    return user;
  }

  // Link the provider if not already linked.
  const alreadyLinked = (user.oauth ?? []).some(
    o => o.provider === oauth.provider && o.subject === oauth.subject
  );
  if (!alreadyLinked) {
    user.oauth.push({ provider: oauth.provider, subject: oauth.subject, email, linkedAt: new Date() });
  }
  user.emailVerified = true;
  if (user.status === 'pending') user.status = 'active';
  await user.save();
  return user;
}
