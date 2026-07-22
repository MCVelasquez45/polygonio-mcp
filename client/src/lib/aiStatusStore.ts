import { useSyncExternalStore } from 'react';

// AI Desk's own status — independent of every other subsystem. It reflects
// only the agent request lifecycle (ready / busy / last request errored),
// never equity entitlement, chart freshness, or the options feed.

export type AiStatus = 'ready' | 'busy' | 'error';

let status: AiStatus = 'ready';
const listeners = new Set<() => void>();

export function setAiStatus(next: AiStatus) {
  if (status === next) return;
  status = next;
  listeners.forEach(listener => listener());
}

export function getAiStatus(): AiStatus {
  return status;
}

export function useAiStatus(): AiStatus {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getAiStatus
  );
}
