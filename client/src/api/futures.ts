import { http } from './http';
import type {
  FuturesBacktestConfig,
  FuturesBacktestResult,
  FuturesContractSpec,
  FuturesEngineState,
  FuturesPaperSession,
  FuturesPromotionReport,
  StrategyVersion,
  StressTestResponse
} from '../types/futures';

export async function listFuturesContracts(): Promise<{ count: number; specs: FuturesContractSpec[] }> {
  const { data } = await http.get<{ count: number; specs: FuturesContractSpec[] }>('/api/lab/futures/contracts');
  return data;
}

export async function runFuturesBacktest(config: FuturesBacktestConfig): Promise<FuturesBacktestResult> {
  const { data } = await http.post<FuturesBacktestResult>('/api/lab/futures/backtest', config);
  return data;
}

export async function getFuturesBacktest(backtestId: string): Promise<FuturesBacktestResult> {
  const { data } = await http.get<FuturesBacktestResult>(`/api/lab/futures/backtest/${backtestId}`);
  return data;
}

export async function startFuturesPaperSession(payload: {
  strategyId: string;
  strategyName: string;
  symbol: string;
  contracts: number;
  initialCapital: number;
  maxDailyLoss: number;
  maxDrawdown: number;
  slippageBps: number;
  feePerContract: number;
}): Promise<FuturesPaperSession> {
  const { data } = await http.post<FuturesPaperSession>('/api/lab/futures/paper/start', payload);
  return data;
}

export async function getFuturesPaperSession(sessionId: string): Promise<FuturesPaperSession> {
  const { data } = await http.get<FuturesPaperSession>(`/api/lab/futures/paper/${sessionId}`);
  return data;
}

export async function controlFuturesPaperSession(
  sessionId: string,
  action: 'pause' | 'resume' | 'stop' | 'emergency_stop'
): Promise<FuturesPaperSession> {
  const { data } = await http.post<FuturesPaperSession>(`/api/lab/futures/paper/${sessionId}/control`, { action });
  return data;
}

export async function runFuturesPromotionCheck(sessionId: string, strategyId: string): Promise<FuturesPromotionReport> {
  const { data } = await http.post<FuturesPromotionReport>('/api/lab/futures/promotion/check', {
    sessionId,
    strategyId
  });
  return data;
}

export async function deployFuturesSession(payload: {
  sessionId: string;
  strategyId: string;
  symbol: string;
}): Promise<{ deploymentId: string; session: FuturesPaperSession; engine: any }> {
  const { data } = await http.post('/api/engine/futures/deploy', payload);
  return data;
}

export async function getFuturesEngineStatus(): Promise<FuturesEngineState> {
  const { data } = await http.get<FuturesEngineState>('/api/engine/futures/status');
  return data;
}

export async function getStrategyVersions(strategyId: string): Promise<StrategyVersion[]> {
  const { data } = await http.get<StrategyVersion[]>(`/api/lab/strategy/${strategyId}/versions`);
  return data;
}

export async function compareStrategyVersions(
  strategyId: string,
  v1: number,
  v2: number
): Promise<{ v1: StrategyVersion; v2: StrategyVersion; deltas: Record<string, { v1: number; v2: number; delta: number; deltaPct: number }> }> {
  const { data } = await http.get(`/api/lab/strategy/${strategyId}/versions/compare`, { params: { v1, v2 } });
  return data;
}

export async function applySuggestions(
  strategyId: string,
  suggestions: Array<{ field: string; suggestedValue: unknown; action?: string }>
): Promise<any> {
  const { data } = await http.post(`/api/lab/strategy/${strategyId}/apply-suggestions`, { suggestions });
  return data;
}

export async function revertToVersion(
  strategyId: string,
  versionNumber: number
): Promise<{ message: string; strategy: any }> {
  const { data } = await http.post(`/api/lab/strategy/${strategyId}/versions/${versionNumber}/revert`);
  return data;
}

export async function runStressTest(config: {
  strategyId: string;
  strategyName: string;
  symbol: string;
  startDate: string;
  endDate: string;
  initialCapital?: number;
  slippageBps?: number;
  feePerContract?: number;
}): Promise<StressTestResponse> {
  const { data } = await http.post<StressTestResponse>('/api/lab/futures/backtest/stress-test', config);
  return data;
}
