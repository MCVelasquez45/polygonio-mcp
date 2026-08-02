import { http, getApiBaseUrl } from '../api/http';

export type IdentityRole = 'viewer' | 'analyst' | 'trader' | 'admin';

export type PublicUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  status: 'pending' | 'active' | 'disabled';
  roles: IdentityRole[];
  profile: {
    name: string;
    avatarUrl: string | null;
    timezone: string;
    tradingExperience: 'none' | 'beginner' | 'intermediate' | 'advanced' | 'professional';
    preferredTheme: 'dark' | 'light' | 'system';
    workspaceName: string;
  };
  hasPassword: boolean;
  oauthProviders: string[];
  lastLoginAt: string | null;
  createdAt: string;
  firstLogin: boolean;
  onboardingCompletedAt: string | null;
};

export type AuthSession = {
  accessToken: string;
  accessTokenExpiresInSec: number;
  sessionId: string;
  user: PublicUser;
};

export type SessionSummary = {
  id: string;
  current: boolean;
  device: { ua: string; ip: string };
  rememberMe: boolean;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
};

export type BrokerProvider = 'alpaca' | 'tradier' | 'ibkr' | 'tastytrade' | 'paper';

export type WorkspaceSummary = {
  organization: {
    id: string;
    name: string;
    slug: string;
    status: 'active' | 'suspended';
  };
  membership: {
    roles: IdentityRole[];
  };
  defaults: {
    watchlist: { symbol: string; label: string; enabled: boolean }[];
    aiMemory: {
      status: 'ready' | 'pending';
      seedVersion: string;
      preferences: {
        riskPosture: 'balanced';
        automationMode: 'paper';
        assistantTone: 'institutional';
      };
    };
    journal: {
      status: 'ready' | 'pending';
      seedVersion: string;
      firstEntry: string;
    };
  };
  brokerOnboarding: {
    status: 'not_started' | 'in_progress' | 'connected';
    providers: { provider: BrokerProvider; label: string; enabled: boolean }[];
    connections: Array<{
      provider: BrokerProvider;
      label: string;
      status: 'unconfigured' | 'connecting' | 'connected' | 'syncing' | 'error' | 'revoked';
      accountId: string | null;
      accountType: string | null;
      paper: boolean;
      buyingPower: number | null;
      currency: string | null;
    }>;
  };
  onboarding: {
    status: 'not_started' | 'in_progress' | 'complete';
    currentStep: number;
    completedAt: string | null;
  };
  aiProfile: {
    riskTolerance: 'conservative' | 'balanced' | 'aggressive';
    preferredMarkets: string[];
    preferredStrategies: string[];
    personality: 'institutional' | 'research' | 'execution' | 'automation';
    marketHours: 'regular' | 'extended';
  };
  riskProfile: {
    maximumDailyLoss: number;
    maximumPositionSize: number;
    instruments: 'stocks' | 'options' | 'stocks_options';
    paperTrading: boolean;
    automationAllowed: boolean;
    defaultStrategy: string;
    emergencyStop: boolean;
  };
  notifications: Record<'emailAlerts' | 'tradeAlerts' | 'automationAlerts' | 'aiSuggestions' | 'brokerDisconnect' | 'marginCalls' | 'systemMaintenance', boolean>;
  layouts: { key: string; label: string; version: number }[];
};

export type OnboardingPatch = {
  timezone?: string;
  tradingExperience?: PublicUser['profile']['tradingExperience'];
  currentStep?: number;
  aiProfile?: Partial<WorkspaceSummary['aiProfile']>;
  riskProfile?: Partial<WorkspaceSummary['riskProfile']>;
  notifications?: Partial<WorkspaceSummary['notifications']>;
};

export async function getAuthConfig(): Promise<{ googleConfigured: boolean; googleClientId: string | null; alpacaConfigured: boolean; alpacaPaper: boolean }> {
  const response = await http.get('/api/auth/config');
  return response.data;
}

export async function ensureCsrf(): Promise<string | null> {
  const response = await http.get('/api/auth/csrf');
  return response.data?.csrfToken ?? null;
}

export async function register(input: {
  email: string;
  password: string;
  workspaceName?: string;
  name?: string;
}): Promise<void> {
  await ensureCsrf();
  await http.post('/api/auth/register', input);
}

export async function login(input: { email: string; password: string; rememberMe?: boolean }): Promise<AuthSession> {
  await ensureCsrf();
  const response = await http.post('/api/auth/login', input);
  return response.data;
}

let refreshSessionPromise: Promise<AuthSession> | null = null;

export function refreshSession(): Promise<AuthSession> {
  // Refresh tokens rotate on every use. React Strict Mode intentionally mounts
  // effects twice in development, so concurrent restore calls must share one
  // request or the second request is correctly detected as token replay.
  if (!refreshSessionPromise) {
    refreshSessionPromise = (async () => {
      await ensureCsrf();
      const response = await http.post('/api/auth/refresh', {});
      return response.data;
    })().finally(() => {
      refreshSessionPromise = null;
    });
  }
  return refreshSessionPromise;
}

export async function logout(): Promise<void> {
  await http.post('/api/auth/logout', {});
}

export async function logoutAll(): Promise<void> {
  await http.post('/api/auth/logout-all', {});
}

export async function getMe(): Promise<PublicUser> {
  const response = await http.get('/api/auth/me');
  return response.data.user;
}

export async function updateProfile(patch: Partial<PublicUser['profile']>): Promise<PublicUser> {
  const response = await http.patch('/api/auth/profile', patch);
  return response.data.user;
}

export async function listSessions(): Promise<SessionSummary[]> {
  const response = await http.get('/api/auth/sessions');
  return response.data.sessions ?? [];
}

export async function getWorkspace(): Promise<WorkspaceSummary> {
  const response = await http.get('/api/auth/workspace');
  return response.data.workspace;
}

export async function updateOnboarding(patch: OnboardingPatch): Promise<WorkspaceSummary> {
  const response = await http.patch('/api/auth/onboarding', patch);
  return response.data.workspace;
}

export async function connectPaperBroker(): Promise<WorkspaceSummary> {
  const response = await http.post('/api/auth/onboarding/broker/paper', {});
  return response.data.workspace;
}

export async function connectAlpacaBroker(): Promise<WorkspaceSummary> {
  const response = await http.post('/api/auth/onboarding/broker/alpaca', {});
  return response.data.workspace;
}

export async function completeOnboarding(): Promise<{ workspace: WorkspaceSummary; user: PublicUser }> {
  const response = await http.post('/api/auth/onboarding/complete', {});
  return response.data;
}

export async function revokeSession(id: string): Promise<void> {
  await http.delete(`/api/auth/sessions/${encodeURIComponent(id)}`);
}

export async function verifyEmail(token: string): Promise<PublicUser> {
  const response = await http.post('/api/auth/verify-email', { token });
  return response.data.user;
}

export async function resendVerification(email: string): Promise<void> {
  await http.post('/api/auth/resend-verification', { email });
}

export async function forgotPassword(email: string): Promise<void> {
  await ensureCsrf();
  await http.post('/api/auth/forgot-password', { email });
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await ensureCsrf();
  await http.post('/api/auth/reset-password', { token, password });
}

export function googleRedirect(returnTo = '/'): void {
  const base = getApiBaseUrl().replace(/\/+$/, '');
  window.location.assign(`${base}/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`);
}
