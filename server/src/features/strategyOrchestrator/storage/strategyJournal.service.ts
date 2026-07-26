import type { StrategyOrchestratorRun } from '../types/orchestratorTypes';
import { StrategyOrchestratorModel } from './strategyOrchestrator.model';

function serialize(doc: any): StrategyOrchestratorRun {
  const value = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    runId: value.runId,
    timestamp: value.timestamp instanceof Date ? value.timestamp.toISOString() : String(value.timestamp),
    strategiesEvaluated: value.strategiesEvaluated ?? [],
    rankings: value.rankings ?? [],
    winner: value.winner ?? null,
    conflicts: value.conflicts,
    recommendation: value.recommendation,
    evidence: value.evidence,
    marketContext: value.marketContext,
    decisionEngineContext: value.decisionEngineContext,
    eventContext: value.eventContext,
    portfolioContext: value.portfolioContext,
    schemaVersion: value.schemaVersion ?? 1,
  };
}

export async function appendStrategyRun(run: StrategyOrchestratorRun): Promise<StrategyOrchestratorRun> {
  const created = await StrategyOrchestratorModel.create({
    ...run,
    timestamp: new Date(run.timestamp),
  });
  return serialize(created);
}

export async function getLatestStrategyRun(): Promise<StrategyOrchestratorRun | null> {
  const doc = await StrategyOrchestratorModel.findOne().sort({ timestamp: -1, createdAt: -1 });
  return doc ? serialize(doc) : null;
}

export async function listStrategyRuns(limit = 50): Promise<StrategyOrchestratorRun[]> {
  const docs = await StrategyOrchestratorModel.find()
    .sort({ timestamp: -1, createdAt: -1 })
    .limit(Math.max(1, Math.min(250, limit)));
  return docs.map(serialize);
}
