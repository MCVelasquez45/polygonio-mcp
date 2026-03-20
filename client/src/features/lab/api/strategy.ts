import { http } from '../../../api/http';
import { extractStrategy as siftExtract } from '../../../api/agent';
import type { BacktestResult, StrategyRecord, StrategyVersionRecord, StructuredStrategy } from '../types';

/**
 * Parse strategy text using SIFT extraction (primary path).
 * Returns the full extraction output which is richer than NLP parsing.
 */
export async function parseStrategy(input: string, _sourceType: StructuredStrategy['sourceType'] = 'text') {
  // Use SIFT extraction instead of the NLP parser — it produces richer structured output
  const extraction = await siftExtract({ transcript: input });
  // Map extraction output to StructuredStrategy-compatible shape for UI display
  const parsedStrategy: StructuredStrategy = {
    name: extraction.name ?? 'Unnamed Strategy',
    sourceText: input,
    sourceType: 'text',
    action: 'SELL',
    instrument: extraction.trading_method === 'options' ? 'CALL'
      : extraction.trading_method === 'futures' ? 'FUTURE' : 'STOCK',
    tradingMethod: extraction.trading_method ?? 'equities',
    entry: (extraction.entry_rules ?? []).map((rule: string, i: number) => ({
      field: 'PRICE' as const,
      operator: 'gt' as const,
      value: 0,
      raw: rule,
      provenance: { source: 'user' as const, reason: null },
    })),
    exit: (extraction.exit_rules ?? []).map((rule: string, i: number) => ({
      field: 'PRICE' as const,
      operator: 'gt' as const,
      value: 0,
      raw: rule,
      provenance: { source: 'user' as const, reason: null },
    })),
    riskManagement: { stopLossPct: 0.1, takeProfitPct: 0.2, maxBarsInTrade: 120 },
    warnings: [],
  };
  // Stash the full extraction on the parsedStrategy for compile-extracted
  (parsedStrategy as any)._extraction = extraction;
  return { parsedStrategy };
}

/**
 * Compile strategy using the extraction-based path (primary).
 * Sends full extraction data to /compile-extracted which bypasses NLP parsing.
 */
export async function compileStrategy(payload: {
  input?: string;
  parsedStrategy?: StructuredStrategy | null;
  strategyId?: string | null;
  name?: string | null;
}) {
  // If we have a stashed extraction from parseStrategy, use compile-extracted
  const extraction = (payload.parsedStrategy as any)?._extraction;
  if (extraction) {
    return compileExtractedStrategy({
      ...extraction,
      strategyId: payload.strategyId ?? undefined,
    });
  }
  // Fallback to compile-extracted with input text as transcript
  return compileExtractedStrategy({
    name: payload.name ?? payload.parsedStrategy?.name ?? 'Strategy',
    description: payload.parsedStrategy?.sourceText ?? payload.input ?? '',
    entry_rules: payload.parsedStrategy?.entry?.map(e => e.raw) ?? [],
    exit_rules: payload.parsedStrategy?.exit?.map(e => e.raw) ?? [],
    trading_method: payload.parsedStrategy?.tradingMethod ?? 'equities',
    strategyId: payload.strategyId ?? undefined,
  });
}

export async function compileExtractedStrategy(payload: Record<string, unknown>) {
  const { data } = await http.post<{ strategy: StrategyRecord; version: StrategyVersionRecord }>(
    '/api/strategy/compile-extracted',
    payload
  );
  return data;
}

export async function backtestStrategy(payload: { strategyId?: string | null; versionId?: string | null }) {
  const { data } = await http.post<{ strategyId: string; versionId: string; backtestRunId: string; results: BacktestResult }>(
    '/api/strategy/backtest',
    {
      strategyId: payload.strategyId ?? undefined,
      versionId: payload.versionId ?? undefined
    }
  );
  return data;
}

export async function listStrategies() {
  const { data } = await http.get<{ strategies: StrategyRecord[] }>('/api/strategy');
  return data.strategies;
}

export async function getStrategyVersions(strategyId: string) {
  const { data } = await http.get<{ versions: StrategyVersionRecord[] }>(`/api/strategy/${strategyId}/versions`);
  return data.versions;
}
