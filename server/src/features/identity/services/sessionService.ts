// Session lifecycle: refresh-token sessions with rotation + reuse detection.
//
// See docs/identity/ARCHITECTURE.md §3. The raw refresh token is never stored;
// only its SHA-256 hash. Each refresh rotates the token within the same family;
// replaying an already-rotated token is treated as theft and revokes the whole
// family.

import type { Request } from 'express';
import { randomUUID } from 'crypto';
import { SessionModel, type SessionDocument } from '../models/session.model';
import type { UserDocument } from '../models/user.model';
import { getIdentityConfig } from '../../../shared/identity/config';
import { generateOpaqueToken, sha256 } from '../../../shared/identity/crypto';
import { signAccessToken } from '../../../shared/identity/jwt';
import { normalizeRoles } from '../../../shared/identity/rbac';
import { clientIp, clientUa } from './auditService';
import { ensureUserWorkspace } from './workspaceService';

export type IssuedTokens = {
  accessToken: string;
  accessTokenExpiresInSec: number;
  refreshToken: string; // raw — set as HttpOnly cookie
  refreshExpiresInSec: number;
  csrfToken: string; // set as JS-readable cookie + echoed in header
  sessionId: string;
  familyId: string;
};

function mintAccessToken(user: UserDocument, sessionId: string): string {
  return signAccessToken({
    sub: String(user._id),
    sid: sessionId,
    roles: normalizeRoles(user.roles),
    wsp: user.profile?.workspaceName,
    typ: 'access',
  });
}

function refreshTtl(rememberMe: boolean): number {
  const cfg = getIdentityConfig();
  return rememberMe ? cfg.rememberMeTtlSec : cfg.refreshTtlSec;
}

async function issueTokensForSession(
  user: UserDocument,
  session: SessionDocument,
  rawRefreshToken: string,
  refreshExpiresInSec: number
): Promise<IssuedTokens> {
  const cfg = getIdentityConfig();
  return {
    accessToken: mintAccessToken(user, String(session._id)),
    accessTokenExpiresInSec: cfg.accessTokenTtlSec,
    refreshToken: rawRefreshToken,
    refreshExpiresInSec,
    csrfToken: generateOpaqueToken(24),
    sessionId: String(session._id),
    familyId: session.familyId,
  };
}

/** Create a brand-new session (login / oauth). */
export async function createSession(
  user: UserDocument,
  rememberMe: boolean,
  req: Request
): Promise<IssuedTokens> {
  await ensureUserWorkspace(user);
  const ttl = refreshTtl(rememberMe);
  const rawRefresh = generateOpaqueToken();
  const familyId = randomUUID();
  const session = await SessionModel.create({
    userId: user._id,
    familyId,
    tokenHash: sha256(rawRefresh),
    rememberMe,
    device: { ua: clientUa(req), ip: clientIp(req) },
    lastUsedAt: new Date(),
    expiresAt: new Date(Date.now() + ttl * 1000),
  });
  return issueTokensForSession(user, session, rawRefresh, ttl);
}

export type RotateResult =
  | { status: 'ok'; tokens: IssuedTokens; user: UserDocument }
  | { status: 'reuse'; familyId: string; userId: string }
  | { status: 'invalid' };

/**
 * Rotate a presented refresh token. Detects reuse of an already-rotated token
 * and revokes the entire family in that case.
 */
export async function rotateSession(
  rawRefreshToken: string,
  req: Request,
  loadUser: (userId: string) => Promise<UserDocument | null>
): Promise<RotateResult> {
  if (!rawRefreshToken) return { status: 'invalid' };
  const presentedHash = sha256(rawRefreshToken);
  const session = await SessionModel.findOne({ tokenHash: presentedHash });
  if (!session) return { status: 'invalid' };

  // Reuse detection: a token that has already been rotated OR belongs to a
  // revoked/expired session is being replayed → revoke the family.
  const expired = session.expiresAt.getTime() < Date.now();
  if (session.rotatedTo || session.revokedAt || expired) {
    await revokeFamily(session.familyId);
    return { status: 'reuse', familyId: session.familyId, userId: String(session.userId) };
  }

  const user = await loadUser(String(session.userId));
  if (!user || user.status === 'disabled') {
    await revokeFamily(session.familyId);
    return { status: 'invalid' };
  }

  // Rotate: mint a new token in the same family, mark the old one rotated.
  const ttl = refreshTtl(session.rememberMe);
  const rawRefresh = generateOpaqueToken();
  const newSession = await SessionModel.create({
    userId: session.userId,
    familyId: session.familyId,
    tokenHash: sha256(rawRefresh),
    rememberMe: session.rememberMe,
    device: { ua: clientUa(req), ip: clientIp(req) },
    lastUsedAt: new Date(),
    expiresAt: new Date(Date.now() + ttl * 1000),
  });
  session.rotatedTo = newSession.tokenHash;
  session.lastUsedAt = new Date();
  await session.save();

  const tokens = await issueTokensForSession(user, newSession, rawRefresh, ttl);
  return { status: 'ok', tokens, user };
}

/** Revoke a single active session by presented refresh token. */
export async function revokeByRefreshToken(rawRefreshToken: string): Promise<void> {
  if (!rawRefreshToken) return;
  await SessionModel.updateOne(
    { tokenHash: sha256(rawRefreshToken), revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

export async function revokeFamily(familyId: string): Promise<void> {
  await SessionModel.updateMany(
    { familyId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

/** Logout-everywhere: revoke all of a user's active sessions. */
export async function revokeAllUserSessions(userId: string): Promise<number> {
  const res = await SessionModel.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  return res.modifiedCount ?? 0;
}

export type SessionSummary = {
  id: string;
  current: boolean;
  device: { ua: string; ip: string };
  rememberMe: boolean;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
};

/** List active (non-revoked, non-rotated, unexpired) sessions for a user. */
export async function listActiveSessions(userId: string, currentSessionId?: string): Promise<SessionSummary[]> {
  const now = new Date();
  const sessions = await SessionModel.find({
    userId,
    revokedAt: null,
    rotatedTo: null,
    expiresAt: { $gt: now },
  }).sort({ lastUsedAt: -1 });
  return sessions.map(s => ({
    id: String(s._id),
    current: currentSessionId ? String(s._id) === currentSessionId : false,
    device: s.device,
    rememberMe: s.rememberMe,
    createdAt: s.createdAt.toISOString(),
    lastUsedAt: s.lastUsedAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
  }));
}

/** Revoke a specific session id, but only if it belongs to the user. */
export async function revokeSessionById(userId: string, sessionId: string): Promise<boolean> {
  try {
    const res = await SessionModel.updateOne(
      { _id: sessionId, userId, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    return (res.modifiedCount ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Whether a session id is still active (used by access-token verification). */
export async function isSessionActive(sessionId: string): Promise<boolean> {
  try {
    const session = await SessionModel.findById(sessionId);
    if (!session) return false;
    return !session.revokedAt && !session.rotatedTo && session.expiresAt.getTime() > Date.now();
  } catch {
    return false;
  }
}
