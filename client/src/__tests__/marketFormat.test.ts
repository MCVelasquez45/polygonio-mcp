/**
 * The operator cockpit's cardinal rule: a MISSING market value must never render
 * as a real number. These tests lock in that a null bid/ask/spread/greek shows the
 * em-dash placeholder — never "$0.00", "0.0%", or "×0" — while a genuine zero still
 * renders as zero. Also covers the freshness state machine and live P/L math.
 */
import { describe, expect, it } from 'vitest';
import {
  UNAVAILABLE,
  freshnessOf,
  fmtMoney,
  fmtSignedMoney,
  fmtPercent,
  fmtSignedPercent,
  fmtNumber,
  fmtSize,
  fmtGreek,
  fmtDuration,
  tickDirection,
  computeUnrealizedPnl,
  computeUnrealizedPnlPct,
  distanceToTrigger,
} from '../lib/marketFormat';

describe('never renders absent values as $0.00', () => {
  it.each([null, undefined, ''])('fmtMoney(%s) is the em dash, not $0.00', (v) => {
    expect(fmtMoney(v)).toBe(UNAVAILABLE);
    expect(fmtMoney(v)).not.toBe('$0.00');
  });

  it('fmtMoney renders a genuine zero as $0.00', () => {
    expect(fmtMoney(0)).toBe('$0.00');
  });

  it('fmtMoney formats positive and negative dollars', () => {
    expect(fmtMoney(6.4)).toBe('$6.40');
    expect(fmtMoney(-1.2)).toBe('-$1.20');
  });

  it('fmtSignedMoney signs both directions, em dash when absent', () => {
    expect(fmtSignedMoney(142)).toBe('+$142.00');
    expect(fmtSignedMoney(-40)).toBe('-$40.00');
    expect(fmtSignedMoney(null)).toBe(UNAVAILABLE);
  });

  it.each([null, undefined, ''])('fmtPercent(%s) is the em dash, not 0.0%', (v) => {
    expect(fmtPercent(v)).toBe(UNAVAILABLE);
  });

  it('fmtPercent / fmtSignedPercent format real values', () => {
    expect(fmtPercent(0.3)).toBe('0.3%');
    expect(fmtSignedPercent(12.5)).toBe('+12.5%');
    expect(fmtSignedPercent(-3)).toBe('-3.0%');
  });

  it('fmtSize shows ×N for real sizes, em dash when absent (never ×0)', () => {
    expect(fmtSize(18)).toBe('×18');
    expect(fmtSize(null)).toBe(UNAVAILABLE);
    expect(fmtSize(0)).toBe('×0'); // a genuine zero size is still shown
  });

  it('fmtGreek / fmtNumber guard absence', () => {
    expect(fmtGreek(0.58)).toBe('0.58');
    expect(fmtGreek(null)).toBe(UNAVAILABLE);
    expect(fmtNumber(4120)).toBe('4,120');
    expect(fmtNumber(undefined)).toBe(UNAVAILABLE);
  });

  it('NaN and Infinity are treated as absent', () => {
    expect(fmtMoney(NaN)).toBe(UNAVAILABLE);
    expect(fmtMoney(Infinity)).toBe(UNAVAILABLE);
    expect(fmtPercent('abc')).toBe(UNAVAILABLE);
  });
});

describe('freshnessOf', () => {
  it('UNAVAILABLE when age is absent or negative', () => {
    expect(freshnessOf(null, 5000)).toBe('UNAVAILABLE');
    expect(freshnessOf(undefined, 5000)).toBe('UNAVAILABLE');
    expect(freshnessOf(-1, 5000)).toBe('UNAVAILABLE');
  });
  it('FRESH within threshold, STALE beyond it', () => {
    expect(freshnessOf(1000, 5000)).toBe('FRESH');
    expect(freshnessOf(5000, 5000)).toBe('FRESH'); // boundary is inclusive-fresh
    expect(freshnessOf(5001, 5000)).toBe('STALE');
  });
});

describe('fmtDuration', () => {
  it('formats seconds, minutes, hours; absent → em dash', () => {
    expect(fmtDuration(5000)).toBe('5s');
    expect(fmtDuration(65000)).toBe('1m 5s');
    expect(fmtDuration(3_660_000)).toBe('1h 1m');
    expect(fmtDuration(null)).toBe(UNAVAILABLE);
    expect(fmtDuration(-1)).toBe(UNAVAILABLE);
  });
});

describe('tickDirection', () => {
  it('reports up/down/none and none when either side absent', () => {
    expect(tickDirection(6.4, 6.41)).toBe('up');
    expect(tickDirection(6.41, 6.4)).toBe('down');
    expect(tickDirection(6.4, 6.4)).toBe('none');
    expect(tickDirection(null, 6.4)).toBe('none');
    expect(tickDirection(6.4, undefined)).toBe('none');
  });
});

describe('live P/L math', () => {
  it('computes long-option unrealized P/L with the 100 multiplier', () => {
    // (6.41 - 5.70) * 2 * 100 = 142
    expect(computeUnrealizedPnl(6.41, 5.7, 2)).toBeCloseTo(142, 6);
  });
  it('returns null when any input is absent (never a fabricated 0)', () => {
    expect(computeUnrealizedPnl(null, 5.7, 2)).toBeNull();
    expect(computeUnrealizedPnl(6.41, null, 2)).toBeNull();
    expect(computeUnrealizedPnl(6.41, 5.7, null)).toBeNull();
  });
  it('computes P/L percent and guards zero entry', () => {
    expect(computeUnrealizedPnlPct(6.41, 5.7)).toBeCloseTo(12.456, 2);
    expect(computeUnrealizedPnlPct(6.41, 0)).toBeNull();
  });
});

describe('distanceToTrigger', () => {
  it('signs distance (mark above trigger is positive) and computes pct of mark', () => {
    const d = distanceToTrigger(6.42, 4.28);
    expect(d.abs).toBeCloseTo(2.14, 6);
    expect(d.pct).toBeCloseTo(33.33, 1);
  });
  it('negative when mark is below the trigger (target above)', () => {
    const d = distanceToTrigger(6.42, 6.55);
    expect(d.abs).toBeCloseTo(-0.13, 6);
    expect(d.pct).toBeLessThan(0);
  });
  it('null when either input absent', () => {
    expect(distanceToTrigger(null, 4.28)).toEqual({ abs: null, pct: null });
  });
});
