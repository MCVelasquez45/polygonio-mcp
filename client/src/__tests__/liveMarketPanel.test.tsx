/**
 * Live Market panel (M3): quote availability/freshness uses the same cockpit
 * quote object as the header, without re-rendering duplicate bid/ask rows.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

import { LiveMarketPanel } from '../components/cockpit/LiveMarketPanel';
import { buildCockpitQuoteState } from '../components/cockpit/cockpitQuote';
import { publishTrade, removeSymbols } from '../lib/liveMarketStore';
import type { CockpitTrade } from '../components/cockpit/cockpitUi';
import type { PositionLiveSnapshot } from '../api/portfolio';
import type { QuoteSnapshot, TradePrint } from '../types/market';

const SYM = 'O:SPY260724C00600000';

function quote(bid: number | null, ask: number | null): QuoteSnapshot {
  return {
    ticker: SYM,
    timestamp: Date.now(),
    bidPrice: bid,
    askPrice: ask,
    bidSize: 12,
    askSize: 18,
    spread: bid !== null && ask !== null ? ask - bid : null,
    midpoint: bid !== null && ask !== null ? (bid + ask) / 2 : null,
  } as QuoteSnapshot;
}

const trade: CockpitTrade = {
  positionId: 'p1',
  underlying: 'SPY',
  optionSymbol: SYM,
};

const greeks = {
  positionId: 'p1',
  asOf: new Date().toISOString(),
  available: true,
  optionSymbol: SYM,
  openInterest: 1200,
  dayVolume: 340,
  greeks: { delta: 0.55, gamma: 0.02, theta: -0.03, vega: 0.12, rho: 0.01 },
} as PositionLiveSnapshot;

describe('LiveMarketPanel', () => {
  beforeEach(() => {
    removeSymbols([SYM]);
  });

  it('renders a populated shared quote state without duplicate NBBO price rows', () => {
    const quoteState = buildCockpitQuoteState(trade, quote(6.4, 6.42), Date.now());
    render(<LiveMarketPanel symbol={SYM} greeks={greeks} quote={quoteState} />);
    expect(screen.getByText('Streaming quote available')).toBeInTheDocument();
    expect(screen.getByText('340')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.queryByText(/No live quote is currently available from the provider/)).not.toBeInTheDocument();
    expect(screen.queryByText('$6.40')).not.toBeInTheDocument();
    cleanup();
  });

  it('shows one honest message when no quote exists', () => {
    const quoteState = buildCockpitQuoteState(trade, null, Date.now());
    const { container } = render(<LiveMarketPanel symbol={SYM} quote={quoteState} />);
    expect(screen.getByText(/No live quote is currently available from the provider/)).toBeInTheDocument();
    expect(screen.queryByText('Streaming quote available')).not.toBeInTheDocument();
    expect(container.textContent).not.toContain('$0.00');
    cleanup();
  });

  it('explains a provider socket disconnect', () => {
    const quoteState = buildCockpitQuoteState(trade, null, Date.now(), false);
    render(<LiveMarketPanel symbol={SYM} quote={quoteState} />);
    expect(screen.getByText(/live quote socket is disconnected and retrying/i)).toBeInTheDocument();
    cleanup();
  });

  it('renders the recent trades tape from streamed prints', () => {
    const quoteState = buildCockpitQuoteState(trade, quote(6.4, 6.42), Date.now());
    render(<LiveMarketPanel symbol={SYM} quote={quoteState} />);
    const print: TradePrint & { ticker: string } = { id: 't1', ticker: SYM, price: 6.41, size: 2, timestamp: Date.now() };
    act(() => publishTrade(print));
    expect(screen.getAllByText('$6.41').length).toBeGreaterThan(0);
    cleanup();
  });
});
