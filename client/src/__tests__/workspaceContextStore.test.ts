import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  setActiveSymbol,
  setActiveContract,
  setActivePosition,
  setActiveTrade,
  setLinkedMode,
  toggleLinkedMode,
  getWorkspaceContext,
  useActiveSymbol,
  useActiveContract,
  useActivePosition,
  useLinkedMode,
  useWorkspaceContext,
  __resetWorkspaceContextForTests,
} from '../lib/workspaceContextStore';
import type { OptionLeg } from '../types/market';

function leg(ticker: string): OptionLeg {
  return { ticker } as OptionLeg;
}

describe('workspaceContextStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetWorkspaceContextForTests();
  });

  it('normalizes and publishes the active symbol to subscribers', () => {
    const { result } = renderHook(() => useActiveSymbol());
    expect(result.current).toBeNull();
    act(() => setActiveSymbol('  aapl '));
    expect(result.current).toBe('AAPL');
  });

  it('clears the active contract when the underlying changes', () => {
    act(() => {
      setActiveSymbol('SPY');
      setActiveContract(leg('O:SPY260101C00450000'));
    });
    expect(getWorkspaceContext().activeContract?.ticker).toBe('O:SPY260101C00450000');
    act(() => setActiveSymbol('QQQ'));
    expect(getWorkspaceContext().activeContract).toBeNull();
  });

  it('does not re-render on a no-op publish (stable reference)', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useWorkspaceContext();
    });
    const initial = result.current;
    const before = renders;
    act(() => setActiveSymbol(null)); // already null → no change
    expect(renders).toBe(before);
    expect(result.current).toBe(initial);
  });

  it('tracks the active position and trade independently', () => {
    const { result: pos } = renderHook(() => useActivePosition());
    act(() => setActivePosition({ id: 'p1', underlying: 'AMD', source: 'MANUAL' }));
    expect(pos.current?.id).toBe('p1');
    act(() => setActiveTrade({ id: 't1', underlying: 'AMD' }));
    expect(getWorkspaceContext().activeTrade?.id).toBe('t1');
    // Selecting a trade must not disturb the active position.
    expect(pos.current?.id).toBe('p1');
  });

  it('defaults Linked Mode ON and persists changes to localStorage', () => {
    const { result } = renderHook(() => useLinkedMode());
    expect(result.current).toBe(true); // enterprise default
    act(() => setLinkedMode(false));
    expect(result.current).toBe(false);
    expect(window.localStorage.getItem('workspace:linkedMode')).toBe('false');
    act(() => toggleLinkedMode());
    expect(result.current).toBe(true);
  });

  it('propagates a contract to a separate contract subscriber', () => {
    const { result } = renderHook(() => useActiveContract());
    expect(result.current).toBeNull();
    act(() => {
      setActiveSymbol('SPY');
      setActiveContract(leg('O:SPY260101C00450000'));
    });
    expect(result.current?.ticker).toBe('O:SPY260101C00450000');
  });
});
