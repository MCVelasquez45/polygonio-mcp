// Secure cookie helpers for the Identity Platform.
//
// Two cookies (see docs/identity/ARCHITECTURE.md §4):
//   id_refresh — HttpOnly refresh token, scoped to /api/auth
//   id_csrf    — JS-readable double-submit CSRF token, scoped to /
//
// `Secure` follows config (true in production / HTTPS). `SameSite=Lax` permits
// the top-level OAuth redirect to carry the cookie while blocking cross-site
// POST forgery.

import type { Response } from 'express';
import type { CookieOptions } from 'express';
import { getIdentityConfig } from './config';

export const REFRESH_COOKIE = 'id_refresh';
export const CSRF_COOKIE = 'id_csrf';
export const REFRESH_COOKIE_PATH = '/api/auth';

function baseOptions(): CookieOptions {
  const cfg = getIdentityConfig();
  return {
    secure: cfg.cookieSecure,
    sameSite: 'lax',
    domain: cfg.cookieDomain,
  };
}

export function setRefreshCookie(res: Response, token: string, maxAgeSec: number): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...baseOptions(),
    httpOnly: true,
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeSec * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    ...baseOptions(),
    httpOnly: true,
    path: REFRESH_COOKIE_PATH,
  });
}

export function setCsrfCookie(res: Response, token: string, maxAgeSec: number): void {
  res.cookie(CSRF_COOKIE, token, {
    ...baseOptions(),
    httpOnly: false, // must be readable by the SPA to echo into X-CSRF-Token
    path: '/',
    maxAge: maxAgeSec * 1000,
  });
}

export function clearCsrfCookie(res: Response): void {
  res.clearCookie(CSRF_COOKIE, { ...baseOptions(), httpOnly: false, path: '/' });
}
