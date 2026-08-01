// Double-submit CSRF protection for cookie-authenticated auth endpoints.
//
// The SPA reads the `id_csrf` cookie and echoes it in the `X-CSRF-Token`
// header. This middleware verifies (timing-safe) that the header matches the
// cookie. Bearer-authenticated API calls carry no ambient cookie authority and
// are therefore not CSRF-vulnerable — only endpoints that trust the refresh
// cookie need this guard.

import type { NextFunction, Request, Response } from 'express';
import { CSRF_COOKIE } from './cookies';
import { safeEquals } from './crypto';

export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.[CSRF_COOKIE];
  const headerToken = req.header('x-csrf-token');
  if (!cookieToken || !headerToken || !safeEquals(cookieToken, headerToken)) {
    res.status(403).json({ error: 'CSRF_VALIDATION_FAILED' });
    return;
  }
  next();
}
