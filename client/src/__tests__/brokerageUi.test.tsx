import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrokerConnectionCenter } from '../components/brokerage/BrokerConnectionCenter';
import { SecurityCenter } from '../components/brokerage/SecurityCenter';
import * as brokerage from '../api/brokerage';

vi.mock('../api/brokerage', async () => {
  const actual = await vi.importActual<typeof import('../api/brokerage')>('../api/brokerage');
  return { ...actual, listBrokers: vi.fn(), connectBroker: vi.fn(), disconnectBroker: vi.fn(), reconnectBroker: vi.fn(), syncBrokers: vi.fn(), getSecurityOverview: vi.fn() };
});

const connection: brokerage.BrokerConnection = {
  id: 'connection-1', provider: 'alpaca', brokerName: 'Alpaca', nickname: 'Alpaca', accountId: 'account-1', accountType: 'margin',
  environment: 'paper', paper: true, live: false, primary: true, status: 'connected', scopes: ['account', 'trading'],
  permissions: ['Read Account', 'Submit Orders'], connectedAt: '2026-08-01T00:00:00Z', lastSync: '2026-08-02T00:00:00Z',
  lastRefresh: null, expiresAt: null, oauthStatus: 'authorized', reconnectStatus: 'not_required', health: 'healthy',
  balances: { buyingPower: 250000, cash: 100000, equity: 300000, portfolioValue: 300000 }, metrics: { openPositions: 2, openOrders: 1, todayPl: 100 },
};

const current = { provider: 'alpaca', name: 'Alpaca', monogram: 'A', assets: ['Stocks', 'Options', 'Crypto'], oauthSupported: true, paperTrading: true, liveTrading: true, available: true, configured: true, permissions: ['Read Account', 'Read Positions', 'Submit Orders'], description: 'API-first brokerage.', connections: [] } satisfies brokerage.BrokerDirectoryEntry;
const future = { provider: 'schwab', name: 'Charles Schwab', monogram: 'CS', assets: ['Stocks', 'Options'], oauthSupported: false, paperTrading: false, liveTrading: true, available: false, configured: false, permissions: [], description: 'Full-service investing.', connections: [] } satisfies brokerage.BrokerDirectoryEntry;

describe('enterprise brokerage UI', () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(brokerage.listBrokers).mockResolvedValue([current, future]);
    vi.mocked(brokerage.disconnectBroker).mockResolvedValue();
    vi.mocked(brokerage.syncBrokers).mockResolvedValue();
  });

  it('shows active and future institutions without dead navigation', async () => {
    render(<BrokerConnectionCenter />);
    expect(await screen.findByRole('heading', { name: 'Connect your brokerage' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alpaca/ })).toBeEnabled();
    expect(screen.getByText('Charles Schwab')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Charles Schwab/ })).not.toBeInTheDocument();
    expect(screen.getByText('No passwords stored')).toBeInTheDocument();
  });

  it('reviews permissions and disconnect consequences before revocation', async () => {
    vi.mocked(brokerage.listBrokers).mockResolvedValue([{ ...current, connections: [connection] }, future]);
    render(<BrokerConnectionCenter mode="settings" />);
    await screen.findByText('connected');
    fireEvent.click(await screen.findByRole('button', { name: /Alpaca/ }));
    expect(screen.getByText('$250,000')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('OAuth tokens');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('AI memory');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(brokerage.disconnectBroker).toHaveBeenCalledWith('alpaca', 'connection-1'));
  });

  it('renders security controls, devices, brokers, and activity', async () => {
    vi.mocked(brokerage.getSecurityOverview).mockResolvedValue({
      controls: { oauthAuthentication: true, encryption: 'AES-256-GCM', transport: 'TLS 1.3', revocableAccess: true },
      sessionStatus: 'active', lastLogin: '2026-08-02T00:00:00Z', connectedDevices: [{ id: 'session-1', device: { ua: 'Secure Browser', ip: '127.0.0.1' }, lastUsedAt: '2026-08-02T00:00:00Z', createdAt: '2026-08-01T00:00:00Z' }],
      connectedBrokers: [connection], activity: [{ _id: 'audit-1', action: 'BROKER_CONNECTED', outcome: 'success', createdAt: '2026-08-02T00:00:00Z', ip: '127.0.0.1', ua: 'Secure Browser', targetType: 'broker_connection' }],
    });
    render(<SecurityCenter />);
    expect(await screen.findByText('AES-256-GCM')).toBeInTheDocument();
    expect(screen.getByText('TLS 1.3')).toBeInTheDocument();
    expect(screen.getByText('Secure Browser')).toBeInTheDocument();
    expect(screen.getByText('broker connected')).toBeInTheDocument();
  });
});
