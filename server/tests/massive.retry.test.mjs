// Unit tests for the single authoritative Massive retry policy.
// Run after `npm run build` (imports the compiled module from dist/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRetryableMassiveError,
  parseRetryAfterMs,
  resolveMassiveRetryDelayMs,
  MASSIVE_RETRYABLE_STATUS,
} from '../dist/shared/data/massiveRetry.js';

const axiosErr = (status, extra = {}) => ({ isAxiosError: true, response: { status, headers: {}, ...extra } });

test('429 is retryable (the P1 bug: it used to be excluded)', () => {
  assert.equal(isRetryableMassiveError(axiosErr(429), 0, 3), true);
  assert.ok(MASSIVE_RETRYABLE_STATUS.has(429));
});

test('transient 5xx are retryable, client 4xx are not', () => {
  for (const s of [500, 502, 503, 504]) assert.equal(isRetryableMassiveError(axiosErr(s), 0, 3), true, `status ${s}`);
  for (const s of [400, 401, 403, 404]) assert.equal(isRetryableMassiveError(axiosErr(s), 0, 3), false, `status ${s}`);
});

test('network timeouts are retryable', () => {
  assert.equal(isRetryableMassiveError({ isAxiosError: true, code: 'ECONNABORTED' }, 0, 3), true);
  assert.equal(isRetryableMassiveError({ isAxiosError: true, code: 'ETIMEDOUT' }, 0, 3), true);
});

test('retry budget and non-axios errors are respected', () => {
  assert.equal(isRetryableMassiveError(axiosErr(429), 3, 3), false, 'attempt == max → stop');
  assert.equal(isRetryableMassiveError(new Error('boom'), 0, 3), false, 'non-axios → no retry');
});

test('parseRetryAfterMs handles delta-seconds and HTTP-date', () => {
  assert.equal(parseRetryAfterMs('5'), 5000);
  assert.equal(parseRetryAfterMs(3), 3000);
  const future = new Date(Date.now() + 4000).toUTCString();
  const ms = parseRetryAfterMs(future);
  assert.ok(ms > 1000 && ms <= 5000, `expected ~4000, got ${ms}`);
  assert.equal(parseRetryAfterMs('nonsense-that-is-not-a-date'), null);
  assert.equal(parseRetryAfterMs(null), null);
});

test('resolveMassiveRetryDelayMs honors Retry-After, capped at maxMs', () => {
  const err = axiosErr(429, { headers: { 'retry-after': '2' } });
  assert.equal(resolveMassiveRetryDelayMs(err, 0, { baseMs: 500, maxMs: 5000 }), 2000);
  // header exceeds cap → clamped
  const big = axiosErr(429, { headers: { 'retry-after': '999' } });
  assert.equal(resolveMassiveRetryDelayMs(big, 0, { baseMs: 500, maxMs: 5000 }), 5000);
});

test('resolveMassiveRetryDelayMs falls back to exponential backoff', () => {
  const err = axiosErr(503); // no Retry-After
  assert.equal(resolveMassiveRetryDelayMs(err, 0, { baseMs: 500, maxMs: 5000 }), 500);
  assert.equal(resolveMassiveRetryDelayMs(err, 1, { baseMs: 500, maxMs: 5000 }), 1000);
  assert.equal(resolveMassiveRetryDelayMs(err, 2, { baseMs: 500, maxMs: 5000 }), 2000);
  assert.equal(resolveMassiveRetryDelayMs(err, 10, { baseMs: 500, maxMs: 5000 }), 5000, 'capped');
});
