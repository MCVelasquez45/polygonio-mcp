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

/** Health check → colored pill with status dot. null renders as unknown. */
export function HealthPill({ label, healthy }: { label: string; healthy?: boolean | null }) {
  const tone: Tone = healthy == null ? 'neutral' : healthy ? 'pos' : 'neg';
  const dot = tone === 'pos' ? 'bg-intel-pos' : tone === 'neg' ? 'bg-intel-neg' : 'bg-intel-ink3';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] tracking-wide ${
        tone === 'pos'
          ? 'border-intel-pos/35 text-intel-pos'
          : tone === 'neg'
            ? 'border-intel-neg/35 text-intel-neg'
            : 'border-intel-line text-intel-ink2'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}
