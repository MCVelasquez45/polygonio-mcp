import { memo, useEffect, useMemo, useState } from 'react';
import { Command, Menu, MessageSquare, Plus, Search, Settings, TrendingUp } from 'lucide-react';
import { ActionButton } from '../intelligence/ui';
import { LiveNumber, LiveState } from '../shared/terminal';
import { useLiveQuote } from '../../lib/liveMarketStore';
import { useLiveMarketSubscription } from '../../hooks/useCockpitLiveSubscription';
import { modeLabel, type AppView } from './navModes';

type Props = {
  selectedTicker: string;
  onTickerSubmit: (ticker: string) => void;
  onAddToWatchlist: (ticker: string) => void;
  currentView: AppView;
  onViewChange: (view: AppView) => void;
  onToggleSidebar: () => void;
  onToggleChat: () => void;
  isChatOpen: boolean;
  chatDisabled?: boolean;
  onToggleSettings: () => void;
  isSettingsOpen?: boolean;
  onOpenCommandPalette?: () => void;
};

/** SPY from a raw ticker or option symbol (O:SPY...), for the context pill. */
function underlyingOf(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  if (t.startsWith('O:')) {
    const m = t.slice(2).match(/^([A-Z]+)/);
    return m?.[1] ?? t;
  }
  return t;
}

export const TradingHeader = memo(function TradingHeader({
  selectedTicker,
  onTickerSubmit,
  onAddToWatchlist,
  currentView,
  onToggleSidebar,
  onToggleChat,
  isChatOpen,
  chatDisabled,
  onToggleSettings,
  isSettingsOpen,
  onOpenCommandPalette,
}: Props) {
  const [tickerInput, setTickerInput] = useState(selectedTicker);

  useEffect(() => {
    setTickerInput(selectedTicker);
  }, [selectedTicker]);

  const underlying = useMemo(() => underlyingOf(selectedTicker), [selectedTicker]);
  useLiveMarketSubscription(underlying);
  const quote = useLiveQuote(underlying);
  const mid =
    quote?.midpoint ??
    (quote?.bidPrice != null && quote?.askPrice != null ? (quote.bidPrice + quote.askPrice) / 2 : null);

  const handleSubmit = () => {
    const normalized = tickerInput.trim().toUpperCase();
    if (!normalized || normalized === selectedTicker) return;
    onTickerSubmit(normalized);
  };

  const handleAddTicker = () => {
    const normalized = tickerInput.trim().toUpperCase() || selectedTicker;
    if (!normalized) return;
    onAddToWatchlist(normalized);
  };

  return (
    <header className="flex h-14 items-center justify-between gap-3 border-b border-intel-line bg-intel-bg px-3 sm:h-16 sm:px-5">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        {/* Mobile: toggle the Terminal watchlist drawer. */}
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-intel-line text-intel-ink2 lg:hidden"
          onClick={onToggleSidebar}
          aria-label="Toggle watchlist"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-panel border border-intel-accentLine bg-intel-accentSoft">
            <TrendingUp className="h-5 w-5 text-intel-accent" />
          </div>
          <div className="hidden sm:block">
            <p className="font-mono text-[10px] uppercase tracking-eyebrow text-intel-ink3">AI-Trader · {modeLabel(currentView)}</p>
            <p className="text-sm font-semibold leading-tight text-intel-ink">Trading Terminal</p>
          </div>
        </div>

        {/* Live symbol context — a quiet inline group, not a box, that persists
            as you work the name. */}
        <div className="hidden items-center gap-3 border-l border-intel-divider pl-4 lg:flex">
          <span className="font-mono text-base font-semibold tracking-wide text-intel-ink">{underlying}</span>
          <LiveNumber value={mid} className="text-sm text-intel-ink2" />
          <LiveState timestamp={quote?.timestamp ?? null} />
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-intel-ink3" />
          <input
            className="h-9 min-w-[130px] rounded-lg border border-intel-line bg-intel-panel pl-9 pr-4 font-mono text-sm uppercase tracking-wide text-intel-ink focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-intel-accent"
            placeholder="Symbol"
            value={tickerInput}
            onChange={event => setTickerInput(event.target.value.toUpperCase())}
            onKeyDown={event => event.key === 'Enter' && handleSubmit()}
            aria-label="Load symbol"
          />
        </div>
        <button
          type="button"
          onClick={onOpenCommandPalette}
          title="Command palette (⌘K)"
          aria-label="Open command palette"
          className="hidden h-9 items-center gap-2 rounded-lg border border-intel-line px-2.5 text-intel-ink2 transition-colors hover:border-intel-accentLine hover:text-intel-accent sm:inline-flex"
        >
          <Command className="h-4 w-4" />
          <kbd className="font-mono text-[10px] text-intel-ink3">⌘K</kbd>
        </button>
        <ActionButton onClick={handleAddTicker} className="hidden sm:inline-flex">
          <Plus className="h-4 w-4" /> Watchlist
        </ActionButton>
        <ActionButton onClick={handleSubmit} className="hidden sm:inline-flex">
          Load
        </ActionButton>
        <button
          type="button"
          onClick={onToggleChat}
          disabled={chatDisabled}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border ${
            isChatOpen
              ? 'border-intel-accentLine bg-intel-accentSoft text-intel-accent'
              : chatDisabled
                ? 'border-intel-lineSoft text-intel-ink3'
                : 'border-intel-line text-intel-ink2 hover:text-intel-ink'
          }`}
          aria-label="Toggle AI chat"
        >
          <MessageSquare className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onToggleSettings}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border ${
            isSettingsOpen
              ? 'border-intel-accentLine bg-intel-accentSoft text-intel-accent'
              : 'border-intel-line text-intel-ink2 hover:text-intel-ink'
          }`}
          aria-label="Settings"
        >
          <Settings className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
});
