import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { finiteOrNull } from '../../../lib/marketFormat';
import { fmtSignedUsd, pnlTone, toneText } from '../../../lib/intelligenceFormat';

// Small shared primitives so every surface renders P/L and buttons identically.
// Deliberately thin — the goal is one consistent look, not a component library.

/** Signed money + optional signed percent, colored by P/L tone, tabular mono. */
export function PnlValue({
  value,
  pct,
  emphasis = false,
  className = '',
}: {
  value: number | null | undefined;
  pct?: number | null;
  emphasis?: boolean;
  className?: string;
}) {
  const n = finiteOrNull(pct);
  const pctText = n === null ? null : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
  return (
    <span
      className={`font-mono tabular-nums ${toneText(pnlTone(value))} ${
        emphasis ? 'text-base font-semibold' : ''
      } ${className}`}
    >
      {fmtSignedUsd(value)}
      {pctText ? <span className="text-intel-ink3"> {pctText}</span> : null}
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  busy?: boolean;
  /** Primary = filled amber accent; default = outlined. */
  variant?: 'default' | 'primary';
};

const BUTTON_BASE =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 font-mono text-xs tracking-wide transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-intel-accent disabled:cursor-not-allowed disabled:opacity-40';

/** Standard workstation action button (default outlined, primary filled). */
export function ActionButton({
  children,
  busy = false,
  variant = 'default',
  disabled,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  const tone =
    variant === 'primary'
      ? 'bg-intel-accent text-intel-bg hover:brightness-110'
      : 'border border-intel-line text-intel-ink2 hover:border-intel-accentLine hover:text-intel-accent';
  return (
    <button type={type} disabled={disabled || busy} className={`${BUTTON_BASE} ${tone} ${className}`} {...rest}>
      {busy ? '…' : children}
    </button>
  );
}

/** Destructive action — the ONE consistent danger style (close, stop, delete). */
export function DangerousActionButton({
  children,
  busy = false,
  disabled,
  className = '',
  type = 'button',
  ...rest
}: Omit<ButtonProps, 'variant'>) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      className={`${BUTTON_BASE} border border-intel-neg/40 text-intel-neg hover:bg-intel-neg/10 ${className}`}
      {...rest}
    >
      {busy ? '…' : children}
    </button>
  );
}
