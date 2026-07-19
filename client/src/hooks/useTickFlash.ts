import { useEffect, useRef, useState } from 'react';
import { finiteOrNull, tickDirection, type TickDirection } from '../lib/marketFormat';

let reducedMotion = false;
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion = mq.matches;
  // addEventListener is not present on the matchMedia mock in some jsdom setups.
  mq.addEventListener?.('change', (e) => {
    reducedMotion = e.matches;
  });
}

/**
 * Returns the direction of the most recent change to `value` and briefly holds a
 * "flash" flag so a tile can tint green/red on an up/down tick. Honors
 * `prefers-reduced-motion`: when set, direction is still reported (for a static
 * arrow) but `flash` never fires, so nothing blinks.
 */
export function useTickFlash(value: number | null | undefined, holdMs = 400): {
  direction: TickDirection;
  flash: boolean;
} {
  const prev = useRef<number | null>(finiteOrNull(value));
  const [state, setState] = useState<{ direction: TickDirection; flash: boolean }>({
    direction: 'none',
    flash: false,
  });

  useEffect(() => {
    const next = finiteOrNull(value);
    const dir = tickDirection(prev.current, next);
    prev.current = next;
    if (dir === 'none') return;
    if (reducedMotion) {
      setState({ direction: dir, flash: false });
      return;
    }
    setState({ direction: dir, flash: true });
    const t = setTimeout(() => setState((s) => ({ ...s, flash: false })), holdMs);
    return () => clearTimeout(t);
  }, [value, holdMs]);

  return state;
}
