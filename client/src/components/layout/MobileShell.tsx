import { FormEvent, ReactNode, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { AGENT_META } from '../chat/agentMeta';
import { MobileTabBar, type MobileTab } from './MobileTabBar';

// ── The phone experience: a trading companion, not a squeezed workstation. ──
// Screen hierarchy (Trade tab): Ticker → Chart → AI Insight → Quick Actions →
// Trade Ticket → Matrix. One section expands at a time; everything else
// collapses to a 48px header. Bottom tabs and the header never scroll away.

type TradeSection = 'chart' | 'insight' | 'actions' | 'ticket' | 'matrix';

const TRADE_SECTIONS: { id: TradeSection; label: string; hint: string }[] = [
  { id: 'chart', label: 'Chart', hint: 'Price action' },
  { id: 'insight', label: 'AI Insight', hint: 'Desk read' },
  { id: 'actions', label: 'Quick Actions', hint: 'Run an analyst' },
  { id: 'ticket', label: 'Trade Ticket', hint: 'Execute' },
  { id: 'matrix', label: 'Matrix', hint: 'Option chain' },
];

export type MobileShellProps = {
  ticker: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  marketClosed?: boolean;
  onTickerSubmit: (value: string) => void;
  tab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  /** Launches a desk agent in the AI tab. */
  onAgentLaunch: (agentId: string, label: string) => void;
  chartPanel: ReactNode;
  insightPanel: ReactNode;
  ticketPanel: ReactNode;
  matrixPanel: ReactNode;
  scannerPanel: ReactNode;
  portfolioPanel: ReactNode;
  cockpitPanel: ReactNode;
  chat: ReactNode;
  banners?: ReactNode;
};

export function MobileShell({
  ticker,
  price,
  change,
  changePercent,
  marketClosed,
  onTickerSubmit,
  tab,
  onTabChange,
  onAgentLaunch,
  chartPanel,
  insightPanel,
  ticketPanel,
  matrixPanel,
  scannerPanel,
  portfolioPanel,
  cockpitPanel,
  chat,
  banners,
}: MobileShellProps) {
  const [openSection, setOpenSection] = useState<TradeSection>('chart');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');

  const changeTone =
    typeof change === 'number' ? (change > 0 ? 'text-intel-pos' : change < 0 ? 'text-intel-neg' : 'text-intel-ink2') : 'text-intel-ink3';

  function handleSearchSubmit(event: FormEvent) {
    event.preventDefault();
    const value = searchDraft.trim().toUpperCase();
    if (value) onTickerSubmit(value);
    setSearchDraft('');
    setSearchOpen(false);
  }

  const quickActionGrid = (
    <div className="grid grid-cols-3 gap-2">
      {Object.values(AGENT_META).map(meta => {
        const Icon = meta.icon;
        return (
          <button
            key={meta.id}
            type="button"
            onClick={() => onAgentLaunch(meta.id, meta.label)}
            className="flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-panel border bg-intel-panel px-2 py-2 transition active:bg-intel-panel2"
            style={{ borderColor: meta.line }}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-md" style={{ backgroundColor: meta.soft, color: meta.color }}>
              <Icon style={{ width: 17, height: 17 }} aria-hidden="true" />
            </span>
            <span className="text-[11px] font-semibold leading-tight text-intel-ink">{meta.shortLabel}</span>
          </button>
        );
      })}
    </div>
  );

  const sectionContent: Record<TradeSection, ReactNode> = {
    chart: chartPanel,
    insight: insightPanel,
    actions: quickActionGrid,
    ticket: ticketPanel,
    matrix: matrixPanel,
  };

  const tradePage = (
    <div className="flex h-full flex-col gap-2 overflow-y-auto overscroll-contain p-2 pb-4">
      {banners}
      {TRADE_SECTIONS.map(section => {
        const open = openSection === section.id;
        return (
          <section
            key={section.id}
            className={`flex flex-col rounded-panel border ${open ? 'flex-1 border-intel-line' : 'flex-none border-intel-lineSoft'}`}
          >
            <button
              type="button"
              onClick={() => setOpenSection(section.id)}
              aria-expanded={open}
              className={`flex min-h-[48px] items-center justify-between px-3 text-left ${open ? 'border-b border-intel-lineSoft' : ''}`}
            >
              <span className="flex items-baseline gap-2">
                <span className={`text-sm font-semibold ${open ? 'text-intel-ink' : 'text-intel-ink2'}`}>{section.label}</span>
                <span className="font-mono text-[10px] uppercase tracking-label text-intel-ink3">{section.hint}</span>
              </span>
              <ChevronDown
                className={`h-4 w-4 text-intel-ink3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
            <div
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? 'min-h-0 flex-1 [grid-template-rows:1fr]' : '[grid-template-rows:0fr]'}`}
            >
              <div className={`min-h-0 ${open ? 'overflow-y-auto p-2' : 'overflow-hidden'}`}>{open ? sectionContent[section.id] : null}</div>
            </div>
          </section>
        );
      })}
    </div>
  );

  const scrollPage = (node: ReactNode) => (
    <div className="h-full overflow-y-auto overscroll-contain p-2 pb-6">
      {banners}
      {node}
    </div>
  );

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-intel-bg text-intel-ink">
      {/* ── Ticker header: identity + price, one thumb-reach search ── */}
      <header className="flex flex-none items-center justify-between gap-2 border-b border-intel-line px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        {searchOpen ? (
          <form onSubmit={handleSearchSubmit} className="flex flex-1 items-center gap-2">
            <input
              autoFocus
              value={searchDraft}
              onChange={event => setSearchDraft(event.target.value)}
              onBlur={() => setSearchOpen(false)}
              placeholder="Ticker (e.g. SPY)"
              autoCapitalize="characters"
              autoCorrect="off"
              className="min-h-[44px] w-full rounded-panel border border-intel-accentLine bg-intel-panel px-3 text-base uppercase text-intel-ink focus:outline-none"
              aria-label="Search ticker"
            />
            <button type="submit" className="min-h-[44px] flex-none rounded-panel bg-intel-accent px-3 text-sm font-semibold text-intel-bg">
              Go
            </button>
          </form>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex min-h-[44px] items-center gap-2 rounded-panel px-1 text-left"
              aria-label={`Change ticker (current ${ticker})`}
            >
              <span className="text-xl font-bold tracking-wide">{ticker}</span>
              <Search className="h-4 w-4 text-intel-ink3" aria-hidden="true" />
            </button>
            <span className="flex items-baseline gap-2">
              <span className="font-mono text-lg font-semibold">
                {typeof price === 'number' ? `$${price.toFixed(2)}` : '—'}
              </span>
              <span className={`font-mono text-xs ${changeTone}`}>
                {typeof change === 'number' ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}` : ''}
                {typeof changePercent === 'number' ? ` (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)` : ''}
              </span>
              {marketClosed && (
                <span className="rounded bg-intel-warn/10 px-1.5 py-[1px] font-mono text-[9px] font-semibold uppercase tracking-label text-intel-warn">
                  Closed
                </span>
              )}
            </span>
          </>
        )}
      </header>

      {/* ── Active page — only this region scrolls ── */}
      <main className="min-h-0 flex-1">
        {tab === 'trade' && tradePage}
        {tab === 'scanner' && scrollPage(scannerPanel)}
        {tab === 'chart' && <div className="flex h-full flex-col p-2">{chartPanel}</div>}
        {tab === 'ai' && <div className="h-full">{chat}</div>}
        {tab === 'portfolio' && scrollPage(portfolioPanel)}
        {tab === 'cockpit' && scrollPage(cockpitPanel)}
      </main>

      <MobileTabBar current={tab} onChange={onTabChange} />
    </div>
  );
}
