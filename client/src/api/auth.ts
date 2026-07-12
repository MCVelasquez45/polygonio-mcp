export type AuthRole = 'viewer' | 'trader' | 'admin';

export type AuthSnapshot = {
  token: string;
  role: AuthRole;
};

const AUTH_TOKEN_KEY = 'market-copilot.authToken';
const AUTH_ROLE_KEY = 'market-copilot.authRole';
const AUTH_ROLES: AuthRole[] = ['viewer', 'trader', 'admin'];

function isAuthRole(value: unknown): value is AuthRole {
  return typeof value === 'string' && AUTH_ROLES.includes(value as AuthRole);
}

function readLocalStorage(key: string): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(key)?.trim() ?? '';
  } catch {
    return '';
  }
}

function writeLocalStorage(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // ignore persistence failures
  }
}

function readEnv(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split('.');
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`;
    return JSON.parse(window.atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function roleFromToken(token: string): AuthRole | null {
  if (!token || typeof window === 'undefined') return null;
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  if (isAuthRole(payload.role)) return payload.role;
  if (Array.isArray(payload.roles)) {
    if (payload.roles.includes('admin')) return 'admin';
    if (payload.roles.includes('trader')) return 'trader';
    if (payload.roles.includes('viewer')) return 'viewer';
  }
  return null;
}

export function getAuthToken(): string {
  return readLocalStorage(AUTH_TOKEN_KEY) || readEnv(import.meta.env.VITE_AUTH_TOKEN);
}

export function setAuthToken(token: string) {
  writeLocalStorage(AUTH_TOKEN_KEY, token.trim());
}

export function getAuthRole(): AuthRole {
  const stored = readLocalStorage(AUTH_ROLE_KEY);
  if (isAuthRole(stored)) return stored;

  const envRole = readEnv(import.meta.env.VITE_AUTH_ROLE);
  if (isAuthRole(envRole)) return envRole;

  return roleFromToken(getAuthToken()) ?? 'viewer';
}

export function setAuthRole(role: AuthRole) {
  writeLocalStorage(AUTH_ROLE_KEY, role);
}

export function getAuthSnapshot(): AuthSnapshot {
  return {
    token: getAuthToken(),
    role: getAuthRole()
  };
}

export function getSocketAuth() {
  const token = getAuthToken();
  return token ? { token } : undefined;
}

export function canTrade(role: AuthRole) {
  return role === 'trader' || role === 'admin';
}

export function canAdmin(role: AuthRole) {
  return role === 'admin';
}

