import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { writeStructuredLog } from '../logging/safeLogging';

export type AuthRole = 'viewer' | 'trader' | 'operator' | 'administrator';

export type AuthEnforcementMode = 'observe' | 'required';

export type RequestAuthContext = {
  authenticated: boolean;
  actorId: string;
  accountId: string;
  roles: AuthRole[];
  authMethod: 'bearer' | 'legacy-compatible';
  enforcementMode: AuthEnforcementMode;
};

export type RequestIdentityConfig = {
  enforcementMode: AuthEnforcementMode;
  staticToken: string | null;
  defaultActorId: string;
  defaultAccountId: string;
  defaultRoles: AuthRole[];
};

type RequestWithContext = Request & {
  requestId?: string;
  auth?: RequestAuthContext;
};

declare module 'express-serve-static-core' {
  interface Request {
    auth?: RequestAuthContext;
  }
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ROLE_SET = new Set<AuthRole>(['viewer', 'trader', 'operator', 'administrator']);

export function createRequestIdentityMiddleware(config = resolveRequestIdentityConfig()) {
  return (req: RequestWithContext, res: Response, next: NextFunction): void => {
    const identity = resolveRequestIdentity(req, config);
    req.auth = identity;

    if (shouldRequireAuthentication(req, config) && !identity.authenticated) {
      const missingConfig = !config.staticToken;
      const status = missingConfig ? 503 : 401;
      const error = missingConfig ? 'AUTH_CONFIGURATION_REQUIRED' : 'AUTH_REQUIRED';
      writeStructuredLog({
        component: 'server',
        module: 'auth',
        event: 'AUTH_REQUEST_REJECTED',
        severity: missingConfig ? 'error' : 'warning',
        requestId: req.requestId,
        context: {
          method: req.method,
          path: req.originalUrl,
          reason: error,
          actorId: identity.actorId,
          accountId: identity.accountId,
        },
      });
      res.status(status).json({ error });
      return;
    }

    next();
  };
}

export function resolveRequestIdentityConfig(env: NodeJS.ProcessEnv = process.env): RequestIdentityConfig {
  const mode = normalizeMode(env.AI_TRADER_AUTH_ENFORCEMENT ?? env.AI_TRADER_AUTH_MODE);
  return {
    enforcementMode: mode,
    staticToken: normalizeOptionalSecret(env.AI_TRADER_AUTH_TOKEN ?? env.AI_TRADER_OPERATOR_TOKEN),
    defaultActorId: normalizeIdentifier(env.AI_TRADER_DEFAULT_ACTOR_ID, 'legacy-operator'),
    defaultAccountId: normalizeIdentifier(env.AI_TRADER_DEFAULT_ACCOUNT_ID, 'paper-default'),
    defaultRoles: parseRoles(env.AI_TRADER_DEFAULT_ROLES, ['administrator']),
  };
}

export function resolveRequestIdentity(req: Request, config: RequestIdentityConfig): RequestAuthContext {
  const providedToken = extractBearerToken(req.header('authorization'));
  if (providedToken && config.staticToken && tokenEquals(providedToken, config.staticToken)) {
    return {
      authenticated: true,
      actorId: normalizeIdentifier(req.header('x-ai-trader-actor-id'), config.defaultActorId),
      accountId: normalizeIdentifier(req.header('x-ai-trader-account-id'), config.defaultAccountId),
      roles: parseRoles(req.header('x-ai-trader-roles'), config.defaultRoles),
      authMethod: 'bearer',
      enforcementMode: config.enforcementMode,
    };
  }

  return {
    authenticated: false,
    actorId: config.defaultActorId,
    accountId: config.defaultAccountId,
    roles: config.defaultRoles,
    authMethod: 'legacy-compatible',
    enforcementMode: config.enforcementMode,
  };
}

export function shouldRequireAuthentication(req: Request, config: RequestIdentityConfig): boolean {
  if (config.enforcementMode !== 'required') return false;
  if (!UNSAFE_METHODS.has(req.method.toUpperCase())) return false;
  const path = req.originalUrl || req.path || '';
  return path === '/api' || path.startsWith('/api/');
}

function normalizeMode(value: string | undefined): AuthEnforcementMode {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'required' || normalized === 'enforced' || normalized === 'true' || normalized === '1'
    ? 'required'
    : 'observe';
}

function normalizeOptionalSecret(value: string | undefined): string | null {
  const normalized = String(value ?? '').trim();
  return normalized.length ? normalized : null;
}

function extractBearerToken(header: string | undefined): string | null {
  const match = String(header ?? '').match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function tokenEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeIdentifier(value: string | undefined, fallback: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return fallback;
  return normalized.replace(/[^\w.:@-]/g, '_').slice(0, 128) || fallback;
}

function parseRoles(value: string | undefined, fallback: AuthRole[]): AuthRole[] {
  const roles = String(value ?? '')
    .split(',')
    .map(role => role.trim().toLowerCase())
    .filter((role): role is AuthRole => ROLE_SET.has(role as AuthRole));
  return roles.length ? Array.from(new Set(roles)) : fallback;
}
