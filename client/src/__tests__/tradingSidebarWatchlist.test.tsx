import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TradingSidebar } from '../components/layout/TradingSidebar';

const listWatchlist = vi.fn();

vi.mock('../api/watchlist', () => ({
  listWatchlist: (...args: unknown[]) => listWatchlist(...args),
  removeWatchlistItem: vi.fn(),
  upsertWatchlistItem: vi.fn(),
}));

vi.mock('../api', () => ({
  marketApi: {
    getWatchlistSnapshots: vi.fn().mockResolvedValue([]),
    getAggregates: vi.fn().mockResolvedValue({ results: [] }),
  },
}));

vi.mock('../hooks/useCockpitLiveSubscription', () => ({
  useLiveMarketSubscriptions: vi.fn(),
}));

vi.mock('../hooks/useLiveConnection', () => ({
  useLiveConnection: () => ({ connected: false }),
}));

vi.mock('../hooks/useNow', () => ({
  useNow: () => Date.now(),
}));

vi.mock('../lib/liveMarketStore', () => ({
  useLiveQuotes: () => ({}),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSidebar(initialSymbols?: string[]) {
  render(
    <TradingSidebar
      selectedTicker=""
      onSelectTicker={vi.fn()}
      initialSymbols={initialSymbols}
    />
  );
}

describe('TradingSidebar watchlist hydration', () => {
  it('renders preloaded authoritative symbols while the full watchlist request is pending', () => {
    listWatchlist.mockReturnValue(new Promise(() => undefined));

    renderSidebar(['SOFI', 'XOM']);

    expect(screen.getByText('SOFI')).toBeInTheDocument();
    expect(screen.getByText('XOM')).toBeInTheDocument();
    expect(screen.queryByText(/Empty universe/i)).not.toBeInTheDocument();
  });

  it('shows loading instead of a false empty universe before the first server response', () => {
    listWatchlist.mockReturnValue(new Promise(() => undefined));

    renderSidebar();

    expect(screen.getByText(/Loading watchlist/i)).toBeInTheDocument();
    expect(screen.queryByText(/Empty universe/i)).not.toBeInTheDocument();
  });
});
