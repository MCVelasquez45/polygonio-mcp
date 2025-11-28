import { useState, type ReactNode } from 'react';
import { Briefcase, Menu, MessageSquare, ScanSearch, Search, Settings, TrendingUp } from 'lucide-react';

type View = 'trading' | 'scanner' | 'portfolio';

type Props = {
  selectedTicker: string;
  onTickerSubmit: (ticker: string) => void;
  currentView: View;
  onViewChange: (view: View) => void;
  onToggleSidebar: () => void;
  onToggleChat: () => void;
  isChatOpen: boolean;
};

const views: { id: View; label: string; icon: ReactNode }[] = [
  { id: 'trading', label: 'Trading', icon: <TrendingUp className="h-4 w-4" /> },
  { id: 'scanner', label: 'Scanner', icon: <ScanSearch className="h-4 w-4" /> },
  { id: 'portfolio', label: 'Portfolio', icon: <Briefcase className="h-4 w-4" /> },
];

export function TradingHeader({
  selectedTicker,
  onTickerSubmit,
  currentView,
  onViewChange,
  onToggleSidebar,
  onToggleChat,
  isChatOpen,
}: Props) {
  const [tickerInput, setTickerInput] = useState(selectedTicker);

  const handleSubmit = () => {
    const normalized = tickerInput.trim().toUpperCase();
    if (!normalized) return;
    if (normalized === selectedTicker) return;
    onTickerSubmit(normalized);
  };

  return (
    <header className="h-14 sm:h-16 bg-gray-950 border-b border-gray-900 flex items-center justify-between px-3 sm:px-6">
      <div className="flex items-center gap-3 sm:gap-4">
        <button
          type="button"
          className="lg:hidden inline-flex items-center justify-center h-9 w-9 rounded-md border border-gray-800 text-gray-300"
          onClick={onToggleSidebar}
          aria-label="Toggle navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-emerald-600/15 border border-emerald-500/30 flex items-center justify-center">
            <TrendingUp className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500 hidden sm:block">Options Desk</p>
            <p className="text-base sm:text-lg font-semibold">Polygon Market Copilot</p>
          </div>
        </div>
        <div className="hidden lg:flex items-center gap-2 rounded-full bg-gray-900 border border-gray-800 px-1 py-1">
          {views.map(view => (
            <button
              key={view.id}
              type="button"
              className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                currentView === view.id
                  ? 'bg-emerald-600 text-white'
                  : 'text-gray-400 hover:text-gray-100'
              }`}
              onClick={() => onViewChange(view.id)}
            >
              {view.icon}
              <span className="hidden xl:inline">{view.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            className="bg-gray-900 border border-gray-800 rounded-full pl-9 pr-4 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 min-w-[140px]"
            placeholder="Search ticker"
            value={tickerInput}
            onChange={event => setTickerInput(event.target.value.toUpperCase())}
            onKeyDown={event => event.key === 'Enter' && handleSubmit()}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSubmit}
            className="hidden sm:inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold"
          >
            Load
          </button>
          <button
            type="button"
            onClick={onToggleChat}
            className={`inline-flex items-center justify-center h-10 w-10 rounded-xl border ${
              isChatOpen ? 'border-emerald-500 text-emerald-300' : 'border-gray-800 text-gray-400 hover:text-white'
            }`}
            aria-label="Toggle chat"
          >
            <MessageSquare className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="hidden sm:inline-flex items-center justify-center h-10 w-10 rounded-xl border border-gray-800 text-gray-400 hover:text-white"
            aria-label="Settings"
          >
            <Settings className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-gray-950 border-t border-gray-900 flex lg:hidden">
        {views.map(view => (
          <button
            key={view.id}
            type="button"
            className={`flex-1 py-2 flex flex-col items-center gap-1 text-xs ${
              view.id === currentView ? 'text-white' : 'text-gray-500'
            }`}
            onClick={() => onViewChange(view.id)}
          >
            {view.icon}
            {view.label}
          </button>
        ))}
      </div>
    </header>
  );
}
