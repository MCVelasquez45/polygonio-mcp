import { getLatestStrategyRun } from '../../strategyOrchestrator/controllers/orchestrator.service';
import type { StrategyOrchestratorRun } from '../../strategyOrchestrator/types/orchestratorTypes';
import { evaluateRiskApproval } from '../approval/riskApproval.service';
import { getRiskRuleSet } from '../limits/riskRules.service';
import { buildRiskPortfolioSnapshot } from '../portfolio/riskPortfolio.service';
import { appendRiskJournalRecord, getLatestRiskApproval, listRiskApprovals } from '../journal/riskJournal.service';
import type { ApprovalPackage, RiskJournalRecord, RiskRecommendationInput } from '../types/riskTypes';

function directionFromRun(run: StrategyOrchestratorRun): RiskRecommendationInput['direction'] {
  const winner = run.strategiesEvaluated.find(strategy => strategy.strategyId === run.winner?.strategyId);
  return winner?.direction ?? 'NEUTRAL';
}

function expectedReturnFromRun(run: StrategyOrchestratorRun): number {
  const winner = run.strategiesEvaluated.find(strategy => strategy.strategyId === run.winner?.strategyId);
  return winner?.expectedReturn ?? 0;
}

function sectorFromRun(run: StrategyOrchestratorRun): string | null {
  const symbol = run.decisionEngineContext.bestOpportunity?.symbol;
  const sectorFromEvent = run.eventContext.latestEvents
    .find(event => symbol && event.affectedSymbols.includes(symbol))
    ?.affectedSectors?.[0];
  return sectorFromEvent ?? run.eventContext.latestEvents[0]?.affectedSectors?.[0] ?? null;
}

export function buildRiskRecommendationFromStrategyRun(run: StrategyOrchestratorRun): RiskRecommendationInput {
  const symbol = run.decisionEngineContext.bestOpportunity?.symbol ?? run.eventContext.latestEvents[0]?.affectedSymbols?.[0] ?? null;
  return {
    recommendationId: run.recommendation.riskHandoff.packageId,
    strategyRunId: run.runId,
    recommendation: run.recommendation,
    symbol,
    sector: sectorFromRun(run),
    strategyId: run.winner?.strategyId ?? null,
    direction: directionFromRun(run),
    confidence: run.recommendation.confidence,
    expectedReturn: expectedReturnFromRun(run),
    marketRegime: run.marketContext.regime,
    marketStatus: run.marketContext.marketStatus,
    eventContext: run.eventContext,
    raw: run,
  };
}

export async function buildRiskApprovalQueue(): Promise<{
  latestStrategyRunId: string | null;
  pending: RiskRecommendationInput[];
}> {
  const latest = await getLatestStrategyRun().catch(() => null);
  return {
    latestStrategyRunId: latest?.runId ?? null,
    pending: latest ? [buildRiskRecommendationFromStrategyRun(latest)] : [],
  };
}

export async function runRiskReview(options: {
  recommendation?: RiskRecommendationInput;
  persist?: boolean;
  now?: Date;
} = {}): Promise<{ approval: ApprovalPackage; record: RiskJournalRecord | null }> {
  const now = options.now ?? new Date();
  const recommendation =
    options.recommendation ??
    (await getLatestStrategyRun().then(run => (run ? buildRiskRecommendationFromStrategyRun(run) : null)));
  if (!recommendation) {
    throw Object.assign(new Error('RISK_RECOMMENDATION_NOT_FOUND'), { status: 404 });
  }
  const portfolio = await buildRiskPortfolioSnapshot(now);
  const approval = evaluateRiskApproval(recommendation, portfolio, now);
  const record = options.persist === false ? null : await appendRiskJournalRecord(recommendation, approval, portfolio, now);
  return { approval, record };
}

export async function getRiskEngineStatus() {
  const [latestApproval, queue, portfolio] = await Promise.all([
    getLatestRiskApproval().catch(() => null),
    buildRiskApprovalQueue().catch(() => ({ latestStrategyRunId: null, pending: [] })),
    buildRiskPortfolioSnapshot().catch(() => null),
  ]);
  return {
    enabled: (process.env.RISK_ENGINE_ENABLED ?? 'true').toLowerCase() !== 'false',
    approvalRequired: (process.env.RISK_ENGINE_APPROVAL_REQUIRED ?? 'true').toLowerCase() !== 'false',
    latestApprovalId: latestApproval?.approvalId ?? null,
    latestStatus: latestApproval?.approval.status ?? null,
    pendingRecommendations: queue.pending.length,
    portfolioHeat:
      portfolio && portfolio.riskBudget.maximumOpenRisk > 0
        ? Number((portfolio.riskBudget.openRisk / portfolio.riskBudget.maximumOpenRisk).toFixed(4))
        : 0,
    ruleVersion: getRiskRuleSet().ruleVersion,
  };
}

export { buildRiskPortfolioSnapshot, getLatestRiskApproval, getRiskRuleSet, listRiskApprovals };
