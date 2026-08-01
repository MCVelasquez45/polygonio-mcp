import type { NextFunction, Request, Response } from 'express';
import { isMongoReady } from '../../shared/db/mongo';
import { rolesHaveAllPermissions, type IdentityRole, type Permission } from '../../shared/identity/rbac';

export function requireMongoIdentity(req: Request, res: Response, next: NextFunction): void {
  if (!isMongoReady()) {
    res.status(503).json({ error: 'IDENTITY_STORE_UNAVAILABLE' });
    return;
  }
  next();
}

export function requireAuthenticated(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth?.authenticated) {
    res.status(401).json({ error: 'AUTH_REQUIRED' });
    return;
  }
  next();
}

export function requirePermissions(required: Permission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth?.authenticated) {
      res.status(401).json({ error: 'AUTH_REQUIRED' });
      return;
    }
    const identityRoles = req.auth.roles
      .map<IdentityRole>(role => {
        if (role === 'administrator') return 'admin';
        if (role === 'operator') return 'trader';
        return role;
      });
    if (!rolesHaveAllPermissions(identityRoles, required)) {
      res.status(403).json({ error: 'PERMISSION_DENIED', required });
      return;
    }
    next();
  };
}
