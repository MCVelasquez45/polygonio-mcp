// Role-Based Access Control matrix (Phase 1).
//
// Roles are GLOBAL in Phase 1 (org-scoped roles arrive with the memberships
// layer). This module is the single source of truth for the role->permission
// mapping; it is mirrored into the seeded `identity_roles` collection for
// queryability, but authorization logic reads from here (fast, no DB hit).

import type { AuthRole as LegacyAuthRole } from '../auth/requestIdentity';

export const IDENTITY_ROLES = ['viewer', 'analyst', 'trader', 'admin'] as const;
export type IdentityRole = (typeof IDENTITY_ROLES)[number];

export const PERMISSIONS = [
  'workspace:read',
  'market:read',
  'portfolio:read',
  'intelligence:read',
  'research:run',
  'order:create',
  'automation:control',
  'watchlist:write',
  'user:manage',
  'role:assign',
  'audit:read',
  'org:manage',
  'system:admin',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// Direct (non-inherited) grants per role.
const DIRECT_GRANTS: Record<IdentityRole, Permission[]> = {
  viewer: ['workspace:read', 'market:read', 'portfolio:read'],
  analyst: ['intelligence:read', 'research:run'],
  trader: ['order:create', 'automation:control', 'watchlist:write'],
  admin: ['user:manage', 'role:assign', 'audit:read', 'org:manage', 'system:admin'],
};

// Inheritance chain: admin ⊃ trader ⊃ analyst ⊃ viewer.
const INHERITS: Record<IdentityRole, IdentityRole[]> = {
  viewer: [],
  analyst: ['viewer'],
  trader: ['analyst'],
  admin: ['trader'],
};

function expandRole(role: IdentityRole, seen = new Set<IdentityRole>()): Permission[] {
  if (seen.has(role)) return [];
  seen.add(role);
  const perms = new Set<Permission>(DIRECT_GRANTS[role]);
  for (const parent of INHERITS[role]) {
    for (const p of expandRole(parent, seen)) perms.add(p);
  }
  return Array.from(perms);
}

const EFFECTIVE_PERMISSIONS: Record<IdentityRole, Permission[]> = Object.fromEntries(
  IDENTITY_ROLES.map(role => [role, expandRole(role)])
) as Record<IdentityRole, Permission[]>;

export function isIdentityRole(value: unknown): value is IdentityRole {
  return typeof value === 'string' && (IDENTITY_ROLES as readonly string[]).includes(value);
}

export function normalizeRoles(input: unknown): IdentityRole[] {
  const arr = Array.isArray(input) ? input : [input];
  const roles = arr.filter(isIdentityRole);
  return roles.length ? Array.from(new Set(roles)) : ['viewer'];
}

/** All effective permissions granted by a set of roles (with inheritance). */
export function permissionsForRoles(roles: IdentityRole[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const role of roles) {
    for (const p of EFFECTIVE_PERMISSIONS[role] ?? []) out.add(p);
  }
  return out;
}

export function rolesHaveAllPermissions(roles: IdentityRole[], required: Permission[]): boolean {
  const granted = permissionsForRoles(roles);
  return required.every(p => granted.has(p));
}

export function rolesHaveAnyRole(roles: IdentityRole[], required: IdentityRole[]): boolean {
  return roles.some(r => required.includes(r));
}

/** Seed payload for the `identity_roles` catalog collection. */
export function roleCatalog(): Array<{ key: IdentityRole; label: string; permissions: Permission[] }> {
  const labels: Record<IdentityRole, string> = {
    viewer: 'Viewer',
    analyst: 'Analyst',
    trader: 'Trader',
    admin: 'Administrator',
  };
  return IDENTITY_ROLES.map(key => ({
    key,
    label: labels[key],
    permissions: EFFECTIVE_PERMISSIONS[key],
  }));
}

// --- Interop with the legacy requestIdentity AuthRole union ------------------
// Existing consumers/logs expect roles from ('viewer'|'trader'|'operator'|
// 'administrator'). Map identity roles onto that union so req.auth.roles stays
// valid everywhere downstream.
const LEGACY_MAP: Record<IdentityRole, LegacyAuthRole> = {
  viewer: 'viewer',
  analyst: 'viewer',
  trader: 'trader',
  admin: 'administrator',
};

export function toLegacyRoles(roles: IdentityRole[]): LegacyAuthRole[] {
  const mapped = roles.map(r => LEGACY_MAP[r]);
  // admins additionally get 'operator' capabilities in the legacy union.
  if (roles.includes('admin') || roles.includes('trader')) mapped.push('operator');
  return Array.from(new Set(mapped));
}
