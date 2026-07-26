import { Suspense, lazy, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

// Diagnostics drawer — one consolidated, collapsed-by-default surface for all
// engineering telemetry (scheduler, monitor, Mongo, queue, cache, heartbeats,
// WebSocket health, API latency, logs, broker/Massive/AI diagnostics).
//
// It does NOT reimplement any of that: it reuses the existing System Operations
// page verbatim inside a slide-over so the telemetry stays available from every
// workspace without occupying the operator's normal trading surface. Nothing is
// removed — this is purely where the noise now lives.

const SystemOperationsPage = lazy(() =>
  import('../operations/SystemOperationsPage').then(m => ({ default: m.SystemOperationsPage })),
);

type Props = {
  open: boolean;
  onClose: () => void;
};

export function DiagnosticsDrawer({ open, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="presentation">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
        onClick={onClose}
        role="presentation"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Diagnostics"
        className="relative flex h-full w-full max-w-5xl flex-col border-l border-intel-line bg-intel-bg shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-intel-line px-5 py-3">
          <div>
            <h2 className="font-mono text-sm font-semibold uppercase tracking-label text-intel-ink">
              Diagnostics
            </h2>
            <p className="mt-0.5 text-[11px] text-intel-ink3">
              Engineering telemetry — not required for normal trading. Everything here is searchable.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close diagnostics"
            className="rounded-panel border border-intel-line p-1.5 text-intel-ink2 transition-colors hover:border-intel-accentLine hover:text-intel-accent focus:outline-none focus-visible:border-intel-accentLine"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Suspense
            fallback={
              <div className="p-6 font-mono text-xs text-intel-ink3">Loading diagnostics…</div>
            }
          >
            <SystemOperationsPage />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
