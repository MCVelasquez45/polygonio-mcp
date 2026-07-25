import test from 'node:test';
import assert from 'node:assert/strict';

const originalEnv = {
  AGENT_CHAT_RETRIES: process.env.AGENT_CHAT_RETRIES,
  AGENT_CHAT_RETRY_DELAYS_MS: process.env.AGENT_CHAT_RETRY_DELAYS_MS,
  AGENT_WARMUP_ENABLED: process.env.AGENT_WARMUP_ENABLED,
  AGENT_WARMUP_INTERVAL_MS: process.env.AGENT_WARMUP_INTERVAL_MS,
  NODE_ENV: process.env.NODE_ENV,
};

const {
  getAgentChatRetryDelaysMs,
  getAgentWarmupIntervalMs,
  isAgentChatRetryableError,
  isAgentWarmupEnabled,
} = await import('../dist/features/assistant/agentClient.js');

test.afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test('agent chat retry defaults cover transient Render cold-start 502s', () => {
  delete process.env.AGENT_CHAT_RETRIES;
  delete process.env.AGENT_CHAT_RETRY_DELAYS_MS;

  assert.deepEqual(getAgentChatRetryDelaysMs(), [2000, 5000, 10000, 15000, 20000, 30000]);
});

test('agent chat retry budget can be constrained without changing delay order', () => {
  process.env.AGENT_CHAT_RETRIES = '3';
  process.env.AGENT_CHAT_RETRY_DELAYS_MS = '100, 200, 300, 400';

  assert.deepEqual(getAgentChatRetryDelaysMs(), [100, 200, 300]);
});

test('agent chat retries only transient upstream gateway failures and timeouts', () => {
  assert.equal(isAgentChatRetryableError({ response: { status: 502 } }), true);
  assert.equal(isAgentChatRetryableError({ response: { status: 503 } }), true);
  assert.equal(isAgentChatRetryableError({ response: { status: 504 } }), true);
  assert.equal(isAgentChatRetryableError({ code: 'ECONNABORTED' }), true);
  assert.equal(isAgentChatRetryableError({ response: { status: 400 } }), false);
  assert.equal(isAgentChatRetryableError({ response: { status: 429 } }), false);
});

test('agent warmup is production-on by default and clamps interval to one minute', () => {
  process.env.NODE_ENV = 'production';
  delete process.env.AGENT_WARMUP_ENABLED;
  process.env.AGENT_WARMUP_INTERVAL_MS = '5000';

  assert.equal(isAgentWarmupEnabled(), true);
  assert.equal(getAgentWarmupIntervalMs(), 60000);
});

test('agent warmup can be disabled explicitly for non-production and diagnostics', () => {
  process.env.NODE_ENV = 'production';
  process.env.AGENT_WARMUP_ENABLED = 'false';
  process.env.AGENT_WARMUP_INTERVAL_MS = '120000';

  assert.equal(isAgentWarmupEnabled(), false);
  assert.equal(getAgentWarmupIntervalMs(), 120000);
});
