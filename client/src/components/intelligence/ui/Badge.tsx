import type { ReactNode } from 'react';
import { gradeToneClass, type Tone } from '../../../lib/intelligenceFormat';

const TONE_CLASS: Record<Tone | 'accent' | 'info', string> = {
  pos: 'border-intel-pos/40 bg-intel-pos/10 text-intel-pos',
  neg: 'border-intel-neg/40 bg-intel-neg/10 text-intel-neg',
  warn: 'border-intel-warn/40 bg-intel-warn/10 text-intel-warn',
  neutral: 'border-intel-line bg-intel-panel2 text-intel-ink2',
  accent: 'border-intel-accentLine bg-intel-accentSoft text-intel-accent',
  info: 'border-intel-info/40 bg-intel-info/10 text-intel-info',
};

type BadgeProps = {
  children: ReactNode;
  tone?: Tone | 'accent' | 'info';
  className?: string;
};

/** Tone-driven pill. Replaces the ad-hoc badge markup duplicated across pages. */
export function Badge({ children, tone = 'neutral', className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-label ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Small letter-grade pill (A+ … F, UNAVAILABLE) colored by tier. */
export function GradeBadge({ grade, className = '' }: { grade: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-xs font-bold ${gradeToneClass(grade)} ${className}`}
      aria-label={`Grade ${grade}`}
    >
      {grade}
    </span>
  );
}
