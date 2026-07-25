import { describe, expect, it } from 'vitest';
import { deriveChartHealthPresentation } from '../components/trading/ChartPanel';

describe('deriveChartHealthPresentation', () => {
  it('does not label snapshot-only equity chart data stale just because the provider bar is old', () => {
    const presentation = deriveChartHealthPresentation({
      health: {
        mode: 'LIVE',
        source: 'snapshot',
        lastUpdateMsAgo: 36 * 60 * 60 * 1000,
        providerThrottled: false,
        gapsDetected: 0,
      },
      usingLastSession: false,
      resultGranularity: 'intraday',
      isMarketClosed: false,
    });

    expect(presentation.label).toBe('Snapshot');
    expect(presentation.stale).toBe(false);
    expect(presentation.detail).toContain('Bar age 36h ago');
  });

  it('still labels genuinely old live delivery as stale', () => {
    const presentation = deriveChartHealthPresentation({
      health: {
        mode: 'LIVE',
        source: 'ws',
        lastUpdateMsAgo: 11 * 60 * 1000,
        providerThrottled: false,
        gapsDetected: 0,
      },
      usingLastSession: false,
      resultGranularity: 'intraday',
      isMarketClosed: false,
    });

    expect(presentation.label).toBe('Stale');
    expect(presentation.stale).toBe(true);
    expect(presentation.detail).toContain('Last update 11m ago');
  });
});
