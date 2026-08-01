import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setAccessToken } from './tokenStore';
import * as authApi from './authApi';
import type { AuthSession, PublicUser, SessionSummary, WorkspaceSummary } from './authApi';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

type AuthContextValue = {
  status: AuthStatus;
  user: PublicUser | null;
  googleConfigured: boolean;
  googleClientId: string | null;
  login: (input: { email: string; password: string; rememberMe?: boolean }) => Promise<void>;
  register: typeof authApi.register;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refresh: () => Promise<void>;
  verifyEmail: (token: string) => Promise<void>;
  forgotPassword: typeof authApi.forgotPassword;
  resetPassword: typeof authApi.resetPassword;
  resendVerification: typeof authApi.resendVerification;
  updateProfile: (patch: Partial<PublicUser['profile']>) => Promise<void>;
  listSessions: () => Promise<SessionSummary[]>;
  getWorkspace: () => Promise<WorkspaceSummary>;
  revokeSession: (id: string) => Promise<void>;
  signInWithGoogle: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const TEST_USER: PublicUser = {
  id: 'test-user',
  email: 'test@example.com',
  emailVerified: true,
  status: 'active',
  roles: ['admin'],
  profile: {
    name: 'Test Operator',
    avatarUrl: null,
    timezone: 'UTC',
    tradingExperience: 'professional',
    preferredTheme: 'dark',
    workspaceName: 'Test Workspace',
  },
  hasPassword: true,
  oauthProviders: [],
  lastLoginAt: null,
  createdAt: new Date(0).toISOString(),
};

function shouldUseTestIdentity(): boolean {
  const e2eIdentity =
    import.meta.env.MODE !== 'production' &&
    import.meta.env.VITE_E2E_TEST_IDENTITY === 'true';
  return (import.meta.env.MODE === 'test' || e2eIdentity) && typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth');
}

function applySession(session: AuthSession, setUser: (user: PublicUser | null) => void, setStatus: (status: AuthStatus) => void): void {
  setAccessToken(session.accessToken);
  setUser(session.user);
  setStatus('authenticated');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const testIdentity = shouldUseTestIdentity();
  const [status, setStatus] = useState<AuthStatus>(testIdentity ? 'authenticated' : 'loading');
  const [user, setUser] = useState<PublicUser | null>(testIdentity ? TEST_USER : null);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const session = await authApi.refreshSession();
    applySession(session, setUser, setStatus);
  }, []);

  useEffect(() => {
    if (testIdentity) return;
    let cancelled = false;
    authApi
      .getAuthConfig()
      .then(config => {
        if (cancelled) return;
        setGoogleConfigured(config.googleConfigured);
        setGoogleClientId(config.googleClientId);
      })
      .catch(() => undefined);

    refresh()
      .catch(() => {
        if (cancelled) return;
        setAccessToken(null);
        setUser(null);
        setStatus('anonymous');
      });
    return () => {
      cancelled = true;
    };
  }, [refresh, testIdentity]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      googleConfigured,
      googleClientId,
      login: async input => {
        const session = await authApi.login(input);
        applySession(session, setUser, setStatus);
      },
      register: authApi.register,
      logout: async () => {
        try {
          await authApi.logout();
        } finally {
          setAccessToken(null);
          setUser(null);
          setStatus('anonymous');
        }
      },
      logoutAll: async () => {
        try {
          await authApi.logoutAll();
        } finally {
          setAccessToken(null);
          setUser(null);
          setStatus('anonymous');
        }
      },
      refresh,
      verifyEmail: async token => {
        await authApi.verifyEmail(token);
      },
      forgotPassword: authApi.forgotPassword,
      resetPassword: authApi.resetPassword,
      resendVerification: authApi.resendVerification,
      updateProfile: async patch => {
        const next = await authApi.updateProfile(patch);
        setUser(next);
      },
      listSessions: authApi.listSessions,
      getWorkspace: authApi.getWorkspace,
      revokeSession: authApi.revokeSession,
      signInWithGoogle: () => authApi.googleRedirect(window.location.pathname + window.location.search),
    }),
    [googleClientId, googleConfigured, refresh, status, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
