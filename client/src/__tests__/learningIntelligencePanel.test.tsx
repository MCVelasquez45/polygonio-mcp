import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { LearningIntelligencePanel } from '../components/cockpit/LearningIntelligencePanel';

vi.mock('../api', () => ({
  learningApi: {
    getStatus: () =>
      Promise.resolve({
        status: 'CURRENT',
        generatedAt: new Date().toISOString(),
        completedTrades: 2,
        tradeReviews: 2,
        datasets: 2,
        pendingReviews: 0,
        pendingDatasets: 0,
        latestReviewAt: new Date().toISOString(),
        explanation: 'Learning artifacts are current with completed trade reports.',
      }),
    getTrades: () =>
      Promise.resolve([
        {
          reviewId: 'learning-review:1',
          sourceTradeId: 'trade-1',
          entryTimestamp: null,
          exitTimestamp: null,
          entryStrategy: 'momentum-v1',
          winningStrategy: 'Momentum',
          marketRegime: 'TRENDING',
          sector: 'Technology',
          symbol: 'SPY',
          direction: 'BULLISH',
          confidence: 0.72,
          evidenceScore: 0.81,
          riskScore: 0.7,
          actualReturn: 4.2,
          realizedPnl: 120,
          outcome: 'WIN',
          whySucceeded: ['Trend continued after entry.'],
          whyFailed: [],
          whatCouldImprove: ['Enter earlier when liquidity confirms.'],
        },
      ]),
    getScorecards: () =>
      Promise.resolve([
        {
          key: 'Momentum',
          window: 'LIFETIME',
          totalTrades: 2,
          wins: 1,
          losses: 1,
          winRate: 0.5,
          averageReturn: 1.1,
          medianReturn: 1.1,
          averageHoldTimeMinutes: 42,
          averageRisk: 0.65,
          largestWinner: 4.2,
          largestLoser: -2,
          sharpe: 0.4,
          maxDrawdown: -2,
        },
      ]),
    getCalibration: () =>
      Promise.resolve([
        {
          confidenceBand: '65-79%',
          totalTrades: 2,
          predictedConfidence: 0.72,
          actualSuccessRate: 0.5,
          historicalAccuracy: 0.5,
          calibrationError: 0.22,
          verdict: 'Overconfident',
        },
      ]),
    getRegimes: () =>
      Promise.resolve([
        {
          key: 'TRENDING',
          window: 'LIFETIME',
          totalTrades: 2,
          wins: 1,
          losses: 1,
          winRate: 0.5,
          averageReturn: 1.1,
          medianReturn: 1.1,
          averageHoldTimeMinutes: 42,
          averageRisk: 0.65,
          largestWinner: 4.2,
          largestLoser: -2,
          sharpe: 0.4,
          maxDrawdown: -2,
        },
      ]),
    getEvents: () =>
      Promise.resolve([
        {
          event: 'Fed',
          trades: 2,
          winRate: 0.5,
          averageReturn: 1.1,
          topStrategies: [{ strategy: 'Momentum', trades: 2 }],
        },
      ]),
  },
}));

afterEach(() => cleanup());

describe('LearningIntelligencePanel', () => {
  it('renders learning performance, lessons, scorecards, and calibration in Automation', async () => {
    render(<LearningIntelligencePanel />);
    await waitFor(() => expect(screen.getByText('Learning Intelligence')).toBeInTheDocument());
    expect(screen.getByText('Learning artifacts are current with completed trade reports.')).toBeInTheDocument();
    expect(screen.getByText('Best Strategy')).toBeInTheDocument();
    expect(screen.getAllByText('Momentum').length).toBeGreaterThan(0);
    expect(screen.getByText('Confidence Accuracy')).toBeInTheDocument();
    expect(screen.getByText('Recent Lessons')).toBeInTheDocument();
    expect(screen.getByText('Enter earlier when liquidity confirms.')).toBeInTheDocument();
    expect(screen.getByText('Strategy Scorecards, Trade Reviews, and Calibration')).toBeInTheDocument();
  });
});
