import { useState } from 'react';
import {
  BarChart3,
  BookOpenText,
  CalendarDays,
  FileSearch,
  LayoutDashboard,
  Newspaper,
} from 'lucide-react';
import { CommandCenterPage } from './CommandCenterPage';
import { DailyReportsPage } from './DailyReportsPage';
import { DecisionJournalPage } from './DecisionJournalPage';
import { StrategyAnalyticsPage } from './StrategyAnalyticsPage';
import { TradeReportsPage } from './TradeReportsPage';
import { TradingSessionsPage } from './TradingSessionsPage';
import type { IntelligenceView } from './views';

const NAV: Array<{ view: IntelligenceView; label: string; icon: typeof LayoutDashboard }> = [
  { view: 'command', label: 'Command Center', icon: LayoutDashboard },
  { view: 'daily', label: 'Daily Reports', icon: Newspaper },
  { view: 'trades', label: 'Trade Reports', icon: FileSearch },
  { view: 'decisions', label: 'Decision Journal', icon: BookOpenText },
  { view: 'analytics', label: 'Strategy Analytics', icon: BarChart3 },
  { view: 'sessions', label: 'Sessions', icon: CalendarDays },
];

export function TradingIntelligencePage() {
  const [view, setView] = useState<IntelligenceView>('command');

  return (
    <div className="flex flex-col gap-4 pb-24 lg:flex-row" data-testid="trading-intelligence-workspace">
      {/* Workspace rail */}
      <nav
        aria-label="Intelligence workspace"
        className="flex gap-1 overflow-x-auto rounded-panel border border-intel-line bg-intel-panel p-2 lg:sticky lg:top-4 lg:h-fit lg:w-56 lg:flex-none lg:flex-col lg:overflow-visible"
      >
        {NAV.map(({ view: v, label, icon: Icon }) => {
          const active = view === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex flex-none items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent ${
                active
                  ? 'bg-intel-accentSoft text-intel-accent'
                  : 'text-intel-ink2 hover:bg-intel-panel2 hover:text-intel-ink'
              }`}
            >
              <Icon className="h-4 w-4 flex-none" aria-hidden="true" />
              <span className="whitespace-nowrap">{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Active view */}
      <div className="min-w-0 flex-1">
        {view === 'command' && <CommandCenterPage onOpen={setView} />}
        {view === 'daily' && <DailyReportsPage />}
        {view === 'trades' && <TradeReportsPage />}
        {view === 'decisions' && <DecisionJournalPage />}
        {view === 'analytics' && <StrategyAnalyticsPage />}
        {view === 'sessions' && <TradingSessionsPage />}
      </div>
    </div>
  );
}
