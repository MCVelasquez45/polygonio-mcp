import type { TradeLifecycleState } from '../types/lifecycleTypes';

export const STATE_ORDER: TradeLifecycleState[] = [
  'NEW',
  'PENDING_ENTRY',
  'ENTRY_SUBMITTED',
  'ENTRY_FILLED',
  'MONITORING',
  'PARTIAL_EXIT',
  'EXIT_PENDING',
  'EXIT_FILLED',
  'EVALUATION',
  'ARCHIVED',
];

const stateRank = new Map<TradeLifecycleState, number>(STATE_ORDER.map((state, index) => [state, index]));

export function compareLifecycleStates(a: TradeLifecycleState, b: TradeLifecycleState): number {
  return (stateRank.get(a) ?? 0) - (stateRank.get(b) ?? 0);
}

export function nextLifecycleStates(from: TradeLifecycleState, to: TradeLifecycleState): TradeLifecycleState[] {
  const start = stateRank.get(from);
  const end = stateRank.get(to);
  if (start == null || end == null || end <= start) return [];
  return STATE_ORDER.slice(start + 1, end + 1);
}

export function isLifecycleTerminal(state: TradeLifecycleState): boolean {
  return state === 'ARCHIVED';
}

export function targetStateFromAutomationPosition(position: any, intent?: any | null): TradeLifecycleState {
  const status = String(position?.status ?? '');
  if (status === 'CLOSED') return 'ARCHIVED';
  if (status === 'EXITING' || status === 'MANUAL_REVIEW') return 'EXIT_PENDING';
  if (status === 'OPEN') return 'MONITORING';
  if (status === 'PENDING_ENTRY') {
    if (position?.entryBrokerOrderId || intent?.brokerOrderId || ['SUBMITTING', 'SUBMITTED'].includes(String(intent?.status))) {
      return 'ENTRY_SUBMITTED';
    }
    return 'PENDING_ENTRY';
  }
  return 'NEW';
}
