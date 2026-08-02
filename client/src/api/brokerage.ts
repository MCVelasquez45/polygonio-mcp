import { http } from './http';

export type BrokerConnection = {
  id: string; provider: string; brokerName: string; nickname: string; accountId: string | null;
  accountType: string | null; environment: 'paper' | 'live'; paper: boolean; live: boolean; primary: boolean;
  status: 'connecting' | 'connected' | 'syncing' | 'error' | 'revoked'; scopes: string[]; permissions: string[];
  connectedAt: string | null; lastSync: string | null; lastRefresh: string | null; expiresAt: string | null;
  oauthStatus: string; reconnectStatus: string; health: string;
  balances: { buyingPower: number | null; cash: number | null; equity: number | null; portfolioValue: number | null };
  metrics: { openPositions: number; openOrders: number; todayPl: number };
};

export type BrokerDirectoryEntry = {
  provider: string; name: string; monogram: string; assets: string[]; oauthSupported: boolean;
  paperTrading: boolean; liveTrading: boolean; available: boolean; configured: boolean;
  permissions: string[]; description: string; connections: BrokerConnection[];
};

export async function listBrokers(): Promise<BrokerDirectoryEntry[]> {
  const response = await http.get('/api/brokers');
  return response.data.brokers ?? [];
}

export async function brokerStatus(): Promise<{ checkedAt: string; healthy: number; degraded: number; reconnectRequired: number; aiStatus: string; riskScore: number; recentSignals: unknown[]; connections: BrokerConnection[] }> {
  const response = await http.get('/api/brokers/status');
  return response.data;
}

export async function connectBroker(provider: string, environment: 'paper' | 'live', returnTo = '/onboarding'): Promise<string> {
  const response = await http.post(`/api/brokers/${encodeURIComponent(provider)}/connect`, { environment, returnTo });
  return response.data.authorizationUrl;
}

export async function reconnectBroker(provider: string, environment: 'paper' | 'live'): Promise<string> {
  const response = await http.post(`/api/brokers/${encodeURIComponent(provider)}/reconnect`, { environment, returnTo: '/terminal?settings=brokers' });
  return response.data.authorizationUrl;
}

export async function disconnectBroker(provider: string, connectionId: string): Promise<void> {
  await http.post(`/api/brokers/${encodeURIComponent(provider)}/disconnect`, { connectionId });
}

export async function syncBrokers(provider?: string): Promise<void> {
  await http.post('/api/brokers/sync', provider ? { provider } : {});
}

export type SecurityOverview = {
  controls: { oauthAuthentication: boolean; encryption: string; transport: string; revocableAccess: boolean };
  sessionStatus: string; lastLogin: string | null;
  connectedDevices: Array<{ id: string; device: { ua: string; ip: string }; lastUsedAt: string; createdAt: string }>;
  connectedBrokers: BrokerConnection[];
  activity: Array<{ _id: string; action: string; outcome: string; createdAt: string; ip: string; ua: string; targetType: string | null }>;
};

export async function getSecurityOverview(): Promise<SecurityOverview> {
  const response = await http.get('/api/brokers/security');
  return response.data;
}
