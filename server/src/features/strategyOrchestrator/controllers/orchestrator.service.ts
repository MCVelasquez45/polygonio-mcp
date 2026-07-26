import { randomUUID } from 'crypto';
import { getMarketStatusSnapshot } from '../../market/services/marketStatus';
import { listWatchlist } from '../../watchlist/watchlist.service';
import { listEventRecords } from '../../eventIntelligence/storage/eventJournal.service';
import { getLatestDecisionScan } from '../../decisionEngine/journal.service';
import { buildPortfolioContext } from '../portfolio/portfolioContext.service';
import { detectMarketRegime } from '../scheduler/marketRegime.service';
import { scheduleStrategies } from '../scheduler/strategyScheduler.service';
import { buildEvidenceScore } from '../ranking/evidence.service';
import { rankStrategies, resolveStrategyConflicts } from '../ranking/ranking.service';
import { buildRecommendationPackage } from '../ranking/recommendation.service';
import { listRegisteredStrategies } from '../strategies/strategyRegistry.service';
import { appendStrategyRun, getLatestStrategyRun, listStrategyRuns } from '../storage/strategyJournal.service';
import type { StrategyEvaluationContext, StrategyOrchestratorRun } from '../types/orchestratorTypes';

function eventSentimentValue(value: any): number | string | null {
  return value?.event?.sentiment?.score ?? value?.event?.sentiment?.label ?? null;
}

export async function buildStrategyContext(): Promise<StrategyEvaluationContext> {
  const [events, decision, portfolio, watchlistDocs, marketStatus] = await Promise.all([
    listEventRecords(25).catch(() => []),
    getLatestDecisionScan().catch(() => null),
    buildPortfolioContext(),
    listWatchlist().catch(() => []),
    getMarketStatusSnapshot().catch(() => null),
  ]);
  const decisionConfidence = decision?.winner?.confidence ?? null;
  const marketRegime = detectMarketRegime({
    events,
    decisionConfidence,
    rejectedCount: decision?.rejections?.length ?? 0,
  });
  return {
    timestamp: new Date().toISOString(),
    eventContext: {
      latestEvents: events.slice(0, 10).map(record => ({
        id: record.event.id,
        title: record.event.title,
        category: record.event.category,
        importance: record.event.importance,
        sentiment: eventSentimentValue(record),
        affectedSymbols: record.impact.affectedSymbols,
        affectedEtfs: record.impact.affectedEtfs,
        affectedSectors: record.impact.affectedSectors,
      })),
    },
    decisionContext: {
      latestScanId: decision?.scanId ?? null,
      bestOpportunity: decision?.winner
        ? {
            symbol: decision.winner.symbol,
            score: decision.winner.overallScore,
            confidence: decision.winner.confidence,
            recommendation: decision.winner.recommendation,
          }
        : null,
      rejectedCount: decision?.rejections?.length ?? 0,
      noTradeReason: decision?.noTradeReason ?? null,
    },
    marketData: {
      marketStatus: marketStatus?.market ?? 'unknown',
      trendScore: decision?.winner?.scores?.trend?.score ?? null,
      momentumScore: decision?.winner?.scores?.momentum?.score ?? null,
      volatilityScore: decision?.winner?.scores?.volatility?.score ?? null,
    },
    portfolio,
    watchlist: watchlistDocs.filter(item => item.enabled).map(item => item.symbol),
    news: events.slice(0, 5).map(record => record.event.title),
    sentiment: {
      bullish: events.filter(record => record.event.sentiment.label === 'bullish').length,
      bearish: events.filter(record => record.event.sentiment.label === 'bearish').length,
      neutral: events.filter(record => record.event.sentiment.label === 'neutral').length,
    },
    technicalAnalysis: {
      trendScore: decision?.winner?.scores?.trend?.score ?? null,
      momentumScore: decision?.winner?.scores?.momentum?.score ?? null,
      volatilityScore: decision?.winner?.scores?.volatility?.score ?? null,
    },
    marketRegime,
  };
}

export async function runStrategyOrchestrator(options: { persist?: boolean } = {}): Promise<StrategyOrchestratorRun> {
  const context = await buildStrategyContext();
  const registry = listRegisteredStrategies();
  const scheduled = scheduleStrategies(registry, context);
  const evidence = buildEvidenceScore(context);
  const strategiesEvaluated = scheduled.selected.map(strategy => strategy.evaluate(context));
  const skippedEvaluations = scheduled.skipped.map(strategy => ({
    strategyId: strategy.id,
    name: strategy.name,
    direction: 'NEUTRAL' as const,
    confidence: 0,
    risk: 0,
    expectedReturn: 0,
    positionSize: 0,
    evidenceScore: 0,
    reasoning: [scheduled.explanation],
    rejected: true,
    rejectionReason: 'Skipped by strategy scheduler as unrelated to current event/regime context.',
  }));
  const allEvaluations = [...strategiesEvaluated, ...skippedEvaluations];
  const rankings = rankStrategies(allEvaluations);
  const conflicts = resolveStrategyConflicts(strategiesEvaluated);
  const recommendation = buildRecommendationPackage({ rankings, conflicts, evidence });
  const run: StrategyOrchestratorRun = {
    runId: randomUUID(),
    timestamp: context.timestamp,
    strategiesEvaluated: allEvaluations,
    rankings,
    winner: rankings.find(ranking => !ranking.rejected) ?? null,
    conflicts,
    recommendation,
    evidence,
    marketContext: { regime: context.marketRegime, marketStatus: context.marketData.marketStatus },
    decisionEngineContext: context.decisionContext,
    eventContext: context.eventContext,
    portfolioContext: context.portfolio,
    schemaVersion: 1,
  };
  return options.persist === false ? run : appendStrategyRun(run);
}

export { getLatestStrategyRun, listStrategyRuns };
