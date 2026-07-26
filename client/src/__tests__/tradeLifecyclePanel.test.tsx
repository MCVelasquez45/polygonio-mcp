import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { TradeLifecyclePanel } from '../components/cockpit/TradeLifecyclePanel';

vi.mock('../api/tradeLifecycle', () => ({
  getTradeLifecycleStatus: () =>
    Promise.resolve({
      generatedAt: new Date().toISOString(),
      flags: { TRADE_LIFECYCLE_ENABLED: true },
      aiStatus: 'READY',
      paperTrading: true,
      market: 'OPEN',
      currentStrategy: 'sv-lifecycle',
      currentRegime: 'REGULAR_SESSION',
      nextEvaluation: new Date().toISOString(),
      currentDecision: {
        watching: 'SPY260821C00450000',
        recommendation: 'HOLD',
        confidence: 91,
        reason: 'Confidence trend is Improving.',
      },
      counts: { MONITORING: 1 },
      schedulers: {},
    }),
  getTradeLifecycleActive: () =>
    Promise.resolve([
      {
        tradeId: 'tl-1',
        automationPositionId: 'pos-1',
        automationSessionId: 'sess-1',
        strategyVersionId: 'sv-lifecycle',
        underlying: 'SPY',
        optionSymbol: 'SPY260821C00450000',
        state: 'MONITORING',
        previousState: 'ENTRY_FILLED',
        entryIntentId: 'entry-1',
        exitIntentId: null,
        riskDecisionId: 'risk-1',
        recommendationId: 'rec-1',
        evaluationReportId: null,
        confidence: { entry: 82, current: 91, trend: 'Improving', delta: 9 },
        currentAction: 'HOLD',
        reasoning: ['Confidence trend is Improving.'],
        exitReason: null,
        evaluationSummary: null,
        lastEvaluatedAt: new Date().toISOString(),
        nextEvaluationAt: new Date().toISOString(),
        archivedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]),
  getTradeLifecyclePending: () => Promise.resolve([]),
  getTradeLifecycleHistory: () => Promise.resolve([]),
  getTradeLifecycleTimeline: () =>
    Promise.resolve([
      {
        tradeId: 'tl-1',
        at: new Date().toISOString(),
        eventType: 'MONITORING_DECISION',
        state: 'MONITORING',
      },
    ]),
}));

afterEach(() => cleanup());

describe('TradeLifecyclePanel', () => {
  it('renders the operator lifecycle view inside Automation', async () => {
    render(<TradeLifecyclePanel />);
    await waitFor(() => expect(screen.getByText('Trade Lifecycle')).toBeInTheDocument());
    expect(screen.getByText('AI Status')).toBeInTheDocument();
    expect(screen.getByText('Paper Trading')).toBeInTheDocument();
    expect(screen.getByText('Current AI Decision')).toBeInTheDocument();
    expect(screen.getAllByText('SPY260821C00450000').length).toBeGreaterThan(0);
    expect(screen.getByText('Open Trades')).toBeInTheDocument();
    expect(screen.getByText('Pending Trades')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('Activity Timeline')).toBeInTheDocument();
  });
});
