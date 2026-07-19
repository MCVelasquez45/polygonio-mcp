import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getOptionOrders, healthGet } = vi.hoisted(() => ({
  getOptionOrders: vi.fn(),
  healthGet: vi.fn(),
}));

vi.mock('../api/alpaca', () => ({
  getOptionOrders,
}));

vi.mock('../api/http', () => ({
  http: {
    get: healthGet,
  },
}));

import {
  classifyOrderHistoryError,
  getOptionOrdersDeduped,
  getOptionOrdersForPolling,
  resetOrderHistoryPollingForTests,
} from '../api/orderHistory';

describe('order-history polling guard', () => {
  beforeEach(() => {
    resetOrderHistoryPollingForTests();
    vi.clearAllMocks();
    healthGet.mockResolvedValue({ data: { ok: true } });
  });

  it('deduplicates duplicate fetchOrders calls for the same params', async () => {
    let resolveRequest: (value: { orders: any[] }) => void = () => undefined;
    getOptionOrders.mockReturnValue(
      new Promise(resolve => {
        resolveRequest = resolve;
      })
    );

    const first = getOptionOrdersDeduped({ status: 'filled', limit: 50 });
    const second = getOptionOrdersDeduped({ status: 'filled', limit: 50 });
    expect(getOptionOrders).toHaveBeenCalledTimes(1);

    resolveRequest({ orders: [] });
    await expect(Promise.all([first, second])).resolves.toEqual([{ orders: [] }, { orders: [] }]);
  });

  it('does not retry HTTP 410 from the disabled legacy submission path', async () => {
    const error = {
      response: { status: 410, data: { error: 'DIRECT_BROKER_SUBMISSION_DISABLED' } },
      config: { url: '/api/broker/alpaca/options/orders' },
    };
    getOptionOrders.mockRejectedValue(error);

    await expect(getOptionOrdersForPolling({ status: 'filled', limit: 50 })).rejects.toBe(error);
    expect(classifyOrderHistoryError(error)).toBe('legacy-disabled');
    expect(getOptionOrders).toHaveBeenCalledTimes(1);
  });
});
