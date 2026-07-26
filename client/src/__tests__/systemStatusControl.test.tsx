import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { SystemStatus } from '../hooks/useSystemStatus';

afterEach(() => cleanup());

// The control derives its summary from useSystemStatus; mock the hook so the
// test drives status without real timers, sockets, or HTTP probes.
let mockStatus: SystemStatus;
vi.mock('../hooks/useSystemStatus', () => ({
  useSystemStatus: () => mockStatus,
}));

import { SystemStatusControl, summarizeSystemStatus } from '../components/layout/SystemStatusControl';

function healthy(): SystemStatus {
  return {
    backend: 'ONLINE',
    socket: 'CONNECTED',
    optionsFeed: 'LIVE',
    equityFeed: 'SNAPSHOT',
    chart: { status: 'SNAPSHOT', ageSeconds: 3 },
    ai: 'ready',
    automation: 'UNKNOWN',
  };
}

describe('summarizeSystemStatus', () => {
  it('reports HEALTHY when nothing needs attention', () => {
    const s = summarizeSystemStatus({ ...healthy(), equityFeed: 'REALTIME', chart: { status: 'LIVE', ageSeconds: 1 } });
    expect(s.headline).toBe('HEALTHY');
    expect(s.tone).toBe('good');
    expect(s.alerts).toHaveLength(0);
  });

  it('always includes every subsystem so nothing becomes unreachable', () => {
    const labels = summarizeSystemStatus(healthy()).rows.map(r => r.label);
    for (const required of [
      'Backend',
      'Broker',
      'Massive REST',
      'Options WebSocket',
      'Stocks WebSocket',
      'Equity Data',
      'Chart',
      'MongoDB',
      'AI',
      'Automation',
    ]) {
      expect(labels).toContain(required);
    }
  });

  it('does not let a resting (UNKNOWN) automation engine drag the roll-up down', () => {
    expect(summarizeSystemStatus(healthy()).tone).not.toBe('bad');
  });

  it('surfaces an operator alert with impact + action when the backend is offline', () => {
    const s = summarizeSystemStatus({ ...healthy(), backend: 'OFFLINE' });
    expect(s.headline).toBe('OFFLINE');
    const alert = s.alerts.find(a => a.title === 'Backend unreachable');
    expect(alert?.impact).toMatch(/unavailable/i);
    expect(alert?.action).toBeTruthy();
  });

  it('flags a delayed options feed as DEGRADED with a targeted action', () => {
    const s = summarizeSystemStatus({ ...healthy(), optionsFeed: 'STALE' });
    expect(s.headline).toBe('DEGRADED');
    expect(s.reason).toBe('Options feed delayed');
    expect(s.alerts.some(a => /entitlement/i.test(a.action))).toBe(true);
  });
});

describe('SystemStatusControl', () => {
  it('collapses to a single summary and expands to the full breakdown', () => {
    mockStatus = { ...healthy(), optionsFeed: 'STALE' };
    render(<SystemStatusControl />);
    // Collapsed: one summary control, headline visible, detail hidden.
    expect(screen.getByText('DEGRADED')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Expand.
    fireEvent.click(screen.getByRole('button', { name: /system status/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Options WebSocket')).toBeInTheDocument();
    expect(screen.getByText('Options feed delayed')).toBeInTheDocument();
  });

  it('offers a Diagnostics entry point when provided', () => {
    mockStatus = healthy();
    const onOpenDiagnostics = vi.fn();
    render(<SystemStatusControl onOpenDiagnostics={onOpenDiagnostics} />);
    fireEvent.click(screen.getByRole('button', { name: /system status/i }));
    fireEvent.click(screen.getByRole('button', { name: /diagnostics/i }));
    expect(onOpenDiagnostics).toHaveBeenCalledOnce();
  });
});
