import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import cookieParser from 'cookie-parser';
import { randomBytes } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

process.env.IDENTITY_JWT_SECRET = 'test-identity-secret-at-least-32-bytes-long';
process.env.IDENTITY_ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.IDENTITY_APP_BASE_URL = 'http://localhost:5173';
process.env.IDENTITY_API_BASE_URL = 'http://localhost:4000';
process.env.ALPACA_OAUTH_CLIENT_ID = 'alpaca-client';
process.env.ALPACA_OAUTH_CLIENT_SECRET = 'alpaca-secret';
process.env.ALPACA_OAUTH_AUTHORIZE_URL = 'https://broker.example/authorize';
process.env.ALPACA_OAUTH_TOKEN_URL = 'https://broker.example/token';
process.env.ALPACA_OAUTH_API_BASE_URL = 'https://broker.example/api';

const { initMongo, closeMongo } = await import('../dist/shared/db/mongo.js');
const { brokerageRouter } = await import('../dist/features/brokerage/brokerage.routes.js');
const { setBrokerHttpRequest, refreshExpiringConnections } = await import('../dist/features/brokerage/brokerPlatform.service.js');
const { BrokerConnectionModel } = await import('../dist/features/identity/models/brokerConnection.model.js');
const { BrokerOAuthAttemptModel } = await import('../dist/features/brokerage/models/brokerOAuthAttempt.model.js');
const { BrokerPortfolioModel } = await import('../dist/features/brokerage/models/brokerPortfolio.model.js');
const { OrganizationModel } = await import('../dist/features/identity/models/organization.model.js');
const { MembershipModel } = await import('../dist/features/identity/models/membership.model.js');
const { WorkspaceProfileModel } = await import('../dist/features/identity/models/workspaceProfile.model.js');

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}
function closeServer(server) { return new Promise(resolve => server.close(() => resolve())); }

let mongod;
let appServer;
let userId;
let accountSequence = 1;
let refreshGrantSeen = false;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await initMongo(mongod.getUri(), 'brokerage-platform-test');
  userId = new mongoose.Types.ObjectId();
  const org = await OrganizationModel.create({ name: 'Institutional Desk', slug: 'institutional-desk', ownerId: userId, status: 'active' });
  await MembershipModel.create({ userId, orgId: org._id, roles: ['admin'] });
  await WorkspaceProfileModel.create({ userId, orgId: org._id });

  setBrokerHttpRequest(async config => {
    if (config.method === 'POST' && config.url.endsWith('/token')) {
      if (String(config.data).includes('grant_type=refresh_token')) refreshGrantSeen = true;
      return { data: { access_token: refreshGrantSeen ? 'refreshed-access-token' : `access-token-${accountSequence}`, refresh_token: `refresh-token-${accountSequence}`, expires_in: 3600, scope: 'account trading', user_id: `broker-user-${accountSequence}` } };
    }
    if (config.url.endsWith('/v2/account')) return { data: { id: `alpaca-account-${accountSequence}`, account_type: 'margin', status: 'ACTIVE', buying_power: '250000', cash: '100000', equity: '300000', portfolio_value: '300000' } };
    if (config.url.includes('/v2/positions')) return { data: [{ symbol: 'SPY', asset_class: 'us_equity', unrealized_intraday_pl: '125.50' }, { symbol: 'SPY260101C00600000', asset_class: 'us_option', unrealized_intraday_pl: '-25.50' }] };
    if (config.url.includes('/v2/orders')) return { data: [{ id: 'order-1', status: 'new' }] };
    if (config.url.includes('/v2/watchlists')) return { data: [{ id: 'watchlist-1', name: 'Core' }] };
    if (config.url.includes('/v2/account/configurations')) return { data: { dtbp_check: 'entry' } };
    throw new Error(`Unexpected broker request: ${config.method} ${config.url}`);
  });

  const app = express();
  app.use(cookieParser());
  app.use((req, _res, next) => { req.auth = { authenticated: true, actorId: String(userId), accountId: 'workspace', roles: ['administrator'], authMethod: 'session', enforcementMode: 'required', sessionId: 'session-1' }; next(); });
  app.use(express.json());
  app.use('/api/brokers', brokerageRouter);
  app.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.message }));
  appServer = await startServer(app);
});

test.after(async () => {
  setBrokerHttpRequest(null);
  await closeServer(appServer.server);
  await closeMongo();
  await mongod.stop();
});

function request(path, options = {}) {
  return fetch(`http://127.0.0.1:${appServer.port}${path}`, { redirect: 'manual', ...options, headers: { cookie: 'id_csrf=csrf-token', 'x-csrf-token': 'csrf-token', ...(options.headers ?? {}) } });
}

async function beginAndCompleteConnection() {
  const begin = await request('/api/brokers/alpaca/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ environment: 'paper', returnTo: '/onboarding' }) });
  assert.equal(begin.status, 201);
  const authorizationUrl = new URL((await begin.json()).authorizationUrl);
  assert.equal(authorizationUrl.origin, 'https://broker.example');
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  const state = authorizationUrl.searchParams.get('state');
  assert.ok(state);
  const callback = await request(`/api/brokers/alpaca/callback?state=${encodeURIComponent(state)}&code=authorization-code`, { headers: {} });
  assert.equal(callback.status, 303);
  assert.match(callback.headers.get('location'), /connection=success/);
}

test('OAuth callback encrypts tokens, imports the full portfolio, and exposes only safe status', async () => {
  await beginAndCompleteConnection();
  const connection = await BrokerConnectionModel.findOne({ userId, provider: 'alpaca', accountId: 'alpaca-account-1' }).select('+encryptedAccessToken +encryptedRefreshToken');
  assert.ok(connection);
  assert.notEqual(connection.encryptedAccessToken.data, 'access-token-1');
  assert.notEqual(connection.encryptedRefreshToken.data, 'refresh-token-1');
  assert.equal(connection.status, 'connected');
  assert.equal(connection.oauthStatus, 'authorized');
  assert.ok(connection.lastSync);
  const portfolio = await BrokerPortfolioModel.findOne({ connectionId: connection._id }).lean();
  assert.equal(portfolio.positions.length, 2);
  assert.equal(portfolio.optionPositions.length, 1);
  assert.equal(portfolio.openOrders.length, 1);
  assert.equal(portfolio.watchlists.length, 1);
  assert.equal(portfolio.balances.buyingPower, 250000);

  const status = await request('/api/brokers/status', { headers: {} });
  assert.equal(status.status, 200);
  const payload = await status.json();
  assert.equal(payload.connections[0].metrics.todayPl, 100);
  assert.equal(payload.connections[0].metrics.openPositions, 2);
  assert.equal(JSON.stringify(payload).includes('encryptedAccessToken'), false);
  assert.equal(JSON.stringify(payload).includes('access-token-1'), false);

  const replay = await request(`/api/brokers/alpaca/callback?state=invalid&code=authorization-code`, { headers: {} });
  assert.equal(replay.status, 303);
  assert.match(replay.headers.get('location'), /connection=failed/);
  assert.equal(await BrokerOAuthAttemptModel.countDocuments({ consumedAt: { $ne: null } }), 1);
});

test('supports multiple accounts and refreshes expiring OAuth credentials', async () => {
  accountSequence = 2;
  await beginAndCompleteConnection();
  assert.equal(await BrokerConnectionModel.countDocuments({ userId, provider: 'alpaca', status: 'connected' }), 2);
  const expiring = await BrokerConnectionModel.findOne({ accountId: 'alpaca-account-2' });
  expiring.expiresAt = new Date(Date.now() + 10_000);
  await expiring.save();
  const refreshed = await refreshExpiringConnections();
  assert.equal(refreshed, 1);
  assert.equal(refreshGrantSeen, true);
  const after = await BrokerConnectionModel.findById(expiring._id);
  assert.ok(after.lastRefresh);
  assert.equal(after.reconnectStatus, 'not_required');
});

test('disconnect revokes local credentials and removes only broker caches', async () => {
  const connection = await BrokerConnectionModel.findOne({ accountId: 'alpaca-account-2' });
  const response = await request('/api/brokers/alpaca/disconnect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ connectionId: String(connection._id) }) });
  assert.equal(response.status, 200);
  const after = await BrokerConnectionModel.findById(connection._id).select('+encryptedAccessToken +encryptedRefreshToken');
  assert.equal(after.status, 'revoked');
  assert.equal(after.encryptedAccessToken, null);
  assert.equal(after.encryptedRefreshToken, null);
  assert.equal(await BrokerPortfolioModel.countDocuments({ connectionId: connection._id }), 0);
  assert.equal(await WorkspaceProfileModel.countDocuments({ userId }), 1);
  assert.equal(await MembershipModel.countDocuments({ userId }), 1);
});
