import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StrategyAnalyticsPage } from '../components/intelligence/StrategyAnalyticsPage';
import type { StrategyAnalytics, StrategyAnalyticsBucket } from '../api/intelligence';

const bucket = (overrides: Partial<StrategyAnalyticsBucket>): StrategyAnalyticsBucket => ({
  key: overrides.key ?? 'key',
  label: overrides.label ?? 'Label',
  totalTrades: overrides.totalTrades ?? 1,
  wins: overrides.wins ?? 1,
  losses: overrides.losses ?? 0,
  breakeven: overrides.breakeven ?? 0,
  netPnl: overrides.netPnl ?? 2,
  winRate: overrides.winRate ?? 1,
  expectancy: overrides.expectancy ?? 2,
  profitFactor: overrides.profitFactor ?? 2,
  averageWinner: overrides.averageWinner ?? 2,
  averageLoser: overrides.averageLoser ?? null,
  averageInputValue: overrides.averageInputValue ?? null,
  sampleTradeIds: overrides.sampleTradeIds ?? ['trade-1'],
  sampleReportIds: overrides.sampleReportIds ?? ['report-1'],
  sampleDecisionIds: overrides.sampleDecisionIds ?? ['decision-1'],
  notes: overrides.notes ?? [],
});

const analytics: StrategyAnalytics = {
  analyticsId: 'analytics:daily:2026-07-16:paper',
  tradingDate: '2026-07-16',
  windowType: 'DAILY',
  windowStart: '2026-07-16T04:00:00.000Z',
  windowEnd: '2026-07-17T04:00:00.000Z',
  generatedAt: '2026-07-17T03:30:00.000Z',
  environment: 'PAPER',
  status: 'GENERATED',
  performance: {
    totalTrades: 2,
    wins: 1,
    losses: 1,
    breakeven: 0,
    netPnl: -56,
    winRate: 0.5,
    expectancy: -28,
    profitFactor: 0.0345,
    averageWinner: 2,
    averageLoser: -58,
    drawdown: -72,
    capitalEfficiency: 0.0125,
  },
  strategyBreakdown: [
    bucket({
      key: 'momentum',
      label: 'Momentum',
      totalTrades: 2,
      wins: 1,
      losses: 1,
      netPnl: -56,
      winRate: 0.5,
      expectancy: -28,
      profitFactor: 0.0345,
      averageWinner: 2,
      averageLoser: -58,
      notes: ['Raw strategy version: momentum-5m-v1'],
    }),
  ],
  underlyingBreakdown: [
    bucket({
      key: 'XLE',
      label: 'XLE',
      totalTrades: 1,
      wins: 1,
      losses: 0,
      netPnl: 2,
      winRate: 1,
      expectancy: 2,
      profitFactor: null,
      averageWinner: 2,
      averageLoser: null,
    }),
    bucket({
      key: 'SPY',
      label: 'SPY',
      totalTrades: 1,
      wins: 0,
      losses: 1,
      netPnl: -58,
      winRate: 0,
      expectancy: -58,
      profitFactor: null,
      averageWinner: null,
      averageLoser: -58,
    }),
  ],
  sectorBreakdown: [
    bucket({
      key: 'not-captured',
      label: 'Not captured',
      totalTrades: 2,
      wins: 1,
      losses: 1,
      netPnl: -56,
      winRate: 0.5,
      expectancy: -28,
      profitFactor: 0.0345,
      averageWinner: 2,
      averageLoser: -58,
    }),
  ],
  marketRegimeBreakdown: [
    bucket({
      key: 'regular-session',
      label: 'REGULAR_SESSION',
      totalTrades: 2,
      wins: 1,
      losses: 1,
      netPnl: -56,
      winRate: 0.5,
      expectancy: -28,
      profitFactor: 0.0345,
      averageWinner: 2,
      averageLoser: -58,
    }),
  ],
  confidenceBreakdown: [
    bucket({
      key: '80-89',
      label: '80-89',
      totalTrades: 1,
      wins: 1,
      losses: 0,
      netPnl: 2,
      winRate: 1,
      expectancy: 2,
      profitFactor: null,
      averageWinner: 2,
      averageInputValue: 84,
    }),
    bucket({
      key: '70-79',
      label: '70-79',
      totalTrades: 1,
      wins: 0,
      losses: 1,
      netPnl: -58,
      winRate: 0,
      expectancy: -58,
      profitFactor: null,
      averageLoser: -58,
      averageInputValue: 78,
    }),
  ],
  dteBreakdown: [
    bucket({
      key: '0-1',
      label: '0-1',
      totalTrades: 1,
      wins: 1,
      losses: 0,
      netPnl: 2,
      winRate: 1,
      expectancy: 2,
      profitFactor: null,
      averageWinner: 2,
      averageInputValue: 1,
    }),
  ],
  deltaBreakdown: [
    bucket({
      key: '0.40-0.60',
      label: '0.40-0.60',
      totalTrades: 2,
      wins: 1,
      losses: 1,
      netPnl: -56,
      winRate: 0.5,
      expectancy: -28,
      profitFactor: 0.0345,
      averageWinner: 2,
      averageLoser: -58,
      averageInputValue: 0.48,
    }),
  ],
  ivBreakdown: [
    bucket({
      key: '20-35',
      label: '20-35%',
      totalTrades: 2,
      wins: 1,
      losses: 1,
      netPnl: -56,
      winRate: 0.5,
      expectancy: -28,
      profitFactor: 0.0345,
      averageWinner: 2,
      averageLoser: -58,
      averageInputValue: 32,
    }),
  ],
  weekdayBreakdown: [
    bucket({
      key: 'friday',
      label: 'Friday',
      totalTrades: 2,
      wins: 1,
      losses: 1,
      netPnl: -56,
      winRate: 0.5,
      expectancy: -28,
      profitFactor: 0.0345,
      averageWinner: 2,
      averageLoser: -58,
    }),
  ],
  timeOfDayBreakdown: [
    bucket({
      key: '09:30-11:29',
      label: '09:30-11:29',
      totalTrades: 1,
      wins: 1,
      losses: 0,
      netPnl: 2,
      winRate: 1,
      expectancy: 2,
      profitFactor: null,
      averageWinner: 2,
    }),
  ],
  exitReasonBreakdown: [
    bucket({
      key: 'end-of-day',
      label: 'END_OF_DAY',
      totalTrades: 1,
      wins: 1,
      losses: 0,
      netPnl: 2,
      winRate: 1,
      expectancy: 2,
      profitFactor: null,
      averageWinner: 2,
    }),
    bucket({
      key: 'overnight',
      label: 'OVERNIGHT',
      totalTrades: 1,
      wins: 0,
      losses: 1,
      netPnl: -58,
      winRate: 0,
      expectancy: -58,
      profitFactor: null,
      averageLoser: -58,
    }),
  ],
  riskProfileBreakdown: [
    bucket({
      key: '1',
      label: '1 contract',
      totalTrades: 2,
      wins: 1,
      losses: 1,
      netPnl: -56,
      winRate: 0.5,
      expectancy: -28,
      profitFactor: 0.0345,
      averageWinner: 2,
      averageLoser: -58,
      averageInputValue: 1,
    }),
  ],
  evidenceQuality: {
    availableEvidencePercent: 85,
    missingEvidence: ['sector evidence'],
  },
  warnings: [{ code: 'SECTOR_CONTEXT_NOT_CAPTURED', message: 'Sector attribution is not persisted in the current evidence window.' }],
  references: {
    sessionIds: ['paper:2026-07-16:session'],
    dailyReportIds: ['daily:paper:2026-07-16:session'],
    tradeReportIds: ['trade:xle', 'trade:spy'],
    decisionJournalIds: ['decision:risk:xle', 'decision:risk:spy'],
  },
  generation: {
    schemaVersion: 1,
    generatorVersion: 'strategy-analytics-v1',
    generatedBy: 'server:intelligence:strategy-analytics',
    generatedFromPersistedEvidence: true,
  },
};

afterEach(() => cleanup());

describe('StrategyAnalyticsPage', () => {
  it('renders strategy analytics snapshots, KPIs, and chart sections', () => {
    render(<StrategyAnalyticsPage initialAnalytics={[analytics]} loadOnMount={false} />);

    // Page masthead + snapshot selector
    expect(screen.getByText('Strategy Analytics')).toBeInTheDocument();
    expect(screen.getAllByText('2026-07-16').length).toBeGreaterThan(0);
    expect(screen.getAllByText('DAILY').length).toBeGreaterThan(0);
    expect(screen.getAllByText('-$56.00').length).toBeGreaterThan(0);

    // KPI metric strip
    expect(screen.getByText('Win Rate')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('Profit Factor')).toBeInTheDocument();
    expect(screen.getByText('0.03')).toBeInTheDocument();
    expect(screen.getByText('Expectancy')).toBeInTheDocument();
    expect(screen.getByText('-$28.00')).toBeInTheDocument();
    expect(screen.getByText('Net P/L')).toBeInTheDocument();
    expect(screen.getByText('Max Drawdown')).toBeInTheDocument();
    expect(screen.getByText('-$72.00')).toBeInTheDocument();
    expect(screen.getByText('Total Trades')).toBeInTheDocument();

    // Chart cards (titles render even though Recharts draws at 0x0 in jsdom)
    expect(screen.getByText('Strategy Rankings')).toBeInTheDocument();
    expect(screen.getByText('Sector Rankings')).toBeInTheDocument();
    expect(screen.getByText('Top & Worst Symbols')).toBeInTheDocument();
    expect(screen.getByText('Market Regimes')).toBeInTheDocument();
    expect(screen.getByText('Exit Reasons')).toBeInTheDocument();
    expect(screen.getByText('Confidence Distribution')).toBeInTheDocument();

    // Collapsed cohort + evidence panels
    expect(screen.getByText('DTE Cohorts')).toBeInTheDocument();
    expect(screen.getByText('Delta Cohorts')).toBeInTheDocument();
    expect(screen.getByText('IV Cohorts')).toBeInTheDocument();
    expect(screen.getByText('Weekday Cohorts')).toBeInTheDocument();
    expect(screen.getByText('Time of Day Cohorts')).toBeInTheDocument();
    expect(screen.getByText('Risk Profile Cohorts')).toBeInTheDocument();
    expect(screen.getByText('Evidence Quality')).toBeInTheDocument();
    expect(screen.getByText('Warnings')).toBeInTheDocument();
  });

  it('renders honest empty states without placeholder tokens', () => {
    const missing: StrategyAnalytics = {
      ...analytics,
      analyticsId: 'analytics:daily:empty',
      performance: {
        ...analytics.performance,
        totalTrades: 0,
        wins: 0,
        losses: 0,
        breakeven: 0,
        netPnl: null,
        winRate: null,
        expectancy: null,
        profitFactor: null,
        averageWinner: null,
        averageLoser: null,
        drawdown: null,
        capitalEfficiency: null,
      },
      strategyBreakdown: [],
      underlyingBreakdown: [],
      sectorBreakdown: [],
      marketRegimeBreakdown: [],
      confidenceBreakdown: [],
      dteBreakdown: [],
      deltaBreakdown: [],
      ivBreakdown: [],
      weekdayBreakdown: [],
      timeOfDayBreakdown: [],
      exitReasonBreakdown: [],
      riskProfileBreakdown: [],
      evidenceQuality: {
        availableEvidencePercent: 0,
        missingEvidence: ['trading sessions', 'closed trade reports'],
      },
      warnings: [],
      references: {
        sessionIds: [],
        dailyReportIds: [],
        tradeReportIds: [],
        decisionJournalIds: [],
      },
    };
    const { container } = render(<StrategyAnalyticsPage initialAnalytics={[missing]} loadOnMount={false} />);

    // Empty cohorts must show an honest empty state, never blank axes.
    expect(screen.getAllByText('No data yet').length).toBeGreaterThan(0);
    expect(
      screen.getByText('No strategy buckets were captured for this window.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('No sector attribution was captured for this window.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('No market-regime attribution was captured for this window.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('No confidence values were captured for this window.')
    ).toBeInTheDocument();

    // MANDATORY integrity assertions: no cryptic / fabricated placeholders.
    expect(container.textContent).not.toContain('N/A');
    expect(container.textContent).not.toContain('UNKNOWN');
    expect(container.textContent).not.toContain('—');
    expect(container.textContent).not.toContain('$0.00');
  });

  it('renders empty state without duplicating automation controls', () => {
    render(<StrategyAnalyticsPage initialAnalytics={[]} loadOnMount={false} />);
    expect(screen.getByText('No strategy analytics snapshots have been generated yet.')).toBeInTheDocument();
    expect(screen.queryByText('Automation Command Center')).not.toBeInTheDocument();
    expect(screen.queryByText('Emergency Stop')).not.toBeInTheDocument();
  });
});
