/**
 * Cockpit shell (M2): OCC parsing, active-trade selection, and the guarantee that
 * the rendered Position panel never shows fabricated zero values for absent data.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const socket = vi.hoisted(() => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true }));
vi.mock('../lib/socket', () => ({ getSharedSocket: () => socket }));
const visibilityRef = vi.hoisted(() => ({
  current: {
    generatedAt: new Date().toISOString(),
    engineStatus: {
      automationState: 'RUNNING',
      market: 'OPEN',
      broker: { state: 'CONNECTED' },
      massive: { state: 'CONNECTED' },
    },
    watchlistEvaluation: {
      outcome: 'INTENT_CREATED',
      selectedContract: 'O:SPY260724C00600000',
      evaluatedAt: new Date().toISOString(),
    },
    pendingOrders: [],
    activeTrades: [],
  } as unknown as AutomationVisibility,
}));
vi.mock('../hooks/useAutomationVisibility', () => ({
  useAutomationVisibility: () => ({
    visibility: visibilityRef.current,
    connected: true,
    error: null,
    refresh: vi.fn(),
  }),
}));

import { parseOcc, contractLabel } from '../components/cockpit/occSymbol';
import { selectActiveTrade, type CockpitTrade } from '../components/cockpit/cockpitUi';
import { CockpitWorkspace } from '../components/cockpit/CockpitWorkspace';
import { CockpitLayout } from '../components/cockpit/CockpitLayout';
import { removeSymbols } from '../lib/liveMarketStore';
import type { AutomationVisibility } from '../api/portfolio';

afterEach(() => {
  cleanup();
  removeSymbols(['O:SPY260724C00600000']);
  socket.emit.mockClear();
});

describe('parseOcc / contractLabel', () => {
  it('parses a standard OCC symbol', () => {
    expect(parseOcc('O:SPY260724C00600000')).toEqual({
      underlying: 'SPY',
      expiration: '2026-07-24',
      type: 'CALL',
      strike: 600,
    });
  });
  it('handles a put with a fractional strike and no O: prefix', () => {
    const p = parseOcc('QQQ260320P00512500');
    expect(p?.type).toBe('PUT');
    expect(p?.strike).toBe(512.5);
  });
  it('produces a human label and falls back on garbage', () => {
    expect(contractLabel('O:SPY260724C00600000')).toBe('SPY Jul 24 2026 $600 Call');
    expect(contractLabel('O:SOFI260717C00018000')).toBe('SOFI Jul 17 2026 $18 Call');
    expect(contractLabel('not-a-symbol')).toBe('not-a-symbol');
  });
});

describe('CockpitLayout health strip', () => {
  it('uses compact health instead of a dominant engineering rail', () => {
    render(<CockpitLayout />);
    expect(screen.getByText('Automation')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Broker')).toBeInTheDocument();
    expect(screen.getByText('Market')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Data')).toBeInTheDocument();
    expect(screen.getAllByText('Connected').length).toBeGreaterThan(1);
    expect(screen.getByText('Cockpit')).toBeInTheDocument();
    for (const label of ['Socket', 'Scheduler', 'Workers', 'Recon', 'Lease']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });
});

describe('selectActiveTrade', () => {
  it('returns null with no trades, first by default, and by id when given', () => {
    expect(selectActiveTrade(null)).toBeNull();
    const vis = {
      activeTrades: [{ positionId: 'a' }, { positionId: 'b' }],
    } as unknown as AutomationVisibility;
    expect(selectActiveTrade(vis)?.positionId).toBe('a');
    expect(selectActiveTrade(vis, 'b')?.positionId).toBe('b');
  });
});

describe('CockpitWorkspace position panel', () => {
  const trade: CockpitTrade = {
    positionId: 'p1',
    underlying: 'SPY',
    optionSymbol: 'O:SPY260724C00600000',
    direction: 'BULLISH',
    contracts: 2,
    entryPrice: 5.7,
    currentMark: 6.41,
    currentBid: null,
    currentAsk: null,
    unrealizedPnl: 142,
    unrealizedPnlPct: 12.45,
    mfe: null,
    mae: -40,
    lifecycleStatus: 'OPEN',
    brokerStatus: 'FILLED',
    filledTime: new Date().toISOString(),
  };

  it('renders the contract label, live P/L, and market value', () => {
    render(<CockpitWorkspace trade={trade} buyingPower={100000} nextEvaluationAt={null} sessionId={null} onActed={() => {}} />);
    expect(screen.getByText('SPY Jul 24 2026 $600 Call')).toBeInTheDocument();
    expect(screen.getByText('Long 2')).toBeInTheDocument();
    for (const label of ['Entry', 'Mark', 'P&L', 'Return', 'Bid', 'Ask', 'Mid', 'Spread']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText('+$142.00').length).toBeGreaterThan(0);
    expect(screen.getByText('$1282.00')).toBeInTheDocument();
  });

  it('never prints fabricated zeroes or placeholder dashes for absent position data', () => {
    const { container } = render(<CockpitWorkspace trade={trade} buyingPower={null} nextEvaluationAt={null} sessionId={null} onActed={() => {}} />);
    expect(container.textContent).not.toContain('$0.00');
    expect(container.textContent).not.toContain('—');
    expect(container.textContent).toContain('Not captured for this position');
  });

  it('keeps a single command bar/workspace and no placeholder panels', () => {
    render(<CockpitWorkspace trade={trade} buyingPower={null} nextEvaluationAt={null} sessionId={null} onActed={() => {}} />);
    expect(screen.getAllByTestId('cockpit-command-bar')).toHaveLength(1);
    expect(screen.getAllByTestId('cockpit-workspace')).toHaveLength(1);
    expect(screen.queryByText(/Coming online/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('cockpit-primary-grid').className).toContain(
      'xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]'
    );
  });

  it('uses one shared quote state: header prices render once and Live Market is populated', () => {
    const quotedTrade: CockpitTrade = {
      ...trade,
      currentBid: 1.78,
      currentAsk: 1.92,
      currentMid: 1.85,
      currentMark: 1.85,
      currentSpreadPct: 7.6,
      unrealizedPnl: null,
      unrealizedPnlPct: null,
    };

    render(<CockpitWorkspace trade={quotedTrade} buyingPower={null} nextEvaluationAt={null} sessionId={null} onActed={() => {}} />);

    expect(screen.getByText('Snapshot quote available')).toBeInTheDocument();
    expect(screen.queryByText(/No live quote is currently available from the provider/)).not.toBeInTheDocument();
    expect(screen.getAllByText('$1.78')).toHaveLength(1);
    expect(screen.getAllByText('$1.92')).toHaveLength(1);
    expect(screen.getAllByText('$1.85').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$0.14')).toHaveLength(1);
    for (const label of ['Entry', 'Mark', 'P&L', 'Return', 'Bid', 'Ask', 'Mid', 'Spread']) {
      expect(screen.getAllByText(label)).toHaveLength(1);
    }
  });
});
