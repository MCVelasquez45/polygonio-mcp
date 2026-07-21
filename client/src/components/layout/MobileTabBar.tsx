import { memo } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeftRight, Bot, CandlestickChart, Layers, Radar, Sparkles } from 'lucide-react';

// Persistent bottom tab bar for the phone companion shell. Six task-focused
// destinations (not the desktop's five workspaces): the trader's thumb jobs.
// Always visible, safe-area aware, 48px+ touch targets.

export type MobileTab = 'trade' | 'scanner' | 'chart' | 'ai' | 'portfolio' | 'cockpit';

type TabDef = { id: MobileTab; label: string; icon: LucideIcon };

export const MOBILE_TABS: TabDef[] = [
  { id: 'trade', label: 'Trade', icon: ArrowLeftRight },
  { id: 'scanner', label: 'Scanner', icon: Radar },
  { id: 'chart', label: 'Chart', icon: CandlestickChart },
  { id: 'ai', label: 'AI', icon: Sparkles },
  { id: 'portfolio', label: 'Portfolio', icon: Layers },
  { id: 'cockpit', label: 'Cockpit', icon: Bot },
];

type Props = {
  current: MobileTab;
  onChange: (tab: MobileTab) => void;
};

export const MobileTabBar = memo(function MobileTabBar({ current, onChange }: Props) {
  return (
    <nav
      className="flex flex-none border-t border-intel-line bg-intel-bg pb-[env(safe-area-inset-bottom)]"
      aria-label="Workspace navigation"
    >
      {MOBILE_TABS.map(tab => {
        const active = current === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
              active ? 'text-intel-accent' : 'text-intel-ink3'
            }`}
          >
            <Icon className="h-[19px] w-[19px]" aria-hidden="true" />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
});
