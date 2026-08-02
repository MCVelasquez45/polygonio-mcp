import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { REFRESH_COOKIE, setCsrfCookie, setRefreshCookie, clearCsrfCookie, clearRefreshCookie } from '../../shared/identity/cookies';
import { generateOpaqueToken } from '../../shared/identity/crypto';
import { authRateLimit } from '../../shared/identity/rateLimit';
import { requireCsrf } from '../../shared/identity/csrf';
import { checkPasswordPolicy, verifyPassword } from '../../shared/identity/password';
import { getIdentityConfig, isGoogleOAuthConfigured } from '../../shared/identity/config';
import { normalizeReturnTo, verifyGoogleOAuthState } from '../../shared/identity/oauthState';
import { requireAuthenticated, requireMongoIdentity } from './identity.middleware';
import type { UserDocument } from './models/user.model';
import {
  createEmailPasswordUser,
  findUserByEmail,
  findUserById,
  isLocked,
  issueResetToken,
  issueVerificationToken,
  recordFailedLogin,
  recordSuccessfulLogin,
  resetPasswordWithToken,
  toPublicUser,
  updateProfile,
  upsertOAuthUser,
  verifyEmailWithToken,
} from './services/userService';
import {
  createSession,
  listActiveSessions,
  revokeAllUserSessions,
  revokeByRefreshToken,
  revokeSessionById,
  rotateSession,
} from './services/sessionService';
import { beginGoogleOAuth, consumeGoogleOAuthAttempt, exchangeGoogleCode } from './services/oauthService';
import { getAlpacaAccount, getAlpacaEnvironment } from '../broker/services/alpaca';
import { sendPasswordResetEmail, sendVerificationEmail } from './services/emailService';
import { clientIp, clientUa, recordAuditFromRequest } from './services/auditService';
import {
  completeUserOnboarding,
  connectAlpacaBroker,
  connectPaperBroker,
  getUserWorkspace,
  updateOnboardingConfiguration,
} from './services/workspaceService';

export const identityRouter = express.Router();

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncRoute(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}

function refreshCookie(req: Request): string {
  return String((req as Request & { cookies?: Record<string, string> }).cookies?.[REFRESH_COOKIE] ?? '');
}

function setSessionCookies(res: Response, tokens: { refreshToken: string; refreshExpiresInSec: number; csrfToken: string }): void {
  setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresInSec);
  setCsrfCookie(res, tokens.csrfToken, tokens.refreshExpiresInSec);
}

function sendTokenResponse(res: Response, tokens: { accessToken: string; accessTokenExpiresInSec: number; sessionId: string }, user: unknown): void {
  res.json({
    accessToken: tokens.accessToken,
    accessTokenExpiresInSec: tokens.accessTokenExpiresInSec,
    sessionId: tokens.sessionId,
    user,
  });
}

function bool(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

function stringBody(value: unknown, max = 512): string {
  return String(value ?? '').trim().slice(0, max);
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

identityRouter.get('/config', (_req, res) => {
  const alpaca = getAlpacaEnvironment();
  res.json({
    googleConfigured: isGoogleOAuthConfigured(),
    googleClientId: getIdentityConfig().googleClientId,
    alpacaConfigured: alpaca.hasCredentials,
    alpacaPaper: alpaca.paper,
  });
});

identityRouter.get('/csrf', (_req, res) => {
  const token = generateOpaqueToken(24);
  setCsrfCookie(res, token, getIdentityConfig().refreshTtlSec);
  res.json({ csrfToken: token });
});

identityRouter.post('/register', requireMongoIdentity, requireCsrf, authRateLimit(8), asyncRoute(async (req, res) => {
  const email = stringBody(req.body?.email, 320).toLowerCase();
  const password = String(req.body?.password ?? '');
  const workspaceName = stringBody(req.body?.workspaceName, 120);
  const name = stringBody(req.body?.name, 120);

  if (!isEmail(email)) {
    res.status(400).json({ error: 'INVALID_EMAIL' });
    return;
  }
  const policy = checkPasswordPolicy(password);
  if (!policy.ok) {
    res.status(400).json({ error: 'PASSWORD_POLICY_FAILED', message: policy.reason });
    return;
  }

  const user = await createEmailPasswordUser({ email, password, workspaceName, name });
  if (user) {
    const token = await issueVerificationToken(String(user._id));
    await sendVerificationEmail(user.email, token);
    await recordAuditFromRequest(req, {
      actorId: String(user._id),
      action: 'REGISTER',
      targetType: 'user',
      targetId: String(user._id),
      meta: { ip: clientIp(req), ua: clientUa(req) },
    });
  }

  res.status(201).json({
    ok: true,
    message: 'If registration is accepted, a verification email will be sent.',
  });
}));

identityRouter.post('/login', requireMongoIdentity, requireCsrf, authRateLimit(), asyncRoute(async (req, res) => {
  const email = stringBody(req.body?.email, 320).toLowerCase();
  const password = String(req.body?.password ?? '');
  const rememberMe = bool(req.body?.rememberMe);
  const user = isEmail(email) ? await findUserByEmail(email) : null;

  if (!user || !user.passwordHash || user.status === 'disabled' || isLocked(user)) {
    await recordAuditFromRequest(req, {
      actorId: user ? String(user._id) : 'anonymous',
      action: 'LOGIN',
      outcome: 'failure',
      targetType: 'user',
      targetId: user ? String(user._id) : null,
    });
    res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    return;
  }

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    await recordFailedLogin(user);
    await recordAuditFromRequest(req, {
      actorId: String(user._id),
      action: 'LOGIN',
      outcome: 'failure',
      targetType: 'user',
      targetId: String(user._id),
    });
    res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    return;
  }

  if (!user.emailVerified || user.status !== 'active') {
    res.status(403).json({ error: 'EMAIL_VERIFICATION_REQUIRED' });
    return;
  }

  await recordSuccessfulLogin(user);
  const tokens = await createSession(user, rememberMe, req);
  setSessionCookies(res, tokens);
  await recordAuditFromRequest(req, {
    actorId: String(user._id),
    action: 'LOGIN',
    targetType: 'session',
    targetId: tokens.sessionId,
  });
  sendTokenResponse(res, tokens, toPublicUser(user));
}));

identityRouter.post('/refresh', requireMongoIdentity, requireCsrf, authRateLimit(60), asyncRoute(async (req, res) => {
  const raw = refreshCookie(req);
  const result = await rotateSession(raw, req, findUserById);
  if (result.status === 'reuse') {
    clearRefreshCookie(res);
    clearCsrfCookie(res);
    await recordAuditFromRequest(req, {
      actorId: result.userId,
      action: 'REFRESH_REUSE_DETECTED',
      outcome: 'denied',
      targetType: 'session_family',
      targetId: result.familyId,
    });
    res.status(401).json({ error: 'SESSION_REUSE_DETECTED' });
    return;
  }
  if (result.status !== 'ok') {
    clearRefreshCookie(res);
    clearCsrfCookie(res);
    res.status(401).json({ error: 'SESSION_INVALID' });
    return;
  }
  setSessionCookies(res, result.tokens);
  sendTokenResponse(res, result.tokens, toPublicUser(result.user));
}));

identityRouter.post('/logout', requireMongoIdentity, requireCsrf, asyncRoute(async (req, res) => {
  await revokeByRefreshToken(refreshCookie(req));
  clearRefreshCookie(res);
  clearCsrfCookie(res);
  await recordAuditFromRequest(req, {
    actorId: req.auth?.actorId ?? 'anonymous',
    action: 'LOGOUT',
    targetType: 'session',
    targetId: req.auth?.sessionId ?? null,
  });
  res.json({ ok: true });
}));

identityRouter.post('/logout-all', requireMongoIdentity, requireAuthenticated, requireCsrf, asyncRoute(async (req, res) => {
  const revoked = await revokeAllUserSessions(req.auth!.actorId);
  clearRefreshCookie(res);
  clearCsrfCookie(res);
  await recordAuditFromRequest(req, {
    actorId: req.auth!.actorId,
    action: 'LOGOUT_ALL',
    targetType: 'user',
    targetId: req.auth!.actorId,
    meta: { revoked },
  });
  res.json({ ok: true, revoked });
}));

identityRouter.get('/me', requireMongoIdentity, requireAuthenticated, asyncRoute(async (req, res) => {
  const user = await findUserById(req.auth!.actorId);
  if (!user || user.status === 'disabled') {
    res.status(401).json({ error: 'AUTH_REQUIRED' });
    return;
  }
  res.json({ user: toPublicUser(user) });
}));

identityRouter.get('/workspace', requireMongoIdentity, requireAuthenticated, asyncRoute(async (req, res) => {
  const user = await findUserById(req.auth!.actorId);
  if (!user || user.status === 'disabled') {
    res.status(401).json({ error: 'AUTH_REQUIRED' });
    return;
  }
  res.json({ workspace: await getUserWorkspace(user) });
}));

identityRouter.patch('/onboarding', requireMongoIdentity, requireAuthenticated, requireCsrf, asyncRoute(async (req, res) => {
  const user = await findUserById(req.auth!.actorId);
  if (!user || user.status === 'disabled') {
    res.status(401).json({ error: 'AUTH_REQUIRED' });
    return;
  }
  const experience = stringBody(req.body?.tradingExperience, 32);
  const riskTolerance = stringBody(req.body?.aiProfile?.riskTolerance, 32);
  const personality = stringBody(req.body?.aiProfile?.personality, 32);
  const marketHours = stringBody(req.body?.aiProfile?.marketHours, 32);
  const instruments = stringBody(req.body?.riskProfile?.instruments, 32);
  const maximumDailyLoss = Number(req.body?.riskProfile?.maximumDailyLoss);
  const maximumPositionSize = Number(req.body?.riskProfile?.maximumPositionSize);
  const currentStep = Math.max(0, Math.min(5, Number(req.body?.currentStep) || 0));
  const workspace = await updateOnboardingConfiguration(user, {
    timezone: stringBody(req.body?.timezone, 64) || undefined,
    tradingExperience: ['none', 'beginner', 'intermediate', 'advanced', 'professional'].includes(experience)
      ? experience as UserDocument['profile']['tradingExperience']
      : undefined,
    currentStep,
    aiProfile: {
      ...(['conservative', 'balanced', 'aggressive'].includes(riskTolerance) ? { riskTolerance: riskTolerance as 'conservative' | 'balanced' | 'aggressive' } : {}),
      ...(['institutional', 'research', 'execution', 'automation'].includes(personality) ? { personality: personality as 'institutional' | 'research' | 'execution' | 'automation' } : {}),
      ...(['regular', 'extended'].includes(marketHours) ? { marketHours: marketHours as 'regular' | 'extended' } : {}),
      ...(Array.isArray(req.body?.aiProfile?.preferredMarkets) ? { preferredMarkets: req.body.aiProfile.preferredMarkets.map((item: unknown) => stringBody(item, 32)).filter(Boolean).slice(0, 10) } : {}),
      ...(Array.isArray(req.body?.aiProfile?.preferredStrategies) ? { preferredStrategies: req.body.aiProfile.preferredStrategies.map((item: unknown) => stringBody(item, 48)).filter(Boolean).slice(0, 10) } : {}),
    },
    riskProfile: {
      ...(Number.isFinite(maximumDailyLoss) ? { maximumDailyLoss: Math.max(0, Math.min(maximumDailyLoss, 10_000_000)) } : {}),
      ...(Number.isFinite(maximumPositionSize) ? { maximumPositionSize: Math.max(0, Math.min(maximumPositionSize, 100_000_000)) } : {}),
      ...(['stocks', 'options', 'stocks_options'].includes(instruments) ? { instruments: instruments as 'stocks' | 'options' | 'stocks_options' } : {}),
      ...(typeof req.body?.riskProfile?.paperTrading === 'boolean' ? { paperTrading: req.body.riskProfile.paperTrading } : {}),
      ...(typeof req.body?.riskProfile?.automationAllowed === 'boolean' ? { automationAllowed: req.body.riskProfile.automationAllowed } : {}),
      ...(typeof req.body?.riskProfile?.emergencyStop === 'boolean' ? { emergencyStop: req.body.riskProfile.emergencyStop } : {}),
      ...(stringBody(req.body?.riskProfile?.defaultStrategy, 64) ? { defaultStrategy: stringBody(req.body.riskProfile.defaultStrategy, 64) } : {}),
    },
    notifications: Object.fromEntries(
      ['emailAlerts', 'tradeAlerts', 'automationAlerts', 'aiSuggestions', 'brokerDisconnect', 'marginCalls', 'systemMaintenance']
        .filter(key => typeof req.body?.notifications?.[key] === 'boolean')
        .map(key => [key, req.body.notifications[key]])
    ),
  });
  await recordAuditFromRequest(req, { actorId: req.auth!.actorId, action: 'ONBOARDING_UPDATED', targetType: 'workspace', targetId: workspace.organization.id, meta: { currentStep } });
  res.json({ workspace });
}));

identityRouter.post('/onboarding/broker/paper', requireMongoIdentity, requireAuthenticated, requireCsrf, asyncRoute(async (req, res) => {
  const user = await findUserById(req.auth!.actorId);
  if (!user || user.status === 'disabled') {
    res.status(401).json({ error: 'AUTH_REQUIRED' });
    return;
  }
  const workspace = await connectPaperBroker(user);
  await recordAuditFromRequest(req, { actorId: req.auth!.actorId, action: 'PAPER_BROKER_CONNECTED', targetType: 'workspace', targetId: workspace.organization.id });
  res.json({ workspace });
}));

identityRouter.post('/onboarding/broker/alpaca', requireMongoIdentity, requireAuthenticated, requireCsrf, asyncRoute(async (req, res) => {
  const user = await findUserById(req.auth!.actorId);
  if (!user || user.status === 'disabled') {
    res.status(401).json({ error: 'AUTH_REQUIRED' });
    return;
  }
  const environment = getAlpacaEnvironment();
  if (!environment.hasCredentials) {
    res.status(503).json({ error: 'ALPACA_NOT_CONFIGURED' });
    return;
  }
  try {
    const account = await getAlpacaAccount();
    const workspace = await connectAlpacaBroker(user, account as Record<string, unknown>, environment.paper);
    await recordAuditFromRequest(req, { actorId: req.auth!.actorId, action: 'ALPACA_BROKER_CONNECTED', targetType: 'workspace', targetId: workspace.organization.id, meta: { paper: environment.paper } });
    res.json({ workspace });
  } catch {
    await recordAuditFromRequest(req, { actorId: req.auth!.actorId, action: 'ALPACA_BROKER_CONNECTION_FAILED', targetType: 'workspace', outcome: 'failure' });
    res.status(502).json({ error: 'ALPACA_CONNECTION_FAILED' });
  }
}));

identityRouter.post('/onboarding/complete', requireMongoIdentity, requireAuthenticated, requireCsrf, asyncRoute(async (req, res) => {
  const user = await findUserById(req.auth!.actorId);
  if (!user || user.status === 'disabled') {
    res.status(401).json({ error: 'AUTH_REQUIRED' });
    return;
  }
  const workspace = await completeUserOnboarding(user);
  if (!workspace) {
    res.status(409).json({ error: 'BROKER_CONNECTION_REQUIRED' });
    return;
  }
  await recordAuditFromRequest(req, { actorId: req.auth!.actorId, action: 'ONBOARDING_COMPLETED', targetType: 'workspace', targetId: workspace.organization.id });
  res.json({ workspace, user: toPublicUser(user) });
}));

identityRouter.patch('/profile', requireMongoIdentity, requireAuthenticated, requireCsrf, asyncRoute(async (req, res) => {
  const user = await updateProfile(req.auth!.actorId, {
    name: req.body?.name,
    avatarUrl: req.body?.avatarUrl,
    timezone: req.body?.timezone,
    tradingExperience: req.body?.tradingExperience,
    preferredTheme: req.body?.preferredTheme,
    workspaceName: req.body?.workspaceName,
  });
  if (!user) {
    res.status(404).json({ error: 'USER_NOT_FOUND' });
    return;
  }
  await recordAuditFromRequest(req, {
    actorId: req.auth!.actorId,
    action: 'PROFILE_UPDATED',
    targetType: 'user',
    targetId: req.auth!.actorId,
  });
  res.json({ user: toPublicUser(user) });
}));

identityRouter.get('/sessions', requireMongoIdentity, requireAuthenticated, asyncRoute(async (req, res) => {
  res.json({ sessions: await listActiveSessions(req.auth!.actorId, req.auth!.sessionId) });
}));

identityRouter.delete('/sessions/:id', requireMongoIdentity, requireAuthenticated, requireCsrf, asyncRoute(async (req, res) => {
  const revoked = await revokeSessionById(req.auth!.actorId, req.params.id);
  await recordAuditFromRequest(req, {
    actorId: req.auth!.actorId,
    action: 'SESSION_REVOKED',
    outcome: revoked ? 'success' : 'failure',
    targetType: 'session',
    targetId: req.params.id,
  });
  res.status(revoked ? 200 : 404).json({ ok: revoked });
}));

identityRouter.post('/verify-email', requireMongoIdentity, requireCsrf, authRateLimit(20), asyncRoute(async (req, res) => {
  const user = await verifyEmailWithToken(stringBody(req.body?.token, 512));
  if (!user) {
    res.status(400).json({ error: 'INVALID_OR_EXPIRED_TOKEN' });
    return;
  }
  await recordAuditFromRequest(req, {
    actorId: String(user._id),
    action: 'EMAIL_VERIFIED',
    targetType: 'user',
    targetId: String(user._id),
  });
  res.json({ ok: true, user: toPublicUser(user) });
}));

identityRouter.post('/resend-verification', requireMongoIdentity, requireCsrf, authRateLimit(5), asyncRoute(async (req, res) => {
  const email = stringBody(req.body?.email, 320).toLowerCase();
  const user = isEmail(email) ? await findUserByEmail(email) : null;
  if (user && !user.emailVerified && user.status !== 'disabled') {
    await sendVerificationEmail(user.email, await issueVerificationToken(String(user._id)));
  }
  res.json({ ok: true });
}));

identityRouter.post('/forgot-password', requireMongoIdentity, requireCsrf, authRateLimit(5), asyncRoute(async (req, res) => {
  const email = stringBody(req.body?.email, 320).toLowerCase();
  const user = isEmail(email) ? await findUserByEmail(email) : null;
  if (user && user.status !== 'disabled') {
    await sendPasswordResetEmail(user.email, await issueResetToken(String(user._id)));
    await recordAuditFromRequest(req, {
      actorId: String(user._id),
      action: 'PASSWORD_RESET_REQUESTED',
      targetType: 'user',
      targetId: String(user._id),
    });
  }
  res.json({ ok: true });
}));

identityRouter.post('/reset-password', requireMongoIdentity, requireCsrf, authRateLimit(10), asyncRoute(async (req, res) => {
  const password = String(req.body?.password ?? '');
  const policy = checkPasswordPolicy(password);
  if (!policy.ok) {
    res.status(400).json({ error: 'PASSWORD_POLICY_FAILED', message: policy.reason });
    return;
  }
  const user = await resetPasswordWithToken(stringBody(req.body?.token, 512), password);
  if (!user) {
    res.status(400).json({ error: 'INVALID_OR_EXPIRED_TOKEN' });
    return;
  }
  await revokeAllUserSessions(String(user._id));
  await recordAuditFromRequest(req, {
    actorId: String(user._id),
    action: 'PASSWORD_RESET',
    targetType: 'user',
    targetId: String(user._id),
  });
  res.json({ ok: true });
}));

identityRouter.get('/google', requireMongoIdentity, authRateLimit(20), asyncRoute(async (req, res) => {
  if (!isGoogleOAuthConfigured()) {
    res.status(503).json({ error: 'GOOGLE_OAUTH_NOT_CONFIGURED' });
    return;
  }
  res.redirect(await beginGoogleOAuth(String(req.query.returnTo ?? '/')));
}));

identityRouter.get('/google/callback', requireMongoIdentity, authRateLimit(40), asyncRoute(async (req, res) => {
  const code = stringBody(req.query.code, 4096);
  const state = verifyGoogleOAuthState(stringBody(req.query.state, 2048));
  if (!code || !state) {
    res.redirect(`${getIdentityConfig().appBaseUrl}/auth/login?error=oauth_state`);
    return;
  }
  try {
    const codeVerifier = await consumeGoogleOAuthAttempt(stringBody(req.query.state, 2048));
    if (!codeVerifier) {
      res.redirect(`${getIdentityConfig().appBaseUrl}/auth/login?error=oauth_state`);
      return;
    }
    const profile = await exchangeGoogleCode(code, codeVerifier, state.nonce);
    const user = await upsertOAuthUser(profile);
    await recordSuccessfulLogin(user);
    const tokens = await createSession(user, true, req);
    setSessionCookies(res, tokens);
    await recordAuditFromRequest(req, {
      actorId: String(user._id),
      action: 'GOOGLE_LOGIN',
      targetType: 'session',
      targetId: tokens.sessionId,
    });
    res.redirect(`${getIdentityConfig().appBaseUrl}${normalizeReturnTo(state.returnTo)}`);
  } catch {
    res.redirect(`${getIdentityConfig().appBaseUrl}/auth/login?error=google`);
  }
}));

export default identityRouter;
