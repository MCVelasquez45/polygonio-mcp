import type { ConditionNode, StrategyAst, StructuredCondition, StructuredStrategy } from '../types';

function toConditionNode(prefix: 'entry' | 'exit', condition: StructuredCondition, index: number): ConditionNode {
  return {
    id: `${prefix}-${index + 1}`,
    type: 'condition',
    field: condition.field,
    operator: condition.operator,
    value: condition.value,
    raw: condition.raw,
    provenance: condition.provenance
  };
}

export function buildStrategyAst(strategy: StructuredStrategy): StrategyAst {
  return {
    type: 'strategy',
    name: strategy.name,
    meta: {
      action: strategy.action,
      instrument: strategy.instrument,
      tradingMethod: strategy.tradingMethod,
      contractSelection: strategy.contractSelection,
      spreadConfig: strategy.spreadConfig,
      regimeConfig: strategy.regimeConfig,
      timeRules: strategy.timeRules
    },
    entry: strategy.entry.map((condition, index) => toConditionNode('entry', condition, index)),
    exit: strategy.exit.map((condition, index) => toConditionNode('exit', condition, index)),
    riskManagement: strategy.riskManagement
  };
}
