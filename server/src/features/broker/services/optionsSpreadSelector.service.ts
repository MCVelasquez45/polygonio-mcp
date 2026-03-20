/**
 * Options spread selector — finds the right 0DTE credit spread strikes
 * from the Alpaca options chain based on the strategy's contract_selection config.
 *
 * For the House Strategy:
 *   - 0DTE SPX/SPXW options
 *   - ~20 delta short leg
 *   - Credit spread (sell short leg, buy further OTM long leg)
 *   - 5-point spread width
 */

import {
  getAlpacaOptionChain,
  getAlpacaLatestTrade,
} from './alpaca';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContractSelection = {
  contract_type: 'call' | 'put';
  strike_selection: string;      // "delta_target"
  delta_target: number;          // 0.2
  dte_min: number;               // 0
  dte_max: number;               // 0
  spread_strategy: string;       // "credit_spread"
  spread_width: number;          // 5
  short_leg_delta: number;       // 0.2
};

export type SpreadLeg = {
  symbol: string;        // OCC option symbol
  strike: number;
  type: 'call' | 'put';
  side: 'sell' | 'buy';
  delta: number;
  bid: number;
  ask: number;
  position_intent: 'sell_to_open' | 'buy_to_open';
};

export type SelectedSpread = {
  direction: 'put_credit_spread' | 'call_credit_spread';
  shortLeg: SpreadLeg;
  longLeg: SpreadLeg;
  estimatedCredit: number;  // net credit received
  maxLoss: number;          // spread width - credit
  underlyingPrice: number;
  expirationDate: string;
  underlying: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build today's expiration date string in YYYY-MM-DD format (Eastern Time).
 */
function getTodayExpiration(): string {
  const now = new Date();
  // Convert to Eastern Time
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const y = eastern.getFullYear();
  const m = String(eastern.getMonth() + 1).padStart(2, '0');
  const d = String(eastern.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Determine the underlying symbol for options chain lookup.
 * SPX uses SPXW for 0DTE (weeklys). Also handle SPY.
 */
function resolveOptionsUnderlying(ticker: string): string {
  const upper = ticker.toUpperCase();
  // SPX 0DTE options trade under SPXW
  if (upper === 'SPX') return 'SPXW';
  return upper;
}

/**
 * Determine the underlying symbol for price lookup.
 * SPX doesn't have a directly tradable price on Alpaca, use SPY * 10 as proxy
 * or fetch SPX index if available.
 */
function resolvePriceSymbol(ticker: string): string {
  const upper = ticker.toUpperCase();
  if (upper === 'SPX' || upper === 'SPXW') return 'SPY';
  return upper;
}

function extractGreeks(contract: any): { delta: number; gamma: number; theta: number; vega: number } {
  const greeks = contract?.greeks ?? contract?.Greeks ?? {};
  return {
    delta: Math.abs(Number(greeks?.delta ?? greeks?.Delta ?? 0)),
    gamma: Number(greeks?.gamma ?? greeks?.Gamma ?? 0),
    theta: Number(greeks?.theta ?? greeks?.Theta ?? 0),
    vega: Number(greeks?.vega ?? greeks?.Vega ?? 0),
  };
}

function extractQuote(contract: any): { bid: number; ask: number } {
  const quote = contract?.latestQuote ?? contract?.LatestQuote ?? {};
  return {
    bid: Number(quote?.bp ?? quote?.BidPrice ?? quote?.bid_price ?? 0),
    ask: Number(quote?.ap ?? quote?.AskPrice ?? quote?.ask_price ?? 0),
  };
}

function extractStrike(contract: any): number {
  return Number(
    contract?.strike_price ??
    contract?.strikePrice ??
    contract?.StrikePrice ??
    0,
  );
}

function extractSymbol(contract: any): string {
  return contract?.symbol ?? contract?.Symbol ?? '';
}

function extractType(contract: any): 'call' | 'put' {
  const t = (contract?.type ?? contract?.Type ?? contract?.option_type ?? '').toLowerCase();
  return t === 'put' ? 'put' : 'call';
}

// ---------------------------------------------------------------------------
// Main selector
// ---------------------------------------------------------------------------

export async function selectCreditSpread(
  contractConfig: ContractSelection,
  direction: 'put_credit_spread' | 'call_credit_spread',
  underlyingTicker: string,
): Promise<SelectedSpread | null> {
  const optionsUnderlying = resolveOptionsUnderlying(underlyingTicker);
  const priceSymbol = resolvePriceSymbol(underlyingTicker);
  const expiration = getTodayExpiration();
  const spreadWidth = contractConfig.spread_width || 5;
  const targetDelta = contractConfig.short_leg_delta || contractConfig.delta_target || 0.2;

  // 1. Get current underlying price
  let underlyingPrice = 0;
  try {
    const trade = await getAlpacaLatestTrade(priceSymbol);
    underlyingPrice = trade?.Price ?? (trade as any)?.p ?? 0;
    // If underlying is SPX, multiply SPY price by ~10 (approximate)
    if (underlyingTicker.toUpperCase() === 'SPX' && priceSymbol === 'SPY') {
      underlyingPrice *= 10;
    }
  } catch (err: any) {
    console.warn(`[SPREAD-SELECTOR] Failed to get price for ${priceSymbol}:`, err?.message);
    return null;
  }

  if (underlyingPrice <= 0) {
    console.warn(`[SPREAD-SELECTOR] Invalid underlying price: ${underlyingPrice}`);
    return null;
  }

  // 2. Determine option type and strike range
  const optionType: 'call' | 'put' = direction === 'put_credit_spread' ? 'put' : 'call';

  // For puts: look below current price. For calls: look above.
  let strikeLow: number;
  let strikeHigh: number;
  if (optionType === 'put') {
    strikeLow = Math.floor(underlyingPrice * 0.94);  // ~6% below
    strikeHigh = Math.floor(underlyingPrice * 0.995); // just below current
  } else {
    strikeLow = Math.ceil(underlyingPrice * 1.005);   // just above current
    strikeHigh = Math.ceil(underlyingPrice * 1.06);    // ~6% above
  }

  // 3. Fetch options chain
  console.log(`[SPREAD-SELECTOR] Fetching ${optionType} chain for ${optionsUnderlying}, exp=${expiration}, strikes=${strikeLow}-${strikeHigh}`);

  const chain = await getAlpacaOptionChain(optionsUnderlying, {
    expiration_date: expiration,
    type: optionType,
    strike_price_gte: strikeLow,
    strike_price_lte: strikeHigh,
    limit: 50,
  });

  // Gap 1 fix: If SPXW chain is empty, fall back to SPY options
  if (!chain.length && optionsUnderlying === 'SPXW') {
    console.warn(`[SPREAD-SELECTOR] No SPXW options found, falling back to SPY`);
    const spyPrice = underlyingPrice / 10; // approximate SPY from SPX
    const spyStrikeLow = optionType === 'put' ? Math.floor(spyPrice * 0.94) : Math.ceil(spyPrice * 1.005);
    const spyStrikeHigh = optionType === 'put' ? Math.floor(spyPrice * 0.995) : Math.ceil(spyPrice * 1.06);

    const spyChain = await getAlpacaOptionChain('SPY', {
      expiration_date: expiration,
      type: optionType,
      strike_price_gte: spyStrikeLow,
      strike_price_lte: spyStrikeHigh,
      limit: 50,
    });

    if (spyChain.length) {
      console.log(`[SPREAD-SELECTOR] Using SPY fallback chain (${spyChain.length} contracts)`);
      // Recurse with SPY as underlying (spread_width for SPY is typically 1-2, not 5)
      const spyConfig = { ...contractConfig, spread_width: Math.max(1, Math.round(contractConfig.spread_width / 5)) };
      return selectCreditSpread(spyConfig, direction, 'SPY');
    }
  }

  if (!chain.length) {
    console.warn(`[SPREAD-SELECTOR] No options found for ${optionsUnderlying} exp=${expiration}`);
    return null;
  }

  // 4. Find the contract closest to target delta
  let bestShort: any = null;
  let bestDeltaDiff = Infinity;

  for (const contract of chain) {
    const greeks = extractGreeks(contract);
    const quote = extractQuote(contract);
    const strike = extractStrike(contract);

    // Skip contracts with no delta or no bid
    if (greeks.delta === 0 || quote.bid <= 0) continue;

    // Skip ITM contracts
    if (optionType === 'put' && strike >= underlyingPrice) continue;
    if (optionType === 'call' && strike <= underlyingPrice) continue;

    const deltaDiff = Math.abs(greeks.delta - targetDelta);
    if (deltaDiff < bestDeltaDiff) {
      bestDeltaDiff = deltaDiff;
      bestShort = contract;
    }
  }

  if (!bestShort) {
    console.warn(`[SPREAD-SELECTOR] No contract found near ${targetDelta} delta`);
    return null;
  }

  const shortStrike = extractStrike(bestShort);
  const shortGreeks = extractGreeks(bestShort);
  const shortQuote = extractQuote(bestShort);
  const shortSymbol = extractSymbol(bestShort);

  // 5. Find the long leg (further OTM by spread width)
  const longStrikeTarget = optionType === 'put'
    ? shortStrike - spreadWidth
    : shortStrike + spreadWidth;

  let bestLong: any = null;
  let bestLongDiff = Infinity;

  for (const contract of chain) {
    const strike = extractStrike(contract);
    const diff = Math.abs(strike - longStrikeTarget);
    if (diff < bestLongDiff) {
      bestLongDiff = diff;
      bestLong = contract;
    }
  }

  if (!bestLong) {
    console.warn(`[SPREAD-SELECTOR] No long leg found near strike ${longStrikeTarget}`);
    return null;
  }

  const longStrike = extractStrike(bestLong);
  const longGreeks = extractGreeks(bestLong);
  const longQuote = extractQuote(bestLong);
  const longSymbol = extractSymbol(bestLong);

  // 6. Calculate credit and max loss
  const estimatedCredit = Math.max(0, shortQuote.bid - longQuote.ask);
  const actualWidth = Math.abs(shortStrike - longStrike);
  const maxLoss = Math.max(0, actualWidth - estimatedCredit);

  const shortLeg: SpreadLeg = {
    symbol: shortSymbol,
    strike: shortStrike,
    type: optionType,
    side: 'sell',
    delta: shortGreeks.delta,
    bid: shortQuote.bid,
    ask: shortQuote.ask,
    position_intent: 'sell_to_open',
  };

  const longLeg: SpreadLeg = {
    symbol: longSymbol,
    strike: longStrike,
    type: optionType,
    side: 'buy',
    delta: longGreeks.delta,
    bid: longQuote.bid,
    ask: longQuote.ask,
    position_intent: 'buy_to_open',
  };

  console.log(
    `[SPREAD-SELECTOR] Selected ${direction}: sell ${shortStrike} (Δ${shortGreeks.delta.toFixed(2)}) / buy ${longStrike} ` +
    `| credit $${estimatedCredit.toFixed(2)} | max loss $${maxLoss.toFixed(2)} | underlying $${underlyingPrice.toFixed(2)}`,
  );

  return {
    direction,
    shortLeg,
    longLeg,
    estimatedCredit,
    maxLoss,
    underlyingPrice,
    expirationDate: expiration,
    underlying: underlyingTicker.toUpperCase(),
  };
}
