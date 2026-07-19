/**
 * Client-side option analytics derived from fields the market data already
 * carries (spot, strike, IV, DTE, mark). These are DISPLAY estimates for the
 * matrix/ticket — Black-Scholes with r=0, no dividends — not trading logic.
 * Every function returns null rather than inventing a number when an input
 * is missing or degenerate.
 */

export type OptionSide = 'call' | 'put';

/** Standard normal CDF via Abramowitz–Stegun (max abs error ~7.5e-8). */
export function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

function d1d2(spot: number, strike: number, iv: number, yearsToExp: number): { d1: number; d2: number } | null {
  if (!(spot > 0) || !(strike > 0) || !(iv > 0) || !(yearsToExp > 0)) return null;
  const sigmaSqrtT = iv * Math.sqrt(yearsToExp);
  const d1 = (Math.log(spot / strike) + 0.5 * iv * iv * yearsToExp) / sigmaSqrtT;
  return { d1, d2: d1 - sigmaSqrtT };
}

/** Probability the option expires in the money: N(d2) calls, N(-d2) puts. */
export function probItm(
  side: OptionSide,
  spot: number | null | undefined,
  strike: number | null | undefined,
  iv: number | null | undefined,
  dte: number | null | undefined
): number | null {
  if (spot == null || strike == null || iv == null || dte == null) return null;
  const d = d1d2(spot, strike, iv, Math.max(dte, 0.02) / 365);
  if (!d) return null;
  return side === 'call' ? normCdf(d.d2) : normCdf(-d.d2);
}

/** Probability of expiring out of the money. */
export function probOtm(
  side: OptionSide,
  spot: number | null | undefined,
  strike: number | null | undefined,
  iv: number | null | undefined,
  dte: number | null | undefined
): number | null {
  const itm = probItm(side, spot, strike, iv, dte);
  return itm == null ? null : 1 - itm;
}

/**
 * Probability the underlying TOUCHES the strike before expiration. Standard
 * desk approximation: ≈ 2 × prob of expiring ITM, capped at 1 (exact by the
 * reflection principle for driftless GBM).
 */
export function probTouch(
  side: OptionSide,
  spot: number | null | undefined,
  strike: number | null | undefined,
  iv: number | null | undefined,
  dte: number | null | undefined
): number | null {
  if (spot == null || strike == null) return null;
  // Already through the strike → it has touched.
  const through = side === 'call' ? spot >= strike : spot <= strike;
  if (through) return 1;
  const itm = probItm(side, spot, strike, iv, dte);
  return itm == null ? null : Math.min(1, 2 * itm);
}

/** 1σ expected move of the underlying by expiration: S·σ·√(DTE/365). */
export function expectedMove(
  spot: number | null | undefined,
  iv: number | null | undefined,
  dte: number | null | undefined
): number | null {
  if (spot == null || iv == null || dte == null) return null;
  if (!(spot > 0) || !(iv > 0) || dte < 0) return null;
  return spot * iv * Math.sqrt(Math.max(dte, 0.02) / 365);
}

/** Intrinsic value of the contract at the current spot. */
export function intrinsicValue(
  side: OptionSide,
  spot: number | null | undefined,
  strike: number | null | undefined
): number | null {
  if (spot == null || strike == null) return null;
  return side === 'call' ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
}

/** Extrinsic (time) value: mark minus intrinsic, floored at 0. */
export function extrinsicValue(
  side: OptionSide,
  spot: number | null | undefined,
  strike: number | null | undefined,
  mark: number | null | undefined
): number | null {
  const intrinsic = intrinsicValue(side, spot, strike);
  if (intrinsic == null || mark == null) return null;
  return Math.max(0, mark - intrinsic);
}

/** Bid/ask spread as a percent of the mid; null when the mid is degenerate. */
export function spreadPercent(bid: number | null | undefined, ask: number | null | undefined): number | null {
  if (bid == null || ask == null) return null;
  if (!(ask >= bid) || ask <= 0) return null;
  const mid = (bid + ask) / 2;
  if (mid <= 0) return null;
  return ((ask - bid) / mid) * 100;
}

/**
 * Probability of profit for a LONG single-leg at expiration: the chance the
 * underlying finishes beyond breakeven (strike + premium for calls, strike −
 * premium for puts). Uses the same N(d2) machinery with the breakeven as the
 * effective strike.
 */
export function probOfProfitLong(
  side: OptionSide,
  spot: number | null | undefined,
  strike: number | null | undefined,
  premium: number | null | undefined,
  iv: number | null | undefined,
  dte: number | null | undefined
): number | null {
  if (strike == null || premium == null) return null;
  const breakeven = side === 'call' ? strike + premium : strike - premium;
  if (!(breakeven > 0)) return null;
  return probItm(side, spot, breakeven, iv, dte);
}
