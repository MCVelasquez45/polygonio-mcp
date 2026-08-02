import axios, { type AxiosRequestConfig } from 'axios';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { BrokerConnectionModel, type BrokerConnectionDocument, type BrokerProvider } from '../identity/models/brokerConnection.model';
import { MembershipModel } from '../identity/models/membership.model';
import { WorkspaceProfileModel } from '../identity/models/workspaceProfile.model';
import { encryptSecret, decryptSecret, generateOpaqueToken, sha256 } from '../../shared/identity/crypto';
import { BrokerOAuthAttemptModel } from './models/brokerOAuthAttempt.model';
import { BrokerPortfolioModel } from './models/brokerPortfolio.model';
import { getBrokerOAuthConfig } from './brokerConfig';
import { getBrokerEntry } from './brokerRegistry';

type BrokerEnvironment = 'paper' | 'live';
type HttpRequest = <T = unknown>(config: AxiosRequestConfig) => Promise<{ data: T }>;
let httpRequest: HttpRequest = config => axios.request(config);

export function setBrokerHttpRequest(next: HttpRequest | null): void {
  httpRequest = next ?? (config => axios.request(config));
}

function objectId(value: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) throw Object.assign(new Error('AUTH_REQUIRED'), { status: 401 });
  return new Types.ObjectId(value);
}

async function workspaceForUser(userId: Types.ObjectId): Promise<Types.ObjectId> {
  const membership = await MembershipModel.findOne({ userId }).sort({ createdAt: 1 }).lean();
  if (!membership) throw Object.assign(new Error('WORKSPACE_REQUIRED'), { status: 409 });
  return membership.orgId;
}

function safeReturnTo(value: unknown): string {
  const candidate = String(value ?? '/onboarding');
  return candidate.startsWith('/') && !candidate.startsWith('//') ? candidate.slice(0, 300) : '/onboarding';
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const candidate = record.positions ?? record.position ?? record.orders ?? record.order ?? record.watchlists ?? record.watchlist ?? record.data;
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === 'object') return [candidate];
  }
  return [];
}

function publicConnection(connection: BrokerConnectionDocument, portfolio?: any) {
  const entry = getBrokerEntry(connection.provider);
  return {
    id: String(connection._id),
    provider: connection.provider,
    brokerName: entry?.name ?? connection.label,
    nickname: connection.nickname || connection.label,
    accountId: connection.accountId,
    accountType: connection.accountType,
    environment: connection.environment,
    paper: connection.paper,
    live: connection.live,
    primary: connection.primary,
    status: connection.status,
    scopes: connection.scopes,
    permissions: connection.permissions,
    connectedAt: connection.connectedAt,
    lastSync: connection.lastSync,
    lastRefresh: connection.lastRefresh,
    expiresAt: connection.expiresAt,
    oauthStatus: connection.oauthStatus,
    reconnectStatus: connection.reconnectStatus,
    health: connection.meta?.health ?? (connection.status === 'connected' ? 'healthy' : 'inactive'),
    balances: portfolio?.balances ?? {
      buyingPower: asNumber(connection.meta?.buyingPower), cash: null, equity: null, portfolioValue: null,
    },
    metrics: {
      openPositions: portfolio?.positions?.length ?? 0,
      openOrders: portfolio?.openOrders?.length ?? 0,
      todayPl: portfolio?.positions?.reduce((total: number, position: any) => total + (asNumber(position?.unrealized_intraday_pl ?? position?.day_gain) ?? 0), 0) ?? 0,
    },
  };
}

export async function listConnections(actorId: string) {
  const userId = objectId(actorId);
  const connections = await BrokerConnectionModel.find({ userId, status: { $ne: 'unconfigured' } }).sort({ primary: -1, connectedAt: 1 });
  const portfolios = await BrokerPortfolioModel.find({ userId }).lean();
  const byConnection = new Map(portfolios.map(portfolio => [String(portfolio.connectionId), portfolio]));
  return connections.map(connection => publicConnection(connection, byConnection.get(String(connection._id))));
}

export async function beginBrokerOAuth(input: { actorId: string; provider: Exclude<BrokerProvider, 'paper'>; environment: BrokerEnvironment; returnTo?: string }) {
  const userId = objectId(input.actorId);
  const workspaceId = await workspaceForUser(userId);
  const config = getBrokerOAuthConfig(input.provider);
  if (!config.clientId || !config.clientSecret || !config.authorizeUrl || !config.tokenUrl || !config.apiBaseUrl) {
    throw Object.assign(new Error('BROKER_OAUTH_NOT_CONFIGURED'), { status: 503 });
  }
  const state = generateOpaqueToken(32);
  const verifier = generateOpaqueToken(48);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  await BrokerOAuthAttemptModel.create({
    userId, workspaceId, provider: input.provider, environment: input.environment,
    stateHash: sha256(state), verifierCiphertext: encryptSecret(verifier),
    returnTo: safeReturnTo(input.returnTo), expiresAt: new Date(Date.now() + 10 * 60_000), consumedAt: null,
  });
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('environment', input.environment);
  return { authorizationUrl: url.toString(), expiresInSec: 600 };
}

type TokenPayload = { access_token?: string; refresh_token?: string; expires_in?: number | string; scope?: string | string[]; token_type?: string; user_id?: string };

async function exchangeCode(provider: Exclude<BrokerProvider, 'paper'>, code: string, verifier: string): Promise<TokenPayload> {
  const config = getBrokerOAuthConfig(provider);
  const form = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: config.redirectUri,
    client_id: config.clientId!, client_secret: config.clientSecret!, code_verifier: verifier,
  });
  const response = await httpRequest<TokenPayload>({
    method: 'POST', url: config.tokenUrl, data: form.toString(), timeout: 15_000,
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
  });
  if (!response.data?.access_token) throw Object.assign(new Error('BROKER_TOKEN_EXCHANGE_FAILED'), { status: 502 });
  return response.data;
}

function providerPaths(provider: Exclude<BrokerProvider, 'paper'>, accountId?: string | null) {
  if (provider === 'alpaca') return { account: '/v2/account', positions: '/v2/positions', orders: '/v2/orders?status=open&nested=true', watchlists: '/v2/watchlists', configuration: '/v2/account/configurations' };
  if (provider === 'tradier') return { account: '/v1/user/profile', positions: `/v1/accounts/${accountId ?? ''}/positions`, orders: `/v1/accounts/${accountId ?? ''}/orders`, watchlists: '/v1/watchlists', configuration: `/v1/accounts/${accountId ?? ''}/balances` };
  if (provider === 'ibkr') return { account: '/portfolio/accounts', positions: `/portfolio/${accountId ?? ''}/positions/0`, orders: '/iserver/account/orders', watchlists: '/iserver/watchlists', configuration: `/portfolio/${accountId ?? ''}/summary` };
  return { account: '/customers/me/accounts', positions: `/accounts/${accountId ?? ''}/positions`, orders: `/accounts/${accountId ?? ''}/orders/live`, watchlists: '/watchlists', configuration: `/accounts/${accountId ?? ''}/balances` };
}

async function brokerGet(provider: Exclude<BrokerProvider, 'paper'>, accessToken: string, path: string): Promise<unknown> {
  const config = getBrokerOAuthConfig(provider);
  const response = await httpRequest({ method: 'GET', url: `${config.apiBaseUrl.replace(/\/+$/, '')}${path}`, timeout: 15_000, headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
  return response.data;
}

async function optionalBrokerGet(provider: Exclude<BrokerProvider, 'paper'>, accessToken: string, path: string, fallback: unknown): Promise<unknown> {
  try { return await brokerGet(provider, accessToken, path); } catch { return fallback; }
}

function accountRecord(provider: Exclude<BrokerProvider, 'paper'>, raw: any): Record<string, any> {
  if (provider === 'tradier') {
    const profile = raw?.profile ?? raw;
    const account = Array.isArray(profile?.account) ? profile.account[0] : profile?.account;
    return account ?? profile ?? {};
  }
  if (provider === 'ibkr') return (Array.isArray(raw) ? raw[0] : raw?.accounts?.[0] ?? raw) ?? {};
  if (provider === 'tastytrade') return raw?.data?.items?.[0] ?? raw?.data ?? raw ?? {};
  return raw ?? {};
}

function accountIdFrom(raw: Record<string, any>): string {
  return String(raw.id ?? raw.account_id ?? raw.accountId ?? raw.account_number ?? raw.accountNumber ?? raw.account ?? raw.accountNo ?? raw['account-number'] ?? '').trim();
}

export async function completeBrokerOAuth(input: { provider: Exclude<BrokerProvider, 'paper'>; state: string; code: string }) {
  const now = new Date();
  const attempt = await BrokerOAuthAttemptModel.findOneAndUpdate(
    { provider: input.provider, stateHash: sha256(input.state), consumedAt: null, expiresAt: { $gt: now } },
    { $set: { consumedAt: now } }, { returnDocument: 'after' }
  );
  if (!attempt) throw Object.assign(new Error('BROKER_OAUTH_STATE_INVALID'), { status: 400 });
  const token = await exchangeCode(input.provider, input.code, decryptSecret(attempt.verifierCiphertext));
  const rawAccount = accountRecord(input.provider, await brokerGet(input.provider, token.access_token!, providerPaths(input.provider).account));
  const accountId = accountIdFrom(rawAccount);
  if (!accountId) throw Object.assign(new Error('BROKER_ACCOUNT_INVALID'), { status: 502 });
  const entry = getBrokerEntry(input.provider)!;
  const existing = await BrokerConnectionModel.findOne({ userId: attempt.userId, provider: input.provider, accountId });
  const placeholder = existing ?? await BrokerConnectionModel.findOne({ userId: attempt.userId, provider: input.provider, accountId: null, status: { $in: ['unconfigured', 'revoked', 'error'] } });
  const expiresIn = asNumber(token.expires_in);
  const scopes = Array.isArray(token.scope) ? token.scope : String(token.scope ?? getBrokerOAuthConfig(input.provider).scopes.join(' ')).split(/[ ,]+/).filter(Boolean);
  const values = {
    workspaceId: attempt.workspaceId, provider: input.provider, label: entry.name, nickname: entry.name,
    status: 'connected' as const, accountId, brokerUserId: token.user_id ?? null,
    accountType: String(rawAccount.account_type ?? rawAccount.type ?? rawAccount.accountType ?? attempt.environment),
    paper: attempt.environment === 'paper', live: attempt.environment === 'live', primary: false, environment: attempt.environment,
    encryptedAccessToken: encryptSecret(token.access_token!),
    encryptedRefreshToken: token.refresh_token ? encryptSecret(token.refresh_token) : null,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    scopes, permissions: entry.permissions, connectedAt: now, lastSync: null, lastRefresh: null,
    reconnectStatus: 'not_required' as const, oauthStatus: 'authorized' as const,
    meta: { health: 'sync_pending', brokerStatus: rawAccount.status ?? 'ACTIVE' },
  };
  const connection = placeholder
    ? await BrokerConnectionModel.findByIdAndUpdate(placeholder._id, { $set: values }, { returnDocument: 'after' })
    : await BrokerConnectionModel.create({ userId: attempt.userId, ...values });
  if (!connection) throw new Error('BROKER_CONNECTION_WRITE_FAILED');
  if (!(await BrokerConnectionModel.exists({ userId: attempt.userId, primary: true, status: 'connected' }))) {
    connection.primary = true;
    await connection.save();
  }
  await syncConnection(connection, token.access_token!);
  await WorkspaceProfileModel.updateOne({ userId: attempt.userId }, { $set: { 'brokerOnboarding.status': 'connected', 'onboarding.status': 'in_progress', 'onboarding.currentStep': 2 } });
  return { connection: publicConnection(connection), returnTo: attempt.returnTo, actorId: String(attempt.userId) };
}

async function syncConnection(connection: BrokerConnectionDocument, providedAccessToken?: string) {
  if (connection.provider === 'paper') return null;
  const provider = connection.provider as Exclude<BrokerProvider, 'paper'>;
  const withSecrets = providedAccessToken ? connection : await BrokerConnectionModel.findById(connection._id).select('+encryptedAccessToken +encryptedRefreshToken');
  const accessToken = providedAccessToken ?? (withSecrets?.encryptedAccessToken ? decryptSecret(withSecrets.encryptedAccessToken) : '');
  if (!accessToken) throw Object.assign(new Error('BROKER_RECONNECT_REQUIRED'), { status: 409 });
  await BrokerConnectionModel.updateOne({ _id: connection._id }, { $set: { status: 'syncing', 'meta.health': 'syncing' } });
  const paths = providerPaths(provider, connection.accountId);
  try {
    const accountRaw = await brokerGet(provider, accessToken, paths.account);
    const account = accountRecord(provider, accountRaw);
    const [positionsRaw, ordersRaw, watchlistsRaw, configurationRaw] = await Promise.all([
      optionalBrokerGet(provider, accessToken, paths.positions, []), optionalBrokerGet(provider, accessToken, paths.orders, []),
      optionalBrokerGet(provider, accessToken, paths.watchlists, []), optionalBrokerGet(provider, accessToken, paths.configuration, {}),
    ]);
    const positions = asArray(positionsRaw);
    const balancesRaw: any = (configurationRaw as any)?.balances ?? configurationRaw ?? {};
    const balances = {
      buyingPower: asNumber(account.buying_power ?? account.buyingPower ?? balancesRaw.buying_power ?? balancesRaw.buyingPower),
      cash: asNumber(account.cash ?? balancesRaw.cash ?? balancesRaw.total_cash),
      equity: asNumber(account.equity ?? balancesRaw.equity ?? balancesRaw.total_equity),
      portfolioValue: asNumber(account.portfolio_value ?? account.portfolioValue ?? balancesRaw.market_value ?? balancesRaw.net_liquidating_value),
    };
    const syncedAt = new Date();
    await BrokerPortfolioModel.findOneAndUpdate({ connectionId: connection._id }, { $set: {
      connectionId: connection._id, userId: connection.userId, workspaceId: connection.workspaceId,
      provider, accountId: connection.accountId, account, balances, positions,
      optionPositions: positions.filter((item: any) => String(item?.asset_class ?? item?.instrument_type ?? '').toLowerCase().includes('option')),
      openOrders: asArray(ordersRaw), watchlists: asArray(watchlistsRaw), accountConfiguration: configurationRaw ?? {}, syncedAt,
    } }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true });
    await BrokerConnectionModel.updateOne({ _id: connection._id }, { $set: {
      status: 'connected', lastSync: syncedAt, 'meta.health': 'healthy', 'meta.buyingPower': balances.buyingPower,
      'meta.cash': balances.cash, 'meta.equity': balances.equity, 'meta.portfolioValue': balances.portfolioValue,
    } });
    connection.status = 'connected'; connection.lastSync = syncedAt; connection.meta = { ...connection.meta, health: 'healthy', buyingPower: balances.buyingPower };
    return { syncedAt, balances, positions: positions.length, orders: asArray(ordersRaw).length };
  } catch (error) {
    await BrokerConnectionModel.updateOne({ _id: connection._id }, { $set: { status: 'error', 'meta.health': 'degraded', 'meta.lastErrorAt': new Date() } });
    throw error;
  }
}

export async function syncConnections(actorId: string, provider?: Exclude<BrokerProvider, 'paper'>) {
  const userId = objectId(actorId);
  const connections = await BrokerConnectionModel.find({ userId, status: { $in: ['connected', 'error'] }, ...(provider ? { provider } : { provider: { $ne: 'paper' } }) });
  const results = [];
  for (const connection of connections) results.push({ connectionId: String(connection._id), ...(await syncConnection(connection)) });
  return results;
}

export async function refreshConnection(connection: BrokerConnectionDocument): Promise<boolean> {
  if (connection.provider === 'paper') return true;
  const provider = connection.provider as Exclude<BrokerProvider, 'paper'>;
  const current = await BrokerConnectionModel.findById(connection._id).select('+encryptedRefreshToken');
  if (!current?.encryptedRefreshToken) {
    await BrokerConnectionModel.updateOne({ _id: connection._id }, { $set: { reconnectStatus: 'required', oauthStatus: 'expired', status: 'error' } });
    return false;
  }
  const config = getBrokerOAuthConfig(provider);
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: decryptSecret(current.encryptedRefreshToken), client_id: config.clientId!, client_secret: config.clientSecret! });
  try {
    const response = await httpRequest<TokenPayload>({ method: 'POST', url: config.tokenUrl, data: form.toString(), timeout: 15_000, headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' } });
    if (!response.data.access_token) throw new Error('BROKER_REFRESH_FAILED');
    const expiresIn = asNumber(response.data.expires_in);
    await BrokerConnectionModel.updateOne({ _id: connection._id }, { $set: {
      encryptedAccessToken: encryptSecret(response.data.access_token),
      ...(response.data.refresh_token ? { encryptedRefreshToken: encryptSecret(response.data.refresh_token) } : {}),
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null, lastRefresh: new Date(),
      reconnectStatus: 'not_required', oauthStatus: 'authorized', status: 'connected', 'meta.health': 'healthy',
    } });
    return true;
  } catch {
    await BrokerConnectionModel.updateOne({ _id: connection._id }, { $set: { reconnectStatus: 'required', oauthStatus: 'error', status: 'error', 'meta.health': 'degraded' } });
    return false;
  }
}

export async function refreshExpiringConnections(): Promise<number> {
  const cutoff = new Date(Date.now() + 5 * 60_000);
  const connections = await BrokerConnectionModel.find({ status: 'connected', expiresAt: { $ne: null, $lte: cutoff } });
  let refreshed = 0;
  for (const connection of connections) if (await refreshConnection(connection)) refreshed += 1;
  return refreshed;
}

export async function disconnectBroker(input: { actorId: string; provider: Exclude<BrokerProvider, 'paper'>; connectionId?: string }) {
  const userId = objectId(input.actorId);
  const query: any = { userId, provider: input.provider, status: { $ne: 'unconfigured' } };
  if (input.connectionId) query._id = objectId(input.connectionId);
  const connection = await BrokerConnectionModel.findOne(query).select('+encryptedAccessToken +encryptedRefreshToken');
  if (!connection) throw Object.assign(new Error('BROKER_CONNECTION_NOT_FOUND'), { status: 404 });
  const config = getBrokerOAuthConfig(input.provider);
  if (config.revokeUrl && connection.encryptedAccessToken) {
    try { await httpRequest({ method: 'POST', url: config.revokeUrl, data: new URLSearchParams({ token: decryptSecret(connection.encryptedAccessToken) }).toString(), timeout: 10_000, headers: { 'content-type': 'application/x-www-form-urlencoded' } }); } catch { /* Local revocation remains authoritative. */ }
  }
  await BrokerPortfolioModel.deleteOne({ connectionId: connection._id });
  await BrokerConnectionModel.updateOne({ _id: connection._id }, { $set: {
    status: 'revoked', encryptedAccessToken: null, encryptedRefreshToken: null, expiresAt: null,
    oauthStatus: 'revoked', reconnectStatus: 'required', lastSync: null, primary: false,
    meta: { disconnectedAt: new Date(), health: 'inactive' },
  } });
  return { disconnected: true, provider: input.provider, connectionId: String(connection._id) };
}

export async function connectionHealth(actorId: string) {
  const userId = objectId(actorId);
  const connections = await listConnections(actorId);
  const workspace = await WorkspaceProfileModel.findOne({ userId }).select('aiMemory riskProfile').lean();
  const tolerance = workspace?.riskProfile?.automationAllowed ? 65 : workspace?.riskProfile?.emergencyStop ? 35 : 50;
  return {
    checkedAt: new Date(), healthy: connections.filter(item => item.status === 'connected' && item.health === 'healthy').length,
    degraded: connections.filter(item => item.status === 'error' || item.health === 'degraded').length,
    reconnectRequired: connections.filter(item => item.reconnectStatus === 'required').length,
    aiStatus: workspace?.aiMemory?.status ?? 'pending', riskScore: tolerance, recentSignals: [], connections,
  };
}

let refreshTimer: NodeJS.Timeout | null = null;
export function startBrokerRefreshService(): void {
  if (refreshTimer || process.env.BROKER_REFRESH_ENABLED === 'false') return;
  refreshTimer = setInterval(() => void refreshExpiringConnections().catch(() => undefined), 60_000);
  refreshTimer.unref();
}
export function stopBrokerRefreshService(): void { if (refreshTimer) clearInterval(refreshTimer); refreshTimer = null; }
