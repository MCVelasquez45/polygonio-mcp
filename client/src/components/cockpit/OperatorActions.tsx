import { useState } from 'react';
import { toast } from 'sonner';
import { portfolioApi } from '../../api';
import { BROKER_TERMINAL } from './cockpitUi';
import type { CockpitTrade } from './cockpitUi';

type PendingAction = {
  key: string;
  title: string;
  body: string;
  confirmLabel: string;
  tone: 'bad' | 'warn';
  run: () => Promise<unknown>;
} | null;

function ConfirmModal({
  action,
  busy,
  onConfirm,
  onCancel,
}: {
  action: NonNullable<PendingAction>;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmClass =
    action.tone === 'bad'
      ? 'border-red-500/50 bg-red-500/20 text-red-100 hover:bg-red-500/30'
      : 'border-amber-500/50 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-950 p-5">
        <h4 className="text-sm font-semibold text-white">{action.title}</h4>
        <p className="mt-2 text-xs text-gray-400">{action.body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-900 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${confirmClass}`}
          >
            {busy ? 'Working…' : action.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  label,
  tone,
  disabled,
  onClick,
}: {
  label: string;
  tone: 'bad' | 'warn' | 'neutral';
  disabled?: boolean;
  onClick: () => void;
}) {
  const cls =
    tone === 'bad'
      ? 'border-red-500/40 text-red-200 hover:bg-red-500/10'
      : tone === 'warn'
        ? 'border-amber-500/40 text-amber-200 hover:bg-amber-500/10'
        : 'border-gray-800 text-gray-300 hover:bg-gray-900';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide disabled:opacity-40 ${cls}`}
    >
      {label}
    </button>
  );
}

/**
 * Operator interventions. Each
 * calls an EXISTING durable endpoint (nothing here changes automation logic); a
 * confirm modal guards the destructive ones. On success we refresh the snapshot.
 */
export function OperatorActions({
  trade,
  sessionId,
  onActed,
}: {
  trade: CockpitTrade;
  sessionId: string | null;
  onActed: () => void;
}) {
  const [pending, setPending] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);

  const exitWorking =
    !!trade.execution?.exit &&
    !BROKER_TERMINAL.has(String(trade.execution.exit.status ?? '').toUpperCase()) &&
    !!trade.exitIntentId;

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await pending.run();
      toast.success(`${pending.title} submitted`);
      onActed();
      setPending(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? err?.message ?? `${pending.title} failed`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ActionButton
        label="⚠ Force Close"
        tone="bad"
        onClick={() =>
          setPending({
            key: 'close',
            title: 'Force close position',
            body: `Submit a market exit for ${trade.optionSymbol}. The automation will stop managing this position.`,
            confirmLabel: 'Force close',
            tone: 'bad',
            run: () => portfolioApi.closePosition(trade.positionId),
          })
        }
      />
      <ActionButton
        label="Cancel Exit"
        tone="warn"
        disabled={!exitWorking}
        onClick={() =>
          setPending({
            key: 'cancel',
            title: 'Cancel exit order',
            body: 'Cancel the working exit order. The position remains open and under automation management.',
            confirmLabel: 'Cancel exit order',
            tone: 'warn',
            run: () => portfolioApi.cancelOrder(String(trade.exitIntentId)),
          })
        }
      />
      <ActionButton
        label="Pause"
        tone="neutral"
        disabled={!sessionId}
        onClick={() =>
          setPending({
            key: 'pause',
            title: 'Pause new entries',
            body: 'Pause new automation entries. Existing position management continues.',
            confirmLabel: 'Pause entries',
            tone: 'warn',
            run: () => portfolioApi.pauseEntries(String(sessionId)),
          })
        }
      />
      <ActionButton
        label="⏹ E-Stop"
        tone="bad"
        disabled={!sessionId}
        onClick={() =>
          setPending({
            key: 'estop',
            title: 'Emergency stop',
            body: 'Trigger an emergency stop: halt entries and flatten automation positions. Use only when intervention is required.',
            confirmLabel: 'Emergency stop',
            tone: 'bad',
            run: () => portfolioApi.emergencyStop(String(sessionId)),
          })
        }
      />
      {pending ? (
        <ConfirmModal action={pending} busy={busy} onConfirm={confirm} onCancel={() => setPending(null)} />
      ) : null}
    </>
  );
}
