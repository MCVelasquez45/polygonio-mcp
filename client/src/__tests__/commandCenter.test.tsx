import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// NOW · Live Operations streams over the socket. Mock the streaming hooks so the
// page renders deterministically without a live connection.
vi.mock('../hooks/useLiveConnection', () => ({
  useLiveConnection: () => ({
    connected: true,
    phase: 'connected',
    provider: 'Massive',
    lastQuoteAt: 1_000,
  }),
}));
vi.mock('../hooks/useAutomationVisibility', () => ({
  useAutomationVisibility: () => ({
    visibility: {
      portfolioIntegration: { automationPositions: [{ unrealizedPnl: 12 }], manualPositions: [] },
      pendingOrders: [],
      engineStatus: { broker: { state: 'CONNECTED' }, market: 'OPEN' },
    },
    events: [{ id: 'e1', timestamp: '2026-07-17T14:30:00Z', event: 'ORDER_SUBMITTED', symbol: 'O:SPY' }],
    connected: true,
    error: null,
    refresh: vi.fn(),
  }),
}));
vi.mock('../api/alpaca', () => ({
  getBrokerClock: vi.fn(async () => ({ is_open: true, timestamp: '', next_open: '', next_close: '' })),
}));

import { CommandCenterPage } from '../components/intelligence/CommandCenterPage';

afterEach(() => cleanup());

describe('CommandCenterPage', () => {
  it('renders the landing header and an honest empty state without a network call', () => {
    render(<CommandCenterPage loadOnMount={false} />);
    expect(screen.getByText('Command Center')).toBeInTheDocument();
    expect(screen.getByText('No intelligence generated yet')).toBeInTheDocument();
  });

  it('routes card "Open" clicks through the onOpen handler', () => {
    const onOpen = vi.fn();
    render(<CommandCenterPage loadOnMount={false} onOpen={onOpen} />);
    expect(screen.getByText('Command Center')).toBeInTheDocument();
    expect(screen.getByText('Refresh')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Refresh'));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('shows a LIVE now section: market Open (never Closed), feed live, and real activity', () => {
    render(
      <CommandCenterPage
        loadOnMount={false}
        initial={{ clock: { is_open: true, timestamp: '', next_open: '', next_close: '' } }}
      />
    );
    // Market is authoritative from the broker clock — Open, and NEVER Closed.
    expect(screen.getByText('Now · Live Operations')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.queryByText('Closed')).not.toBeInTheDocument();
    // Feed reads live from the connection + streamed visibility.
    expect(screen.getByText('Feed live')).toBeInTheDocument();
    // Market Data Health card single-sources the provider.
    expect(screen.getByText('Massive')).toBeInTheDocument();
    // Activity feed renders the real streamed event, humanized.
    expect(screen.getByText(/Order submitted/)).toBeInTheDocument();
  });
});
