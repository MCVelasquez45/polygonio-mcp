// Entitlement + rate-limit behavior of the shared Massive client:
//  * NOT_AUTHORIZED (plan) failures never enter a retry loop and block the
//    endpoint class, while other endpoint classes stay available
//  * Retry-After is respected (never retried earlier than directed)
//  * retry backoff carries jitter
//  * low-priority (WATCHLIST) requests yield to AUTOMATION_DECISION requests
//  * logs contain no full cursors and no API key
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

function startFakeMassive(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push({ path: url.pathname, params: url.searchParams, at: Date.now() });
    handler(url, res, requests.length);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: server.address().port, requests })
    );
  });
}

const fake = await startFakeMassive((url, res) => {
  res.setHeader('content-type', 'application/json');
  if (url.pathname.startsWith('/v2/aggs/ticker/SPY/')) {
    // Plan limitation exactly as probed live on 2026-07-13.
    res.statusCode = 403;
    res.end(
      JSON.stringify({ status: 'NOT_AUTHORIZED', message: "Your plan doesn't include this data timeframe." })
    );
    return;
  }
  if (url.pathname.startsWith('/v2/aggs/ticker/O:')) {
    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'OK', results: [{ t: 1783953060000, o: 1, h: 1, l: 1, c: 1, v: 5 }] }));
    return;
  }
  if (url.pathname === '/slow') {
    setTimeout(() => {
      res.statusCode = 200;
      res.end(JSON.stringify({ status: 'OK', results: [] }));
    }, 120);
    return;
  }
  res.statusCode = 200;
  res.end(JSON.stringify({ status: 'OK', results: [] }));
});

process.env.MASSIVE_API_KEY = 'test-key-SECRET';
process.env.MASSIVE_BASE_URL = `http://127.0.0.1:${fake.port}`;
process.env.MASSIVE_MIN_INTERVAL_MS = '10';
process.env.MASSIVE_MAX_CONCURRENT = '1';
process.env.MASSIVE_RETRY_BASE_MS = '10';
process.env.MASSIVE_RETRY_MAX_MS = '50';
process.env.MASSIVE_MAX_RETRIES = '3';

const massive = await import('../dist/shared/data/massive.js');
const retryMod = await import('../dist/shared/data/massiveRetry.js');
const { massiveGet, REQUEST_PRIORITY, getEntitlementBlocks, clearEntitlementBlocks, logHash } = massive;
const { MassiveEntitlementError, isRetryableMassiveError, resolveMassiveRetryDelayMs, applyRetryJitter } = retryMod;

test('7. unauthorized stock aggregates: one provider hit, no retry loop, endpoint class blocked', async () => {
  const before = fake.requests.length;
  await assert.rejects(
    () => massiveGet('/v2/aggs/ticker/SPY/range/5/minute/2026-07-13/2026-07-13', { limit: 3 }, { cacheTtlMs: 0 }),
    (err) => err instanceof MassiveEntitlementError
  );
  const hits = fake.requests.filter(r => r.path.startsWith('/v2/aggs/ticker/SPY/')).length;
  assert.equal(hits, 1, 'a 403 plan failure must NOT be retried');

  // Second call fails fast without touching the network at all.
  await assert.rejects(
    () => massiveGet('/v2/aggs/ticker/SPY/range/5/minute/2026-07-13/2026-07-13', { limit: 3 }, { cacheTtlMs: 0 }),
    (err) => err instanceof MassiveEntitlementError
  );
  assert.equal(
    fake.requests.filter(r => r.path.startsWith('/v2/aggs/ticker/SPY/')).length,
    1,
    'entitlement-blocked endpoint class must fail fast without a request'
  );
  assert.ok(Object.keys(getEntitlementBlocks()).length >= 1, 'block is visible to health reporting');

  // Options data on the same client remains fully available.
  const options = await massiveGet(
    '/v2/aggs/ticker/O:SPY260720C00753000/range/1/minute/2026-07-13/2026-07-13',
    { limit: 1 },
    { cacheTtlMs: 0 }
  );
  assert.equal(options.status, 'OK');
  assert.equal(options.results.length, 1);
  assert.ok(before < fake.requests.length);
});

test('8. Retry-After is respected: retry never fires earlier than directed', () => {
  const err = {
    isAxiosError: true,
    response: { status: 429, headers: { 'retry-after': '2' } },
  };
  for (let i = 0; i < 20; i += 1) {
    const delay = resolveMassiveRetryDelayMs(err, 0, { baseMs: 10, maxMs: 50 });
    assert.ok(delay >= 2000, `delay ${delay} must be >= the 2s Retry-After`);
    assert.ok(delay <= 2300, `delay ${delay} keeps jitter bounded upward`);
  }
});

test('backoff without Retry-After is jittered within bounds', () => {
  const err = { isAxiosError: true, response: { status: 429, headers: {} } };
  const seen = new Set();
  for (let i = 0; i < 50; i += 1) {
    const delay = resolveMassiveRetryDelayMs(err, 1, { baseMs: 100, maxMs: 10_000 });
    // base 100 * 2^1 = 200, jitter ±25% → [150, 250]
    assert.ok(delay >= 150 && delay <= 250, `delay ${delay} in jitter window`);
    seen.add(delay);
  }
  assert.ok(seen.size > 1, 'jitter must actually vary');
  assert.equal(applyRetryJitter(0), 0);
});

test('entitlement errors are never classified retryable', () => {
  const err = new MassiveEntitlementError('/v2/aggs/x', 403, 'plan');
  assert.equal(isRetryableMassiveError(err, 0, 5), false);
});

test('9. WATCHLIST requests yield to AUTOMATION_DECISION under a busy queue', async () => {
  clearEntitlementBlocks();
  const startIndex = fake.requests.length;
  // Occupy the single slot with a slow request, then enqueue watchlist BEFORE
  // automation — the automation request must still hit the wire first.
  const slow = massiveGet('/slow', {}, { cacheTtlMs: 0, priority: REQUEST_PRIORITY.BACKGROUND });
  await new Promise(r => setTimeout(r, 20)); // ensure /slow is in flight
  const watchlist = massiveGet('/watchlist-endpoint', {}, { cacheTtlMs: 0, priority: REQUEST_PRIORITY.WATCHLIST });
  const automation = massiveGet('/automation-endpoint', {}, { cacheTtlMs: 0, priority: REQUEST_PRIORITY.AUTOMATION_DECISION });
  await Promise.all([slow, watchlist, automation]);
  const order = fake.requests.slice(startIndex).map(r => r.path);
  const automationIdx = order.indexOf('/automation-endpoint');
  const watchlistIdx = order.indexOf('/watchlist-endpoint');
  assert.ok(automationIdx !== -1 && watchlistIdx !== -1, `both drained (${order.join(',')})`);
  assert.ok(automationIdx < watchlistIdx, `automation before watchlist (${order.join(',')})`);
});

test('21. logs carry hashed cursors and never the API key', async () => {
  const captured = [];
  const original = console.log;
  console.log = (...args) => captured.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  try {
    await massiveGet('/v3/reference/options/contracts', { cursor: 'FULL_CURSOR_VALUE_abc123', limit: 5 }, { cacheTtlMs: 0 });
  } finally {
    console.log = original;
  }
  const joined = captured.join('\n');
  assert.ok(!joined.includes('FULL_CURSOR_VALUE_abc123'), 'raw cursor must not be logged');
  assert.ok(joined.includes(`#${logHash('FULL_CURSOR_VALUE_abc123')}`), 'cursor appears only as a short hash');
  assert.ok(!joined.includes('test-key-SECRET'), 'API key must never be logged');
});

test.after(() => {
  fake.server.close();
});
