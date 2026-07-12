// Integration test: massiveGet must retry HTTP 429 and then succeed.
// Proves the wired path (not just the policy helper). Uses a local HTTP server
// as a fake Massive endpoint. Env is set BEFORE importing the compiled module
// because massive.ts reads config at module load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

function startFakeMassive() {
  let calls = 0;
  const server = http.createServer((req, res) => {
    calls += 1;
    if (calls === 1) {
      // First hit: rate-limited. No Retry-After → backoff path.
      res.statusCode = 429;
      res.end(JSON.stringify({ status: 'ERROR', error: 'rate limited' }));
      return;
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'OK', results: [{ v: 42 }] }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, calls: () => calls }));
  });
}

test('massiveGet retries a 429 and returns the eventual 200 body', async () => {
  const fake = await startFakeMassive();
  // Configure the module via env before import.
  process.env.MASSIVE_API_KEY = 'test-key';
  process.env.MASSIVE_BASE_URL = `http://127.0.0.1:${fake.port}`;
  process.env.MASSIVE_MIN_INTERVAL_MS = '0';   // no inter-request spacing in test
  process.env.MASSIVE_RETRY_BASE_MS = '10';    // fast backoff
  process.env.MASSIVE_RETRY_MAX_MS = '50';
  process.env.MASSIVE_MAX_RETRIES = '3';

  const { massiveGet } = await import('../dist/shared/data/massive.js');
  try {
    const payload = await massiveGet('/v3/reference/tickers', { limit: 1 }, { cacheTtlMs: 0 });
    assert.deepEqual(payload.results, [{ v: 42 }], 'should return the post-retry 200 body');
    assert.equal(fake.calls(), 2, 'should have hit the server twice (429 then 200)');
  } finally {
    fake.server.close();
  }
});
