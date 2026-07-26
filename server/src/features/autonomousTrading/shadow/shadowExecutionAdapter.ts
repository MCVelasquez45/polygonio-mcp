import { randomUUID } from 'crypto';

export type ShadowExecutionRequest = {
  pipelineId: string;
  symbol: string;
  optionContract: string;
  quantity: number;
  bid: number | null;
  ask: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
  slippagePct?: number | null;
  requestedAt?: Date;
};

export type ShadowExecutionRecord = {
  shadowExecutionId: string;
  pipelineId: string;
  source: 'SHADOW_SIMULATION';
  symbol: string;
  optionContract: string;
  quantity: number;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  slippagePct: number;
  intendedEntryPrice: number | null;
  simulatedFillPrice: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
  status: 'SIMULATED_FILLED' | 'SIMULATED_BLOCKED';
  reason: string;
  requestedAt: string;
  filledAt: string | null;
  simulatedPnl: number | null;
};

function midFrom(bid: number | null, ask: number | null): number | null {
  if (bid == null || ask == null || bid <= 0 || ask < bid) return null;
  return Number(((bid + ask) / 2).toFixed(2));
}

export function createShadowExecution(request: ShadowExecutionRequest): ShadowExecutionRecord {
  const requestedAt = request.requestedAt ?? new Date();
  const slippagePct = Math.max(0, request.slippagePct ?? Number(process.env.AUTONOMOUS_SHADOW_SLIPPAGE_PCT ?? 0.02));
  const mid = midFrom(request.bid, request.ask);
  const simulatedFillPrice = mid == null ? null : Number((mid * (1 + slippagePct)).toFixed(2));
  return {
    shadowExecutionId: `shadow_${randomUUID()}`,
    pipelineId: request.pipelineId,
    source: 'SHADOW_SIMULATION',
    symbol: request.symbol,
    optionContract: request.optionContract,
    quantity: request.quantity,
    bid: request.bid,
    ask: request.ask,
    mid,
    slippagePct,
    intendedEntryPrice: mid,
    simulatedFillPrice,
    stopPrice: request.stopPrice,
    targetPrice: request.targetPrice,
    status: simulatedFillPrice == null ? 'SIMULATED_BLOCKED' : 'SIMULATED_FILLED',
    reason:
      simulatedFillPrice == null
        ? 'Shadow execution could not simulate a fill because bid/ask data was unavailable or invalid.'
        : 'Shadow execution simulated a midpoint fill with configured slippage. No broker order was submitted.',
    requestedAt: requestedAt.toISOString(),
    filledAt: simulatedFillPrice == null ? null : requestedAt.toISOString(),
    simulatedPnl: null,
  };
}

