// Access-token (JWT) signing + verification for the Identity Platform.
//
// Access tokens are short-lived and STATELESS: no DB hit per request. The `sid`
// claim ties an access token to its refresh session so a revoked session's
// access tokens age out within the (short) TTL window.

import jwt from 'jsonwebtoken';
import { getIdentityConfig } from './config';
import type { IdentityRole } from './rbac';

export type AccessTokenClaims = {
  sub: string; // userId
  sid: string; // sessionId (refresh family)
  roles: IdentityRole[];
  wsp?: string; // workspace name (convenience)
  typ: 'access';
};

export function signAccessToken(claims: AccessTokenClaims): string {
  const cfg = getIdentityConfig();
  return jwt.sign(claims, cfg.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: cfg.accessTokenTtlSec,
    issuer: cfg.jwtIssuer,
    audience: cfg.jwtAudience,
  });
}

export type VerifiedAccessToken = AccessTokenClaims & { iat: number; exp: number };

export function verifyAccessToken(token: string): VerifiedAccessToken | null {
  const cfg = getIdentityConfig();
  try {
    const decoded = jwt.verify(token, cfg.jwtSecret, {
      algorithms: ['HS256'],
      issuer: cfg.jwtIssuer,
      audience: cfg.jwtAudience,
    });
    if (typeof decoded !== 'object' || decoded === null) return null;
    const claims = decoded as jwt.JwtPayload & Partial<AccessTokenClaims>;
    if (claims.typ !== 'access' || typeof claims.sub !== 'string' || typeof claims.sid !== 'string') {
      return null;
    }
    return {
      sub: claims.sub,
      sid: claims.sid,
      roles: Array.isArray(claims.roles) ? (claims.roles as IdentityRole[]) : [],
      wsp: typeof claims.wsp === 'string' ? claims.wsp : undefined,
      typ: 'access',
      iat: claims.iat ?? 0,
      exp: claims.exp ?? 0,
    };
  } catch {
    return null;
  }
}
