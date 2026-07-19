import { memo } from 'react';
import { PRIMARY_MODES, type AppView } from './navModes';

// Persistent bottom tab bar for phones (below `md`, where the rail hides).
// Same destinations as the rail — navigation is a fixture the trader never
// has to hunt for, mirroring the reference terminal's always-on bottom nav.

type Props = {
  currentView: AppView;
  onViewChange: (view: AppView) => void;
};

export const MobileTabBar = memo(function MobileTabBar({ currentView, onViewChange }: Props) {
  return (
    <nav
      className="flex shrink-0 border-t border-intel-line bg-intel-bg md:hidden"
      aria-label="Workspace navigation"
    >
      {PRIMARY_MODES.map(m => {
        const active = currentView === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onViewChange(m.id)}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium ${
              active ? 'text-intel-accent' : 'text-intel-ink3'
            }`}
          >
            {m.icon}
            {m.label}
          </button>
        );
      })}
    </nav>
  );
});
