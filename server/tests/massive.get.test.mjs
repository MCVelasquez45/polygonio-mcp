// Integration test: massiveGet's 429 handling on the fully wired path (not just
// the policy helper). Uses a local HTTP server as a fake Massive endpoint. Env
// is set BEFORE importing the compiled module because massive.ts reads config
// (incl. base URL) once at module load — so all cases share ONE fake server and
// vary behavior by request path.
//
// Corrected policy (see massiveRetry.ts): a 429 is retried ONLY when the
// provider sent Retry-After. A bare 429 must fail fast — retrying it on
// sub-second backoff cannot clear a per-minute quota and only amplifies the
// throttle (the measured production request-storm).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

function startFakeMassive() {
  const calls = { retry: 0, bare: 0 };
  const server = http.createServer((req, res) => {
    if (req.url.includes('/retry-with-header')) {
      calls.retry += 1;
      if (calls.retry === 1) {
        res.statusCode = 429;
        res.setHeader('retry-after', '0'); // provider-directed → retry allowed
        res.end(JSON.stringify({ status: 'ERROR', error: 'rate limited' }));
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'OK', results: [{ v: 42 }] }));
      return;
    }
    // bare 429: no Retry-After, every time
    calls.bare += 1;
    res.statusCode = 429;
    res.end(JSON.stringify({ status: 'ERROR', error: 'rate limited' }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, calls }));
  });
}

test('massiveGet retries a 429 WITH Retry-After but fails fast on a bare 429', async () => {
  const fake = await startFakeMassive();
  process.env.MASSIVE_API_KEY = 'test-key';
  process.env.MASSIVE_BASE_URL = `http://127.0.0.1:${fake.port}`;
  process.env.MASSIVE_MIN_INTERVAL_MS = '0';   // no inter-request spacing in test
  process.env.MASSIVE_RETRY_BASE_MS = '10';    // fast backoff
  process.env.MASSIVE_RETRY_MAX_MS = '50';
  process.env.MASSIVE_MAX_RETRIES = '3';

  const { massiveGet, clearRateLimitBlocks } = await import('../dist/shared/data/massive.js');
  try {
    // 1) Provider-directed 429 (Retry-After) → retried, then 200.
    clearRateLimitBlocks();
    const payload = await massiveGet('/retry-with-header', { limit: 1 }, { cacheTtlMs: 0 });
    assert.deepEqual(payload.results, [{ v: 42 }], 'should return the post-retry 200 body');
    assert.equal(fake.calls.retry, 2, 'should hit twice (429+Retry-After then 200)');

    // 2) Bare 429 (no Retry-After) → NOT retried, surfaces as an error, one hit.
    clearRateLimitBlocks();
    await assert.rejects(
      massiveGet('/bare-429', { limit: 1 }, { cacheTtlMs: 0 }),
      'a bare 429 should surface, not be retried into a 200'
    );
    assert.equal(fake.calls.bare, 1, 'should hit the server exactly once (no retry storm)');
  } finally {
    fake.server.close();
  }
});
