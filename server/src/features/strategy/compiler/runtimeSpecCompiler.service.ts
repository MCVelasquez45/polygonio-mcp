import type { StrategyAst, StrategyField, StrategyRuntimeSpec } from '../types';

function collectIndicators(ast: StrategyAst): StrategyField[] {
  const fields = new Set<StrategyField>();
  const pushField = (value?: number | StrategyField) => {
    if (typeof value === 'string') {
      fields.add(value);
    }
  };

  [...ast.entry, ...ast.exit].forEach(rule => {
    fields.add(rule.field);
    pushField(rule.value);
  });

  return Array.from(fields);
}

export function compileRuntimeSpec(ast: StrategyAst): StrategyRuntimeSpec {
  return {
    name: ast.name,
    indicators: collectIndicators(ast),
    rules: {
      entry: ast.entry.map(rule => ({
        field: rule.field,
        operator: rule.operator,
        value: rule.value,
        raw: rule.raw,
        provenance: rule.provenance
      })),
      exit: ast.exit.map(rule => ({
        field: rule.field,
        operator: rule.operator,
        value: rule.value,
        raw: rule.raw,
        provenance: rule.provenance
      }))
    },
    execution: {
      action: ast.meta.action,
      instrument: ast.meta.instrument,
      tradingMethod: ast.meta.tradingMethod,
      contractSelection: ast.meta.contractSelection,
      spreadConfig: ast.meta.spreadConfig,
      regimeConfig: ast.meta.regimeConfig,
      timeRules: ast.meta.timeRules
    },
    riskManagement: ast.riskManagement
  };
}
