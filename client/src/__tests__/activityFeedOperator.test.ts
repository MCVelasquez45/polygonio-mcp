import { describe, expect, it } from 'vitest';
import { isOperatorEvent, splitOperatorEvents } from '../lib/activityFeed';
import type { AutomationVisibilityEvent } from '../api/portfolio';

function ev(event: string, extra: Partial<AutomationVisibilityEvent> = {}): AutomationVisibilityEvent {
  return { event, timestamp: '2026-07-26T10:00:00Z', ...extra };
}

describe('activityFeed operator/engineering split', () => {
  it('keeps trading, order, and risk events on the operator timeline', () => {
    expect(isOperatorEvent(ev('POSITION_FILLED'))).toBe(true);
    expect(isOperatorEvent(ev('ORDER_SUBMITTED'))).toBe(true);
    expect(isOperatorEvent(ev('EXIT_FILLED'))).toBe(true);
    expect(isOperatorEvent(ev('RISK_REJECTED'))).toBe(true);
    expect(isOperatorEvent(ev('BROKER_DISCONNECTED'))).toBe(true);
    expect(isOperatorEvent(ev('EMERGENCY_STOP'))).toBe(true);
  });

  it('routes engineering telemetry to diagnostics, not the operator timeline', () => {
    expect(isOperatorEvent(ev('MONITOR_HEARTBEAT'))).toBe(false);
    expect(isOperatorEvent(ev('RECONCILIATION_RUN'))).toBe(false);
    expect(isOperatorEvent(ev('SCHEDULER_LEASE_RENEWED'))).toBe(false);
    expect(isOperatorEvent(ev('WATCHLIST_CACHE_HIT'))).toBe(false);
    expect(isOperatorEvent(ev('EVALUATED'))).toBe(false);
  });

  it('always surfaces critical-severity events to the operator', () => {
    expect(isOperatorEvent(ev('MONITOR_HEARTBEAT', { severity: 'critical' }))).toBe(true);
  });

  it('partitions a stream without dropping any event', () => {
    const events = [
      ev('MONITOR_HEARTBEAT'),
      ev('ORDER_SUBMITTED'),
      ev('CACHE_HIT'),
      ev('POSITION_CLOSED'),
      ev('RECONCILIATION_RUN'),
    ];
    const { operator, engineering } = splitOperatorEvents(events);
    expect(operator).toHaveLength(2);
    expect(engineering).toHaveLength(3);
    expect(operator.length + engineering.length).toBe(events.length);
  });
});
