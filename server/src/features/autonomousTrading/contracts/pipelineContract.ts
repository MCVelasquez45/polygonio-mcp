import { createHash } from 'crypto';
import type { AutonomousTradePipelineRecord, AutonomousTradingMode } from '../types/pipelineTypes';

export const AUTONOMOUS_PIPELINE_SCHEMA_VERSION = 1;

export function normalizeAutonomousMode(raw = process.env.AUTONOMOUS_TRADING_MODE): AutonomousTradingMode {
  const value = String(raw ?? 'shadow').trim().toLowerCase();
  if (value === 'paper' || value === 'autonomous_paper') return 'AUTONOMOUS_PAPER';
  if (value === 'manual') return 'MANUAL';
  return 'SHADOW';
}

export function autonomousModeLabel(mode: AutonomousTradingMode): 'Manual' | 'Shadow' | 'Autonomous Paper' {
  if (mode === 'AUTONOMOUS_PAPER') return 'Autonomous Paper';
  if (mode === 'MANUAL') return 'Manual';
  return 'Shadow';
}

export function executionSourceForMode(mode: AutonomousTradingMode) {
  if (mode === 'AUTONOMOUS_PAPER') return 'AUTONOMOUS_PAPER' as const;
  if (mode === 'MANUAL') return 'MANUAL_PAPER' as const;
  return 'SHADOW_SIMULATION' as const;
}

export function stablePipelineId(input: {
  mode: AutonomousTradingMode;
  symbol: string | null;
  eventIds: string[];
  scanId: string | null;
  strategyRunId: string | null;
  recommendationId: string | null;
}): string {
  const hash = createHash('sha256')
    .update(JSON.stringify({
      mode: input.mode,
      symbol: input.symbol,
      eventIds: input.eventIds.slice().sort(),
      scanId: input.scanId,
      strategyRunId: input.strategyRunId,
      recommendationId: input.recommendationId,
    }))
    .digest('hex')
    .slice(0, 32);
  return `atp_${hash}`;
}

export function emptyPipelineRecord(args: {
  pipelineId: string;
  mode: AutonomousTradingMode;
  symbol: string | null;
  optionContract: string | null;
  idempotencyKey: string;
  now: string;
}): AutonomousTradePipelineRecord {
  const source = executionSourceForMode(args.mode);
  return {
    pipelineId: args.pipelineId,
    schemaVersion: AUTONOMOUS_PIPELINE_SCHEMA_VERSION,
    createdAt: args.now,
    updatedAt: args.now,
    mode: args.mode,
    state: 'OBSERVING',
    executionSource: source,
    symbol: args.symbol,
    optionContract: args.optionContract,
    idempotencyKey: args.idempotencyKey,
    eventContext: { eventIds: [], importance: null, sentiment: null, summary: null },
    decisionContext: {
      scanId: null,
      opportunityScore: null,
      rank: null,
      recommendation: null,
      explanation: null,
    },
    strategyContext: {
      runId: null,
      winningStrategy: null,
      confidence: null,
      evidenceScore: null,
      conflicts: [],
    },
    riskContext: {
      approvalId: null,
      approved: null,
      suggestedContracts: null,
      dollarRisk: null,
      reasonCodes: [],
      warnings: [],
      expiresAt: null,
    },
    lifecycleContext: {
      lifecycleId: null,
      state: null,
      currentAction: null,
      currentConfidence: null,
      nextEvaluationAt: null,
    },
    executionContext: {
      requested: false,
      executionIntentId: null,
      brokerOrderId: null,
      status: null,
      paper: args.mode !== 'SHADOW',
      source,
    },
    evaluationContext: {
      evaluationId: null,
      status: null,
      outcome: null,
      returnPct: null,
    },
    blockingReasons: [],
    plainLanguageStatus: 'The autonomous trader is observing and waiting for current subsystem data.',
    timeline: [],
  };
}

