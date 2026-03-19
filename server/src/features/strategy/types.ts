export const STRATEGY_SOURCE_TYPES = ['text', 'transcript', 'voice'] as const;
export type StrategySourceType = (typeof STRATEGY_SOURCE_TYPES)[number];

export const STRATEGY_PIPELINE_STAGES = [
  'draft',
  'parsed',
  'compiled',
  'backtested',
  'paper',
  'promotion',
  'engine'
] as const;
export type StrategyPipelineStage = (typeof STRATEGY_PIPELINE_STAGES)[number];

export const STRATEGY_STATUSES = ['draft', 'compiled', 'backtested', 'paper', 'promoted', 'archived'] as const;
export type StrategyStatus = (typeof STRATEGY_STATUSES)[number];

export const STRATEGY_INSTRUMENTS = ['CALL', 'PUT', 'STOCK'] as const;
export type StrategyInstrument = (typeof STRATEGY_INSTRUMENTS)[number];

export const STRATEGY_ACTIONS = ['BUY', 'SELL', 'SHORT'] as const;
export type StrategyAction = (typeof STRATEGY_ACTIONS)[number];

export const STRATEGY_FIELDS = ['RSI', 'VWAP', 'PRICE', 'EMA_9', 'EMA_20', 'MACD', 'SIGNAL'] as const;
export type StrategyField = (typeof STRATEGY_FIELDS)[number];

export const CONDITION_OPERATORS = [
  'lt',
  'lte',
  'gt',
  'gte',
  'eq',
  'touches',
  'crosses_above',
  'crosses_below'
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const CONDITION_PROVENANCE_SOURCES = ['user', 'system-generated'] as const;
export type ConditionProvenanceSource = (typeof CONDITION_PROVENANCE_SOURCES)[number];

export type ConditionProvenance = {
  source: ConditionProvenanceSource;
  reason?: string | null;
};

export type StructuredCondition = {
  field: StrategyField;
  operator: ConditionOperator;
  value?: number | StrategyField;
  raw: string;
  provenance: ConditionProvenance;
};

export type StrategyRiskManagement = {
  stopLossPct: number;
  takeProfitPct: number;
  maxBarsInTrade: number;
};

export type StructuredStrategy = {
  name: string;
  sourceText: string;
  sourceType: StrategySourceType;
  action: StrategyAction;
  instrument: StrategyInstrument;
  entry: StructuredCondition[];
  exit: StructuredCondition[];
  riskManagement: StrategyRiskManagement;
  warnings: string[];
};

export type ConditionNode = {
  id: string;
  type: 'condition';
  field: StrategyField;
  operator: ConditionOperator;
  value?: number | StrategyField;
  raw: string;
  provenance: ConditionProvenance;
};

export type StrategyAst = {
  type: 'strategy';
  name: string;
  meta: {
    action: StrategyAction;
    instrument: StrategyInstrument;
  };
  entry: ConditionNode[];
  exit: ConditionNode[];
  riskManagement: StrategyRiskManagement;
};

export type StrategyRuntimeRule = {
  field: StrategyField;
  operator: ConditionOperator;
  value?: number | StrategyField;
  raw: string;
  provenance: ConditionProvenance;
};

export type StrategyRuntimeSpec = {
  name: string;
  indicators: StrategyField[];
  rules: {
    entry: StrategyRuntimeRule[];
    exit: StrategyRuntimeRule[];
  };
  execution: {
    action: StrategyAction;
    instrument: StrategyInstrument;
  };
  riskManagement: StrategyRiskManagement;
};

export type BacktestTrade = {
  entryTime: string;
  exitTime: string;
  side: 'long' | 'short';
  entryAction: StrategyAction;
  exitAction: 'EXIT';
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  barsHeld: number;
  reason: string;
};

export type BacktestResult = {
  pnl: number;
  winRate: number;
  trades: BacktestTrade[];
  totalTrades: number;
};

export type BacktestRunStatus = 'completed';

export type BacktestRun = {
  strategyId: string;
  versionId: string;
  version: string;
  status: BacktestRunStatus;
  pipelineStage: 'backtested';
  seedKey: string;
  executionSnapshot: StrategyRuntimeSpec;
  results: BacktestResult;
  createdAt?: string;
  updatedAt?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertEnumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string
): asserts value is T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function assertFinitePositiveNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
}

function assertFiniteNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
}

export function assertStrategySourceType(value: unknown): asserts value is StrategySourceType {
  assertEnumValue(value, STRATEGY_SOURCE_TYPES, 'Strategy source type');
}

export function assertStrategyAction(value: unknown, label = 'Strategy action'): asserts value is StrategyAction {
  assertEnumValue(value, STRATEGY_ACTIONS, label);
}

export function assertStrategyInstrument(value: unknown, label = 'Strategy instrument'): asserts value is StrategyInstrument {
  assertEnumValue(value, STRATEGY_INSTRUMENTS, label);
}

export function assertConditionOperator(value: unknown, label = 'Condition operator'): asserts value is ConditionOperator {
  assertEnumValue(value, CONDITION_OPERATORS, label);
}

export function assertStrategyField(value: unknown, label = 'Strategy field'): asserts value is StrategyField {
  assertEnumValue(value, STRATEGY_FIELDS, label);
}

export function assertConditionProvenance(value: unknown, label = 'Condition provenance'): asserts value is ConditionProvenance {
  assertPlainObject(value, label);
  assertEnumValue(value.source, CONDITION_PROVENANCE_SOURCES, `${label}.source`);
  if (value.reason != null && typeof value.reason !== 'string') {
    throw new Error(`${label}.reason must be a string when provided.`);
  }
}

export function assertStructuredCondition(value: unknown, label = 'Strategy condition'): asserts value is StructuredCondition {
  assertPlainObject(value, label);
  assertStrategyField(value.field, `${label}.field`);
  assertConditionOperator(value.operator, `${label}.operator`);
  if (typeof value.raw !== 'string' || !value.raw.trim()) {
    throw new Error(`${label}.raw must be a non-empty string.`);
  }
  if (value.value != null) {
    if (typeof value.value === 'number') {
      assertFiniteNumber(value.value, `${label}.value`);
    } else {
      assertStrategyField(value.value, `${label}.value`);
    }
  }
  assertConditionProvenance(value.provenance, `${label}.provenance`);
}

export function assertStrategyRiskManagement(value: unknown, label = 'Risk management'): asserts value is StrategyRiskManagement {
  assertPlainObject(value, label);
  assertFinitePositiveNumber(value.stopLossPct, `${label}.stopLossPct`);
  assertFinitePositiveNumber(value.takeProfitPct, `${label}.takeProfitPct`);
  assertFinitePositiveNumber(value.maxBarsInTrade, `${label}.maxBarsInTrade`);
}

export function assertStructuredStrategy(value: unknown, label = 'Structured strategy'): asserts value is StructuredStrategy {
  assertPlainObject(value, label);
  if (typeof value.name !== 'string' || !value.name.trim()) {
    throw new Error(`${label}.name must be a non-empty string.`);
  }
  if (typeof value.sourceText !== 'string' || !value.sourceText.trim()) {
    throw new Error(`${label}.sourceText must be a non-empty string.`);
  }
  assertStrategySourceType(value.sourceType);
  assertStrategyAction(value.action, `${label}.action`);
  assertStrategyInstrument(value.instrument, `${label}.instrument`);
  if (!Array.isArray(value.entry) || value.entry.length === 0) {
    throw new Error(`${label}.entry must contain at least one condition.`);
  }
  if (!Array.isArray(value.exit) || value.exit.length === 0) {
    throw new Error(`${label}.exit must contain at least one condition.`);
  }
  value.entry.forEach((condition, index) => assertStructuredCondition(condition, `${label}.entry[${index}]`));
  value.exit.forEach((condition, index) => assertStructuredCondition(condition, `${label}.exit[${index}]`));
  assertStrategyRiskManagement(value.riskManagement, `${label}.riskManagement`);
  if (!Array.isArray(value.warnings) || !value.warnings.every(item => typeof item === 'string')) {
    throw new Error(`${label}.warnings must be a string array.`);
  }
}

export function assertStrategyRuntimeRule(value: unknown, label = 'Runtime rule'): asserts value is StrategyRuntimeRule {
  assertStructuredCondition(value, label);
}

export function assertStrategyRuntimeSpec(value: unknown, label = 'Runtime spec'): asserts value is StrategyRuntimeSpec {
  assertPlainObject(value, label);
  if (typeof value.name !== 'string' || !value.name.trim()) {
    throw new Error(`${label}.name must be a non-empty string.`);
  }
  if (!Array.isArray(value.indicators) || !value.indicators.length) {
    throw new Error(`${label}.indicators must contain at least one indicator.`);
  }
  value.indicators.forEach((indicator, index) => assertStrategyField(indicator, `${label}.indicators[${index}]`));
  assertPlainObject(value.rules, `${label}.rules`);
  if (!Array.isArray(value.rules.entry) || value.rules.entry.length === 0) {
    throw new Error(`${label}.rules.entry must contain at least one rule.`);
  }
  if (!Array.isArray(value.rules.exit) || value.rules.exit.length === 0) {
    throw new Error(`${label}.rules.exit must contain at least one rule.`);
  }
  value.rules.entry.forEach((rule, index) => assertStrategyRuntimeRule(rule, `${label}.rules.entry[${index}]`));
  value.rules.exit.forEach((rule, index) => assertStrategyRuntimeRule(rule, `${label}.rules.exit[${index}]`));
  assertPlainObject(value.execution, `${label}.execution`);
  assertStrategyAction(value.execution.action, `${label}.execution.action`);
  assertStrategyInstrument(value.execution.instrument, `${label}.execution.instrument`);
  assertStrategyRiskManagement(value.riskManagement, `${label}.riskManagement`);
}
