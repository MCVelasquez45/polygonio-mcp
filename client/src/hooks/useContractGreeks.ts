import { useEffect, useRef, useState } from 'react';
import { portfolioApi } from '../api';
import type { PositionLiveSnapshot } from '../api/portfolio';

/**
 * Polls the REST greeks/IV/OI snapshot for a held position. Greeks are not
 * streamable on Massive, so this is the deliberate second data tier alongside the
 * WS quote stream. Polls every `intervalMs` (default 3s, matching the server
 * cache), pauses while the tab is hidden, and stops on unmount / when positionId
 * clears. Never throws — a failed fetch leaves the last snapshot and sets `error`.
 */
export function useContractGreeks(positionId: string | null | undefined, intervalMs = 3000) {
  const [data, setData] = useState<PositionLiveSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!positionId) {
      setData(null);
      return;
    }
    cancelled.current = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      if (document.hidden) return;
      try {
        const snap = await portfolioApi.getPositionLive(positionId);
        if (!cancelled.current) {
          setData(snap);
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled.current) setError(err?.response?.data?.error ?? err?.message ?? 'greeks unavailable');
      }
    };

    const start = () => {
      if (timer) return;
      void tick();
      timer = setInterval(() => void tick(), intervalMs);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled.current = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [positionId, intervalMs]);

  return { data, error };
}
