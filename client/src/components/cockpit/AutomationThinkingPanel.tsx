import { Panel, type CockpitTrade } from './cockpitUi';
import { BotThinkingSection } from './BotThinkingPanel';
import { ExecutionSection } from './ExecutionPanel';

/**
 * Automation Thinking - one panel that reads as the automation's reasoning plus
 * its execution: the hold rationale and next-evaluation countdown (why it is
 * still holding) sit above the broker order lifecycle/timeline (what it has
 * actually done). Both sections keep their existing honest-missing content.
 */
export function AutomationThinkingPanel({
  trade,
  nextEvaluationAt,
  mark,
}: {
  trade: CockpitTrade;
  nextEvaluationAt: string | null;
  mark: number | null;
}) {
  return (
    <Panel title="Automation Thinking">
      <BotThinkingSection trade={trade} nextEvaluationAt={nextEvaluationAt} mark={mark} />
      <div className="mt-4 border-t border-intel-line pt-3">
        <p className="mb-2 text-[11px] uppercase tracking-widest text-intel-ink3">Order execution</p>
        <ExecutionSection trade={trade} />
      </div>
    </Panel>
  );
}
