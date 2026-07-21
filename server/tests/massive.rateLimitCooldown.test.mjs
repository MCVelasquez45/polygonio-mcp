// Regression test for the 429 request-storm blocker. Once Massive rate-limits
// an endpoint class, the shared client must fail fast until cooldown expires
// instead of letting each chart/AI/watchlist caller trigger another provider hit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

function startFakeMassive() {
  let aggregateHits = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/v2/aggs/ticker/TSLA/range/1/day/')) {
      aggregateHits += 1;
      res.statusCode = 429;
      res.setHeader('retry-after', '1');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'ERROR', error: 'rate limited' }));
      return;
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'OK', results: [] }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: server.address().port, aggregateHits: () => aggregateHits })
    );
  });
}

test('daily aggregate 429 creates an endpoint cooldown and prevents repeated provider hits', async () => {
  const fake = await startFakeMassive();
  process.env.MASSIVE_API_KEY = 'test-key';
  process.env.MASSIVE_BASE_URL = `http://127.0.0.1:${fake.port}`;
  process.env.MASSIVE_MIN_INTERVAL_MS = '0';
  process.env.MASSIVE_RETRY_BASE_MS = '10';
  process.env.MASSIVE_RETRY_MAX_MS = '20';
  process.env.MASSIVE_MAX_RETRIES = '0';
  process.env.MASSIVE_RATE_LIMIT_BLOCK_TTL_MS = '5000';
  process.env.MASSIVE_LOG_THROTTLE_MS = '0';

  const { massiveGet, clearRateLimitBlocks, getRateLimitBlocks } = await import('../dist/shared/data/massive.js');
  const path = '/v2/aggs/ticker/TSLA/range/1/day/2026-07-01/2026-07-21';

  try {
    clearRateLimitBlocks();
    await assert.rejects(
      () => massiveGet(path, { adjusted: true, limit: 60, sort: 'asc' }, { cacheTtlMs: 0 }),
      (error) => error?.response?.status === 429
    );
    assert.equal(fake.aggregateHits(), 1, 'first failed request reaches Massive once');

    await assert.rejects(
      () => massiveGet(path, { adjusted: true, limit: 60, sort: 'asc' }, { cacheTtlMs: 0 }),
      (error) => error?.code === 'MASSIVE_RATE_LIMIT_COOLDOWN'
    );
    assert.equal(fake.aggregateHits(), 1, 'second request is blocked locally during cooldown');
    assert.ok(
      getRateLimitBlocks()['/v2/aggs/stocks/day'],
      'rate-limit block is visible in Massive health stats'
    );
  } finally {
    fake.server.close();
  }
});
