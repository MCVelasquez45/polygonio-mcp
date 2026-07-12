import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export const AUTH_ROLES = ['viewer', 'trader', 'admin'] as const;
export type AuthRole = (typeof AUTH_ROLES)[number];

export type AuthUser = {
  subject: string;
  role: AuthRole;
  tokenType: 'jwt' | 'development';
  issuer?: string;
  audience?: string | string[];
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

type JwtPayload = {
  sub?: unknown;
  role?: unknown;
  roles?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iss?: unknown;
  aud?: unknown;
};

const ROLE_RANK: Record<AuthRole, number> = {
  viewer: 0,
  trader: 1,
  admin: 2
};

function isAuthRole(value: unknown): value is AuthRole {
  return typeof value === 'string' && (AUTH_ROLES as readonly string[]).includes(value);
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function envFlag(name: string) {
  return String(process.env[name] ?? '').trim().toLowerCase() === 'true';
}

function getJwtSecret() {
  const secret = process.env.AUTH_JWT_SECRET?.trim();
  return secret || null;
}

function normalizeBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  return `${base64}${padding}`;
}

function parseBase64UrlJson<T>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(normalizeBase64Url(value), 'base64').toString('utf8')) as T;
  } catch {
    return null;
  }
}

function toBase64Url(buffer: Buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function timingSafeEqualString(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function resolveDevToken(token: string): AuthUser | null {
  if (!envFlag('AUTH_ALLOW_DEV_TOKENS') || isProduction()) {
    return null;
  }

  const devTokens: Record<AuthRole, string> = {
    viewer: process.env.AUTH_DEV_VIEWER_TOKEN?.trim() || 'dev-viewer-token',
    trader: process.env.AUTH_DEV_TRADER_TOKEN?.trim() || 'dev-trader-token',
    admin: process.env.AUTH_DEV_ADMIN_TOKEN?.trim() || 'dev-admin-token'
  };

  for (const role of AUTH_ROLES) {
    if (timingSafeEqualString(token, devTokens[role])) {
      return {
        subject: `development:${role}`,
        role,
        tokenType: 'development'
      };
    }
  }

  return null;
}

function resolveRole(payload: JwtPayload): AuthRole | null {
  if (isAuthRole(payload.role)) {
    return payload.role;
  }
  if (Array.isArray(payload.roles)) {
    return payload.roles
      .filter(isAuthRole)
      .sort((left, right) => ROLE_RANK[right] - ROLE_RANK[left])[0] ?? null;
  }
  return null;
}

function audienceMatches(actual: unknown, expected: string) {
  if (typeof actual === 'string') return actual === expected;
  if (Array.isArray(actual)) return actual.includes(expected);
  return false;
}

function verifyJwt(token: string): AuthUser | null {
  const secret = getJwtSecret();
  if (!secret) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const header = parseBase64UrlJson<{ alg?: unknown; typ?: unknown }>(encodedHeader);
  const payload = parseBase64UrlJson<JwtPayload>(encodedPayload);
  if (!header || !payload || header.alg !== 'HS256') return null;

  const expectedSignature = toBase64Url(
    crypto.createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`).digest()
  );
  if (!timingSafeEqualString(signature, expectedSignature)) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp <= now) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > now) return null;

  const expectedIssuer = process.env.AUTH_JWT_ISSUER?.trim();
  if (expectedIssuer && payload.iss !== expectedIssuer) return null;

  const expectedAudience = process.env.AUTH_JWT_AUDIENCE?.trim();
  if (expectedAudience && !audienceMatches(payload.aud, expectedAudience)) return null;

  const role = resolveRole(payload);
  if (!role) return null;

  const subject = typeof payload.sub === 'string' && payload.sub.trim() ? payload.sub.trim() : `jwt:${role}`;
  return {
    subject,
    role,
    tokenType: 'jwt',
    issuer: typeof payload.iss === 'string' ? payload.iss : undefined,
    audience: typeof payload.aud === 'string' || Array.isArray(payload.aud) ? payload.aud : undefined
  };
}

export function authenticateToken(token: string | null | undefined): AuthUser | null {
  const normalized = token?.trim();
  if (!normalized) return null;
  return resolveDevToken(normalized) ?? verifyJwt(normalized);
}

export function getBearerToken(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function getRequestToken(req: Request): string | null {
  return getBearerToken(req.header('authorization')) ?? req.header('x-auth-token')?.trim() ?? null;
}

function unauthorized(res: Response, message = 'Missing or invalid authentication token') {
  return res.status(401).json({ error: 'Unauthorized', message });
}

function forbidden(res: Response) {
  return res.status(403).json({ error: 'Forbidden', message: 'Insufficient permissions' });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = authenticateToken(getRequestToken(req));
  if (!user) {
    return unauthorized(res);
  }
  req.user = user;
  next();
}

export function roleAtLeast(role: AuthRole, minimum: AuthRole) {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function requireMinimumRole(minimum: AuthRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = getRequestToken(req);
    const user = authenticateToken(token);
    if (!user) {
      return unauthorized(res, token ? 'Invalid authentication token' : 'Missing authentication token');
    }
    if (!roleAtLeast(user.role, minimum)) {
      return forbidden(res);
    }
    req.user = user;
    next();
  };
}

export const requireViewer = requireMinimumRole('viewer');
export const requireTrader = requireMinimumRole('trader');
export const requireAdmin = requireMinimumRole('admin');

