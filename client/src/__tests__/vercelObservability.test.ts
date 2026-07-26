import { describe, expect, it, vi } from 'vitest';
import mainSource from '../main.tsx?raw';

const trackMock = vi.hoisted(() => vi.fn());

vi.mock('@vercel/analytics', () => ({
  track: trackMock,
}));

import {
  OPERATOR_ANALYTICS_EVENTS,
  trackOperatorEvent,
  trackOperatorEventOnce,
} from '../lib/operatorAnalytics';

const sourceFiles = import.meta.glob('../**/*.{ts,tsx,js,jsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('Vercel observability wiring', () => {
  const source = Object.values(sourceFiles).join('\n');

  it('mounts Analytics and Speed Insights exactly once at the React root', () => {
    expect((source.match(/<Analytics\s*\/>/g) ?? [])).toHaveLength(1);
    expect((source.match(/<SpeedInsights\s*\/>/g) ?? [])).toHaveLength(1);
    expect(mainSource).toContain("import { Analytics } from '@vercel/analytics/react';");
    expect(mainSource).toContain("import { SpeedInsights } from '@vercel/speed-insights/react';");
    expect(mainSource).toContain('<React.StrictMode>');
  });

  it('keeps custom operator analytics anonymous and allowlisted', () => {
    expect(OPERATOR_ANALYTICS_EVENTS).toEqual([
      'Application Loaded',
      'Automation Viewed',
      'Automation Started',
      'Automation Stopped',
      'Cockpit Viewed',
      'AI Desk Viewed',
      'Strategy Viewed',
      'Risk Viewed',
      'Trade Lifecycle Viewed',
      'Reports Viewed',
      'Operator Expanded Advanced Details',
      'Shadow Mode Enabled',
      'Paper Mode Enabled',
    ]);
    expect(OPERATOR_ANALYTICS_EVENTS.join(' ')).not.toMatch(/account|email|token|secret|order|price|broker/i);
  });

  it('dedupes once-per-session events and trims string properties', () => {
    trackMock.mockClear();
    trackOperatorEventOnce('Application Loaded', { surface: 'desktop' });
    trackOperatorEventOnce('Application Loaded', { surface: 'desktop' });
    trackOperatorEvent('Cockpit Viewed', { surface: 'x'.repeat(100) });

    expect(trackMock).toHaveBeenCalledTimes(2);
    expect(trackMock).toHaveBeenNthCalledWith(1, 'Application Loaded', { surface: 'desktop' });
    expect(trackMock).toHaveBeenNthCalledWith(2, 'Cockpit Viewed', { surface: 'x'.repeat(80) });
  });
});
