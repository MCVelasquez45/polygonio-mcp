import { memo, type ReactNode } from 'react';
import { Command } from 'lucide-react';
import { PRIMARY_MODES, SECONDARY_MODES, type AppView } from './navModes';

// Desktop + tablet left rail. Always present from `md` up — it never collapses
// into a hamburger, which is what left the 640–1024 tablet band stranded
// before. Icon-only on tablet, icon+label from `xl`.

type Props = {
  currentView: AppView;
  onViewChange: (view: AppView) => void;
  onOpenCommandPalette: () => void;
};

export const NavRail = memo(function NavRail({ currentView, onViewChange, onOpenCommandPalette }: Props) {
  const item = (id: AppView, label: string, hint: string, icon: ReactNode) => {
    const active = currentView === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => onViewChange(id)}
        title={`${label} — ${hint}`}
        aria-current={active ? 'page' : undefined}
        className={`group flex items-center gap-3 rounded-panel border px-3 py-2 text-left transition-colors xl:w-full ${
          active
            ? 'border-intel-accentLine bg-intel-accentSoft text-intel-accent'
            : 'border-transparent text-intel-ink2 hover:bg-intel-panel hover:text-intel-ink'
        }`}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center">{icon}</span>
        <span className="hidden text-sm font-medium xl:inline">{label}</span>
      </button>
    );
  };

  return (
    <nav
      className="hidden h-full w-[64px] shrink-0 flex-col justify-between border-r border-intel-line bg-intel-bg px-2 py-3 md:flex xl:w-56"
      aria-label="Workspace navigation"
    >
      <div className="flex flex-col gap-1">
        <div className="mb-1 hidden px-3 xl:block">
          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-intel-ink3">Workspace</span>
        </div>
        {PRIMARY_MODES.map(m => item(m.id, m.label, m.hint, m.icon))}
      </div>

      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          title="Command palette (⌘K)"
          className="flex items-center gap-3 rounded-panel border border-intel-line px-3 py-2 text-intel-ink2 transition-colors hover:border-intel-accentLine hover:text-intel-accent xl:w-full"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center">
            <Command className="h-[18px] w-[18px]" />
          </span>
          <span className="hidden items-center gap-2 text-sm font-medium xl:inline-flex">
            Command
            <kbd className="rounded border border-intel-line bg-intel-panel2 px-1 font-mono text-[10px] text-intel-ink3">⌘K</kbd>
          </span>
        </button>
        {SECONDARY_MODES.map(m => item(m.id, m.label, m.hint, m.icon))}
      </div>
    </nav>
  );
});
