import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TradeReportsPage } from '../components/intelligence/TradeReportsPage';
import type { GradeBreakdown, TradeReport } from '../api/intelligence';

const grade = (value: GradeBreakdown['grade'], score: number | null, reasons: string[] = []): GradeBreakdown => ({
  grade: value,
  score,
  reasons,
  unavailableInputs: [],
});

const report: TradeReport = {
  reportId: 'trade:position-xle',
  tradeId: 'position-xle',
  sessionId: 'paper:2026-07-16:session',
  automationSessionId: 'session',
  status: 'GENERATED',
  environment: 'PAPER',
  tradingDate: '2026-07-16',
  identity: {
    underlying: 'XLE',
    optionSymbol: 'XLE260717C00090000',
    direction: 'BULLISH',
    strategyVersionId: 'sv-intel-report-1',
    strategy: 'sv-intel-report-1',
    contractType: 'call',
    contractStrike: 90,
    contractExpiration: '2026-07-17',
  },
  lifecycle: {
    openedAt: '2026-07-16T14:38:00.000Z',
    closedAt: '2026-07-16T20:55:00.000Z',
    holdTimeMinutes: 377,
    exitReason: 'END_OF_DAY',
    overnightRecoveryRequired: false,
    manualReviewReason: null,
  },
  execution: {
    entryOrder: { brokerOrderId: 'entry-broker' },
    exitOrder: { brokerOrderId: 'exit-broker' },
    entryIntent: { intentId: 'entry-intent' },
    exitIntent: { intentId: 'exit-intent' },
    fillCount: 2,
    partialFillCount: 0,
    cancellationCount: 0,
    rejectionCount: 0,
    retryCount: 1,
    entrySlippage: -0.01,
    exitSlippage: -0.01,
    totalEstimatedSlippage: -2,
    fillQuality: 'At or better than limit evidence',
  },
  marketContext: {
    marketStatus: 'CLOSED',
    underlyingPriceAtSelection: 89.5,
    spyContext: null,
    sectorContext: null,
    vixContext: null,
    trend: 'UP',
    marketRegime: 'REGULAR_SESSION',
    liquidity: {
      bid: 1.68,
      ask: 1.72,
      mid: 1.7,
      spreadDollars: 0.04,
      spreadPct: 0.0235,
      volume: 120,
      openInterest: 850,
    },
  },
  greeks: {
    delta: 0.48,
    theta: null,
    gamma: null,
    vega: null,
    iv: 0.32,
  },
  signal: {
    confidence: 0.78,
    flowScore: 0.7,
    momentumScore: 0.65,
    trendScore: 0.72,
    riskScore: 1,
    candidateRank: 1,
    candidateStatus: 'RISK_APPROVED',
    riskApproved: true,
    riskReasonCodes: [],
    selectedContractScore: 88,
    selectedContractRank: 1,
  },
  performance: {
    entryPrice: 1.69,
    exitPrice: 1.71,
    contracts: 1,
    realizedPnl: 2,
    returnPct: 0.0118,
    maxFavorableExcursion: 9,
    maxAdverseExcursion: -4,
    drawdown: -4,
    fees: null,
  },
  grades: {
    entry: grade('A', 95, ['Risk engine approved the setup']),
    exit: grade('B', 85, ['Exit reason was end-of-day flattening']),
    risk: grade('A', 90, ['Risk decision approved before entry']),
    execution: grade('A+', 98, ['Entry and exit fill evidence captured']),
    market: grade('A', 92, ['Liquidity snapshot captured at selection']),
    overall: grade('A', 92, ['Average of deterministic component grades']),
  },
  lessons: {
    strengths: ['Risk approval was persisted before entry.'],
    weaknesses: ['Some report fields could not be reconstructed from persisted V1 evidence.'],
    improvementSuggestions: ['Persist full greek snapshots at entry if future reports need theta/gamma/vega attribution.'],
  },
  timeline: [
    {
      at: '2026-07-16T14:35:00.000Z',
      label: 'Signal evaluated',
      source: 'TradeCandidate',
      sourceId: 'candidate',
      severity: 'info',
      details: { status: 'RISK_APPROVED' },
    },
    {
      at: '2026-07-16T20:55:00.000Z',
      label: 'Position closed',
      source: 'AutomationPosition',
      sourceId: 'position-xle',
      severity: 'info',
      details: { realizedPnl: 2 },
    },
  ],
  evidence: {
    positionId: 'position-xle',
    tradingSessionId: 'paper:2026-07-16:session',
    brokerOrderIds: ['entry-broker', 'exit-broker'],
    orderIntentIds: ['entry-intent', 'exit-intent'],
    riskDecisionId: 'risk',
    tradeCandidateId: 'candidate',
    contractSelectionId: 'selection',
    universeEvaluationIds: ['evaluation'],
    eventIds: ['event-1'],
  },
  warnings: [
    {
      code: 'SPY_SECTOR_VIX_CONTEXT_NOT_CAPTURED',
      message: 'SPY, sector, and VIX context are not persisted by V1 evidence.',
      source: 'MarketContext',
    },
  ],
};

afterEach(() => cleanup());

describe('TradeReportsPage', () => {
  it('renders generated report list and institutional detail sections', () => {
    render(<TradeReportsPage initialReports={[report]} loadOnMount={false} />);

    // Header + hero identity
    expect(screen.getByText('Trade Reports')).toBeInTheDocument();
    expect(screen.getAllByText('XLE').length).toBeGreaterThan(0);
    expect(screen.getByText('XLE260717C00090000')).toBeInTheDocument();

    // Overall grade shows in the hero badge + list + rubric header
    expect(screen.getAllByText('A').length).toBeGreaterThan(0);

    // Signed P/L appears in list + hero facts + metric strip
    expect(screen.getAllByText('+$2.00').length).toBeGreaterThan(0);

    // Collapsed section headers are present as panel titles
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getAllByText('Execution').length).toBeGreaterThan(0);
    expect(screen.getByText('Risk & Performance')).toBeInTheDocument();
    expect(screen.getByText('Greeks')).toBeInTheDocument();
    expect(screen.getByText('Timeline')).toBeInTheDocument();

    // Expand the Timeline panel and assert a grouped, humanized label renders
    fireEvent.click(screen.getByRole('button', { name: /Timeline/ }));
    expect(screen.getByText(/signal evaluated/i)).toBeInTheDocument();

    // Expand Warnings and assert the missing-evidence code surfaces
    fireEvent.click(screen.getByRole('button', { name: /Warnings/ }));
    expect(screen.getByText(/SPY_SECTOR_VIX_CONTEXT_NOT_CAPTURED/)).toBeInTheDocument();
  });

  it('renders missing evidence honestly without placeholder tokens', () => {
    const missing: TradeReport = {
      ...report,
      reportId: 'trade:position-spy',
      tradeId: 'position-spy',
      identity: { ...report.identity, underlying: 'SPY', direction: 'BEARISH', optionSymbol: 'SPY260717P00500000', strategy: null, contractType: null, contractStrike: null, contractExpiration: null },
      greeks: { delta: null, theta: null, gamma: null, vega: null, iv: null },
      signal: { ...report.signal, riskApproved: null, riskScore: null, confidence: null, candidateRank: null },
      performance: {
        ...report.performance,
        entryPrice: null,
        exitPrice: null,
        returnPct: null,
        maxFavorableExcursion: null,
        maxAdverseExcursion: null,
        drawdown: null,
        realizedPnl: -58,
        fees: null,
      },
      marketContext: {
        ...report.marketContext,
        marketStatus: null,
        marketRegime: null,
        trend: null,
        underlyingPriceAtSelection: null,
        liquidity: null,
      },
      lifecycle: {
        ...report.lifecycle,
        exitReason: null,
        holdTimeMinutes: null,
        openedAt: null,
        closedAt: null,
      },
    };
    const { container } = render(<TradeReportsPage initialReports={[missing]} loadOnMount={false} />);

    // Expand every collapsible panel so all fields are in the DOM for the token audit.
    for (const btn of screen.getAllByRole('button', { expanded: false })) {
      fireEvent.click(btn);
    }

    // Word-form absence is used, never fabricated numbers or cryptic tokens.
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);

    // MANDATORY product-integrity assertions.
    expect(container.textContent).not.toContain('N/A');
    expect(container.textContent).not.toContain('UNKNOWN');
    expect(container.textContent).not.toContain('—');
    expect(container.textContent).not.toContain('$0.00');
  });

  it('renders empty state without duplicating automation controls', () => {
    render(<TradeReportsPage initialReports={[]} loadOnMount={false} />);
    expect(screen.getByText('No trade intelligence reports have been generated yet.')).toBeInTheDocument();
    expect(screen.queryByText('Automation Command Center')).not.toBeInTheDocument();
    expect(screen.queryByText('Emergency Stop')).not.toBeInTheDocument();
  });
});
