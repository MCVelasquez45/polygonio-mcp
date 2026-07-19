import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MarketDataBadge } from '../components/intelligence/ui/LiveStatus';
import { ActivityFeed } from '../components/intelligence/ActivityFeed';
import type { AutomationVisibilityEvent } from '../api/portfolio';

afterEach(() => cleanup());

describe('MarketDataBadge', () => {
  it('labels a live quote and marks the status for the DOM', () => {
    const { container } = render(<MarketDataBadge status="LIVE" ageMs={500} />);
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText(/Updated just now/)).toBeInTheDocument();
    expect(container.querySelector('[data-status="LIVE"]')).not.toBeNull();
  });

  it('shows a snapshot age and never claims live', () => {
    render(<MarketDataBadge status="SNAPSHOT" ageMs={18_000} />);
    expect(screen.getByText('Snapshot')).toBeInTheDocument();
    expect(screen.getByText(/Updated 18s ago/)).toBeInTheDocument();
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  it('surfaces a disconnected feed', () => {
    render(<MarketDataBadge status="DISCONNECTED" ageMs={161_000} />);
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    expect(screen.getByText(/Last update 2m 41s ago/)).toBeInTheDocument();
  });

  it('renders a neutral "No quote" when there is no data', () => {
    render(<MarketDataBadge status={null} ageMs={null} />);
    expect(screen.getByText('No quote')).toBeInTheDocument();
  });
});

describe('ActivityFeed', () => {
  it('shows an honest empty state with no events', () => {
    render(<ActivityFeed events={[]} />);
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-feed-list')).not.toBeInTheDocument();
  });

  it('renders exactly the real backend events it is given, humanized', () => {
    const events: AutomationVisibilityEvent[] = [
      { id: '1', timestamp: '2026-07-17T14:30:00Z', event: 'ORDER_SUBMITTED', symbol: 'O:SPY260724C00600000' },
      { id: '2', timestamp: '2026-07-17T14:30:05Z', event: 'MONITOR_HEARTBEAT' },
    ];
    render(<ActivityFeed events={events} />);
    expect(screen.getByText(/Order submitted/)).toBeInTheDocument();
    expect(screen.getByText(/Monitor heartbeat/)).toBeInTheDocument();
    expect(screen.getByText(/O:SPY260724C00600000/)).toBeInTheDocument();
    // Only the two provided events render — nothing fabricated.
    expect(screen.getByTestId('activity-feed-list').children).toHaveLength(2);
  });
});
