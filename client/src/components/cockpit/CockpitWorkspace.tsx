import { CockpitCommandBar } from './CockpitCommandBar';
import { LiveMarketPanel } from './LiveMarketPanel';
import { PositionHealthPanel } from './PositionHealthPanel';
import { ExitIntelligencePanel } from './ExitIntelligencePanel';
import { BotThinkingPanel } from './BotThinkingPanel';
import { ExecutionPanel } from './ExecutionPanel';
import { OperatorActions } from './OperatorActions';
import { MarketContextPanel } from './MarketContextPanel';
import { OpportunityPanel } from './OpportunityPanel';
import { type CockpitTrade } from './cockpitUi';
import { useContractGreeks } from '../../hooks/useContractGreeks';
import { useCockpitQuote } from './cockpitQuote';

export function CockpitWorkspace({
  trade,
  buyingPower,
  nextEvaluationAt,
  sessionId,
  onActed,
}: {
  trade: CockpitTrade;
  buyingPower: number | null;
  nextEvaluationAt: string | null;
  sessionId: string | null;
  onActed: () => void;
}) {
  // Greeks/IV/OI are REST-only; poll once here and share with both the Live
  // Market panel (greeks grid) and Position & Health (theta decay, DTE).
  const { data: greeks } = useContractGreeks(trade.positionId);
  const quote = useCockpitQuote(trade);

  return (
    <div data-testid="cockpit-workspace" className="flex min-w-0 flex-col gap-3">
      <CockpitCommandBar
        trade={trade}
        quote={quote}
        actions={<OperatorActions trade={trade} sessionId={sessionId} onActed={onActed} />}
      />
      <div
        data-testid="cockpit-primary-grid"
        className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]"
      >
        <div className="flex min-w-0 flex-col gap-3">
          <LiveMarketPanel symbol={trade.optionSymbol} greeks={greeks} quote={quote} />
          <PositionHealthPanel trade={trade} greeks={greeks} buyingPower={buyingPower} quote={quote} />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <ExitIntelligencePanel trade={trade} mark={quote.mark} />
          <BotThinkingPanel trade={trade} nextEvaluationAt={nextEvaluationAt} mark={quote.mark} />
          <ExecutionPanel trade={trade} />
        </div>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 2xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <MarketContextPanel trade={trade} />
        <OpportunityPanel trade={trade} />
      </div>
    </div>
  );
}
