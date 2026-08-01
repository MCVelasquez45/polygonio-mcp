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
  assert.equal(await OrganizationModel.countDocuments({ ownerId: user._id }), 1);
  assert.equal(await MembershipModel.countDocuments({ userId: user._id }), 1);
  assert.equal(await BrokerConnectionModel.countDocuments({ userId: user._id }), 5);
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
