import type { HistoricalSimilarity, MarketImpactEstimate, NormalizedMarketEvent } from '../types/eventTypes';
import { DecisionJournalModel } from '../../intelligence/models/decisionJournal.model';
import { TradeReportModel } from '../../intelligence/models/tradeReport.model';

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function findHistoricalSimilarity(
  event: NormalizedMarketEvent,
  impact: MarketImpactEstimate
): Promise<HistoricalSimilarity> {
  try {
    const symbols = impact.affectedSymbols.length ? impact.affectedSymbols : event.symbols;
    const eventRegex = new RegExp(event.category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const [decisions, tradeReports] = await Promise.all([
      DecisionJournalModel.find({
        $or: [
          { 'context.symbol': { $in: symbols } },
          { 'reasonSummary.humanSummary': eventRegex },
          { 'reasonSummary.supportingReasons': eventRegex },
        ],
      }).sort({ timestamp: -1 }).limit(20),
      TradeReportModel.find({
        $or: [
          { 'identity.underlying': { $in: symbols } },
          { 'context.symbol': { $in: symbols } },
        ],
      }).sort({ createdAt: -1 }).limit(20),
    ]);

    const previousOutcomes = tradeReports.map((report: any) => ({
      tradeId: report.tradeId ?? null,
      outcome: numeric(report.performance?.realizedPnl) != null && report.performance.realizedPnl > 0 ? 'WIN' : numeric(report.performance?.realizedPnl) != null && report.performance.realizedPnl < 0 ? 'LOSS' : 'UNKNOWN',
      returnPct: numeric(report.performance?.returnPct),
    }));
    const resolved = previousOutcomes.filter(outcome => outcome.outcome !== 'UNKNOWN');
    const wins = resolved.filter(outcome => outcome.outcome === 'WIN').length;
    const returns = previousOutcomes.map(outcome => outcome.returnPct).filter((value): value is number => value != null);
    const holdTimes = tradeReports.map((report: any) => numeric(report.lifecycle?.holdTimeMinutes)).filter((value): value is number => value != null);
    return {
      eventId: event.id,
      similarEvents: decisions.map((decision: any) => ({
        decisionId: decision.decisionId,
        timestamp: decision.timestamp instanceof Date ? decision.timestamp.toISOString() : String(decision.timestamp),
        symbol: decision.context?.symbol ?? null,
        contract: decision.context?.contract ?? null,
        reason: decision.reasonSummary?.humanSummary ?? decision.decision?.humanReadableReasons?.[0] ?? 'Similar symbol or category context.',
      })),
      previousTrades: tradeReports.length,
      previousOutcomes,
      historicalWinRate: resolved.length ? Number((wins / resolved.length).toFixed(4)) : null,
      averageHoldingTimeMinutes: holdTimes.length ? Number((holdTimes.reduce((sum, value) => sum + value, 0) / holdTimes.length).toFixed(2)) : null,
      averageReturn: returns.length ? Number((returns.reduce((sum, value) => sum + value, 0) / returns.length).toFixed(4)) : null,
      explanation: decisions.length || tradeReports.length
        ? `Found ${decisions.length} related decisions and ${tradeReports.length} related trade reports by symbol/category.`
        : 'No similar decision journal or trade report history was found.',
    };
  } catch (error) {
    return {
      eventId: event.id,
      similarEvents: [],
      previousTrades: 0,
      previousOutcomes: [],
      historicalWinRate: null,
      averageHoldingTimeMinutes: null,
      averageReturn: null,
      explanation: `Historical lookup unavailable: ${(error as Error)?.message ?? 'unknown error'}.`,
    };
  }
}
