import { describe, expect, it } from 'vitest';
import {
  expectedMove,
  extrinsicValue,
  intrinsicValue,
  normCdf,
  probItm,
  probOfProfitLong,
  probOtm,
  probTouch,
  spreadPercent,
} from '../lib/optionsMath';

describe('optionsMath', () => {
  it('normCdf matches known values', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it('ATM prob ITM is slightly below 50% for calls (lognormal drift term)', () => {
    const p = probItm('call', 100, 100, 0.3, 30);
    expect(p).not.toBeNull();
    expect(p!).toBeGreaterThan(0.4);
    expect(p!).toBeLessThan(0.5);
  });

  it('deep ITM call ≈ 1, deep OTM call ≈ 0, and put mirrors', () => {
    expect(probItm('call', 100, 50, 0.3, 30)!).toBeGreaterThan(0.99);
    expect(probItm('call', 100, 200, 0.3, 30)!).toBeLessThan(0.01);
    expect(probItm('put', 100, 200, 0.3, 30)!).toBeGreaterThan(0.99);
  });

  it('probOtm complements probItm', () => {
    const itm = probItm('call', 100, 105, 0.25, 21)!;
    const otm = probOtm('call', 100, 105, 0.25, 21)!;
    expect(itm + otm).toBeCloseTo(1, 10);
  });

  it('probTouch is ~2× probItm capped at 1, and 1 when already through', () => {
    const itm = probItm('call', 100, 110, 0.3, 30)!;
    expect(probTouch('call', 100, 110, 0.3, 30)!).toBeCloseTo(Math.min(1, 2 * itm), 10);
    expect(probTouch('call', 100, 95, 0.3, 30)).toBe(1);
    expect(probTouch('put', 100, 105, 0.3, 30)).toBe(1);
  });

  it('expected move is S·σ·√(t)', () => {
    expect(expectedMove(100, 0.2, 365)!).toBeCloseTo(20, 6);
    expect(expectedMove(100, 0, 30)).toBeNull();
    expect(expectedMove(null, 0.2, 30)).toBeNull();
  });

  it('intrinsic / extrinsic split the mark', () => {
    expect(intrinsicValue('call', 105, 100)).toBe(5);
    expect(intrinsicValue('put', 105, 100)).toBe(0);
    expect(extrinsicValue('call', 105, 100, 6.5)).toBeCloseTo(1.5, 10);
    // Extrinsic never goes negative even if the mark is below intrinsic.
    expect(extrinsicValue('call', 105, 100, 4)).toBe(0);
  });

  it('spreadPercent handles crossed/degenerate quotes', () => {
    expect(spreadPercent(1.0, 1.1)!).toBeCloseTo((0.1 / 1.05) * 100, 6);
    expect(spreadPercent(1.1, 1.0)).toBeNull();
    expect(spreadPercent(null, 1.0)).toBeNull();
  });

  it('probOfProfitLong uses breakeven as the effective strike', () => {
    const popCall = probOfProfitLong('call', 100, 100, 3, 0.3, 30)!;
    const itmAtBreakeven = probItm('call', 100, 103, 0.3, 30)!;
    expect(popCall).toBeCloseTo(itmAtBreakeven, 10);
    // Paying premium always lowers POP vs raw prob ITM at the strike.
    expect(popCall).toBeLessThan(probItm('call', 100, 100, 0.3, 30)!);
  });
});
