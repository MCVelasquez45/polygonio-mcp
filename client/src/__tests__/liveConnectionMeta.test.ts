import { afterEach, describe, expect, it } from 'vitest';
import {
  getLastQuoteAt,
  publishQuote,
  publishTrade,
  removeSymbols,
  resetLastQuoteAt,
} from '../lib/liveMarketStore';
import type { QuoteSnapshot, TradePrint } from '../types/market';

const SYM = 'O:TEST260101C00100000';

afterEach(() => {
  removeSymbols([SYM]);
  resetLastQuoteAt();
});

function quote(): QuoteSnapshot {
  return {
    ticker: SYM,
    timestamp: 1_000,
    bidPrice: 1,
    askPrice: 1.1,
    bidSize: 1,
    askSize: 1,
    spread: 0.1,
    midpoint: 1.05,
  } as QuoteSnapshot;
}

describe('liveMarketStore last-quote stamp', () => {
  it('starts empty and stamps a wall-clock time when a quote is published', () => {
    resetLastQuoteAt();
    expect(getLastQuoteAt()).toBeNull();
    const before = Date.now();
    publishQuote(quote());
    const at = getLastQuoteAt();
    expect(at).not.toBeNull();
    expect(at as number).toBeGreaterThanOrEqual(before);
  });

  it('is also stamped by trade prints — proving the feed is flowing', () => {
    resetLastQuoteAt();
    const trade: TradePrint & { ticker: string } = {
      id: 't1',
      ticker: SYM,
      price: 1.05,
      size: 2,
      timestamp: 2_000,
    };
    publishTrade(trade);
    expect(getLastQuoteAt()).not.toBeNull();
  });
});
