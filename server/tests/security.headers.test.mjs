import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'production';
process.env.AI_TRADER_NO_BOOTSTRAP = 'true';
process.env.MASSIVE_OPTIONS_WS_ENABLED = 'false';
process.env.CORS_ORIGINS = 'https://polygonio-mcp-beryl.vercel.app';

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

const { app } = await import('../dist/index.js');

test('production security middleware emits hardened headers without X-Powered-By', async () => {
  const routeServer = await startServer(app);
  try {
    const response = await fetch(`http://127.0.0.1:${routeServer.port}/health`, {
      headers: {
        origin: 'https://polygonio-mcp-beryl.vercel.app',
        'accept-encoding': 'gzip',
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(response.headers.get('strict-transport-security') ?? '', /max-age=15552000/);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://polygonio-mcp-beryl.vercel.app');
  } finally {
    await closeServer(routeServer.server);
  }
});

test('system health exposes additive runtime telemetry fields', async () => {
  const routeServer = await startServer(app);
  try {
    const response = await fetch(`http://127.0.0.1:${routeServer.port}/api/system/health`);
    assert.ok([200, 503].includes(response.status));
    const payload = await response.json();
    assert.equal(typeof payload.timestamp, 'string');
    assert.equal(typeof payload.runtime.market.queueDepth, 'number');
    assert.equal(typeof payload.runtime.mongo.connected, 'boolean');
    assert.equal(typeof payload.runtime.broker.truthCurrent, 'boolean');
    assert.ok('latencyMs' in payload.runtime.ai);
    assert.ok('lastSnapshotAt' in payload.runtime.market);
    assert.ok('lastOptionTickAt' in payload.runtime.market);
    assert.ok(Array.isArray(payload.runtime.automation.recentDecisions));
  } finally {
    await closeServer(routeServer.server);
  }
});
