// Negative-DTE correction: exchange-calendar DTE (America/New_York).
// Requirements: same-day = 0 (never -1 while valid), expired excluded,
// UTC-midnight / ET boundaries / weekends / DST cannot flip the sign.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDteEt,
  isExpiredContract,
  exchangeDateOf,
  expirationWindowForDte,
  addCalendarDays,
} from '../dist/shared/time/tradingCalendar.js';

const ET = (iso) => Date.parse(iso);

test('same-day expiration is DTE 0 all through the ET session — the logged -1 bug', () => {
  // 2026-07-13 is a Monday. At 10:32 ET (14:32Z) the old UTC-midnight math
  // produced -1 for a 2026-07-13 expiration.
  const morning = ET('2026-07-13T14:32:00Z'); // 10:32 ET
  assert.equal(computeDteEt('2026-07-13', morning), 0);
  const afternoon = ET('2026-07-13T19:59:00Z'); // 15:59 ET
  assert.equal(computeDteEt('2026-07-13', afternoon), 0);
  assert.equal(isExpiredContract('2026-07-13', morning), false, 'valid before the cutoff');
});

test('expiration-day cutoff: expired after 16:15 ET, not before', () => {
  const beforeCutoff = ET('2026-07-13T20:10:00Z'); // 16:10 ET
  const afterCutoff = ET('2026-07-13T20:20:00Z'); // 16:20 ET
  assert.equal(isExpiredContract('2026-07-13', beforeCutoff), false);
  assert.equal(isExpiredContract('2026-07-13', afterCutoff), true);
});

test('UTC midnight boundary: late-evening ET is still the prior exchange date', () => {
  // 2026-07-13T03:00Z is 2026-07-12 23:00 ET → a 2026-07-13 expiration is 1 day out.
  const lateNightEt = ET('2026-07-13T03:00:00Z');
  assert.equal(exchangeDateOf(lateNightEt), '2026-07-12');
  assert.equal(computeDteEt('2026-07-13', lateNightEt), 1);
});

test('past expirations are negative and excluded as expired', () => {
  const now = ET('2026-07-13T14:00:00Z');
  assert.equal(computeDteEt('2026-07-10', now), -3);
  assert.equal(isExpiredContract('2026-07-10', now), true);
});

test('weekend gap: Friday → next-Friday expiration is 7 calendar days', () => {
  const friday = ET('2026-07-10T15:00:00Z'); // Friday 11:00 ET
  assert.equal(computeDteEt('2026-07-17', friday), 7);
  assert.equal(computeDteEt('2026-07-13', friday), 3, 'over the weekend');
});

test('DST spring-forward boundary does not shift the calendar diff', () => {
  // US DST began 2026-03-08. Compare across the transition.
  const beforeDst = ET('2026-03-06T20:00:00Z'); // Fri 15:00 ET (EST)
  assert.equal(computeDteEt('2026-03-13', beforeDst), 7);
  const afterDst = ET('2026-03-09T19:00:00Z'); // Mon 15:00 ET (EDT)
  assert.equal(computeDteEt('2026-03-13', afterDst), 4);
});

test('unparseable expirations return null, never a fake number', () => {
  const now = ET('2026-07-13T14:00:00Z');
  assert.equal(computeDteEt(null, now), null);
  assert.equal(computeDteEt('not-a-date', now), null);
  assert.equal(computeDteEt(undefined, now), null);
});

test('expirationWindowForDte covers the configured 7–21 DTE range in exchange days', () => {
  const now = ET('2026-07-13T14:00:00Z'); // Monday, exchange date 2026-07-13
  const window = expirationWindowForDte(now, 7, 21);
  assert.equal(window.gte, '2026-07-20');
  assert.equal(window.lte, '2026-08-03');
  // Bounds themselves map back to the requested DTE range.
  assert.equal(computeDteEt(window.gte, now), 7);
  assert.equal(computeDteEt(window.lte, now), 21);
});

test('addCalendarDays is pure date math (month/year rollover)', () => {
  assert.equal(addCalendarDays('2026-12-30', 5), '2027-01-04');
  assert.equal(addCalendarDays('2026-02-27', 2), '2026-03-01');
});
