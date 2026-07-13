import { useCallback, useEffect, useState } from 'react';
import { portfolioApi } from '../../api';
import type { PortfolioOperations, PortfolioRisk } from '../../api/portfolio';

// Phase 2C — automation command center, embedded in the Portfolio page (no
// separate dashboard). Shows automation status + risk + ownership and exposes
// the safe control actions. Every action goes through the server API, which
// routes through durable intents / the broker adapter — never Alpaca directly.

function currency(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return `${n >= 0 ? '' : '-'}$${Math.abs(n).toFixed(2)}`;
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
        ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-red-500/30 bg-red-500/10 text-red-200'
      }`}
    >
      {label}
    </span>
  );
}

export function AutomationCommandCenter() {
  const [ops, setOps] = useState<PortfolioOperations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOps(await portfolioApi.getOperations());
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? 'Failed to load automation status');
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const act = useCallback(
    async (label: string, fn: () => Promise<unknown>, confirmMsg?: string) => {
      if (confirmMsg && !window.confirm(confirmMsg)) return;
      setBusy(label);
      try {
        await fn();
        await load();
      } catch (err: any) {
        setError(err?.response?.data?.error ?? err?.message ?? `${label} failed`);
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  const sessions: PortfolioRisk[] = ops?.risk ?? [];
  const ready = Boolean(ops?.health?.automationReady);
  const clock = ops?.health?.gates?.marketClock;

  return (
    <section className="bg-gray-950 border border-gray-900 rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-gray-500">Automation</p>
          <h2 className="text-xl font-semibold">Command Center</h2>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill ok label="PAPER" />
          <StatusPill ok={ready} label={ready ? 'READY' : 'NOT READY'} />
          <StatusPill ok={clock?.state === 'OPEN'} label={`MKT ${clock?.state ?? '—'}`} />
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-xl px-3 py-2">{error}</div>
      )}

      {sessions.length === 0 && <p className="text-sm text-gray-500">No automation sessions.</p>}

      {sessions.map(s => (
        <div key={s.automationSessionId} className="rounded-2xl border border-gray-900 bg-gray-950 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white">{s.status}</span>
              {s.emergencyStop && <StatusPill ok={false} label="E-STOP" />}
              <StatusPill ok={s.reconciliationStatus === 'CLEAN'} label={`RECON ${s.reconciliationStatus}`} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!!busy}
                onClick={() => act('pause', () => portfolioApi.pauseEntries(s.automationSessionId))}
                className="px-3 py-1.5 text-xs rounded-full border border-gray-800 text-gray-300 hover:bg-gray-900 disabled:opacity-40"
              >
                Pause
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => act('resume', () => portfolioApi.resumeSession(s.automationSessionId))}
                className="px-3 py-1.5 text-xs rounded-full border border-gray-800 text-gray-300 hover:bg-gray-900 disabled:opacity-40"
              >
                Resume
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() =>
                  act(
                    'emergency-stop',
                    () => portfolioApi.emergencyStop(s.automationSessionId),
                    'Emergency stop and flatten all automation positions?'
                  )
                }
                className="px-3 py-1.5 text-xs rounded-full border border-red-500/40 text-red-200 hover:bg-red-500/10 disabled:opacity-40"
              >
                Emergency Stop
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
            <Metric label="Daily P&L" value={currency(s.dailyRealizedPnl)} positive={s.dailyRealizedPnl >= 0} />
            <Metric label="Trades" value={String(s.dailyTradeCount)} />
            <Metric label="Consec. Loss" value={String(s.consecutiveLossCount)} />
            <Metric label="Drawdown" value={currency(-s.currentDrawdown)} positive={s.currentDrawdown === 0} />
            <Metric label="Last" value={s.lastTradeResult ?? '—'} />
          </div>
        </div>
      ))}

      <p className="text-[11px] text-gray-500">
        Controls create durable intents and never call the broker directly. Auto-refreshes every 15s.
      </p>
    </section>
  );
}

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-gray-500">{label}</p>
      <p className={`text-base font-semibold ${positive === undefined ? 'text-white' : positive ? 'text-emerald-400' : 'text-red-400'}`}>
        {value}
      </p>
    </div>
  );
}
