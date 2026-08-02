import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import cookieParser from 'cookie-parser';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.IDENTITY_JWT_SECRET = 'test-identity-secret-at-least-32-bytes-long';
process.env.IDENTITY_ARGON_MEMORY_KIB = '4096';
process.env.IDENTITY_ARGON_TIME_COST = '1';
process.env.IDENTITY_RATE_MAX = '200';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';

const { initMongo, closeMongo } = await import('../dist/shared/db/mongo.js');
const { createRequestIdentityMiddleware } = await import('../dist/shared/auth/requestIdentity.js');
const { identityRouter } = await import('../dist/features/identity/identity.routes.js');
const { setEmailProvider } = await import('../dist/features/identity/services/emailService.js');
const { UserModel } = await import('../dist/features/identity/models/user.model.js');
const { SessionModel } = await import('../dist/features/identity/models/session.model.js');
const { OrganizationModel } = await import('../dist/features/identity/models/organization.model.js');
const { MembershipModel } = await import('../dist/features/identity/models/membership.model.js');
const { BrokerConnectionModel } = await import('../dist/features/identity/models/brokerConnection.model.js');
const { WorkspaceProfileModel } = await import('../dist/features/identity/models/workspaceProfile.model.js');
const { EmailTokenModel } = await import('../dist/features/identity/models/emailToken.model.js');
const { AuditLogModel } = await import('../dist/features/identity/models/auditLog.model.js');
const { connectAlpacaBroker } = await import('../dist/features/identity/services/workspaceService.js');
const { createSession, rotateSession } = await import('../dist/features/identity/services/sessionService.js');
const { upsertOAuthUser } = await import('../dist/features/identity/services/userService.js');

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function closeServer(server) {
  return new Promise(resolve => {
    if (!server?.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function cookieHeader(jar) {
  return Array.from(jar.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
}

function storeCookies(jar, response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(';');
    const index = pair.indexOf('=');
    if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
}

async function request(base, jar, path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (jar.size) headers.cookie = cookieHeader(jar);
  const response = await fetch(`${base}${path}`, { ...options, headers });
  storeCookies(jar, response);
  return response;
}

let mongod;
let appServer;
const delivered = [];

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await initMongo(mongod.getUri(), 'identity-test');
  setEmailProvider({
    name: 'test',
    async send(message) {
      delivered.push(message);
    },
  });

  const app = express();
  app.use(cookieParser());
  app.use(createRequestIdentityMiddleware({
    enforcementMode: 'required',
    staticToken: null,
    defaultActorId: 'legacy-operator',
    defaultAccountId: 'paper-default',
    defaultRoles: ['viewer'],
  }));
  app.use(express.json());
  app.use('/api/auth', identityRouter);
  appServer = await startServer(app);
});

test.after(async () => {
  setEmailProvider(null);
  await closeServer(appServer?.server);
  await closeMongo();
  await mongod?.stop();
});

test.beforeEach(async () => {
  delivered.length = 0;
  await UserModel.deleteMany({});
  await SessionModel.deleteMany({});
  await OrganizationModel.deleteMany({});
  await MembershipModel.deleteMany({});
  await BrokerConnectionModel.deleteMany({});
  await WorkspaceProfileModel.deleteMany({});
  await EmailTokenModel.deleteMany({});
  await AuditLogModel.deleteMany({});
});

test('identity route lifecycle registers, verifies, logs in, refreshes and logs out', async () => {
  const base = `http://127.0.0.1:${appServer.port}`;
  const jar = new Map();

  let response = await request(base, jar, '/api/auth/csrf');
  assert.equal(response.status, 200);
  const csrf = (await response.json()).csrfToken;
  assert.ok(csrf);

  response = await request(base, jar, '/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({
      email: 'new.user@example.com',
      password: 'correct horse battery staple',
      workspaceName: 'Desk',
      name: 'New User',
    }),
  });
  assert.equal(response.status, 201);
  assert.equal(delivered.length, 1);
  const verifyToken = delivered[0].text.match(/token=([^&\s]+)/)?.[1];
  assert.ok(verifyToken);

  response = await request(base, jar, '/api/auth/verify-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ token: decodeURIComponent(verifyToken) }),
  });
  assert.equal(response.status, 200);

  response = await request(base, jar, '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({
      email: 'new.user@example.com',
      password: 'correct horse battery staple',
      rememberMe: true,
    }),
  });
  assert.equal(response.status, 200);
  const loginPayload = await response.json();
  assert.equal(loginPayload.user.email, 'new.user@example.com');
  assert.ok(loginPayload.accessToken);
  assert.ok(jar.get('id_refresh'));
  assert.ok(jar.get('id_csrf'));

  const user = await UserModel.findOne({ email: 'new.user@example.com' });
  assert.ok(user);
  assert.equal(await EmailTokenModel.countDocuments({ userId: user._id, type: 'verify', usedAt: { $ne: null } }), 1);
  assert.equal(await OrganizationModel.countDocuments({ ownerId: user._id }), 1);
  assert.equal(await MembershipModel.countDocuments({ userId: user._id }), 1);
  assert.equal(await BrokerConnectionModel.countDocuments({ userId: user._id }), 5);
  assert.ok(await AuditLogModel.countDocuments({ actorId: String(user._id) }) >= 3);
  assert.equal(await WorkspaceProfileModel.countDocuments({ userId: user._id }), 1);

  response = await request(base, jar, '/api/auth/me', {
    headers: { authorization: `Bearer ${loginPayload.accessToken}` },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.profile.workspaceName, 'Desk');

  response = await request(base, jar, '/api/auth/workspace', {
    headers: { authorization: `Bearer ${loginPayload.accessToken}` },
  });
  assert.equal(response.status, 200);
  const workspacePayload = await response.json();
  assert.equal(workspacePayload.workspace.organization.name, 'Desk');
  assert.deepEqual(
    workspacePayload.workspace.brokerOnboarding.providers.map(provider => provider.provider).sort(),
    ['alpaca', 'ibkr', 'paper', 'tastytrade', 'tradier']
  );
  assert.equal(workspacePayload.workspace.onboarding.status, 'not_started');
  assert.deepEqual(
    workspacePayload.workspace.defaults.watchlist.map(item => item.symbol),
    ['SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA']
  );

  response = await request(base, jar, '/api/auth/onboarding', {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${loginPayload.accessToken}`,
      'content-type': 'application/json',
      'x-csrf-token': jar.get('id_csrf'),
    },
    body: JSON.stringify({
      currentStep: 3,
      timezone: 'America/Phoenix',
      tradingExperience: 'advanced',
      aiProfile: { riskTolerance: 'conservative', personality: 'research' },
      riskProfile: { maximumDailyLoss: 250, maximumPositionSize: 2500 },
    }),
  });
  assert.equal(response.status, 200);
  const configuredWorkspace = (await response.json()).workspace;
  assert.equal(configuredWorkspace.onboarding.status, 'in_progress');
  assert.equal(configuredWorkspace.aiProfile.personality, 'research');
  assert.equal(configuredWorkspace.riskProfile.maximumDailyLoss, 250);

  response = await request(base, jar, '/api/auth/onboarding/complete', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${loginPayload.accessToken}`,
      'content-type': 'application/json',
      'x-csrf-token': jar.get('id_csrf'),
    },
    body: '{}',
  });
  assert.equal(response.status, 409);

  response = await request(base, jar, '/api/auth/onboarding/broker/paper', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${loginPayload.accessToken}`,
      'content-type': 'application/json',
      'x-csrf-token': jar.get('id_csrf'),
    },
    body: '{}',
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).workspace.brokerOnboarding.status, 'connected');

  const alpacaWorkspace = await connectAlpacaBroker(user, {
    id: 'alpaca-account-1',
    status: 'ACTIVE',
    account_type: 'margin',
    buying_power: '250000.50',
    currency: 'USD',
  }, true);
  const alpaca = alpacaWorkspace.brokerOnboarding.connections.find(connection => connection.provider === 'alpaca');
  assert.equal(alpaca.status, 'connected');
  assert.equal(alpaca.accountId, 'alpaca-account-1');
  assert.equal(alpaca.accountType, 'margin');
  assert.equal(alpaca.paper, true);
  assert.equal(alpaca.buyingPower, 250000.5);
  assert.equal(alpaca.currency, 'USD');
  assert.equal('secretCiphertext' in alpaca, false);

  response = await request(base, jar, '/api/auth/onboarding/complete', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${loginPayload.accessToken}`,
      'content-type': 'application/json',
      'x-csrf-token': jar.get('id_csrf'),
    },
    body: '{}',
  });
  assert.equal(response.status, 200);
  const completionPayload = await response.json();
  assert.equal(completionPayload.user.firstLogin, false);
  assert.equal(completionPayload.workspace.onboarding.status, 'complete');
  assert.ok(completionPayload.user.onboardingCompletedAt);

  response = await request(base, jar, '/api/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': jar.get('id_csrf') },
    body: '{}',
  });
  assert.equal(response.status, 200);
  const refreshPayload = await response.json();
  assert.ok(refreshPayload.accessToken);
  assert.notEqual(refreshPayload.sessionId, loginPayload.sessionId);
  assert.equal(await OrganizationModel.countDocuments({ ownerId: user._id }), 1);
  assert.equal(await BrokerConnectionModel.countDocuments({ userId: user._id }), 5);

  response = await request(base, jar, '/api/auth/logout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': jar.get('id_csrf') },
    body: '{}',
  });
  assert.equal(response.status, 200);
});

test('concurrent refresh-token replay revokes the entire session family', async () => {
  const user = await UserModel.create({
    email: 'refresh-race@example.com',
    emailVerified: true,
    passwordHash: null,
    status: 'active',
    roles: ['admin'],
    profile: { name: 'Refresh Race', workspaceName: 'Race Desk' },
  });
  const req = {
    ip: '127.0.0.1',
    header(name) {
      return name.toLowerCase() === 'user-agent' ? 'identity-test' : undefined;
    },
  };
  const issued = await createSession(user, true, req);
  const loadUser = id => UserModel.findById(id);
  const results = await Promise.all([
    rotateSession(issued.refreshToken, req, loadUser),
    rotateSession(issued.refreshToken, req, loadUser),
  ]);

  assert.deepEqual(results.map(result => result.status).sort(), ['ok', 'reuse']);
  assert.equal(await SessionModel.countDocuments({ familyId: issued.familyId, revokedAt: null }), 0);
});

test('password recovery rotates credentials, revokes sessions and preserves generic responses', async () => {
  const base = `http://127.0.0.1:${appServer.port}`;
  const jar = new Map();
  let response = await request(base, jar, '/api/auth/csrf');
  const csrf = (await response.json()).csrfToken;

  response = await request(base, jar, '/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ email: 'recovery@example.com', password: 'correct horse battery staple', workspaceName: 'Recovery Desk' }),
  });
  assert.equal(response.status, 201);
  const verifyToken = delivered.at(-1).text.match(/token=([^&\s]+)/)?.[1];
  response = await request(base, jar, '/api/auth/verify-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ token: decodeURIComponent(verifyToken) }),
  });
  assert.equal(response.status, 200);

  response = await request(base, jar, '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ email: 'recovery@example.com', password: 'correct horse battery staple' }),
  });
  assert.equal(response.status, 200);
  const user = await UserModel.findOne({ email: 'recovery@example.com' });
  assert.equal(await SessionModel.countDocuments({ userId: user._id, revokedAt: null }), 1);

  response = await request(base, jar, '/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': jar.get('id_csrf') },
    body: JSON.stringify({ email: 'recovery@example.com' }),
  });
  assert.equal(response.status, 200);
  const resetToken = delivered.at(-1).text.match(/token=([^&\s]+)/)?.[1];
  assert.ok(resetToken);

  response = await request(base, jar, '/api/auth/reset-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': jar.get('id_csrf') },
    body: JSON.stringify({ token: decodeURIComponent(resetToken), password: 'new secure recovery phrase' }),
  });
  assert.equal(response.status, 200);
  assert.equal(await SessionModel.countDocuments({ userId: user._id, revokedAt: null }), 0);
  assert.equal(await EmailTokenModel.countDocuments({ userId: user._id, type: 'reset', usedAt: { $ne: null } }), 1);

  response = await request(base, jar, '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': jar.get('id_csrf') },
    body: JSON.stringify({ email: 'recovery@example.com', password: 'correct horse battery staple' }),
  });
  assert.equal(response.status, 401);
  response = await request(base, jar, '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': jar.get('id_csrf') },
    body: JSON.stringify({ email: 'recovery@example.com', password: 'new secure recovery phrase' }),
  });
  assert.equal(response.status, 200);

  response = await request(base, jar, '/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': jar.get('id_csrf') },
    body: JSON.stringify({ email: 'absent@example.com' }),
  });
  assert.equal(response.status, 200);
});

test('Google identities link by verified email and remain idempotent', async () => {
  const passwordUser = await UserModel.create({
    email: 'linked@example.com',
    emailVerified: true,
    passwordHash: 'existing-password-hash',
    status: 'active',
    roles: ['admin'],
    profile: { name: 'Linked User', workspaceName: 'Linked Desk' },
  });
  const linked = await upsertOAuthUser({ provider: 'google', subject: 'google-subject-1', email: 'LINKED@example.com', name: 'Google Name' });
  assert.equal(String(linked._id), String(passwordUser._id));
  assert.equal(linked.oauth.length, 1);
  const repeated = await upsertOAuthUser({ provider: 'google', subject: 'google-subject-1', email: 'linked@example.com', name: 'Google Name' });
  assert.equal(String(repeated._id), String(passwordUser._id));
  assert.equal(repeated.oauth.length, 1);
  assert.equal(await UserModel.countDocuments({ email: 'linked@example.com' }), 1);

  const created = await upsertOAuthUser({ provider: 'google', subject: 'google-subject-2', email: 'google.new@example.com', name: 'Google New' });
  assert.equal(created.emailVerified, true);
  assert.equal(created.firstLogin, true);
  assert.equal(created.oauth.length, 1);
  assert.equal(await UserModel.countDocuments({ email: 'google.new@example.com' }), 1);
});
