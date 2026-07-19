import { beforeEach, describe, expect, it, vi } from 'vitest';

const { io } = vi.hoisted(() => ({
  io: vi.fn(() => ({
    connected: false,
    io: { opts: {} },
    on: vi.fn(),
    disconnect: vi.fn(),
    connect: vi.fn(),
  })),
}));

vi.mock('socket.io-client', () => ({ io }));

vi.mock('../api/http', () => ({
  getApiBaseUrl: () => 'http://localhost:4000',
}));

describe('shared socket singleton', () => {
  beforeEach(() => {
    vi.resetModules();
    io.mockClear();
  });

  it('creates exactly one bounded Socket.IO client for repeated consumers', async () => {
    const { getSharedSocket } = await import('../lib/socket');
    const first = getSharedSocket();
    const second = getSharedSocket();

    expect(first).toBe(second);
    expect(io).toHaveBeenCalledTimes(1);
    expect(io).toHaveBeenCalledWith(
      'http://localhost:4000',
      expect.objectContaining({
        path: '/socket.io',
        reconnection: true,
        reconnectionAttempts: 12,
        reconnectionDelayMax: 5000,
      })
    );
  });
});
