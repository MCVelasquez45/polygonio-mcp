import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  fmtTradeTally,
  fmtChecksAttention,
  fmtSampleGate,
  EMPTY,
} from '../lib/intelligenceFormat';
import { groupActivityEvents, categorize } from '../lib/activityFeed';
import type { AutomationVisibilityEvent } from '../api/portfolio';
import { PnlValue } from '../components/intelligence/ui/Primitives';
import { MarketDataDot } from '../components/intelligence/ui/LiveStatus';

afterEach(() => cleanup());

describe('human copy helpers', () => {
  it('fmtTradeTally speaks in sentences, not machine counts', () => {
    const s = fmtTradeTally(1, 1, -56);
    expect(s).toContain('2 trades');
    expect(s).toContain('1 winner');
    expect(s).toContain('1 loser');
    expect(s).toContain('Net -$56.00');
    expect(fmtTradeTally(0, 0)).toBe('No closed trades yet');
    expect(fmtTradeTally(3, 0)).toContain('3 winners');
  });

  it('fmtChecksAttention pluralizes and stays human', () => {
    expect(fmtChecksAttention(3)).toBe('3 operational checks need attention');
    expect(fmtChecksAttention(1)).toBe('1 operational check needs attention');
    expect(fmtChecksAttention(0)).toBe('All operational checks passing');
  });

  it('fmtSampleGate names the sample size or explains the gate', () => {
    expect(fmtSampleGate(5)).toBe('Awaiting more completed trades — 5 recorded so far.');
    expect(fmtSampleGate()).toBe(EMPTY.analytics);
  });
});

describe('activity grouping', () => {
  const events: AutomationVisibilityEvent[] = [
    { id: '1', event: 'MONITOR_HEARTBEAT', timestamp: '2026-07-17T14:52:00Z' },
    { id: '2', event: 'MONITOR_HEARTBEAT', timestamp: '2026-07-17T14:51:00Z' },
    { id: '3', event: 'MONITOR_HEARTBEAT', timestamp: '2026-07-17T14:50:00Z' },
    { id: '4', event: 'ORDER_SUBMITTED', symbol: 'O:SPY', timestamp: '2026-07-17T14:49:00Z' },
    { id: '5', event: 'POSITION_FILLED', symbol: 'O:SPY', timestamp: '2026-07-17T14:48:00Z' },
  ];

  it('collapses consecutive repetitive events but keeps operational ones individual', () => {
    const rows = groupActivityEvents(events);
    // 3 heartbeats collapse to one group; order + fill stay individual.
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ kind: 'group', count: 3 });
    expect(rows[1]).toMatchObject({ kind: 'event' });
    expect(rows[2]).toMatchObject({ kind: 'event' });
  });

  it('categorizes events for the filter chips', () => {
    expect(categorize({ event: 'ORDER_SUBMITTED' })).toBe('orders');
    expect(categorize({ event: 'POSITION_FILLED' })).toBe('trades');
    expect(categorize({ event: 'RISK_LIMIT_HIT' })).toBe('risk');
    expect(categorize({ event: 'BROKER_DISCONNECTED', severity: 'critical' })).toBe('errors');
    expect(categorize({ event: 'MONITOR_HEARTBEAT' })).toBe('automation');
  });

  it('filters to a single category', () => {
    const rows = groupActivityEvents(events, 'orders');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'event' });
  });

  it('never groups a critical event', () => {
    const criticals: AutomationVisibilityEvent[] = [
      { id: 'a', event: 'MONITOR_HEARTBEAT', severity: 'critical', timestamp: '2026-07-17T14:52:00Z' },
      { id: 'b', event: 'MONITOR_HEARTBEAT', severity: 'critical', timestamp: '2026-07-17T14:51:00Z' },
    ];
    const rows = groupActivityEvents(criticals);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === 'event')).toBe(true);
  });
});

describe('PnlValue', () => {
  it('colors and signs a gain', () => {
    const { container } = render(<PnlValue value={12} pct={3.4} />);
    expect(screen.getByText('+$12.00')).toBeInTheDocument();
    expect(screen.getByText('+3.4%')).toBeInTheDocument();
    expect(container.querySelector('.text-intel-pos')).not.toBeNull();
  });

  it('colors a loss negative', () => {
    const { container } = render(<PnlValue value={-5} />);
    expect(screen.getByText('-$5.00')).toBeInTheDocument();
    expect(container.querySelector('.text-intel-neg')).not.toBeNull();
  });
});

describe('MarketDataDot (compact freshness)', () => {
  it('renders a compact live label with age and never a full pill', () => {
    const { container } = render(<MarketDataDot status="LIVE" ageMs={500} />);
    expect(screen.getByText(/Live · just now/)).toBeInTheDocument();
    expect(container.querySelector('[data-status="LIVE"]')).not.toBeNull();
  });

  it('shows a snapshot short label, never LIVE for equities', () => {
    render(<MarketDataDot status="SNAPSHOT" ageMs={28_000} />);
    expect(screen.getByText(/Snap · 28s ago/)).toBeInTheDocument();
    expect(screen.queryByText(/^Live/)).not.toBeInTheDocument();
  });
});
