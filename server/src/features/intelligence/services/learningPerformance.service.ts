import { DecisionJournalModel } from '../models/decisionJournal.model';
import { TradeReportModel } from '../models/tradeReport.model';

type Bucket = {
  key: string;
  label: string;
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null;
  averageReturnPct: number | null;
  netPnl: number | null;
  sampleTradeIds: string[];
};

function finite(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function classifyTrade(report: any): 'WIN' | 'LOSS' | 'BREAKEVEN' {
  const pnl = finite(report?.performance?.realizedPnl);
  if (pnl == null || pnl === 0) return 'BREAKEVEN';
  return pnl > 0 ? 'WIN' : 'LOSS';
}

function bucketReports(reports: any[], keyOf: (report: any) => string | null, labelOf = (key: string) => key): Bucket[] {
  const buckets = new Map<string, any[]>();
  for (const report of reports) {
    const key = keyOf(report) ?? 'UNAVAILABLE';
    const group = buckets.get(key) ?? [];
    group.push(report);
    buckets.set(key, group);
  }
  return [...buckets.entries()]
    .map(([key, group]) => {
      const wins = group.filter(report => classifyTrade(report) === 'WIN').length;
      const losses = group.filter(report => classifyTrade(report) === 'LOSS').length;
      const breakeven = group.length - wins - losses;
      const returns = group.map(report => finite(report?.performance?.returnPct)).filter((value): value is number => value != null);
      const pnls = group.map(report => finite(report?.performance?.realizedPnl)).filter((value): value is number => value != null);
      return {
        key,
        label: labelOf(key),
        totalTrades: group.length,
        wins,
        losses,
        breakeven,
        winRate: group.length ? wins / group.length : null,
        averageReturnPct: returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null,
        netPnl: pnls.length ? pnls.reduce((sum, value) => sum + value, 0) : null,
        sampleTradeIds: group.slice(0, 5).map(report => report.tradeId).filter(Boolean),
      };
    })
    .sort((a, b) => b.totalTrades - a.totalTrades || String(a.key).localeCompare(String(b.key)));
}

async function recentTradeReports(limit = 500) {
  return TradeReportModel.find({ status: 'GENERATED' })
    .sort({ tradingDate: -1, createdAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 2000))
    .lean();
}

export async function getTradeReview(limit = 100) {
  const reports = await recentTradeReports(limit);
  return {
    generatedAt: new Date().toISOString(),
    totalTrades: reports.length,
    reviews: reports.map((report: any) => ({
      tradeId: report.tradeId,
      reportId: report.reportId,
      tradingDate: report.tradingDate,
      symbol: report.identity?.underlying ?? null,
      contract: report.identity?.optionSymbol ?? null,
      strategy: report.identity?.strategy ?? report.identity?.strategyVersionId ?? null,
      outcome: classifyTrade(report),
      returnPct: finite(report.performance?.returnPct),
      realizedPnl: finite(report.performance?.realizedPnl),
      confidence: finite(report.signal?.confidence),
      overallGrade: report.grades?.overall?.grade ?? null,
      lessons: report.lessons ?? { strengths: [], weaknesses: [], improvementSuggestions: [] },
    })),
  };
}

export async function getConfidenceCalibration(limit = 500) {
  const reports = await recentTradeReports(limit);
  const buckets = bucketReports(reports, report => {
    const confidence = finite(report?.signal?.confidence);
    if (confidence == null) return 'UNAVAILABLE';
    if (confidence < 0.4) return '0.00-0.39';
    if (confidence < 0.6) return '0.40-0.59';
    if (confidence < 0.75) return '0.60-0.74';
    if (confidence < 0.9) return '0.75-0.89';
    return '0.90-1.00';
  });
  return {
    generatedAt: new Date().toISOString(),
    buckets,
    explanation: 'Compares entry confidence bands with realized paper outcomes from persisted trade reports.',
  };
}

export async function getStrategyScorecards(limit = 500) {
  const reports = await recentTradeReports(limit);
  return {
    generatedAt: new Date().toISOString(),
    scorecards: bucketReports(reports, report => report.identity?.strategy ?? report.identity?.strategyVersionId ?? null),
  };
}

export async function getLearningDataset(limit = 500) {
  const [reports, decisions] = await Promise.all([
    recentTradeReports(limit),
    DecisionJournalModel.find({})
      .sort({ timestamp: -1 })
      .limit(Math.min(Math.max(limit, 1), 2000))
      .lean(),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    tradeExamples: reports.map((report: any) => ({
      tradeId: report.tradeId,
      symbol: report.identity?.underlying ?? null,
      strategy: report.identity?.strategy ?? report.identity?.strategyVersionId ?? null,
      marketRegime: report.marketContext?.marketRegime ?? null,
      eventIds: report.evidence?.eventIds ?? [],
      confidence: finite(report.signal?.confidence),
      flowScore: finite(report.signal?.flowScore),
      riskApproved: report.signal?.riskApproved ?? null,
      riskReasonCodes: report.signal?.riskReasonCodes ?? [],
      outcome: classifyTrade(report),
      returnPct: finite(report.performance?.returnPct),
    })),
    decisionExamples: decisions.map((decision: any) => ({
      decisionId: decision.decisionId,
      tradeId: decision.tradeId ?? null,
      timestamp: decision.timestamp,
      symbol: decision.context?.symbol ?? null,
      strategy: decision.context?.strategy ?? null,
      marketRegime: decision.context?.marketRegime ?? decision.evaluation?.marketRegime ?? null,
      action: decision.decision?.decision ?? null,
      approved: decision.decision?.approved ?? null,
      reasonCodes: decision.decision?.reasonCodes ?? [],
      confidence: finite(decision.evaluation?.confidence),
    })),
  };
}

export async function getHistoricalPerformance(limit = 500) {
  const reports = await recentTradeReports(limit);
  return {
    generatedAt: new Date().toISOString(),
    performance: bucketReports(reports, report => report.tradingDate ?? null),
  };
}

export async function getMarketRegimePerformance(limit = 500) {
  const reports = await recentTradeReports(limit);
  return { generatedAt: new Date().toISOString(), performance: bucketReports(reports, report => report.marketContext?.marketRegime ?? null) };
}

export async function getEventPerformance(limit = 500) {
  const reports = await recentTradeReports(limit);
  const expanded = reports.flatMap((report: any) => (report.evidence?.eventIds ?? ['UNAVAILABLE']).map((eventId: string) => ({ ...report, eventId })));
  return { generatedAt: new Date().toISOString(), performance: bucketReports(expanded, report => report.eventId ?? null) };
}

export async function getSectorPerformance(limit = 500) {
  const reports = await recentTradeReports(limit);
  return {
    generatedAt: new Date().toISOString(),
    performance: bucketReports(reports, report => String(report.marketContext?.sectorContext?.sector ?? report.marketContext?.sectorContext?.name ?? 'UNAVAILABLE')),
  };
}

export async function getFedPerformance(limit = 500) {
  const reports = await recentTradeReports(limit);
  const fedReports = reports.filter((report: any) => {
    const haystack = JSON.stringify([report.marketContext, report.lessons, report.evidence?.eventIds]).toLowerCase();
    return haystack.includes('fed') || haystack.includes('fomc') || haystack.includes('federal reserve');
  });
  return { generatedAt: new Date().toISOString(), performance: bucketReports(fedReports, report => report.marketContext?.marketRegime ?? 'FED_EVENT') };
}

export async function getOptionsFlowPerformance(limit = 500) {
  const reports = await recentTradeReports(limit);
  return {
    generatedAt: new Date().toISOString(),
    performance: bucketReports(reports, report => {
      const score = finite(report.signal?.flowScore);
      if (score == null) return 'UNAVAILABLE';
      if (score < 0.4) return 'WEAK_FLOW';
      if (score < 0.7) return 'MODERATE_FLOW';
      return 'STRONG_FLOW';
    }),
  };
}
