import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TradingSessionsPage } from '../components/intelligence/TradingSessionsPage';
import type { TradingSession } from '../api/intelligence';

const finalizedSession: TradingSession = {
  sessionId: 'paper:2026-07-16:test',
  tradingDate: '2026-07-16',
  timezone: 'America/New_York',
  status: 'FINALIZED',
  environment: 'PAPER',
  marketStatus: 'CLOSED',
  startedAt: '2026-07-16T14:00:00.000Z',
  finalizedAt: '2026-07-16T22:00:00.000Z',
  automationSessionId: 'session-1',
  watchlist: { symbols: ['SPY', 'XLE'], size: 2 },
  evaluationSummary: {
    windowsEvaluated: 3,
    symbolsEvaluated: 8,
    signalsGenerated: 2,
    noSignalCount: 4,
    dataRejectCount: 1,
    riskRejectCount: 1,
    approvedCount: 2,
  },
  tradeSummary: {
    tradesOpened: 2,
    tradesClosed: 2,
    winningTrades: 1,
    losingTrades: 1,
    breakevenTrades: 0,
    realizedPnl: -56,
    unrealizedPnlAtClose: null,
    totalPnl: -56,
  },
  orderSummary: {
    intentsCreated: 4,
    ordersSubmitted: 4,
    fills: 2,
    partialFills: 0,
    cancellations: 1,
    rejections: 0,
    manualReviewCount: 0,
  },
  portfolioSnapshot: null,
  providerSummary: {
    totalRequests: 20,
    cacheHits: 5,
    cacheHitRate: null,
    rateLimitCount: 1,
    providerErrors: null,
    entitlementRejects: 0,
  },
  automationHealth: {
    schedulerHealthy: true,
    monitorHealthy: true,
    reconciliationClean: true,
    brokerConnected: true,
    marketDataConnected: true,
    mongoConnected: true,
    emergencyStopActivated: false,
  },
  warnings: [{ code: 'PORTFOLIO_SNAPSHOT_NOT_CAPTURED', message: 'No persisted account-level portfolio snapshot exists for this session.' }],
  errors: [],
  generation: {
    schemaVersion: 1,
    generatorVersion: 'trading-session-capture-v1',
    generatedBy: 'server:intelligence:session-capture',
    sourceWindowStart: '2026-07-16T04:00:00.000Z',
    sourceWindowEnd: '2026-07-17T04:00:00.000Z',
    finalizedFromPersistedEvidence: true,
    attemptCount: 1,
  },
};

afterEach(() => cleanup());

describe('TradingSessionsPage', () => {
  it('renders finalized session values from captured evidence', () => {
    render(<TradingSessionsPage initialSessions={[finalizedSession]} loadOnMount={false} />);

    // Masthead
    expect(screen.getByText('Trading Sessions')).toBeInTheDocument();

    // Trading date appears in the record list and hero facts
    expect(screen.getAllByText('2026-07-16').length).toBeGreaterThan(0);

    // StatusBadge humanizes the label; the raw status is also exposed in the hero status line.
    expect(screen.getByText('Finalized')).toBeInTheDocument();
    expect(screen.getByText('Status FINALIZED')).toBeInTheDocument();

    // Honest market status passthrough (shown in the hero sub)
    expect(screen.getAllByText('CLOSED').length).toBeGreaterThan(0);

    // Net P/L rendered via signed formatter (appears in list, hero badge, metric strip)
    expect(screen.getAllByText('-$56.00').length).toBeGreaterThan(0);

    // Wins / Losses fact
    expect(screen.getByText('1 / 1')).toBeInTheDocument();

    // Missing portfolio snapshot honest copy (Portfolio Snapshot is collapsed by default)
    fireEvent.click(screen.getByRole('button', { name: /Portfolio Snapshot/ }));
    expect(screen.getByText('Portfolio snapshot was not captured for this session.')).toBeInTheDocument();

    // Warning surfaced through EventList, not silently sliced (Warnings panel collapsed by default)
    fireEvent.click(screen.getByRole('button', { name: /^Warnings/ }));
    expect(screen.getByText(/PORTFOLIO_SNAPSHOT_NOT_CAPTURED/)).toBeInTheDocument();
  });

  it('renders collecting and unavailable states honestly', () => {
    const collecting: TradingSession = {
      ...finalizedSession,
      sessionId: 'paper:2026-07-17:test',
      tradingDate: '2026-07-17',
      status: 'OPEN',
      marketStatus: 'UNAVAILABLE',
      finalizedAt: null,
      tradeSummary: { ...finalizedSession.tradeSummary, totalPnl: null },
      providerSummary: { ...finalizedSession.providerSummary, cacheHitRate: null, providerErrors: null },
      warnings: [],
      errors: [],
    };
    const { container } = render(<TradingSessionsPage initialSessions={[collecting]} loadOnMount={false} />);

    // Collecting banner
    expect(screen.getByText('This session is still collecting evidence.')).toBeInTheDocument();

    // Unavailable market status honest copy
    expect(screen.getByText('Market status unavailable from captured evidence')).toBeInTheDocument();

    // Absent scalars render the word form (never a fabricated number). The
    // Provider & Automation panel holds the null cache-hit-rate / provider errors.
    fireEvent.click(screen.getByRole('button', { name: /Provider & Automation/ }));
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);

    // MANDATORY integrity assertions: absence is never a cryptic placeholder or fake zero
    expect(container.textContent).not.toContain('—');
    expect(container.textContent).not.toContain('N/A');
    expect(container.textContent).not.toContain('UNKNOWN');
    expect(container.textContent).not.toContain('$0.00');
  });

  it('renders empty state without duplicating operations controls', () => {
    render(<TradingSessionsPage initialSessions={[]} loadOnMount={false} />);
    expect(screen.getByText('No finalized trading sessions yet.')).toBeInTheDocument();
    expect(screen.queryByText('Automation Command Center')).not.toBeInTheDocument();
    expect(screen.queryByText('Emergency Stop')).not.toBeInTheDocument();
  });
});
