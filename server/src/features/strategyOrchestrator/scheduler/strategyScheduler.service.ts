import type { StrategyDefinition, StrategyEvaluationContext } from '../types/orchestratorTypes';

const CATEGORY_STRATEGIES: Record<string, string[]> = {
  'Federal Reserve': ['fed-reaction', 'macro-rotation', 'ai-consensus'],
  Economic: ['macro-rotation', 'fed-reaction', 'sector-rotation'],
  Oil: ['oil-commodity', 'sector-rotation', 'news-momentum'],
  Commodity: ['oil-commodity', 'macro-rotation'],
  Earnings: ['news-momentum', 'high-volume', 'ai-consensus'],
  Technology: ['momentum', 'trend-following', 'ai-consensus'],
  AI: ['ai-consensus', 'momentum', 'gamma-expansion'],
};

export function scheduleStrategies(
  registry: StrategyDefinition[],
  context: StrategyEvaluationContext
): { selected: StrategyDefinition[]; skipped: StrategyDefinition[]; explanation: string } {
  const selectedIds = new Set<string>();
  for (const event of context.eventContext.latestEvents) {
    for (const id of CATEGORY_STRATEGIES[event.category] ?? ['news-momentum', 'ai-consensus']) selectedIds.add(id);
  }
  if (!selectedIds.size) {
    for (const id of ['momentum', 'trend-following', 'breakout', 'pullback', 'mean-reversion', 'options-flow', 'ai-consensus']) {
      selectedIds.add(id);
    }
  }
  if (context.marketRegime.current === 'SECTOR_ROTATION') selectedIds.add('sector-rotation');
  if (context.marketRegime.current === 'MACRO_DRIVEN') selectedIds.add('macro-rotation');
  const selected = registry.filter(strategy => selectedIds.has(strategy.id));
  const skipped = registry.filter(strategy => !selectedIds.has(strategy.id));
  return {
    selected,
    skipped,
    explanation: `Scheduled ${selected.length} strategies from events/regime and skipped ${skipped.length} unrelated strategies.`,
  };
}
