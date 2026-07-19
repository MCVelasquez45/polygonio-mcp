import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DecisionJournalPage } from '../components/intelligence/DecisionJournalPage';
import type { DecisionJournalEntry } from '../api/intelligence';

const entry: DecisionJournalEntry = {
  decisionId: 'decision:risk:risk-xle',
  sessionId: 'paper:2026-07-16:session',
  automationSessionId: 'automation-session',
  tradeId: 'position-xle',
  reportId: 'trade:position-xle',
  timestamp: '2026-07-16T14:32:00.000Z',
  decisionType: 'BUY_APPROVED',
  source: {
    type: 'RiskDecision',
    id: 'risk-xle',
    collection: 'automation_risk_decisions',
  },
  context: {
    symbol: 'XLE',
    contract: 'XLE260717C00090000',
    strategy: 'options-flow-v1',
    environment: 'PAPER',
    marketRegime: 'REGULAR_SESSION',
  },
  evaluation: {
    signalStrength: 98,
    confidence: 0.72,
    flowScore: 0.68,
    momentumScore: 0.66,
    trendScore: 0.7,
    riskScore: 1,
    candidateRank: 1,
    marketRegime: 'REGULAR_SESSION',
  },
  inputs: {
    liquidity: { openInterest: 850, volume: 120 },
    spread: 0.0235,
    volume: 120,
    iv: 0.32,
    delta: 0.48,
    theta: null,
    gamma: null,
    vega: null,
    marketClock: { state: 'OPEN', canEnter: true },
    buyingPower: 10000,
    existingPositions: 0,
    watchlistRank: 1,
  },
  decision: {
    decision: 'BUY',
    approved: true,
    rejected: false,
    skipped: false,
    reasonCodes: ['RISK_APPROVED'],
    humanReadableReasons: ['Risk engine approved the candidate.'],
  },
  riskSnapshot: {
    positionSize: 1,
    riskPercent: 0.0169,
    maxLoss: 169,
    estimatedReward: null,
    estimatedRR: null,
  },
  executionReference: {
    orderIntentId: 'intent-xle',
    brokerOrderId: 'broker-xle',
    positionId: 'position-xle',
  },
  evidenceQuality: {
    persistedFields: ['checks', 'sizing', 'reasonCodes'],
    missingFields: ['estimatedReward', 'estimatedRR'],
    warnings: [],
  },
  timeline: [
    {
      at: '2026-07-16T14:32:00.000Z',
      label: 'Risk approved',
      source: 'RiskDecision',
      sourceId: 'risk-xle',
      severity: 'info',
    },
  ],
};

afterEach(() => cleanup());

describe('DecisionJournalPage', () => {
  it('renders decision evidence, outcome, symbol and reasons', () => {
    render(<DecisionJournalPage initialEntries={[entry]} loadOnMount={false} />);

    expect(screen.getByText('Decision Journal')).toBeInTheDocument();
    // Decision type appears in the list row and the detail hero.
    expect(screen.getAllByText('BUY APPROVED').length).toBeGreaterThan(0);
    // Outcome badge derived from the approved flag.
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0);
    // Symbol appears in the list row and the hero badge.
    expect(screen.getAllByText('XLE').length).toBeGreaterThan(0);
    // Reason code (rendered as a badge) and the human-readable reason.
    expect(screen.getAllByText('RISK_APPROVED').length).toBeGreaterThan(0);
    expect(screen.getByText('Risk engine approved the candidate.')).toBeInTheDocument();
    expect(screen.getByText('options-flow-v1')).toBeInTheDocument();
  });

  it('renders summary tiles with per-bucket counts', () => {
    const rejected: DecisionJournalEntry = {
      ...entry,
      decisionId: 'decision:risk:risk-spy',
      decisionType: 'RISK_REJECTED',
      decision: {
        ...entry.decision,
        decision: 'REJECT',
        approved: false,
        rejected: true,
        skipped: false,
        reasonCodes: ['RISK_LIMIT'],
      },
    };
    render(<DecisionJournalPage initialEntries={[entry, rejected]} loadOnMount={false} />);

    // Each bucket label is present; find the tile and assert its count.
    const buyApprovedLabel = screen.getByText('Buy Approved');
    expect(within(buyApprovedLabel.parentElement as HTMLElement).getByText('1')).toBeInTheDocument();
    const riskRejectLabel = screen.getByText('Risk Reject');
    expect(within(riskRejectLabel.parentElement as HTMLElement).getByText('1')).toBeInTheDocument();
  });

  it('filters the list by search query', () => {
    const other: DecisionJournalEntry = {
      ...entry,
      decisionId: 'decision:risk:risk-aapl',
      context: { ...entry.context, symbol: 'AAPL' },
    };
    render(<DecisionJournalPage initialEntries={[entry, other]} loadOnMount={false} />);

    const list = screen.getByRole('list', { name: 'Captured decisions' });
    // Both entries render in the list initially.
    expect(within(list).getAllByText('BUY APPROVED').length).toBe(2);

    const search = screen.getByLabelText('Search decisions by symbol, reason code, or strategy');
    fireEvent.change(search, { target: { value: 'AAPL' } });

    // Only the AAPL row remains after filtering.
    const listAfter = screen.getByRole('list', { name: 'Captured decisions' });
    expect(within(listAfter).getAllByText('BUY APPROVED').length).toBe(1);
    expect(within(listAfter).getByText(/AAPL/)).toBeInTheDocument();
  });

  it('renders missing evidence honestly without placeholder tokens', () => {
    const missing: DecisionJournalEntry = {
      ...entry,
      decisionId: 'decision:no-signal:spy',
      decisionType: 'NO_SIGNAL',
      context: {
        ...entry.context,
        symbol: 'SPY',
        contract: null,
        marketRegime: null,
      },
      evaluation: {
        signalStrength: null,
        confidence: null,
        flowScore: null,
        momentumScore: null,
        trendScore: null,
        riskScore: null,
        candidateRank: null,
        marketRegime: null,
      },
      inputs: {
        liquidity: null,
        spread: null,
        volume: null,
        iv: null,
        delta: null,
        theta: null,
        gamma: null,
        vega: null,
        marketClock: null,
        buyingPower: null,
        existingPositions: null,
        watchlistRank: null,
      },
      decision: {
        decision: 'SKIP',
        approved: false,
        rejected: false,
        skipped: true,
        reasonCodes: ['NO_SIGNAL'],
        humanReadableReasons: ['No actionable signal was detected.'],
      },
      evidenceQuality: {
        persistedFields: ['candidateStatus'],
        missingFields: ['confidence', 'contract', 'marketClock'],
        warnings: [],
      },
      timeline: [],
    };
    const { container } = render(<DecisionJournalPage initialEntries={[missing]} loadOnMount={false} />);

    // Absent scalars spell out "Not recorded" via the shared formatters.
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
    // The (collapsed) Timeline panel honestly summarizes the absence of events.
    expect(screen.getByText('No events captured')).toBeInTheDocument();
    expect(container.textContent).not.toContain('N/A');
    expect(container.textContent).not.toContain('UNKNOWN');
    expect(container.textContent).not.toContain('—');
    expect(container.textContent).not.toContain('$0.00');
  });

  it('renders empty state without automation controls', () => {
    render(<DecisionJournalPage initialEntries={[]} loadOnMount={false} />);
    expect(screen.getByText('No decision journal entries have been captured yet.')).toBeInTheDocument();
    expect(screen.queryByText('Emergency Stop')).not.toBeInTheDocument();
    expect(screen.queryByText('Automation Command Center')).not.toBeInTheDocument();
  });
});
