/**
 * Execution-boundary regression: viewing / selecting a contract and receiving
 * quote updates must NEVER submit a broker order. A manual paper order is placed
 * only by the explicit two-step confirmation (Review → Submit Manual Paper
 * Order), which routes through the governed manual-trading API exactly once.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const { submitManualPaperOrder } = vi.hoisted(() => ({
  submitManualPaperOrder: vi.fn(async () => ({ outcome: 'SUBMITTED', intent: {}, brokerOrder: {} })),
}));
vi.mock('../api/manualTrading', () => ({ submitManualPaperOrder }));
vi.mock('../api/alpaca', () => ({
  getBrokerAccount: vi.fn(async () => ({ buying_power: '100000' })),
}));
vi.mock('../lib/liveMarketStore', () => ({ useLiveQuote: () => null }));

import { OrderTicketPanel } from '../components/trading/OrderTicketPanel';

const contract = {
  ticker: 'SPY260724C00500000',
  type: 'call',
  strike: 500,
  lastQuote: { bid: 1.2, ask: 1.3 },
  lastTrade: { price: 1.25 },
} as any;

describe('OrderTicketPanel execution isolation', () => {
  beforeEach(() => submitManualPaperOrder.mockClear());
  afterEach(() => cleanup());

  it('does not submit on mount, selection, or re-render (quote update)', async () => {
    const { rerender } = render(<OrderTicketPanel contract={contract} isLoading={false} />);
    // Simulate a quote update / prop refresh.
    rerender(<OrderTicketPanel contract={{ ...contract }} isLoading={false} spotPrice={499} />);
    // Give any (forbidden) async effects a chance to fire.
    await waitFor(() => expect(screen.getByRole('button', { name: /review order/i })).toBeTruthy());
    expect(submitManualPaperOrder).not.toHaveBeenCalled();
  });

  it('submits exactly once only after explicit Review → Submit confirmation', async () => {
    render(<OrderTicketPanel contract={contract} isLoading={false} />);

    // Opening the review dialog must not submit.
    fireEvent.click(screen.getByRole('button', { name: /review order/i }));
    expect(submitManualPaperOrder).not.toHaveBeenCalled();

    // The explicit final action submits exactly once.
    const submit = await screen.findByRole('button', { name: /submit manual paper order/i });
    fireEvent.click(submit);
    await waitFor(() => expect(submitManualPaperOrder).toHaveBeenCalledTimes(1));
    expect(submitManualPaperOrder).toHaveBeenCalledWith(
      expect.objectContaining({ optionSymbol: contract.ticker, side: 'buy', quantity: 1 })
    );
  });

  it('cancelling the review dialog does not submit', async () => {
    render(<OrderTicketPanel contract={contract} isLoading={false} />);
    fireEvent.click(screen.getByRole('button', { name: /review order/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^back$/i }));
    expect(submitManualPaperOrder).not.toHaveBeenCalled();
  });
});
