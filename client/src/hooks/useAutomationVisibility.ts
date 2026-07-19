import { useCallback, useEffect, useState } from 'react';
import { portfolioApi } from '../api';
import type { AutomationVisibility, AutomationVisibilityEvent } from '../api/portfolio';
import { getSharedSocket } from '../lib/socket';

/**
 * Shared subscription to the automation visibility snapshot (REST initial load +
 * socket push). Mirrors the wiring in AutomationCommandCenter so the cockpit and
 * the command center can each hold their own copy without coupling. Multiple
 * listeners on the shared socket are fine — socket.io fan-outs per event.
 */
export function useAutomationVisibility() {
  const [visibility, setVisibility] = useState<AutomationVisibility | null>(null);
  const [events, setEvents] = useState<AutomationVisibilityEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const snapshot = await portfolioApi.getAutomationVisibility();
      setVisibility(snapshot);
      setEvents((snapshot.timeline ?? []).slice(0, 200));
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? 'Failed to load automation visibility');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const socket = getSharedSocket();
    const subscribe = () => {
      setConnected(true);
      socket.emit('automation:visibility:subscribe');
    };
    const onDisconnect = () => setConnected(false);
    const handleSnapshot = (snapshot: AutomationVisibility) => {
      setVisibility(snapshot);
      setEvents((snapshot.timeline ?? []).slice(0, 200));
      setError(null);
    };
    const handleEvent = (event: AutomationVisibilityEvent) => {
      const key = String(
        event.id ?? `${event.timestamp ?? ''}:${event.service ?? ''}:${event.event ?? ''}:${event.symbol ?? ''}`
      );
      setEvents((prev) => [event, ...prev.filter((item) => {
        const k = String(
          item.id ?? `${item.timestamp ?? ''}:${item.service ?? ''}:${item.event ?? ''}:${item.symbol ?? ''}`
        );
        return k !== key;
      })].slice(0, 200));
    };
    const handleError = (payload: any) => setError(payload?.message ?? 'Automation visibility stream failed');

    socket.on('connect', subscribe);
    socket.on('disconnect', onDisconnect);
    socket.on('automation:visibility', handleSnapshot);
    socket.on('automation:event', handleEvent);
    socket.on('automation:visibility:error', handleError);
    if (socket.connected) subscribe();

    return () => {
      socket.off('connect', subscribe);
      socket.off('disconnect', onDisconnect);
      socket.off('automation:visibility', handleSnapshot);
      socket.off('automation:event', handleEvent);
      socket.off('automation:visibility:error', handleError);
    };
  }, []);

  return { visibility, events, connected, error, refresh };
}
