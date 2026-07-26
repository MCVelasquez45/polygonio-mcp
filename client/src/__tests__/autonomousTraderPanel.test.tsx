import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { AutonomousTraderPanel } from '../components/cockpit/AutonomousTraderPanel';

vi.mock('../api/autonomousTrading', () => ({
  getAutonomousTradingStatus: () =>
    Promise.resolve({
      generatedAt: '2026-07-24T14:30:00.000Z',
      status: 'Running',
      mode: 'Shadow',
      modeBanner: 'SHADOW MODE - No broker orders will be submitted.',
      market: 'Closed',
      broker: 'Alpaca Paper',
      automationOwner: 'Owned',
      marketData: 'Live',
      nextEvaluationAt: '2026-07-27T13:30:00.000Z',
      emergencyStop: 'Inactive',
      watching: ['OXY', 'CVX', 'XLE', 'SPY', 'QQQ'],
      currentActivity:
        'The system is monitoring OXY, CVX, XLE, SPY, and QQQ. Risk Engine rejected the current OXY opportunity because MAX_SECTOR_EXPOSURE.',
      latestPipelineId: 'atp_1',
      featureFlags: { AUTONOMOUS_TRADING_MODE: 'shadow' },
    }),
  getAutonomousTradingCurrent: () =>
    Promise.resolve({
      pipelineId: 'atp_1',
      state: 'RISK_REJECTED',
      mode: 'SHADOW',
      symbol: 'OXY',
      optionContract: 'O:OXY260724C00060000',
      plainLanguageStatus: 'Risk review rejected OXY because MAX_SECTOR_EXPOSURE.',
      blockingReasons: [],
      eventContext: { importance: 90, summary: 'Oil supply event' },
      decisionContext: { recommendation: 'BUY_CALL', opportunityScore: 88 },
      strategyContext: { winningStrategy: 'Oil / Commodity', confidence: 0.84, evidenceScore: 82 },
      riskContext: { approved: false, reasonCodes: ['MAX_SECTOR_EXPOSURE'] },
      lifecycleContext: { lifecycleId: null },
      executionContext: { requested: false, source: 'SHADOW_SIMULATION' },
      evaluationContext: {},
      timeline: [],
    }),
  getAutonomousTradingActive: () =>
    Promise.resolve({
      trades: [
        {
          contract: 'O:OXY260724C00060000',
          lifecycleAction: 'HOLD',
          lifecycleState: 'MONITORING',
          currentConfidence: 0.76,
          nextEvaluationAt: '2026-07-24T14:31:00.000Z',
        },
      ],
      positions: [],
    }),
  getAutonomousTradingPending: () =>
    Promise.resolve({
      trades: [],
      intents: [],
      current: {
        symbol: 'OXY',
        contract: 'OXY $60 Call',
        recommendation: 'BUY_CALL',
        winningStrategy: 'Oil / Commodity',
        evidenceScore: 82,
        riskStatus: 'REJECTED',
        entryStatus: 'WAITING',
        blockingReason: 'MAX_SECTOR_EXPOSURE',
        ageSeconds: 42,
      },
    }),
  getAutonomousTradingRecentDecisions: () =>
    Promise.resolve([
      {
        time: '2026-07-24T14:31:00.000Z',
        symbol: 'CVX',
        action: 'REJECTED',
        subsystem: 'Risk Engine',
        reason: 'Energy exposure exceeded the configured portfolio limit.',
        pipelineId: 'atp_1',
      },
    ]),
  getAutonomousTradingTimeline: () =>
    Promise.resolve([
      {
        at: '2026-07-24T14:31:04.000Z',
        pipelineId: 'atp_1',
        symbol: 'OXY',
        event: 'Risk rejected',
        actor: 'risk-engine',
        reason: 'MAX_SECTOR_EXPOSURE',
        state: 'RISK_REJECTED',
        relatedRecords: [],
      },
    ]),
  getAutonomousTradingHealth: () =>
    Promise.resolve({
      overall: 'DEGRADED',
      generatedAt: '2026-07-24T14:31:05.000Z',
      explanation: 'Degraded services: Massive Options WebSocket.',
      services: [{ name: 'Risk Engine', status: 'HEALTHY', dataTimestamp: null, stale: false, staleReason: null, lastError: null, featureEnabled: true, ownerStatus: null }],
    }),
}));

afterEach(() => cleanup());

describe('AutonomousTraderPanel', () => {
  it('renders unified status, shadow label, trades, reasons, and collapsed details', async () => {
    render(<AutonomousTraderPanel />);

    const panel = await screen.findByTestId('autonomous-trader-panel');
    expect(within(panel).getByText('Running')).toBeInTheDocument();
    expect(within(panel).getByText('Shadow')).toBeInTheDocument();
    expect(within(panel).getByText('Closed')).toBeInTheDocument();
    expect(within(panel).getByText('SHADOW MODE - No broker orders will be submitted.')).toBeInTheDocument();
    expect(within(panel).getByText(/The system is monitoring OXY/)).toBeInTheDocument();
    expect(within(panel).getByText('HOLD')).toBeInTheDocument();
    expect(within(panel).getAllByText('MAX_SECTOR_EXPOSURE').length).toBeGreaterThan(0);
    expect(within(panel).getByText('Risk rejected')).toBeInTheDocument();
    const details = screen.getByTestId('autonomous-details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
  });
});

