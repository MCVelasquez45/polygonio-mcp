import { DecisionJournalModel } from '../../intelligence/models/decisionJournal.model';
import { TradeReportModel, type TradeReportDocument } from '../../intelligence/models/tradeReport.model';
import { LearningDatasetModel } from '../storage/learningDataset.model';
import { LearningTradeReviewModel, type LearningTradeReviewDocument } from '../storage/learningTradeReview.model';
import type { LearningDatasetRecord, LearningOutcome, LearningTradeReview } from '../types/learningTypes';

const REVIEW_SCHEMA_VERSION = 1;
const DATASET_SCHEMA_VERSION = 1;
const MAX_LIMIT = 2000;

function finite(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function avg(values: Array<number | null | undefined>): number | null {
  const filtered = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return filtered.length ? filtered.reduce((sum, value) => sum + value, 0) / filtered.length : null;
}

function text(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function includesAny(haystack: string, words: string[]): boolean {
  const lower = haystack.toLowerCase();
  return words.some(word => lower.includes(word));
}

function classifyOutcome(report: Pick<TradeReportDocument, 'performance'>): LearningOutcome {
  const realizedPnl = finite(report.performance?.realizedPnl);
  const actualReturn = finite(report.performance?.returnPct);
  const basis = realizedPnl ?? actualReturn;
  if (basis == null) return 'UNKNOWN';
  if (basis > 0 && actualReturn != null && actualReturn < 0.5) return 'PARTIAL_WIN';
  if (basis > 0) return 'WIN';
  if (basis < 0) return 'LOSS';
  return 'BREAKEVEN';
}

function deriveEventLabel(report: TradeReportDocument, kind: 'fed' | 'news'): string | null {
  const haystack = text([report.evidence?.eventIds, report.marketContext, report.lessons, report.timeline]);
  if (kind === 'fed' && includesAny(haystack, ['fed', 'fomc', 'federal reserve', 'powell'])) return 'FED';
  if (kind === 'news' && includesAny(haystack, ['news', 'headline', 'breaking', 'earnings', 'cpi', 'ppi', 'jobs', 'oil'])) {
    if (includesAny(haystack, ['cpi'])) return 'CPI';
    if (includesAny(haystack, ['ppi'])) return 'PPI';
    if (includesAny(haystack, ['jobs', 'payroll'])) return 'JOBS';
    if (includesAny(haystack, ['oil', 'crude', 'energy'])) return 'OIL';
    if (includesAny(haystack, ['earnings'])) return 'EARNINGS';
    return 'BREAKING_NEWS';
  }
  return null;
}

function deriveSector(report: TradeReportDocument): string | null {
  const sectorContext = report.marketContext?.sectorContext as Record<string, unknown> | null;
  const candidate =
    sectorContext?.sector ??
    sectorContext?.name ??
    sectorContext?.label ??
    sectorContext?.symbol ??
    null;
  return typeof candidate === 'string' && candidate.trim() ? candidate : null;
}

function deriveEvidenceScore(report: TradeReportDocument): number | null {
  return avg([
    finite(report.signal?.flowScore),
    finite(report.signal?.momentumScore),
    finite(report.signal?.trendScore),
    finite(report.signal?.selectedContractScore),
  ]);
}

function firstReason(report: TradeReportDocument, fallback: string | null): string | null {
  return (
    report.grades?.entry?.reasons?.[0] ??
    report.grades?.market?.reasons?.[0] ??
    report.signal?.riskReasonCodes?.[0] ??
    fallback
  );
}

export function buildLearningTradeReview(report: TradeReportDocument): LearningTradeReview {
  const outcome = classifyOutcome(report);
  return {
    reviewId: `learning-review:${report.reportId}:v${REVIEW_SCHEMA_VERSION}`,
    schemaVersion: REVIEW_SCHEMA_VERSION,
    sourceReportId: report.reportId,
    sourceTradeId: report.tradeId,
    generatedAt: new Date(),
    entryTimestamp: report.lifecycle?.openedAt ?? null,
    exitTimestamp: report.lifecycle?.closedAt ?? null,
    entryStrategy: report.identity?.strategyVersionId ?? null,
    winningStrategy: report.identity?.strategy ?? report.identity?.strategyVersionId ?? null,
    marketRegime: report.marketContext?.marketRegime ?? report.marketContext?.trend ?? null,
    fedEvent: deriveEventLabel(report, 'fed'),
    newsEvent: deriveEventLabel(report, 'news'),
    sector: deriveSector(report),
    symbol: report.identity?.underlying ?? null,
    contract: report.identity?.optionSymbol ?? null,
    direction: report.identity?.direction ?? null,
    confidence: finite(report.signal?.confidence),
    evidenceScore: deriveEvidenceScore(report),
    riskScore: finite(report.signal?.riskScore),
    entryReason: firstReason(report, report.signal?.candidateStatus ?? null),
    exitReason: report.lifecycle?.exitReason ?? report.grades?.exit?.reasons?.[0] ?? null,
    maximumFavorableExcursion: finite(report.performance?.maxFavorableExcursion),
    maximumAdverseExcursion: finite(report.performance?.maxAdverseExcursion),
    holdingTimeMinutes: finite(report.lifecycle?.holdTimeMinutes),
    expectedReturn: finite((report.execution?.entryIntent as Record<string, unknown> | null)?.estimatedReward),
    actualReturn: finite(report.performance?.returnPct),
    realizedPnl: finite(report.performance?.realizedPnl),
    outcome,
    win: outcome === 'WIN',
    loss: outcome === 'LOSS',
    partialWin: outcome === 'PARTIAL_WIN',
    whySucceeded: report.lessons?.strengths ?? [],
    whyFailed: report.lessons?.weaknesses ?? [],
    whatCouldImprove: report.lessons?.improvementSuggestions ?? [],
    evidence: {
      eventIds: report.evidence?.eventIds ?? [],
      positionId: report.evidence?.positionId ?? null,
      riskDecisionId: report.evidence?.riskDecisionId ?? null,
      tradeCandidateId: report.evidence?.tradeCandidateId ?? null,
      contractSelectionId: report.evidence?.contractSelectionId ?? null,
      universeEvaluationIds: report.evidence?.universeEvaluationIds ?? [],
      tradeReportId: report.reportId,
    },
  };
}

export async function buildLearningDataset(report: TradeReportDocument): Promise<LearningDatasetRecord> {
  const decision = await DecisionJournalModel.findOne({
    $or: [{ tradeId: report.tradeId }, { reportId: report.reportId }],
  })
    .sort({ timestamp: -1 })
    .lean();
  const outcome = classifyOutcome(report);
  return {
    datasetId: `learning-dataset:${report.reportId}:v${DATASET_SCHEMA_VERSION}`,
    schemaVersion: DATASET_SCHEMA_VERSION,
    sourceReportId: report.reportId,
    sourceTradeId: report.tradeId,
    generatedAt: new Date(),
    version: `learning-dataset-v${DATASET_SCHEMA_VERSION}`,
    marketSnapshot: report.marketContext ?? null,
    technicalIndicators: {
      flowScore: report.signal?.flowScore ?? null,
      momentumScore: report.signal?.momentumScore ?? null,
      trendScore: report.signal?.trendScore ?? null,
      greeks: report.greeks ?? null,
    },
    massiveData: {
      liquidity: report.marketContext?.liquidity ?? null,
      underlyingPriceAtSelection: report.marketContext?.underlyingPriceAtSelection ?? null,
    },
    news: { fedEvent: deriveEventLabel(report, 'fed'), newsEvent: deriveEventLabel(report, 'news'), eventIds: report.evidence?.eventIds ?? [] },
    sentiment: report.marketContext?.sectorContext ?? null,
    eventIntelligence: { eventIds: report.evidence?.eventIds ?? [] },
    decisionIntelligence: decision ? {
      decisionId: decision.decisionId,
      action: decision.decision?.decision ?? null,
      reasonCodes: decision.decision?.reasonCodes ?? [],
      confidence: decision.evaluation?.confidence ?? null,
    } : null,
    strategyRankings: { strategy: report.identity?.strategy ?? null, strategyVersionId: report.identity?.strategyVersionId ?? null },
    riskPackage: {
      riskDecisionId: report.evidence?.riskDecisionId ?? null,
      riskApproved: report.signal?.riskApproved ?? null,
      riskScore: report.signal?.riskScore ?? null,
      riskReasonCodes: report.signal?.riskReasonCodes ?? [],
    },
    lifecycle: report.lifecycle ?? null,
    executionResult: report.execution ?? null,
    tradeEvaluation: {
      reportId: report.reportId,
      grades: report.grades,
      lessons: report.lessons,
      warnings: report.warnings,
    },
    outcome: {
      label: outcome,
      actualReturn: finite(report.performance?.returnPct),
      realizedPnl: finite(report.performance?.realizedPnl),
    },
  };
}

function limitValue(limit = 500): number {
  return Math.min(Math.max(Number.isFinite(limit) ? limit : 500, 1), MAX_LIMIT);
}

export async function synchronizeLearningArtifacts(limit = 500): Promise<{ scanned: number; reviewsCreated: number; datasetsCreated: number }> {
  const reports = await TradeReportModel.find({ status: 'GENERATED' })
    .sort({ tradingDate: -1, createdAt: -1 })
    .limit(limitValue(limit))
    .lean();

  let reviewsCreated = 0;
  let datasetsCreated = 0;
  for (const report of reports) {
    const review = buildLearningTradeReview(report as TradeReportDocument);
    try {
      await LearningTradeReviewModel.create(review);
      reviewsCreated += 1;
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
    }
    const dataset = await buildLearningDataset(report as TradeReportDocument);
    try {
      await LearningDatasetModel.create(dataset);
      datasetsCreated += 1;
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
    }
  }

  return { scanned: reports.length, reviewsCreated, datasetsCreated };
}

export async function getLearningStatus() {
  const [completedTrades, reviews, datasets, latestReview] = await Promise.all([
    TradeReportModel.countDocuments({ status: 'GENERATED' }),
    LearningTradeReviewModel.countDocuments({}),
    LearningDatasetModel.countDocuments({}),
    LearningTradeReviewModel.findOne({}).sort({ generatedAt: -1 }).lean(),
  ]);
  const pendingReviews = Math.max(0, completedTrades - reviews);
  const pendingDatasets = Math.max(0, completedTrades - datasets);
  return {
    status: pendingReviews || pendingDatasets ? 'LEARNING_PENDING' : 'CURRENT',
    generatedAt: new Date().toISOString(),
    completedTrades,
    tradeReviews: reviews,
    datasets,
    pendingReviews,
    pendingDatasets,
    latestReviewAt: latestReview?.generatedAt ?? null,
    explanation:
      completedTrades === 0
        ? 'No completed trade reports are available for learning yet.'
        : pendingReviews || pendingDatasets
          ? 'Learning has completed trade reports waiting for artifact generation.'
          : 'Learning artifacts are current with completed trade reports.',
  };
}

export async function listLearningTradeReviews(limit = 100): Promise<LearningTradeReviewDocument[]> {
  return LearningTradeReviewModel.find({})
    .sort({ exitTimestamp: -1, generatedAt: -1 })
    .limit(limitValue(limit))
    .lean();
}

export async function listLearningDatasets(limit = 100) {
  return LearningDatasetModel.find({})
    .sort({ generatedAt: -1 })
    .limit(limitValue(limit))
    .lean();
}
