import { test } from 'node:test';
import assert from 'node:assert/strict';

test('market cache coalesces simultaneous misses when Mongo is unavailable', async () => {
  const { fetchWithCache } = await import('../dist/features/market/services/marketCache.js');
  let fetches = 0;
  const [first, second, third] = await Promise.all([
    fetchWithCache(
      'dedup-test',
      { ticker: 'TSLA', window: 60 },
      60_000,
      async () => {
        fetches += 1;
        await new Promise(resolve => setTimeout(resolve, 20));
        return { ok: true };
      },
      { ticker: 'TSLA' }
    ),
    fetchWithCache(
      'dedup-test',
      { window: 60, ticker: 'TSLA' },
      60_000,
      async () => {
        fetches += 1;
        return { ok: false };
      },
      { ticker: 'TSLA' }
    ),
    fetchWithCache(
      'dedup-test',
      { ticker: 'TSLA', window: 60 },
      60_000,
      async () => {
        fetches += 1;
        return { ok: false };
      },
      { ticker: 'TSLA' }
    )
  ]);

  assert.equal(fetches, 1, 'only one fetcher should execute for identical concurrent keys');
  assert.deepEqual(first.data, { ok: true });
  assert.deepEqual(second.data, { ok: true });
  assert.deepEqual(third.data, { ok: true });
  assert.equal(first.fromCache, false);
  assert.equal(second.fromCache, false);
  assert.equal(third.fromCache, false);
});
