import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';

process.env.AGENT_HEALTH_TIMEOUT_MS = '50';
process.env.AGENT_HEALTH_CACHE_TTL_MS = '10';
process.env.AGENT_HEALTH_STALE_OK_MS = '5000';
process.env.OPENAI_API_KEY = 'test-openai-key';

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

async function delay(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

const agentState = {
  calls: 0,
  delayMs: 0,
  status: 200,
};

const agentServer = await startServer(async (_req, res) => {
  agentState.calls += 1;
  await delay(agentState.delayMs);
  res.writeHead(agentState.status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', service: 'test-agent' }));
});

process.env.AGENT_API_URL = `http://127.0.0.1:${agentServer.port}`;

const agentProxyModule = await import('../dist/features/assistant/agentProxy.routes.js');
const agentProxyRouter = agentProxyModule.default.default;
const { resetAiHealthForTests } = agentProxyModule;

function makeApp() {
  const app = express();
  app.use('/api/agent', agentProxyRouter);
  return app;
}

test.after(async () => {
  await closeServer(agentServer.server);
});

test.beforeEach(() => {
  resetAiHealthForTests();
  agentState.calls = 0;
  agentState.delayMs = 0;
  agentState.status = 200;
});

test('/api/agent/health coalesces concurrent upstream probes', async () => {
  agentState.delayMs = 25;
  const routeServer = await startServer(makeApp());
  try {
    const url = `http://127.0.0.1:${routeServer.port}/api/agent/health`;
    const responses = await Promise.all(Array.from({ length: 5 }, () => fetch(url)));
    const payloads = await Promise.all(responses.map(response => response.json()));

    assert.equal(agentState.calls, 1);
    for (const response of responses) assert.equal(response.status, 200);
    for (const payload of payloads) {
      assert.equal(payload.status, 'ok');
      assert.equal(payload.agentReachable, true);
    }
  } finally {
    await closeServer(routeServer.server);
  }
});

test('/api/agent/health serves stale successful health through transient timeout', async () => {
  const routeServer = await startServer(makeApp());
  try {
    const url = `http://127.0.0.1:${routeServer.port}/api/agent/health`;

    const first = await fetch(url);
    assert.equal(first.status, 200);
    assert.equal((await first.json()).status, 'ok');

    await delay(1100);
    agentState.delayMs = 100;

    const second = await fetch(url);
    const payload = await second.json();

    assert.equal(second.status, 200);
    assert.equal(payload.status, 'ok');
    assert.equal(payload.agentReachable, true);
    assert.equal(payload.cached, true);
    assert.equal(payload.stale, true);
    assert.equal(agentState.calls, 2);
  } finally {
    await closeServer(routeServer.server);
  }
});
