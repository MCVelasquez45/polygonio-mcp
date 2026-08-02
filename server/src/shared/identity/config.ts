// Identity Platform configuration (Phase 1).
//
// All values are env-driven with safe defaults for local development. Secrets
// that are required only when enforcement is `required` (see requestIdentity)
// are validated lazily at point of use so the server still boots in observe
// mode without them.

import { createHash } from 'crypto';

export type IdentityConfig = {
  /** Signing secret for short-lived access JWTs. */
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  accessTokenTtlSec: number;
  /** Refresh token lifetimes. */
  refreshTtlSec: number; // standard session
  rememberMeTtlSec: number; // remember-me session
  /** One-time email token lifetimes. */
  verifyTokenTtlSec: number;
  resetTokenTtlSec: number;
  /** 32-byte AES-256-GCM master key (base64) for envelope encryption. */
  encryptionKey: Buffer | null;
  /** Public base URLs used to build links + OAuth redirects. */
  appBaseUrl: string; // where the SPA lives (email links, oauth success redirect)
  apiBaseUrl: string; // where this API is reachable (oauth callback)
  /** Cookie behavior. */
  cookieDomain: string | undefined;
  cookieSecure: boolean;
  /** Argon2id tuning. */
  argonMemoryCost: number;
  argonTimeCost: number;
  argonParallelism: number;
  /** Lockout policy. */
  maxFailedLogins: number;
  lockoutMs: number;
  /** Auth-endpoint IP rate limit. */
  rateLimitWindowMs: number;
  rateLimitMax: number;
  /** Google OAuth. */
  googleProjectId: string | null;
  googleClientId: string | null;
  googleClientSecret: string | null;
  googleRedirectUri: string | null;
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function envStr(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
}

function envOptional(name: string): string | null {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : null;
}

function parseEncryptionKey(): Buffer | null {
  const raw = envOptional('IDENTITY_ENCRYPTION_KEY');
  if (!raw) {
    const legacySessionSecret = envOptional('SESSION_SECRET');
    if (process.env.NODE_ENV !== 'production' && legacySessionSecret) {
      return createHash('sha256')
        .update('ai-trader:identity-encryption:v1\0', 'utf8')
        .update(legacySessionSecret, 'utf8')
        .digest();
    }
    return null;
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(
      'IDENTITY_ENCRYPTION_KEY must be a base64-encoded 32-byte key (AES-256). ' +
        `Got ${buf.length} bytes. Generate with: openssl rand -base64 32`
    );
  }
  return buf;
}

let cached: IdentityConfig | null = null;

export function getIdentityConfig(): IdentityConfig {
  if (cached) return cached;

  // In development we allow an ephemeral JWT secret so the server boots; it is
  // regenerated per process (invalidates tokens on restart) — acceptable for
  // dev, never for production. Production MUST set IDENTITY_JWT_SECRET.
  const jwtSecret =
    envOptional('IDENTITY_JWT_SECRET') ??
    (process.env.NODE_ENV !== 'production' ? envOptional('SESSION_SECRET') : null);
  const resolvedJwtSecret =
    jwtSecret ??
    (process.env.NODE_ENV === 'production'
      ? throwMissing('IDENTITY_JWT_SECRET')
      : `dev-insecure-${process.pid}-${Date.now()}`);

  const appBaseUrl = stripSlash(
    envStr('IDENTITY_APP_BASE_URL', envStr('CLIENT_ORIGIN', 'http://localhost:5173'))
  );
  const apiBaseUrl = stripSlash(envStr('IDENTITY_API_BASE_URL', 'http://localhost:4000'));

  cached = {
    jwtSecret: resolvedJwtSecret,
    jwtIssuer: envStr('IDENTITY_JWT_ISSUER', 'ai-trader-identity'),
    jwtAudience: envStr('IDENTITY_JWT_AUDIENCE', 'ai-trader'),
    accessTokenTtlSec: envInt('IDENTITY_ACCESS_TTL_SEC', 15 * 60),
    refreshTtlSec: envInt('IDENTITY_REFRESH_TTL_SEC', 12 * 60 * 60),
    rememberMeTtlSec: envInt('IDENTITY_REMEMBER_TTL_SEC', 30 * 24 * 60 * 60),
    verifyTokenTtlSec: envInt('IDENTITY_VERIFY_TTL_SEC', 24 * 60 * 60),
    resetTokenTtlSec: envInt('IDENTITY_RESET_TTL_SEC', 60 * 60),
    encryptionKey: parseEncryptionKey(),
    appBaseUrl,
    apiBaseUrl,
    cookieDomain: envOptional('IDENTITY_COOKIE_DOMAIN') ?? undefined,
    cookieSecure:
      envOptional('IDENTITY_COOKIE_SECURE') !== null
        ? envStr('IDENTITY_COOKIE_SECURE', 'false').toLowerCase() === 'true'
        : process.env.NODE_ENV === 'production',
    argonMemoryCost: envInt('IDENTITY_ARGON_MEMORY_KIB', 19456),
    argonTimeCost: envInt('IDENTITY_ARGON_TIME_COST', 2),
    argonParallelism: envInt('IDENTITY_ARGON_PARALLELISM', 1),
    maxFailedLogins: envInt('IDENTITY_MAX_FAILED_LOGINS', 5),
    lockoutMs: envInt('IDENTITY_LOCKOUT_MS', 15 * 60 * 1000),
    rateLimitWindowMs: envInt('IDENTITY_RATE_WINDOW_MS', 60 * 1000),
    rateLimitMax: envInt('IDENTITY_RATE_MAX', 20),
    googleProjectId: envOptional('GOOGLE_PROJECT_ID'),
    googleClientId: envOptional('GOOGLE_CLIENT_ID'),
    googleClientSecret: envOptional('GOOGLE_CLIENT_SECRET'),
    googleRedirectUri:
      envOptional('GOOGLE_REDIRECT_URI') ??
      envOptional('GOOGLE_CALLBACK_URL') ??
      `${apiBaseUrl}/api/auth/google/callback`,
  };
  return cached;
}

/** Test/hot-reload helper: clears the memoized config. */
export function resetIdentityConfigCache(): void {
  cached = null;
}

export function isGoogleOAuthConfigured(): boolean {
  const cfg = getIdentityConfig();
  return Boolean(cfg.googleClientId && cfg.googleClientSecret && cfg.googleRedirectUri);
}

function throwMissing(name: string): never {
  throw new Error(`${name} is required in production for the Identity Platform.`);
}

function stripSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
