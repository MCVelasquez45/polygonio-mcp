import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  publishQuote,
  publishTrade,
  replaceTradeHistory,
  removeSymbols,
  useLiveQuote,
  useLiveTrade,
  useLiveTradeHistory,
  useLiveQuotes,
} from '../lib/liveMarketStore';
import type { QuoteSnapshot, TradePrint } from '../types/market';

function quote(ticker: string, bid = 1, ask = 2): QuoteSnapshot {
  return {
    ticker,
    timestamp: 1,
    bidPrice: bid,
    askPrice: ask,
    bidSize: 1,
    askSize: 1,
    spread: ask - bid,
    midpoint: (bid + ask) / 2,
    updated: 1,
    quotes: undefined,
  } as QuoteSnapshot;
}

function trade(ticker: string, id: string, price = 1): TradePrint & { ticker: string } {
  return { id, ticker, price, size: 1, timestamp: 1 } as TradePrint & { ticker: string };
}

describe('liveMarketStore', () => {
  it('delivers quotes to per-symbol subscribers', () => {
    const { result } = renderHook(() => useLiveQuote('O:SPY260821C00450000'));
    expect(result.current).toBeNull();
    act(() => publishQuote(quote('O:SPY260821C00450000', 3, 4)));
    expect(result.current?.bidPrice).toBe(3);
  });

  it('does not re-render subscribers of other symbols on a tick', () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useLiveQuote('O:AAA111111C00000001');
    });
    const before = renders;
    act(() => publishQuote(quote('O:BBB111111C00000002')));
    expect(renders).toBe(before);
  });

  it('caps and dedupes trade history', () => {
    const symbol = 'O:SPY260821C00499999';
    const { result } = renderHook(() => useLiveTradeHistory(symbol));
    act(() => {
      publishTrade(trade(symbol, 't1'));
      publishTrade(trade(symbol, 't1')); // duplicate id ignored
      publishTrade(trade(symbol, 't2'));
    });
    expect(result.current.map(t => t.id)).toEqual(['t2', 't1']);
    act(() => {
      for (let i = 0; i < 250; i += 1) publishTrade(trade(symbol, `bulk-${i}`));
    });
    expect(result.current.length).toBe(200);
  });

  it('replaceTradeHistory swaps history wholesale and surfaces the latest print', () => {
    const symbol = 'O:QQQ260821P00380000';
    const history = renderHook(() => useLiveTradeHistory(symbol));
    const last = renderHook(() => useLiveTrade(symbol));
    act(() => replaceTradeHistory(symbol, [trade(symbol, 'rest-1', 9), trade(symbol, 'rest-0', 8)]));
    expect(history.result.current.map(t => t.id)).toEqual(['rest-1', 'rest-0']);
    expect(last.result.current?.id).toBe('rest-1');
  });

  it('removeSymbols drops cached data for unsubscribed strips', () => {
    const symbol = 'O:IWM260821C00200000';
    act(() => publishQuote(quote(symbol)));
    const { result } = renderHook(() => useLiveQuotes());
    expect(result.current[symbol]).toBeTruthy();
    act(() => removeSymbols([symbol]));
    expect(result.current[symbol]).toBeUndefined();
  });
});
