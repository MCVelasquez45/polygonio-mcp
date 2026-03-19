import type { ConditionNode, StrategyAst } from '../types';

function compileEntryAction(action: StrategyAst['meta']['action'], instrument: StrategyAst['meta']['instrument']) {
  switch (action) {
    case 'BUY':
      return `buy("${instrument}")`;
    case 'SELL':
      return `sell("${instrument}")`;
    case 'SHORT':
      return `short("${instrument}")`;
    default:
      return `buy("${instrument}")`;
  }
}

function formatValue(value: ConditionNode['value']) {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return 'true';
}

function compileIndicatorFunction(name: 'touch' | 'crossAbove' | 'crossBelow', node: ConditionNode): string {
  if (typeof node.value === 'string' && node.field === 'PRICE') {
    return `${name}(${node.value})`;
  }

  if (node.value == null) {
    return `${name}(${node.field})`;
  }

  return `${name}(${node.field}, ${formatValue(node.value)})`;
}

function compileCondition(node: ConditionNode): string {
  switch (node.operator) {
    case 'lt':
      return `${node.field} < ${formatValue(node.value)}`;
    case 'lte':
      return `${node.field} <= ${formatValue(node.value)}`;
    case 'gt':
      return `${node.field} > ${formatValue(node.value)}`;
    case 'gte':
      return `${node.field} >= ${formatValue(node.value)}`;
    case 'eq':
      return `${node.field} == ${formatValue(node.value)}`;
    case 'touches':
      return compileIndicatorFunction('touch', node);
    case 'crosses_above':
      return compileIndicatorFunction('crossAbove', node);
    case 'crosses_below':
      return compileIndicatorFunction('crossBelow', node);
    default:
      return node.raw;
  }
}

export function compileDsl(ast: StrategyAst): string {
  const entryExpression = ast.entry.map(compileCondition).join(' && ');
  const exitExpression = ast.exit.map(compileCondition).join(' && ');

  return [
    `strategy("${ast.name}")`,
    '',
    `if (${entryExpression}) {`,
    `  ${compileEntryAction(ast.meta.action, ast.meta.instrument)}`,
    '}',
    '',
    `if (${exitExpression}) {`,
    '  exit()',
    '}',
    '',
    'risk({',
    `  stopLossPct: ${ast.riskManagement.stopLossPct.toFixed(2)},`,
    `  takeProfitPct: ${ast.riskManagement.takeProfitPct.toFixed(2)}`,
    '})'
  ].join('\n');
}
