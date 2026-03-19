import { http } from '../../../api/http';
import type { BacktestResult, StrategyRecord, StrategyVersionRecord, StructuredStrategy } from '../types';

export async function parseStrategy(input: string, sourceType: StructuredStrategy['sourceType'] = 'text') {
  const { data } = await http.post<{ parsedStrategy: StructuredStrategy }>('/api/strategy/parse', {
    input,
    sourceType
  });
  return data;
}

export async function compileStrategy(payload: {
  input?: string;
  parsedStrategy?: StructuredStrategy | null;
  strategyId?: string | null;
  name?: string | null;
}) {
  const { data } = await http.post<{ strategy: StrategyRecord; version: StrategyVersionRecord }>('/api/strategy/compile', {
    input: payload.input,
    parsedStrategy: payload.parsedStrategy ?? undefined,
    strategyId: payload.strategyId ?? undefined,
    name: payload.name ?? undefined
  });
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
