/**
 * Regression test for the sprint's highest-priority acceptance criterion:
 *
 *   Selecting an option contract must NOT clear or reload the underlying
 *   chart. Only contract-scoped panels (Greeks, ticket, quotes) may update.
 *
 * The bug: handleContractSelection used to call setBars([]) on every leg
 * click, blanking the chart to "Loading bars…" until the socket re-pushed a
 * snapshot (App.tsx:2091 in the audited revision).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

type Handler = (payload?: any) => void;

class FakeSocket {
  connected = true;
  private handlers = new Map<string, Set<Handler>>();
  emitted: Array<{ event: string; payload: any }> = [];

  on(event: string, handler: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return this;
  }

  off(event: string, handler: Handler) {
    this.handlers.get(event)?.delete(handler);
    return this;
  }

  emit(event: string, payload?: any) {
    this.emitted.push({ event, payload });
    return this;
  }

  /** Test helper: simulate a server-pushed event. */
  receive(event: string, payload?: any) {
    this.handlers.get(event)?.forEach(handler => handler(payload));
  }

  emitCount(event: string) {
    return this.emitted.filter(entry => entry.event === event).length;
  }
}

const fakeSocket = new FakeSocket();

vi.mock('../lib/socket', () => ({
  getSharedSocket: () => fakeSocket,
}));

// Chart canvas is imperative lightweight-charts code; a stub div is enough to
// know whether the chart is mounted (vs the "Loading bars…" placeholder).
vi.mock('../components/trading/TradingViewChart', () => ({
  TradingViewChart: () => <div data-testid="chart-canvas" />,
}));

const CALL_TICKER = 'O:SPY260821C00450000';

function makeLeg(overrides: Record<string, unknown> = {}) {
  return {
    ticker: CALL_TICKER,
    strike: 450,
    type: 'call' as const,
    expiration: '2026-08-21',
    underlying: 'SPY',
    bid: 5.1,
    ask: 5.3,
    mid: 5.2,
    mark: 5.2,
    lastPrice: 5.15,
    iv: 0.22,
    change: 0.4,
    changePercent: 8.1,
    breakeven: 455.2,
    toBreakevenPercent: 1.2,
    delta: 0.55,
    gamma: 0.02,
    theta: -0.05,
    vega: 0.11,
    rho: 0.01,
    volume: 1200,
    openInterest: 3400,
    ...overrides,
  };
}

const chainResponse = {
  ticker: 'SPY',
  underlyingPrice: 449.5,
  expirations: [
    {
      expiration: '2026-08-21',
      dte: 405,
      strikes: [
        { strike: 450, call: makeLeg(), put: undefined },
        {
          strike: 455,
          call: makeLeg({ ticker: 'O:SPY260821C00455000', strike: 455, breakeven: 460.1 }),
          put: undefined,
        },
      ],
    },
  ],
};

vi.mock('../api', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  marketApi: {
    getOptionsChain: vi.fn(async () => chainResponse),
    getOptionExpirations: vi.fn(async () => ({ ticker: 'SPY', expirations: ['2026-08-21'] })),
    getWatchlistSnapshots: vi.fn(async () => ({ entries: [] })),
    getPersistedSelection: vi.fn(async () => ({ selection: null })),
    savePersistedSelection: vi.fn(async () => undefined),
    getOptionContractDetail: vi.fn(async () => makeLeg()),
    getTrades: vi.fn(async () => ({ ticker: CALL_TICKER, trades: [] })),
    getQuote: vi.fn(async () => ({ ticker: CALL_TICKER, bidPrice: 5.1, askPrice: 5.3, midpoint: 5.2 })),
    warmAggregates: vi.fn(async () => ({ tickers: [] })),
    getAggregates: vi.fn(async () => ({ results: [] })),
    getShortInterest: vi.fn(async () => ({ results: [] })),
    getShortVolume: vi.fn(async () => ({ results: [] })),
  },
  analysisApi: {
    getDeskInsight: vi.fn(async () => null),
    getWatchlistReports: vi.fn(async () => ({ reports: [] })),
    runChecklist: vi.fn(async () => ({ results: [] })),
    selectContract: vi.fn(async () => ({ selectedContract: null })),
    getContractExplanation: vi.fn(async () => null),
  },
  chatApi: {
    listConversations: vi.fn(async () => []),
    fetchConversationTranscript: vi.fn(async () => ({ messages: [] })),
    deleteConversation: vi.fn(async () => undefined),
    sendChatMessage: vi.fn(async () => ({})),
  },
  alpacaApi: {
    getOptionOrders: vi.fn(async () => ({ orders: [] })),
  },
  futuresApi: {},
  agentApi: {},
}));

// OrderTicketPanel imports these directly (not via the api index).
vi.mock('../api/alpaca', () => ({
  getBrokerAccount: vi.fn(async () => ({ buying_power: '10000' })),
}));

import App from '../App';

const SNAPSHOT_BARS = Array.from({ length: 5 }, (_, i) => ({
  t: 1_755_000_000_000 + i * 60_000,
  o: 449 + i,
  h: 450 + i,
  l: 448 + i,
  c: 449.5 + i,
  v: 1000 + i,
}));

describe('option contract selection', () => {
  beforeEach(() => {
    window.localStorage.clear();
    fakeSocket.emitted = [];
  });

  it('keeps the underlying chart mounted and does not re-request candles', async () => {
    render(<App />);

    // Chart focus is requested once for the underlying.
    await waitFor(() => {
      expect(fakeSocket.emitCount('chart:focus')).toBeGreaterThan(0);
    });
    const focus = fakeSocket.emitted.find(e => e.event === 'chart:focus');
    expect(focus?.payload?.symbol).toBe('SPY');

    // Server pushes candles → chart mounts.
    act(() => {
      fakeSocket.receive('chart:snapshot', {
        symbol: 'SPY',
        timeframe: focus?.payload?.timeframe ?? '1/day',
        bars: SNAPSHOT_BARS,
        health: null,
        session: null,
      });
    });
    expect(await screen.findByTestId('chart-canvas')).toBeInTheDocument();

    // Wait for the options chain to render its strikes.
    const strikeCell = await screen.findByText('$450.00');
    const focusEmitsBeforeSelection = fakeSocket.emitCount('chart:focus');

    // Click the contract row.
    fireEvent.click(strikeCell);

    // Contract-scoped UI updates: the selected-row detail expands (IV tile).
    expect((await screen.findAllByText('IV')).length).toBeGreaterThan(0);

    // THE acceptance criterion: the chart is still mounted, never blanked...
    expect(screen.getByTestId('chart-canvas')).toBeInTheDocument();
    expect(screen.queryByText('Loading bars…')).not.toBeInTheDocument();
    // ...and no new candle request was issued for the unchanged underlying.
    expect(fakeSocket.emitCount('chart:focus')).toBe(focusEmitsBeforeSelection);
  });
});
