import type { ReactNode } from 'react';

type SectionHeaderProps = {
  icon?: ReactNode;
  title: string;
  right?: ReactNode;
};

/** Lightweight titled header for content groups not wrapped in a <Panel/>. */
export function SectionHeader({ icon, title, right }: SectionHeaderProps) {
  return (
    <div className="mb-3 flex items-center gap-2">
      {icon && <span className="text-intel-accent" aria-hidden="true">{icon}</span>}
      <h3 className="font-mono text-xs uppercase tracking-label text-intel-ink3">{title}</h3>
      {right && <span className="ml-auto">{right}</span>}
    </div>
  );
}
