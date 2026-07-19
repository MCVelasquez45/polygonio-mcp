import { Badge } from './Badge';
import type { Tone } from '../../../lib/intelligenceFormat';

/** Map a known lifecycle/market status string to a tone + readable label. */
const STATUS_MAP: Record<string, { tone: Tone | 'accent' | 'info'; label: string }> = {
  FINALIZED: { tone: 'pos', label: 'Finalized' },
  OPEN: { tone: 'info', label: 'Open' },
  INITIALIZING: { tone: 'warn', label: 'Initializing' },
  CLOSING: { tone: 'warn', label: 'Closing' },
  FINALIZING: { tone: 'warn', label: 'Finalizing' },
  FINALIZATION_FAILED: { tone: 'neg', label: 'Finalization failed' },
  GENERATED: { tone: 'pos', label: 'Generated' },
  GENERATION_FAILED: { tone: 'neg', label: 'Generation failed' },
};

/** Status pill with sensible tone + humanized label; unknown → neutral. */
export function StatusBadge({ status }: { status: string }) {
  const entry = STATUS_MAP[status] ?? { tone: 'neutral' as const, label: status.replace(/_/g, ' ').toLowerCase() };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

/** PAPER / LIVE environment marker. */
export function EnvBadge({ environment }: { environment: 'PAPER' | 'LIVE' }) {
  return <Badge tone={environment === 'LIVE' ? 'accent' : 'neutral'}>{environment}</Badge>;
}

/** Health check -> compact colored status with dot. null renders as unknown. */
export function HealthPill({
  label,
  healthy,
  className = '',
}: {
  label: string;
  healthy?: boolean | null;
  className?: string;
}) {
  const tone: Tone = healthy == null ? 'neutral' : healthy ? 'pos' : 'neg';
  const dot = tone === 'pos' ? 'bg-intel-pos' : tone === 'neg' ? 'bg-intel-neg' : 'bg-intel-ink3';
  return (
    <span
      title={label}
      className={`inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-[1px] font-mono text-[10px] font-semibold leading-4 tracking-normal ${
        tone === 'pos'
          ? 'border-intel-pos/35 text-intel-pos'
          : tone === 'neg'
            ? 'border-intel-neg/35 text-intel-neg'
            : 'border-intel-line text-intel-ink2'
      } ${className}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
