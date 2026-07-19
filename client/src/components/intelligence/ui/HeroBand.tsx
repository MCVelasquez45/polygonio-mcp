import type { ReactNode } from 'react';
import { toneText, type Tone } from '../../../lib/intelligenceFormat';

export type HeroFact = { k: string; v: string; tone?: Tone };

const BADGE_TONE: Record<Tone, string> = {
  pos: 'border-intel-pos/40 bg-intel-pos/10 text-intel-pos',
  neg: 'border-intel-neg/40 bg-intel-neg/10 text-intel-neg',
  warn: 'border-intel-warn/40 bg-intel-warn/10 text-intel-warn',
  neutral: 'border-intel-line bg-intel-panel2 text-intel-ink2',
};

type HeroBandProps = {
  /** Big left badge — a grade letter or a headline number. */
  badge?: { value: ReactNode; label: string; tone?: Tone };
  headline: ReactNode;
  sub?: ReactNode;
  facts?: HeroFact[];
  /** Extra content beneath the headline (e.g. key takeaways). */
  children?: ReactNode;
};

/**
 * The "what happened" band that opens every intelligence detail view.
 * Answers the 5-second question before any metric or raw field.
 */
export function HeroBand({ badge, headline, sub, facts, children }: HeroBandProps) {
  return (
    <div className="rounded-panel border border-intel-line bg-intel-panel p-5">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        {badge && (
          <div
            className={`flex min-w-[104px] flex-none flex-col items-center justify-center rounded-panel border px-5 py-3.5 text-center ${BADGE_TONE[badge.tone ?? 'neutral']}`}
          >
            <span className="font-mono text-4xl font-bold leading-none tracking-tight tabular-nums">
              {badge.value}
            </span>
            <span className="mt-2 font-mono text-[9.5px] uppercase tracking-eyebrow opacity-80">
              {badge.label}
            </span>
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-balance text-xl font-semibold tracking-tight text-intel-ink">{headline}</h2>
          {sub && <p className="mt-1.5 text-sm text-intel-ink2">{sub}</p>}
          {facts && facts.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {facts.map(f => (
                <span
                  key={f.k}
                  className="inline-flex items-center gap-1.5 rounded-md border border-intel-line bg-intel-bg px-2.5 py-1 font-mono text-xs tabular-nums"
                >
                  <span className="text-intel-ink3">{f.k}</span>
                  <span className={toneText(f.tone ?? 'neutral')}>{f.v}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {children && <div className="mt-4 border-t border-intel-lineSoft pt-4">{children}</div>}
    </div>
  );
}
