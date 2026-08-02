import { useEffect, useRef, useState } from 'react';
import { X, Crosshair } from 'lucide-react';
import { getPositionLive, type PositionLiveSnapshot } from '../../api/portfolio';
import { GreeksGrid } from '../cockpit/GreeksGrid';
import {
  useActivePosition,
  setActivePosition,
  useLinkedMode,
  setLinkedMode,
} from '../../lib/workspaceContextStore';

// Position Management workspace — the focused detail surface for the ONE open
// position the operator is managing. Driven entirely by the shared workspace
// context bus (useActivePosition), so selecting a position anywhere lights this
// up. It reuses the existing per-position live endpoint (getPositionLive) and
// the cockpit GreeksGrid; it introduces no new API, socket, or broker path.
//
// Read + focus only in this pass: it surfaces identity, live market, Greeks,
// working orders, risk, and DTE, and drives Linked Mode. Execution (close,
// partial close) stays on the canonical paths that already exist in the blotter.

const POLL_MS = 3000;

function money(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : `$${n.toFixed(2)}`;
}
function pct(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(1)}%`;
}
function num(n: number | null | undefined, digits = 0): string {
  return n == null || !Number.isFinite(n) ? '—' : n.toFixed(digits);
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  const toneClass = tone === 'pos' ? 'text-intel-pos' : tone === 'neg' ? 'text-intel-neg' : 'text-intel-ink';
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[9.5px] uppercase tracking-label text-intel-ink3">{label}</span>
      <span className={`font-mono text-sm font-semibold tabular-nums ${toneClass}`}>{value}</span>
    </div>
  );
}

export function PositionManagerPanel() {
  const position = useActivePosition();
  const linked = useLinkedMode();
  const [live, setLive] = useState<PositionLiveSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only automation-tracked positions have a Mongo positionId the live-snapshot
  // endpoint can resolve. Manual positions carry the option symbol as their id,
  // which the endpoint can't use — so we never poll for them (no wasted 3s
  // request cycle) and show the explanatory note instead.
  const activeId = position?.source === 'AUTOMATION' ? (position?.id ?? null) : null;
  const idRef = useRef<string | null>(null);
  idRef.current = activeId;

  useEffect(() => {
    setLive(null);
    setError(null);
    if (!activeId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const snap = await getPositionLive(activeId);
        if (!cancelled && idRef.current === activeId) setLive(snap);
      } catch {
        if (!cancelled && idRef.current === activeId) setError('Live snapshot unavailable');
      }
    };
    void poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeId]);

  if (!position) return null;

  const optionSymbol = position.optionSymbol ?? (typeof position['symbol'] === 'string' ? (position['symbol'] as string) : null);
  const source = position.source ?? 'MANUAL';
  const stopPrice = typeof position['stopPrice'] === 'number' ? (position['stopPrice'] as number) : null;
  const targetPrice = typeof position['targetPrice'] === 'number' ? (position['targetPrice'] as number) : null;

  const bid = live?.bid ?? null;
  const ask = live?.ask ?? null;
  const mid = live?.mid ?? (bid != null && ask != null ? (bid + ask) / 2 : null);
  const spread = bid != null && ask != null ? ask - bid : null;
  const spreadPct = spread != null && mid ? spread / mid : null;

  return (
    <section
      className="rounded-panel border border-intel-accentLine bg-intel-panel"
      aria-label="Position manager"
      data-testid="position-manager"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-intel-line px-4 py-3">
        <span className="font-mono text-sm font-semibold text-intel-ink">{position.underlying}</span>
        {optionSymbol && (
          <span className="font-mono text-[11px] text-intel-ink2">{optionSymbol}</span>
        )}
        <span className="rounded-full border border-intel-line px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-label text-intel-ink3">
          {source}
        </span>
        <button
          type="button"
          onClick={() => setLinkedMode(!linked)}
          aria-pressed={linked}
          title="Linked Mode — sync chart, matrix, Greeks, and AI to this position"
          className={`ml-auto inline-flex items-center gap-1.5 rounded-panel border px-2 py-0.5 font-mono text-[10px] uppercase tracking-label transition-colors ${
            linked
              ? 'border-intel-accentLine bg-intel-accentSoft text-intel-accent'
              : 'border-intel-line text-intel-ink3 hover:text-intel-ink2'
          }`}
        >
          <Crosshair className="h-3 w-3" /> Linked {linked ? 'On' : 'Off'}
        </button>
        <button
          type="button"
          onClick={() => setActivePosition(null)}
          aria-label="Clear selected position"
          className="rounded-panel border border-intel-line p-1 text-intel-ink3 transition-colors hover:text-intel-ink2"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Bid" value={money(bid)} />
        <Stat label="Ask" value={money(ask)} />
        <Stat label="Mid" value={money(mid)} />
        <Stat label="Spread" value={spread == null ? '—' : `${money(spread)} · ${pct(spreadPct)}`} />
        <Stat label="DTE" value={num(live?.daysToExpiration)} />
        <Stat label="Break-even" value={money(live?.breakEvenPrice)} />
      </div>

      <div className="border-t border-intel-line px-4 py-3">
        <span className="mb-2 block font-mono text-[9.5px] uppercase tracking-label text-intel-ink3">Greeks</span>
        <GreeksGrid greeks={live} />
      </div>

      <div className="grid gap-3 border-t border-intel-line px-4 py-3 sm:grid-cols-2">
        <div>
          <span className="mb-2 block font-mono text-[9.5px] uppercase tracking-label text-intel-ink3">Working orders</span>
          <div className="flex flex-col gap-1.5 font-mono text-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-intel-neg">Stop</span>
              <span className="tabular-nums text-intel-ink2">{stopPrice == null ? 'Not attached' : money(stopPrice)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-intel-pos">Take profit</span>
              <span className="tabular-nums text-intel-ink2">{targetPrice == null ? 'Not attached' : money(targetPrice)}</span>
            </div>
          </div>
        </div>
        <div>
          <span className="mb-2 block font-mono text-[9.5px] uppercase tracking-label text-intel-ink3">Risk &amp; liquidity</span>
          <div className="flex flex-col gap-1.5 font-mono text-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-intel-ink3">Implied vol</span>
              <span className="tabular-nums text-intel-ink2">{pct(live?.impliedVolatility)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-intel-ink3">Open interest</span>
              <span className="tabular-nums text-intel-ink2">{num(live?.openInterest)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-intel-ink3">Day volume</span>
              <span className="tabular-nums text-intel-ink2">{num(live?.dayVolume)}</span>
            </div>
          </div>
        </div>
      </div>

      {(error || live?.available === false || source !== 'AUTOMATION') && (
        <p className="border-t border-intel-line px-4 py-2 font-mono text-[11px] text-intel-ink3">
          {source === 'AUTOMATION'
            ? 'Live contract snapshot is temporarily unavailable — showing last known values.'
            : 'Live Greeks require an automation-tracked position; identity and working orders are shown from broker truth.'}
        </p>
      )}
    </section>
  );
}
