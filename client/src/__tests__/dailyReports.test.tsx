import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DailyReportsPage } from '../components/intelligence/DailyReportsPage';
import type { DailyGradeBreakdown, DailyReport } from '../api/intelligence';

const grade = (value: DailyGradeBreakdown['grade'], score: number | null, reasons: string[] = []): DailyGradeBreakdown => ({
  grade: value,
  score,
  reasons,
  unavailableInputs: [],
});

const dailyReport: DailyReport = {
  reportId: 'daily:paper:2026-07-16:session',
  sessionId: 'paper:2026-07-16:session',
  tradingDate: '2026-07-16',
  environment: 'PAPER',
  status: 'GENERATED',
  executiveSummary: {
    overallGrade: 'B',
    marketSummary: 'Market status captured as CLOSED.',
    sessionSummary: '2 trade report(s), 1 win(s), 1 loss(es), net -$56.00.',
    primaryLesson: 'Overnight exposure reduced performance.',
    bestDecision: 'XLE produced the strongest realized outcome.',
    worstDecision: 'SPY produced the weakest realized outcome.',
    highlights: ['Daily grade B.', 'Net P/L -$56.00.', 'Largest winner XLE at $2.00.', 'Largest loser SPY at -$58.00.'],
    keyFindings: ['2 trade report(s), 1 win(s), 1 loss(es), net -$56.00.'],
  },
  tradingSummary: {
    watchlistSize: 2,
    symbolsEvaluated: 12,
    signalsGenerated: 2,
    signalsApproved: 2,
    signalsRejected: 2,
    riskRejects: 1,
    dataRejects: 1,
    tradesOpened: 2,
    tradesClosed: 2,
    wins: 1,
    losses: 1,
    breakeven: 0,
  },
  performance: {
    realizedPnl: -56,
    unrealizedPnl: null,
    netPnl: -56,
    averageWinner: 2,
    averageLoser: -58,
    largestWinner: { tradeReportId: 'trade:xle', underlying: 'XLE', realizedPnl: 2 },
    largestLoser: { tradeReportId: 'trade:spy', underlying: 'SPY', realizedPnl: -58 },
    averageHoldTimeMinutes: 880,
    profitFactor: 0.0345,
    expectancy: -28,
  },
  capital: {
    equity: null,
    cash: null,
    buyingPower: null,
    drawdown: -72,
    capitalEfficiency: null,
  },
  execution: {
    ordersSubmitted: 4,
    fills: 4,
    partialFills: 0,
    cancelled: 0,
    rejected: 0,
    timeouts: null,
    retryCount: 3,
    fillRate: 1,
  },
  market: {
    marketStatus: 'CLOSED',
    marketRegime: 'REGULAR_SESSION',
    spyTrend: null,
    vix: null,
    sectorLeadership: null,
  },
  grades: {
    execution: grade('A', 92, ['Broker fill rate was high from captured order evidence.']),
    risk: grade('C', 72, ['1 trade(s) required overnight recovery.']),
    market: grade('B', 84),
    tradeQuality: grade('B', 82),
    performance: grade('C', 72),
    evidence: grade('B', 85),
    overall: grade('B', 82),
  },
  evidenceQuality: {
    availableEvidencePercent: 85,
    expectedClosedTrades: 2,
    generatedTradeReports: 2,
    missingEvidence: ['portfolio snapshot', 'THETA_GAMMA_VEGA_NOT_CAPTURED'],
    warnings: [{ code: 'PORTFOLIO_SNAPSHOT_NOT_CAPTURED', message: 'Portfolio snapshot was not captured for this session.' }],
  },
  tradeReports: [
    {
      reportId: 'trade:xle',
      tradeId: 'position-xle',
      underlying: 'XLE',
      direction: 'BULLISH',
      realizedPnl: 2,
      overallGrade: 'A',
      exitReason: 'END_OF_DAY',
    },
    {
      reportId: 'trade:spy',
      tradeId: 'position-spy',
      underlying: 'SPY',
      direction: 'BEARISH',
      realizedPnl: -58,
      overallGrade: 'C',
      exitReason: 'OVERNIGHT_RECOVERY',
    },
  ],
  tradeReportIds: ['trade:spy', 'trade:xle'],
  sessionReference: {
    sessionId: 'paper:2026-07-16:session',
    tradingDate: '2026-07-16',
    status: 'FINALIZED',
  },
  timeline: [
    {
      at: '2026-07-16T14:00:00.000Z',
      label: 'Trading session started',
      source: 'TradingSession',
      sourceId: 'paper:2026-07-16:session',
      severity: 'info',
    },
    {
      at: '2026-07-17T13:36:00.000Z',
      label: 'SPY closed at a loss',
      source: 'TradeReport',
      sourceId: 'trade:spy',
      severity: 'warning',
    },
  ],
  warnings: [{ code: 'PORTFOLIO_SNAPSHOT_NOT_CAPTURED', message: 'Portfolio snapshot was not captured for this session.' }],
};

afterEach(() => cleanup());

describe('DailyReportsPage', () => {
  it('renders daily executive briefing from persisted intelligence data', () => {
    render(<DailyReportsPage initialReports={[dailyReport]} loadOnMount={false} />);

    // Hero-first: title, grade, net P/L, and narrative visible without scrolling.
    expect(screen.getByText('Daily Reports')).toBeInTheDocument();
    expect(screen.getAllByText('2026-07-16').length).toBeGreaterThan(0);
    expect(screen.getByText('Daily Grade')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Grade B').length).toBeGreaterThan(0);
    expect(screen.getAllByText('-$56.00').length).toBeGreaterThan(0);
    expect(screen.getByText('Overnight exposure reduced performance.')).toBeInTheDocument();
    expect(screen.getByText('XLE produced the strongest realized outcome.')).toBeInTheDocument();
    expect(screen.getByText('SPY produced the weakest realized outcome.')).toBeInTheDocument();
    expect(screen.getByText('Executive Summary')).toBeInTheDocument();

    // Evidence lives below the fold — expand the collapsed timeline + warnings.
    fireEvent.click(screen.getByText('Timeline'));
    expect(screen.getByText('spy closed at a loss')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Warnings'));
    expect(screen.getAllByText(/PORTFOLIO_SNAPSHOT_NOT_CAPTURED/).length).toBeGreaterThan(0);
  });

  it('renders honest missing-data states without fake market or capital values', () => {
    const missing: DailyReport = {
      ...dailyReport,
      reportId: 'daily:missing',
      performance: {
        ...dailyReport.performance,
        realizedPnl: null,
        netPnl: null,
        largestWinner: null,
        largestLoser: null,
      },
      capital: {
        equity: null,
        cash: null,
        buyingPower: null,
        drawdown: null,
        capitalEfficiency: null,
      },
      market: {
        marketStatus: null,
        marketRegime: null,
        spyTrend: null,
        vix: null,
        sectorLeadership: null,
      },
      tradeReports: [],
      tradeReportIds: [],
      timeline: [],
    };
    const { container } = render(<DailyReportsPage initialReports={[missing]} loadOnMount={false} />);

    // Absent values spell out in words, both in the always-visible hero/strip
    // and inside the expanded evidence panels.
    fireEvent.click(screen.getByText('Market Context'));
    fireEvent.click(screen.getByText('Capital & Execution'));
    fireEvent.click(screen.getByText('Linked Trades'));
    fireEvent.click(screen.getByText('Timeline'));

    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
    expect(screen.getByText('No trade reports were linked to this daily report.')).toBeInTheDocument();
    expect(screen.getByText('No timeline events recorded this session.')).toBeInTheDocument();

    // Integrity rule: never a cryptic placeholder or a fabricated zero.
    expect(container.textContent).not.toContain('N/A');
    expect(container.textContent).not.toContain('UNKNOWN');
    expect(container.textContent).not.toContain('—');
    expect(container.textContent).not.toContain('$0.00');
  });

  it('renders empty state without duplicating automation controls', () => {
    render(<DailyReportsPage initialReports={[]} loadOnMount={false} />);
    expect(screen.getByText('No daily intelligence reports have been generated yet.')).toBeInTheDocument();
    expect(screen.queryByText('Automation Command Center')).not.toBeInTheDocument();
    expect(screen.queryByText('Emergency Stop')).not.toBeInTheDocument();
  });
});
