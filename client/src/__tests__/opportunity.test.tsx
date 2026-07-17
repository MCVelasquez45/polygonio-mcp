/**
 * Opportunity + Market Context (M7): the entry thesis renders with confidence and
 * a candidate comparison marking the winner, and the context panel labels the
 * delayed underlying honestly.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { OpportunityPanel } from '../components/cockpit/OpportunityPanel';
import { MarketContextPanel } from '../components/cockpit/MarketContextPanel';
import type { CockpitTrade } from '../components/cockpit/cockpitUi';

afterEach(cleanup);

const trade: CockpitTrade = {
  positionId: 'p1',
  underlying: 'SPY',
  optionSymbol: 'O:SPY260724C00600000',
  opportunity: {
    strategy: 'OPTIONS_NATIVE_FLOW',
    direction: 'BULLISH',
    signalConfidence: 1,
    selectedContractSymbol: 'O:SPY260724C00600000',
    selectedContractScore: 0.91,
    consideredCount: 5,
    passedCount: 2,
    noSelectionReason: null,
    candidates: [
      { symbol: 'O:SPY260724C00600000', passed: true, score: 0.91, delta: 0.58, spreadPct: 0.3, openInterest: 22000, rejectionReasons: [], selected: true },
      { symbol: 'O:SPY260724C00605000', passed: true, score: 0.77, delta: 0.5, spreadPct: 0.9, openInterest: 8000, rejectionReasons: [], selected: false },
      { symbol: 'O:SPY260724C00610000', passed: false, score: null, delta: 0.4, spreadPct: 2.1, openInterest: 300, rejectionReasons: ['SPREAD_TOO_WIDE'], selected: false },
    ],
    flow: { netPremiumTilt: 0.42, volumeRatio: 1.8, callPremium: 1000, putPremium: 200, ivSkew: 0.05 },
  },
  marketContext: { trend: 'UP', relativeVolume: 1.8, flowScore: 0.82, regime: 'UP · HIGH VOL', underlyingDelayed: true },
};

describe('OpportunityPanel', () => {
  it('shows confidence, strategy, and marks the selected contract as the winner', () => {
    render(<OpportunityPanel trade={trade} />);
    expect(screen.getByText('100.0%')).toBeInTheDocument(); // confidence
    expect(screen.getByText('OPTIONS_NATIVE_FLOW')).toBeInTheDocument();
    expect(screen.getByText('BULLISH')).toBeInTheDocument();
    expect(screen.getAllByText('SPY Jul 24 2026 $600 Call').length).toBeGreaterThan(0);
    expect(screen.getByText('$1000')).toBeInTheDocument();
    expect(screen.getByText('$200')).toBeInTheDocument();
    expect(screen.getByText('SELECTED')).toBeInTheDocument();
    expect(screen.getByText('winner')).toBeInTheDocument();
    expect(screen.getByText(/beat 4 others/)).toBeInTheDocument();
    // rejected runner-up surfaces its reason
    expect(screen.getByText(/spread too wide/)).toBeInTheDocument();
  });
});

describe('MarketContextPanel', () => {
  it('renders trend/regime and labels the underlying as delayed', () => {
    render(<MarketContextPanel trade={trade} />);
    expect(screen.getByText('UP')).toBeInTheDocument();
    expect(screen.getAllByText('1.80x').length).toBeGreaterThan(0);
    expect(screen.getByText('UP · HIGH VOL')).toBeInTheDocument();
    expect(screen.getAllByText('Delayed').length).toBeGreaterThan(0);
  });

  it('renders one market-context empty state instead of empty metrics', () => {
    render(<MarketContextPanel trade={{ ...trade, marketContext: null as any }} />);
    expect(screen.getByText('No market context snapshot was captured for this trade.')).toBeInTheDocument();
    expect(screen.queryByText('Trend')).not.toBeInTheDocument();
  });
});

describe('OpportunityPanel empty state', () => {
  it('renders one attribution empty state instead of empty metrics', () => {
    render(<OpportunityPanel trade={{ ...trade, opportunity: null as any }} />);
    expect(screen.getByText('No contract attribution is available for this position.')).toBeInTheDocument();
    expect(screen.queryByText('Signal confidence')).not.toBeInTheDocument();
  });
});
