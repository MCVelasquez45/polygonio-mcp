import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';

const authModule = await import('../dist/shared/auth/requestIdentity.js');
const { createRequestIdentityMiddleware } = authModule;

const requiredConfig = {
  enforcementMode: 'required',
  staticToken: 'test-token',
  defaultActorId: 'legacy-operator',
  defaultAccountId: 'paper-default',
  defaultRoles: ['viewer'],
};

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
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

async function withAuthApp(config, assertions) {
  const app = express();
  app.use(createRequestIdentityMiddleware(config));
  app.get('/api/read', (req, res) => {
    res.json({ auth: req.auth });
  });
  app.post('/api/write', (req, res) => {
    res.json({ auth: req.auth });
  });
  app.post('/internal/write', (req, res) => {
    res.json({ auth: req.auth });
  });

  const routeServer = await startServer(app);
  try {
    await assertions(`http://127.0.0.1:${routeServer.port}`);
  } finally {
    await closeServer(routeServer.server);
  }
}

test('required auth mode rejects unauthenticated state-changing API requests', async () => {
  await withAuthApp(requiredConfig, async base => {
    const response = await fetch(`${base}/api/write`, { method: 'POST' });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'AUTH_REQUIRED' });
  });
});

test('required auth mode fails closed when no bootstrap token is configured', async () => {
  await withAuthApp({ ...requiredConfig, staticToken: null }, async base => {
    const response = await fetch(`${base}/api/write`, { method: 'POST' });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'AUTH_CONFIGURATION_REQUIRED' });
  });
});

test('required auth mode accepts bearer token and propagates actor identity', async () => {
  await withAuthApp(requiredConfig, async base => {
    const response = await fetch(`${base}/api/write`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'x-ai-trader-actor-id': 'operator@example.com',
        'x-ai-trader-account-id': 'paper-account-1',
        'x-ai-trader-roles': 'operator,trader,unknown',
      },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.auth.authenticated, true);
    assert.equal(payload.auth.actorId, 'operator@example.com');
    assert.equal(payload.auth.accountId, 'paper-account-1');
    assert.deepEqual(payload.auth.roles, ['operator', 'trader']);
    assert.equal(payload.auth.authMethod, 'bearer');
    assert.equal(payload.auth.enforcementMode, 'required');
  });
});

test('required auth mode keeps read-only API requests compatible', async () => {
  await withAuthApp(requiredConfig, async base => {
    const response = await fetch(`${base}/api/read`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.auth.authenticated, false);
    assert.equal(payload.auth.actorId, 'legacy-operator');
    assert.equal(payload.auth.accountId, 'paper-default');
    assert.deepEqual(payload.auth.roles, ['viewer']);
    assert.equal(payload.auth.authMethod, 'legacy-compatible');
  });
});

test('observe auth mode does not block legacy state-changing requests', async () => {
  await withAuthApp({ ...requiredConfig, enforcementMode: 'observe' }, async base => {
    const response = await fetch(`${base}/api/write`, { method: 'POST' });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.auth.authenticated, false);
    assert.equal(payload.auth.actorId, 'legacy-operator');
    assert.equal(payload.auth.enforcementMode, 'observe');
  });
});

test('auth enforcement is scoped to API routes', async () => {
  await withAuthApp(requiredConfig, async base => {
    const response = await fetch(`${base}/internal/write`, { method: 'POST' });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.auth.authenticated, false);
  });
});
