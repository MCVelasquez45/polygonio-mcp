import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const {
  getBrokerAccount,
  getBrokerClock,
  getOptionOrders,
  getOptionPositions,
  createManualIntent,
  confirmManualIntent,
  submitManualIntent,
  fakeSocket,
} = vi.hoisted(() => ({
  getBrokerAccount: vi.fn(),
  getBrokerClock: vi.fn(),
  getOptionOrders: vi.fn(),
  getOptionPositions: vi.fn(),
  createManualIntent: vi.fn(),
  confirmManualIntent: vi.fn(),
  submitManualIntent: vi.fn(),
  fakeSocket: {
    connected: false,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
}));

vi.mock('../api/alpaca', () => ({
  getBrokerAccount,
  getBrokerClock,
  getOptionOrders,
  getOptionPositions,
}));

vi.mock('../api/manualTrading', () => ({
  createManualIntent,
  confirmManualIntent,
  submitManualIntent,
}));

vi.mock('../lib/socket', () => ({
  getSharedSocket: () => fakeSocket,
}));

vi.mock('../api', () => ({
  analysisApi: {
    getDeskInsight: vi.fn(async () => null),
  },
  marketApi: {
    getWatchlistSnapshots: vi.fn(async () => ({ entries: [] })),
    warmAggregates: vi.fn(async () => ({ tickers: [] })),
  },
  portfolioApi: {
    getOperations: vi.fn(async () => ({
      health: {
        automationReady: true,
        gates: { marketClock: { state: 'OPEN' } },
      },
      runtime: {
        evaluationScheduler: { state: 'ACTIVE' },
        monitorScheduler: { state: 'ACTIVE' },
      },
      risk: [],
    })),
    getAutomationVisibility: vi.fn(async () => ({
      generatedAt: new Date().toISOString(),
      engineStatus: {
        automationState: 'RUNNING',
        market: 'OPEN',
        reconciliation: 'CLEAN',
        scheduler: { state: 'ACTIVE' },
        monitor: { state: 'ACTIVE' },
        broker: { state: 'CONNECTED', paper: true },
        massive: { state: 'OK' },
        mongo: { state: 'CONNECTED' },
        session: null,
        leases: [],
      },
      watchlistEvaluation: {
        evaluationId: null,
        evaluatedAt: null,
        symbolCount: 0,
        symbols: [],
        outcome: null,
        reasonCodes: [],
        selectedSymbol: null,
        selectedContract: null,
        riskApproved: null,
        riskReasonCodes: [],
        results: [],
        ranking: [],
        dataHealth: null,
      },
      activeTrades: [],
      pendingOrders: [],
      timeline: [],
      metrics: {},
      schedulerPanel: {},
      tradeHistory: [],
      portfolioIntegration: { automationPositions: [], manualPositions: [] },
      configuration: {},
    })),
    pauseEntries: vi.fn(),
    resumeSession: vi.fn(),
    emergencyStop: vi.fn(),
  },
}));

import { PortfolioPanel } from '../components/portfolio/PortfolioPanel';

const position = {
  symbol: 'SPY260724P00756000',
  qty: '1',
  side: 'long',
  avg_entry_price: '6.12',
  current_price: '6.73',
  market_value: '673',
  unrealized_pl: '61',
};

const intent = {
  id: 'intent-1',
  status: 'CREATED',
  executionMode: 'MANUAL',
  orderSource: 'MANUAL_UI',
  action: 'CLOSE_POSITION',
  optionSymbol: position.symbol,
  side: 'sell',
  quantity: 1,
  brokerPositionQuantity: 1,
  authorizationId: 'intent-1',
  idempotencyKey: 'manual-once',
  orderType: 'market',
  limitPrice: null,
  timeInForce: 'day',
  payloadHash: 'hash',
  clientOrderId: null,
  brokerOrderId: null,
  rejectionReason: null,
} as const;

describe('PortfolioPanel governed close', () => {
  beforeEach(() => {
    getBrokerAccount.mockResolvedValue({ buying_power: '10000', equity: '10000', cash: '10000' });
    getBrokerClock.mockResolvedValue({ is_open: true, next_open: null, next_close: null });
    getOptionOrders.mockResolvedValue({ orders: [] });
    getOptionPositions.mockResolvedValue({ positions: [position] });
    createManualIntent.mockResolvedValue(intent);
    confirmManualIntent.mockResolvedValue({ ...intent, status: 'CONFIRMED' });
    submitManualIntent.mockResolvedValue({ outcome: 'SUBMITTED', intent: { ...intent, status: 'SUBMITTED' } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('opens a close dialog and does not submit before explicit confirmation', async () => {
    render(<PortfolioPanel />);

    fireEvent.click(await screen.findByRole('button', { name: /close position/i }));
    expect(screen.getByRole('dialog')).toHaveTextContent(`Close ${position.symbol}`);
    expect(screen.getByText('Sell to close: 1 contract')).toBeInTheDocument();
    expect(screen.getByText('Account: Alpaca Paper')).toBeInTheDocument();
    expect(createManualIntent).not.toHaveBeenCalled();
    expect(confirmManualIntent).not.toHaveBeenCalled();
    expect(submitManualIntent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /create close intent/i }));
    await waitFor(() => expect(createManualIntent).toHaveBeenCalledTimes(1));
    expect(createManualIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        executionMode: 'MANUAL',
        orderSource: 'MANUAL_UI',
        action: 'CLOSE_POSITION',
        optionSymbol: position.symbol,
        side: 'sell',
        positionIntent: 'sell_to_close',
        quantity: 1,
        brokerPositionQuantity: 1,
      })
    );
    expect(confirmManualIntent).not.toHaveBeenCalled();
    expect(submitManualIntent).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: /confirm sell to close/i }));
    await waitFor(() => expect(submitManualIntent).toHaveBeenCalledTimes(1));
    expect(confirmManualIntent).toHaveBeenCalledWith(intent.id);
    expect(submitManualIntent).toHaveBeenCalledWith(intent.id);
  });

  it('guards final double-click so only one submit request is sent', async () => {
    render(<PortfolioPanel />);

    fireEvent.click(await screen.findByRole('button', { name: /close position/i }));
    fireEvent.click(screen.getByRole('button', { name: /create close intent/i }));
    const confirm = await screen.findByRole('button', { name: /confirm sell to close/i });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(submitManualIntent).toHaveBeenCalledTimes(1));
    expect(confirmManualIntent).toHaveBeenCalledTimes(1);
  });
});
