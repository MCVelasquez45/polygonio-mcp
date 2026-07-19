/**
 * Execution + Operator Actions (M6): the order cards render broker state, and a
 * destructive action requires confirmation before it calls the existing endpoint.
 */
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

afterEach(cleanup);

const { closePosition, cancelOrder } = vi.hoisted(() => ({
  closePosition: vi.fn().mockResolvedValue({ ok: true }),
  cancelOrder: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../api', () => ({
  portfolioApi: { closePosition, cancelOrder, pauseEntries: vi.fn(), emergencyStop: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ExecutionPanel } from '../components/cockpit/ExecutionPanel';
import { OperatorActions } from '../components/cockpit/OperatorActions';
import type { CockpitTrade, OrderCardData } from '../components/cockpit/cockpitUi';

const entry: OrderCardData = {
  role: 'ENTRY', status: 'FILLED', rawStatus: 'filled', intentStatus: 'COMPLETED',
  orderType: 'limit', limitPrice: 5.7, timeInForce: 'day', qty: 2, filledQty: 2, remainingQty: 0,
  avgFillPrice: 5.7, attemptCount: null, brokerOrderId: 'a1b2c3d4', clientOrderId: 'c1',
  submittedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), timeoutMs: 60000,
  timeoutDeadline: null, statusHistory: [{ at: new Date().toISOString(), status: 'FILLED', rawStatus: 'filled', source: 'order-poll' }],
};

const trade: CockpitTrade = {
  positionId: 'p1',
  underlying: 'SPY',
  optionSymbol: 'O:SPY260724C00600000',
  exitIntentId: 'exit-intent-1',
  execution: {
    entry,
    exit: { ...entry, role: 'EXIT', status: 'PENDING_NEW', filledQty: 0, remainingQty: 2, attemptCount: 1, brokerOrderId: 'e5f6' },
    maxExitRetries: 3,
  },
};

describe('ExecutionPanel', () => {
  it('renders entry and exit order cards with fills and status', () => {
    render(<ExecutionPanel trade={trade} />);
    expect(screen.getByText('ENTRY')).toBeInTheDocument();
    expect(screen.getByText('EXIT')).toBeInTheDocument();
    // FILLED appears in both the status pill and the timeline chip.
    expect(screen.getAllByText('FILLED').length).toBeGreaterThan(0);
    expect(screen.getByText('PENDING_NEW')).toBeInTheDocument();
    expect(screen.getByText('retry 1/3')).toBeInTheDocument();
  });
});

describe('OperatorActions', () => {
  beforeEach(() => {
    closePosition.mockClear();
    cancelOrder.mockClear();
  });

  it('requires confirmation before force-closing, then calls the endpoint', async () => {
    const onActed = vi.fn();
    render(<OperatorActions trade={trade} sessionId="s1" onActed={onActed} />);
    fireEvent.click(screen.getByText('⚠ Force Close'));
    // modal shown; endpoint not yet called
    expect(closePosition).not.toHaveBeenCalled();
    expect(screen.getByText('Force close position')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Force close'));
    await waitFor(() => expect(closePosition).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(onActed).toHaveBeenCalled());
  });

  it('cancelling the confirm modal does not call the endpoint', () => {
    render(<OperatorActions trade={trade} sessionId="s1" onActed={vi.fn()} />);
    fireEvent.click(screen.getByText('⚠ Force Close'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(closePosition).not.toHaveBeenCalled();
  });

  it('enables Cancel Exit only while the exit order is working', () => {
    render(<OperatorActions trade={trade} sessionId="s1" onActed={vi.fn()} />);
    // exit status PENDING_NEW → not terminal → enabled
    const btn = screen.getByText('Cancel Exit') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});
