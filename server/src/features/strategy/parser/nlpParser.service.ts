import type {
  StrategyAction,
  StrategyField,
  StrategyInstrument,
  StrategySourceType,
  StructuredCondition,
  StructuredStrategy
} from '../types';
import { assertStructuredStrategy } from '../types';

const OPERATOR_MAP = {
  '<': 'lt',
  '<=': 'lte',
  '>': 'gt',
  '>=': 'gte',
  '=': 'eq',
  '==': 'eq'
} as const;

const FIELD_ALIASES: Array<{ pattern: RegExp; field: StrategyField }> = [
  { pattern: /\brsi\b/i, field: 'RSI' },
  { pattern: /\bvwap\b/i, field: 'VWAP' },
  { pattern: /\bprice\b|\bclose\b/i, field: 'PRICE' },
  { pattern: /\bema\s*9\b/i, field: 'EMA_9' },
  { pattern: /\bema\s*20\b/i, field: 'EMA_20' },
  { pattern: /\bmacd\b/i, field: 'MACD' },
  { pattern: /\bsignal\b/i, field: 'SIGNAL' }
];

type SentenceKind = 'entry' | 'exit';

function inferInstrument(input: string): StrategyInstrument {
  const lower = input.toLowerCase();
  if (lower.includes('put')) return 'PUT';
  if (lower.includes('call')) return 'CALL';
  return 'STOCK';
}

function inferAction(input: string): StrategyAction {
  const preConditionIntent = input.split(/\b(?:when|if)\b/i)[0]?.toLowerCase() ?? input.toLowerCase();
  if (/\bshort\b/.test(preConditionIntent)) return 'SHORT';
  if (/\bsell\b/.test(preConditionIntent)) return 'SELL';
  return 'BUY';
}

function inferName(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'Untitled Strategy';
  const title = trimmed.slice(0, 48);
  return title.length < trimmed.length ? `${title}...` : title;
}

function splitSentences(input: string): string[] {
  return input
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?;])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean)
    .map(sentence => sentence.replace(/[.!?;]+$/g, '').trim())
    .filter(Boolean);
}

function classifySentence(sentence: string): SentenceKind {
  if (/^(?:exit|close)\b/i.test(sentence) || /\b(?:exit when|close when|exit if|close if)\b/i.test(sentence)) {
    return 'exit';
  }
  return 'entry';
}

function validateSentenceBoundary(sentence: string, kind: SentenceKind) {
  if (/[.!?;]/.test(sentence)) {
    throw new Error('Conditions must not contain multiple sentences.');
  }

  const containsExitMarker = /\b(?:exit when|close when|exit if|close if)\b/i.test(sentence) || /^(?:exit|close)\b/i.test(sentence);
  if (kind === 'entry' && containsExitMarker) {
    throw new Error('Mixed entry and exit logic must be split into separate sentences.');
  }
}

function splitConditions(clause: string): string[] {
  return clause
    .split(/\band\b|,/i)
    .map(part => part.trim())
    .filter(Boolean);
}

function resolveField(value: string): StrategyField | null {
  for (const alias of FIELD_ALIASES) {
    if (alias.pattern.test(value)) return alias.field;
  }
  return null;
}

function buildComparisonCondition(raw: string): StructuredCondition | null {
  const match = raw.match(
    /^(rsi|price|close|ema\s*9|ema\s*20|vwap|macd)\s*(<=|>=|<|>|==|=)\s*(\d+(?:\.\d+)?|rsi|price|close|ema\s*9|ema\s*20|vwap|macd|signal)$/i
  );
  if (!match) return null;

  const left = resolveField(match[1]);
  const operator = OPERATOR_MAP[match[2] as keyof typeof OPERATOR_MAP];
  const numericValue = Number(match[3]);
  const indicatorValue = Number.isFinite(numericValue) ? undefined : resolveField(match[3]);

  if (!left || !operator || (!Number.isFinite(numericValue) && !indicatorValue)) {
    return null;
  }

  return {
    field: left,
    operator,
    value: Number.isFinite(numericValue) ? numericValue : indicatorValue ?? undefined,
    raw: raw.trim(),
    provenance: {
      source: 'user',
      reason: null
    }
  };
}

function buildTouchCondition(raw: string): StructuredCondition | null {
  const match = raw.match(/^(price|close)\s*(?:touches|touch|at)\s*(vwap|ema\s*9|ema\s*20)$/i);
  if (!match) return null;
  const field = resolveField(match[1]);
  const value = resolveField(match[2]);
  if (!field || !value) return null;
  return {
    field,
    operator: 'touches',
    value,
    raw: raw.trim(),
    provenance: {
      source: 'user',
      reason: null
    }
  };
}

function buildCrossCondition(raw: string): StructuredCondition | null {
  const match = raw.match(
    /^(price|close|macd)\s*(crosses above|crosses below)\s*(vwap|ema\s*9|ema\s*20|signal)$/i
  );
  if (!match) return null;
  const field = resolveField(match[1]);
  const value = resolveField(match[3]);
  if (!field || !value) return null;
  return {
    field,
    operator: match[2].toLowerCase().includes('above') ? 'crosses_above' : 'crosses_below',
    value,
    raw: raw.trim(),
    provenance: {
      source: 'user',
      reason: null
    }
  };
}

function parseConditionToken(raw: string): StructuredCondition | null {
  return buildTouchCondition(raw) ?? buildCrossCondition(raw) ?? buildComparisonCondition(raw);
}

function extractClause(sentence: string, kind: SentenceKind): string {
  const patterns = kind === 'entry'
    ? [/^\s*(?:buy|sell|short)\b(?:[^.!?;]*?)\bwhen\b\s*([\s\S]+)$/i, /^\s*if\b\s*([\s\S]+)$/i]
    : [/^\s*exit\s+when\b\s*([\s\S]+)$/i, /^\s*close\s+when\b\s*([\s\S]+)$/i, /^\s*exit\s+if\b\s*([\s\S]+)$/i, /^\s*close\s+if\b\s*([\s\S]+)$/i];

  for (const pattern of patterns) {
    const match = sentence.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  return kind === 'entry' ? sentence.trim() : '';
}

function parseSentenceConditions(sentence: string, kind: SentenceKind): StructuredCondition[] {
  validateSentenceBoundary(sentence, kind);
  const clause = extractClause(sentence, kind);
  if (!clause) return [];

  return splitConditions(clause).map(raw => {
    if (/[.!?;]/.test(raw)) {
      throw new Error('Conditions must not contain multiple sentences.');
    }
    if (/\b(?:exit when|close when|exit if|close if)\b/i.test(raw)) {
      throw new Error('Mixed sentence conditions are not allowed.');
    }

    const condition = parseConditionToken(raw);
    if (!condition) {
      throw new Error(`Malformed condition: "${raw}"`);
    }
    return condition;
  });
}

function extractRiskValue(input: string, label: 'take profit' | 'stop loss', fallback: number): number {
  const pattern = new RegExp(`${label}\\s*(?:at|of)?\\s*(\\d+(?:\\.\\d+)?)%`, 'i');
  const match = input.match(pattern);
  if (!match) return fallback;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value / 100 : fallback;
}

export function validateStructuredStrategy(strategy: StructuredStrategy) {
  assertStructuredStrategy(strategy);
}

export function parseStrategyInput(input: string, sourceType: StrategySourceType = 'text'): StructuredStrategy {
  const normalized = input.trim();
  if (!normalized) {
    throw new Error('Strategy input cannot be empty.');
  }

  const sentences = splitSentences(normalized);
  if (!sentences.length) {
    throw new Error('Strategy input cannot be empty.');
  }

  const warnings: string[] = [];
  const entry: StructuredCondition[] = [];
  const exit: StructuredCondition[] = [];

  sentences.forEach(sentence => {
    const kind = classifySentence(sentence);
    const parsedConditions = parseSentenceConditions(sentence, kind);
    if (kind === 'entry') {
      entry.push(...parsedConditions);
    } else {
      exit.push(...parsedConditions);
    }
  });

  if (!exit.length) {
    warnings.push('No explicit exit rule found. Added default RSI > 55 exit.');
    exit.push({
      field: 'RSI',
      operator: 'gt',
      value: 55,
      raw: 'RSI > 55',
      provenance: {
        source: 'system-generated',
        reason: 'missing exit rule'
      }
    });
  }

  const strategy: StructuredStrategy = {
    name: inferName(normalized),
    sourceText: normalized,
    sourceType,
    action: inferAction(normalized),
    instrument: inferInstrument(normalized),
    entry,
    exit,
    riskManagement: {
      stopLossPct: extractRiskValue(normalized, 'stop loss', 0.1),
      takeProfitPct: extractRiskValue(normalized, 'take profit', 0.2),
      maxBarsInTrade: 24
    },
    warnings
  };

  validateStructuredStrategy(strategy);
  return strategy;
}
