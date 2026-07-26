import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

const { getPositionLive } = vi.hoisted(() => ({ getPositionLive: vi.fn() }));
vi.mock('../api/portfolio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/portfolio')>();
  return { ...actual, getPositionLive };
});

import { PositionManagerPanel } from '../components/portfolio/PositionManagerPanel';
import {
  setActivePosition,
  setLinkedMode,
  getWorkspaceContext,
  __resetWorkspaceContextForTests,
} from '../lib/workspaceContextStore';

const SNAPSHOT = {
  positionId: 'p1',
  asOf: '2026-07-26T10:00:00Z',
  available: true,
  optionSymbol: 'O:AMD260731C00175000',
  underlying: 'AMD',
  greeks: { delta: 0.58, gamma: 0.03, theta: -0.09, vega: 0.12, rho: 0.01 },
  impliedVolatility: 0.42,
  openInterest: 1200,
  dayVolume: 340,
  breakEvenPrice: 177.86,
  bid: 3.0,
  ask: 3.05,
  mid: 3.03,
  daysToExpiration: 5,
  source: 'contract-snapshot',
};

describe('PositionManagerPanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetWorkspaceContextForTests();
    getPositionLive.mockReset();
    getPositionLive.mockResolvedValue(SNAPSHOT);
  });
  afterEach(() => cleanup());

  it('renders nothing until a position is selected on the bus', () => {
    const { container } = render(<PositionManagerPanel />);
    expect(container).toBeEmptyDOMElement();
    expect(getPositionLive).not.toHaveBeenCalled();
  });

  it('shows live market, working orders, and greeks for the active position', async () => {
    setActivePosition({
      id: 'p1',
      underlying: 'AMD',
      optionSymbol: 'O:AMD260731C00175000',
      source: 'AUTOMATION',
      stopPrice: 2.4,
      targetPrice: 4.1,
    });
    render(<PositionManagerPanel />);
    await waitFor(() => expect(getPositionLive).toHaveBeenCalledWith('p1'));
    expect(await screen.findByText('$3.00')).toBeInTheDocument(); // bid
    expect(screen.getByText('$3.05')).toBeInTheDocument(); // ask
    expect(screen.getByText('$2.40')).toBeInTheDocument(); // stop
    expect(screen.getByText('$4.10')).toBeInTheDocument(); // take profit
    expect(screen.getByText('AMD')).toBeInTheDocument();
  });

  it('toggles Linked Mode from the panel and clears the selection', async () => {
    setLinkedMode(true);
    setActivePosition({ id: 'p1', underlying: 'AMD', optionSymbol: 'O:AMD260731C00175000', source: 'AUTOMATION' });
    render(<PositionManagerPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /linked/i }));
    expect(getWorkspaceContext().linkedMode).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /clear selected position/i }));
    expect(getWorkspaceContext().activePosition).toBeNull();
  });
});
