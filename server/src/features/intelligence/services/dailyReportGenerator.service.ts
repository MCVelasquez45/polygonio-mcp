import { writeStructuredLog } from '../../../shared/logging/safeLogging';
import { TradingSessionModel } from '../models/tradingSession.model';
import { TradeReportModel, type TradeReportDocument } from '../models/tradeReport.model';
import {
  DailyReportModel,
  type DailyGradeBreakdown,
  type DailyReportDocument,
  type DailyReportGrade,
  type DailyReportHydratedDocument,
  type DailyReportTimelineEvent,
  type DailyReportWarning,
} from '../models/dailyReport.model';

const GENERATOR_VERSION = 'daily-report-generator-v1';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type GenerationResult = {
  report: DailyReportHydratedDocument;
  idempotent: boolean;
};

type DailySource = {
  session: any;
  tradeReports: any[];
  warnings: DailyReportWarning[];
};

function assertTradingDate(value: string): void {
  if (!DATE_RE.test(value)) {
    throw Object.assign(new Error('tradingDate must be YYYY-MM-DD'), { status: 400 });
  }
}

function dailyReportId(sessionId: string): string {
  return `daily:${sessionId}`;
}

function warning(code: string, message: string, source: string | null = null): DailyReportWarning {
  return { code, message, source };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round(value: number | null, decimals = 4): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

function roundCurrency(value: number | null): number | null {
  return round(value, 2);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]): number | null {
  return values.length ? sum(values) / values.length : null;
}

function gradeToScore(grade: string | null | undefined): number | null {
  switch (grade) {
    case 'A+':
      return 98;
    case 'A':
      return 94;
    case 'A-':
      return 91;
    case 'B+':
      return 88;
    case 'B':
      return 84;
    case 'B-':
      return 81;
    case 'C+':
      return 78;
    case 'C':
      return 74;
    case 'C-':
      return 71;
    case 'D':
      return 64;
    case 'F':
      return 50;
    default:
      return null;
  }
}

function scoreToGrade(score: number | null): DailyReportGrade {
  if (score == null) return 'UNAVAILABLE';
  if (score >= 97) return 'A+';
  if (score >= 93) return 'A';
  if (score >= 90) return 'A-';
  if (score >= 87) return 'B+';
  if (score >= 83) return 'B';
  if (score >= 80) return 'B-';
  if (score >= 77) return 'C+';
  if (score >= 73) return 'C';
  if (score >= 70) return 'C-';
  if (score >= 60) return 'D';
  return 'F';
}

function clampScore(score: number): number {
  return Math.min(100, Math.max(0, Math.round(score)));
}

function grade(score: number | null, reasons: string[], unavailableInputs: string[] = []): DailyGradeBreakdown {
  return {
    grade: scoreToGrade(score),
    score: score == null ? null : clampScore(score),
    reasons,
    unavailableInputs,
  };
}

function largestByPnl(reports: any[], predicate: (value: number) => boolean, direction: 'max' | 'min') {
  const candidates = reports
    .map(report => ({ report, pnl: numberOrNull(report.performance?.realizedPnl) }))
    .filter((item): item is { report: any; pnl: number } => item.pnl != null && predicate(item.pnl));
  if (!candidates.length) return null;
  candidates.sort((a, b) => (direction === 'max' ? b.pnl - a.pnl : a.pnl - b.pnl));
  const winner = candidates[0];
  return {
    tradeReportId: winner.report.reportId,
    underlying: winner.report.identity.underlying,
    realizedPnl: roundCurrency(winner.pnl) ?? winner.pnl,
  };
}

function buildExecutionGrade(session: any, reports: any[]): DailyGradeBreakdown {
  const reasons: string[] = [];
  const unavailable: string[] = [];
  let score = 78;
  const orders = numberOrNull(session.orderSummary?.ordersSubmitted) ?? 0;
  const fills = numberOrNull(session.orderSummary?.fills) ?? 0;
  const partials = numberOrNull(session.orderSummary?.partialFills) ?? 0;
  const rejects = numberOrNull(session.orderSummary?.rejections) ?? 0;
  const cancels = numberOrNull(session.orderSummary?.cancellations) ?? 0;
  const retryCount = reports.reduce((total, report) => total + (numberOrNull(report.execution?.retryCount) ?? 0), 0);

  if (orders > 0) {
    const fillRate = fills / orders;
    if (fillRate >= 0.9) {
      score += 8;
      reasons.push('Broker fill rate was high from captured order evidence.');
    } else if (fillRate < 0.5) {
      score -= 12;
      reasons.push('Broker fill rate was low from captured order evidence.');
    } else {
      reasons.push('Broker fill rate was mixed from captured order evidence.');
    }
  } else {
    unavailable.push('submitted orders');
  }
  if (partials > 0) {
    score -= Math.min(10, partials * 4);
    reasons.push(`${partials} partial fill(s) were captured.`);
  }
  if (rejects > 0) {
    score -= Math.min(16, rejects * 8);
    reasons.push(`${rejects} rejection(s) were captured.`);
  }
  if (cancels > 0) {
    score -= Math.min(8, cancels * 2);
    reasons.push(`${cancels} cancellation(s) were captured.`);
  }
  if (retryCount > reports.length) {
    score -= Math.min(12, retryCount - reports.length);
    reasons.push(`${retryCount} execution retry attempt(s) were captured.`);
  }
  if (!reasons.length) reasons.push('No adverse execution evidence was captured.');
  return grade(clampScore(score), reasons, unavailable);
}

function buildRiskGrade(reports: any[]): DailyGradeBreakdown {
  const reasons: string[] = [];
  const unavailable: string[] = [];
  if (!reports.length) return grade(null, [], ['trade reports']);
  let score = 82;
  const approved = reports.filter(report => report.signal?.riskApproved === true).length;
  const missingRisk = reports.filter(report => report.signal?.riskApproved == null).length;
  const overnight = reports.filter(report => report.lifecycle?.overnightRecoveryRequired || report.lifecycle?.exitReason === 'OVERNIGHT_RECOVERY').length;
  if (approved === reports.length) {
    score += 8;
    reasons.push('All generated trade reports have risk approval evidence.');
  } else if (approved > 0) {
    reasons.push(`${approved} of ${reports.length} trade report(s) have risk approval evidence.`);
  }
  if (missingRisk > 0) {
    score -= missingRisk * 8;
    unavailable.push('risk approval evidence');
  }
  if (overnight > 0) {
    score -= overnight * 14;
    reasons.push(`${overnight} trade(s) required overnight recovery.`);
  }
  return grade(clampScore(score), reasons, unavailable);
}

function buildMarketGrade(session: any, reports: any[]): DailyGradeBreakdown {
  const reasons: string[] = [];
  const unavailable: string[] = [];
  let score = 72;
  if (session.marketStatus && session.marketStatus !== 'UNAVAILABLE') {
    score += 6;
    reasons.push(`Session market status was captured as ${session.marketStatus}.`);
  } else {
    unavailable.push('session market status');
  }
  const marketScores = reports
    .map(report => numberOrNull(report.grades?.market?.score) ?? gradeToScore(report.grades?.market?.grade))
    .filter((value): value is number => value != null);
  if (marketScores.length) {
    const avg = average(marketScores) ?? 0;
    score = (score + avg) / 2;
    reasons.push(`Averaged ${marketScores.length} trade-level market grade(s).`);
  } else {
    unavailable.push('trade-level market grades');
  }
  if (reports.some(report => !report.marketContext?.spyContext && !report.marketContext?.vixContext)) {
    score -= 4;
    reasons.push('SPY/VIX context was not available in trade reports.');
  }
  return grade(clampScore(score), reasons, unavailable);
}

function buildTradeQualityGrade(reports: any[]): DailyGradeBreakdown {
  if (!reports.length) return grade(null, [], ['trade reports']);
  const scores = reports
    .map(report => numberOrNull(report.grades?.overall?.score) ?? gradeToScore(report.grades?.overall?.grade))
    .filter((value): value is number => value != null);
  if (!scores.length) return grade(null, [], ['trade report overall grades']);
  return grade(clampScore(average(scores) ?? 0), [`Average of ${scores.length} trade report overall grade(s).`], []);
}

function buildPerformanceGrade(netPnl: number | null, wins: number, losses: number, profitFactor: number | null): DailyGradeBreakdown {
  const reasons: string[] = [];
  const unavailable: string[] = [];
  if (netPnl == null) return grade(null, [], ['net P/L']);
  let score = 75;
  if (netPnl > 0) {
    score += 12;
    reasons.push('Net realized P/L was positive.');
  } else if (netPnl < 0) {
    score -= 12;
    reasons.push('Net realized P/L was negative.');
  } else {
    reasons.push('Net realized P/L was breakeven.');
  }
  const closed = wins + losses;
  if (closed > 0) {
    const winRate = wins / closed;
    if (winRate >= 0.6) score += 6;
    else if (winRate < 0.4) score -= 6;
    reasons.push(`Win rate from generated reports was ${(winRate * 100).toFixed(0)}%.`);
  }
  if (profitFactor != null) {
    if (profitFactor >= 1.5) score += 6;
    else if (profitFactor < 1) score -= 6;
    reasons.push(`Profit factor was ${profitFactor.toFixed(2)}.`);
  } else {
    unavailable.push('profit factor');
  }
  return grade(clampScore(score), reasons, unavailable);
}

function buildEvidenceGrade(availableEvidencePercent: number, missingEvidence: string[]): DailyGradeBreakdown {
  const reasons = [`Evidence availability score was ${availableEvidencePercent.toFixed(0)}%.`];
  const unavailable = missingEvidence.slice(0, 10);
  return grade(clampScore(availableEvidencePercent), reasons, unavailable);
}

function overallGrade(grades: DailyGradeBreakdown[]): DailyGradeBreakdown {
  const scores = grades.map(item => item.score).filter((value): value is number => typeof value === 'number');
  if (!scores.length) return grade(null, [], ['daily grade inputs']);
  return grade(clampScore(average(scores) ?? 0), [`Average of ${scores.length} deterministic daily component grade(s).`], []);
}

function buildEvidenceQuality(session: any, reports: any[], warnings: DailyReportWarning[]) {
  const missingEvidence = new Set<string>();
  const checks: boolean[] = [];
  const expectedClosedTrades = numberOrNull(session.tradeSummary?.tradesClosed) ?? 0;
  const generatedTradeReports = reports.length;

  checks.push(session.status === 'FINALIZED');
  if (session.status !== 'FINALIZED') missingEvidence.add('finalized trading session');
  checks.push(session.marketStatus && session.marketStatus !== 'UNAVAILABLE');
  if (!session.marketStatus || session.marketStatus === 'UNAVAILABLE') missingEvidence.add('market status');
  checks.push(generatedTradeReports === expectedClosedTrades);
  if (generatedTradeReports !== expectedClosedTrades) missingEvidence.add('complete trade reports for closed trades');
  checks.push(session.portfolioSnapshot != null);
  if (!session.portfolioSnapshot) missingEvidence.add('portfolio snapshot');
  for (const report of reports) {
    checks.push(report.performance?.realizedPnl != null);
    if (report.performance?.realizedPnl == null) missingEvidence.add(`realized P/L for ${report.identity?.underlying ?? report.reportId}`);
    checks.push(report.performance?.entryPrice != null);
    if (report.performance?.entryPrice == null) missingEvidence.add(`entry price for ${report.identity?.underlying ?? report.reportId}`);
    checks.push(report.performance?.exitPrice != null);
    if (report.performance?.exitPrice == null) missingEvidence.add(`exit price for ${report.identity?.underlying ?? report.reportId}`);
    checks.push(report.lifecycle?.exitReason != null);
    if (!report.lifecycle?.exitReason) missingEvidence.add(`exit reason for ${report.identity?.underlying ?? report.reportId}`);
    checks.push(Array.isArray(report.timeline) && report.timeline.length > 0);
    if (!report.timeline?.length) missingEvidence.add(`timeline for ${report.identity?.underlying ?? report.reportId}`);
    for (const reportWarning of report.warnings ?? []) {
      warnings.push(warning(reportWarning.code, reportWarning.message, reportWarning.source ?? report.reportId));
      missingEvidence.add(reportWarning.code);
    }
  }
  const available = checks.length ? checks.filter(Boolean).length / checks.length : 0;
  return {
    availableEvidencePercent: Math.round(available * 100),
    expectedClosedTrades,
    generatedTradeReports,
    missingEvidence: [...missingEvidence].sort(),
    warnings,
  };
}

function buildTimeline(session: any, reports: any[]): DailyReportTimelineEvent[] {
  const timeline: DailyReportTimelineEvent[] = [];
  const push = (
    at: Date | string | null | undefined,
    label: string,
    source: string,
    sourceId: string | null,
    severity: 'info' | 'warning' | 'critical' = 'info'
  ) => {
    if (!at) return;
    const date = at instanceof Date ? at : new Date(at);
    if (Number.isNaN(date.getTime())) return;
    timeline.push({ at: date, label, source, sourceId, severity });
  };
  push(session.startedAt, 'Trading session started', 'TradingSession', session.sessionId, 'info');
  for (const report of reports) {
    push(report.lifecycle?.openedAt, `${report.identity.underlying} opened`, 'TradeReport', report.reportId, 'info');
    push(
      report.lifecycle?.closedAt,
      `${report.identity.underlying} closed ${report.performance?.realizedPnl < 0 ? 'at a loss' : 'profitably'}`,
      'TradeReport',
      report.reportId,
      report.performance?.realizedPnl < 0 ? 'warning' : 'info'
    );
  }
  push(session.finalizedAt, 'Trading session finalized', 'TradingSession', session.sessionId, 'info');
  return timeline.sort((a, b) => a.at.getTime() - b.at.getTime() || a.label.localeCompare(b.label)).slice(0, 100);
}

function formatMoney(value: number | null): string {
  if (value == null) return 'unavailable';
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function buildExecutiveSummary(args: {
  session: any;
  reports: any[];
  overall: DailyGradeBreakdown;
  netPnl: number | null;
  largestWinner: DailyReportDocument['performance']['largestWinner'];
  largestLoser: DailyReportDocument['performance']['largestLoser'];
  warnings: DailyReportWarning[];
}) {
  const { session, reports, overall, netPnl, largestWinner, largestLoser, warnings } = args;
  const trades = reports.length;
  const wins = reports.filter(report => (report.performance?.realizedPnl ?? 0) > 0).length;
  const losses = reports.filter(report => (report.performance?.realizedPnl ?? 0) < 0).length;
  const overnightLoser = reports.find(
    report => (report.performance?.realizedPnl ?? 0) < 0 && report.lifecycle?.exitReason === 'OVERNIGHT_RECOVERY'
  );
  const marketSummary =
    session.marketStatus && session.marketStatus !== 'UNAVAILABLE'
      ? `Market status captured as ${session.marketStatus}.`
      : 'Market status was not captured for this session.';
  const sessionSummary = `${trades} trade report(s), ${wins} win(s), ${losses} loss(es), net ${formatMoney(netPnl)}.`;
  const primaryLesson = overnightLoser
    ? 'Overnight exposure reduced performance.'
    : netPnl != null && netPnl > 0
      ? 'Profitable trades drove positive realized P/L.'
      : netPnl != null && netPnl < 0
        ? 'Loss control and exit quality require review before changing production rules.'
        : null;
  const bestDecision = largestWinner
    ? `${largestWinner.underlying} produced the strongest realized outcome.`
    : 'No profitable trade was captured.';
  const worstDecision = largestLoser
    ? `${largestLoser.underlying} produced the weakest realized outcome.`
    : 'No losing trade was captured.';
  const highlights = [
    `Daily grade ${overall.grade}.`,
    `Net P/L ${formatMoney(netPnl)}.`,
    largestWinner ? `Largest winner ${largestWinner.underlying} at ${formatMoney(largestWinner.realizedPnl)}.` : 'No winner captured.',
    largestLoser ? `Largest loser ${largestLoser.underlying} at ${formatMoney(largestLoser.realizedPnl)}.` : 'No loser captured.',
  ];
  const keyFindings = [
    sessionSummary,
    marketSummary,
    warnings.length ? `${warnings.length} evidence warning(s) require review.` : 'No daily evidence warnings were generated.',
  ];
  return {
    overallGrade: overall.grade,
    marketSummary,
    sessionSummary,
    primaryLesson,
    bestDecision,
    worstDecision,
    highlights,
    keyFindings,
  };
}

function buildDailyReportDocument(source: DailySource): Omit<DailyReportDocument, '_id' | 'createdAt' | 'updatedAt'> {
  const { session, tradeReports } = source;
  const warnings = [...source.warnings];
  const realizedValues = tradeReports
    .map(report => numberOrNull(report.performance?.realizedPnl))
    .filter((value): value is number => value != null);
  const winners = realizedValues.filter(value => value > 0);
  const losers = realizedValues.filter(value => value < 0);
  const realizedPnlFromReports = realizedValues.length ? roundCurrency(sum(realizedValues)) : null;
  const sessionRealizedPnl = numberOrNull(session.tradeSummary?.realizedPnl);
  const realizedPnl = realizedPnlFromReports ?? sessionRealizedPnl;
  const unrealizedPnl = numberOrNull(session.tradeSummary?.unrealizedPnlAtClose);
  const netPnl = numberOrNull(session.tradeSummary?.totalPnl) ?? (realizedPnl == null ? null : roundCurrency(realizedPnl + (unrealizedPnl ?? 0)));
  const largestWinner = largestByPnl(tradeReports, value => value > 0, 'max');
  const largestLoser = largestByPnl(tradeReports, value => value < 0, 'min');
  const averageWinner = roundCurrency(average(winners));
  const averageLoser = roundCurrency(average(losers));
  const grossProfit = sum(winners);
  const grossLoss = Math.abs(sum(losers));
  const profitFactor = grossLoss > 0 ? round(grossProfit / grossLoss, 4) : winners.length ? null : null;
  const expectancy = realizedValues.length ? roundCurrency(sum(realizedValues) / realizedValues.length) : null;
  const holdTimes = tradeReports
    .map(report => numberOrNull(report.lifecycle?.holdTimeMinutes))
    .filter((value): value is number => value != null);
  const averageHoldTimeMinutes = holdTimes.length ? Math.round(average(holdTimes) ?? 0) : null;
  const reportCountMismatch = tradeReports.length !== (session.tradeSummary?.tradesClosed ?? 0);
  if (reportCountMismatch) {
    warnings.push(
      warning(
        'TRADE_REPORT_COUNT_MISMATCH',
        `Session expected ${session.tradeSummary?.tradesClosed ?? 0} closed trade report(s), but ${tradeReports.length} were found.`,
        'TradeReport'
      )
    );
  }
  if (!session.portfolioSnapshot) {
    warnings.push(warning('PORTFOLIO_SNAPSHOT_NOT_CAPTURED', 'Portfolio snapshot was not captured for this session.', 'TradingSession'));
  }

  const evidenceQuality = buildEvidenceQuality(session, tradeReports, warnings);
  const retryCount = tradeReports.reduce((total, report) => total + (numberOrNull(report.execution?.retryCount) ?? 0), 0);
  const ordersSubmitted = numberOrNull(session.orderSummary?.ordersSubmitted) ?? 0;
  const fills = numberOrNull(session.orderSummary?.fills) ?? 0;
  const fillRate = ordersSubmitted > 0 ? round(fills / ordersSubmitted, 4) : null;
  const equity = numberOrNull(session.portfolioSnapshot?.equity);
  const buyingPower = numberOrNull(session.portfolioSnapshot?.buyingPower);
  const drawdowns = tradeReports
    .map(report => numberOrNull(report.performance?.drawdown ?? report.performance?.maxAdverseExcursion))
    .filter((value): value is number => value != null);
  const drawdown = drawdowns.length ? roundCurrency(Math.min(...drawdowns)) : null;
  const capitalEfficiency = buyingPower && netPnl != null ? round(netPnl / buyingPower, 4) : null;

  const execution = buildExecutionGrade(session, tradeReports);
  const risk = buildRiskGrade(tradeReports);
  const market = buildMarketGrade(session, tradeReports);
  const tradeQuality = buildTradeQualityGrade(tradeReports);
  const performance = buildPerformanceGrade(netPnl, winners.length, losers.length, profitFactor);
  const evidence = buildEvidenceGrade(evidenceQuality.availableEvidencePercent, evidenceQuality.missingEvidence);
  const overall = overallGrade([execution, risk, market, tradeQuality, performance, evidence]);
  const executiveSummary = buildExecutiveSummary({
    session,
    reports: tradeReports,
    overall,
    netPnl,
    largestWinner,
    largestLoser,
    warnings: evidenceQuality.warnings,
  });

  return {
    reportId: dailyReportId(session.sessionId),
    sessionId: session.sessionId,
    tradingDate: session.tradingDate,
    environment: session.environment,
    status: 'GENERATED',
    executiveSummary,
    tradingSummary: {
      watchlistSize: numberOrNull(session.watchlist?.size) ?? 0,
      symbolsEvaluated: numberOrNull(session.evaluationSummary?.symbolsEvaluated) ?? 0,
      signalsGenerated: numberOrNull(session.evaluationSummary?.signalsGenerated) ?? 0,
      signalsApproved: numberOrNull(session.evaluationSummary?.approvedCount) ?? 0,
      signalsRejected:
        (numberOrNull(session.evaluationSummary?.riskRejectCount) ?? 0) +
        (numberOrNull(session.evaluationSummary?.dataRejectCount) ?? 0),
      riskRejects: numberOrNull(session.evaluationSummary?.riskRejectCount) ?? 0,
      dataRejects: numberOrNull(session.evaluationSummary?.dataRejectCount) ?? 0,
      tradesOpened: numberOrNull(session.tradeSummary?.tradesOpened) ?? 0,
      tradesClosed: numberOrNull(session.tradeSummary?.tradesClosed) ?? 0,
      wins: winners.length || (numberOrNull(session.tradeSummary?.winningTrades) ?? 0),
      losses: losers.length || (numberOrNull(session.tradeSummary?.losingTrades) ?? 0),
      breakeven: tradeReports.filter(report => report.performance?.realizedPnl === 0).length || (numberOrNull(session.tradeSummary?.breakevenTrades) ?? 0),
    },
    performance: {
      realizedPnl,
      unrealizedPnl,
      netPnl,
      averageWinner,
      averageLoser,
      largestWinner,
      largestLoser,
      averageHoldTimeMinutes,
      profitFactor,
      expectancy,
    },
    capital: {
      equity,
      cash: numberOrNull(session.portfolioSnapshot?.cash),
      buyingPower,
      drawdown,
      capitalEfficiency,
    },
    execution: {
      ordersSubmitted,
      fills,
      partialFills: numberOrNull(session.orderSummary?.partialFills) ?? 0,
      cancelled: numberOrNull(session.orderSummary?.cancellations) ?? 0,
      rejected: numberOrNull(session.orderSummary?.rejections) ?? 0,
      timeouts: null,
      retryCount,
      fillRate,
    },
    market: {
      marketStatus: session.marketStatus === 'UNAVAILABLE' ? null : session.marketStatus,
      marketRegime:
        tradeReports.map(report => report.marketContext?.marketRegime).find((value: unknown) => typeof value === 'string' && value) ?? null,
      spyTrend: null,
      vix: null,
      sectorLeadership: null,
    },
    grades: { execution, risk, market, tradeQuality, performance, evidence, overall },
    evidenceQuality,
    tradeReports: tradeReports.map(report => ({
      reportId: report.reportId,
      tradeId: report.tradeId,
      underlying: report.identity.underlying,
      direction: report.identity.direction,
      realizedPnl: numberOrNull(report.performance?.realizedPnl),
      overallGrade: report.grades?.overall?.grade ?? 'UNAVAILABLE',
      exitReason: report.lifecycle?.exitReason ?? null,
    })),
    tradeReportIds: tradeReports.map(report => report.reportId).sort(),
    sessionReference: {
      sessionId: session.sessionId,
      tradingDate: session.tradingDate,
      status: session.status,
    },
    timeline: buildTimeline(session, tradeReports),
    warnings: evidenceQuality.warnings,
    generation: {
      schemaVersion: 1,
      generatorVersion: GENERATOR_VERSION,
      generatedBy: 'server:intelligence:daily-report-generator',
      generatedAt: new Date(),
      generatedFromPersistedEvidence: true,
    },
  };
}

async function loadDailySource(sessionId: string): Promise<DailySource> {
  const session = await TradingSessionModel.findOne({ sessionId }).lean();
  if (!session) throw Object.assign(new Error('Trading session not found'), { status: 404 });
  const tradeReports = await TradeReportModel.find({ sessionId }).sort({ 'lifecycle.closedAt': 1, updatedAt: 1 }).lean();
  return { session, tradeReports, warnings: [] };
}

export async function generateDailyReportForSession(sessionId: string): Promise<GenerationResult> {
  const existing = await DailyReportModel.findOne({
    $or: [{ sessionId }, { reportId: dailyReportId(sessionId) }],
  });
  if (existing) return { report: existing, idempotent: true };
  const source = await loadDailySource(sessionId);
  const doc = buildDailyReportDocument(source);
  try {
    const report = await DailyReportModel.create(doc);
    writeStructuredLog({
      component: 'intelligence',
      module: 'daily-report-generator',
      event: 'DAILY_REPORT_GENERATED',
      severity: 'info',
      sessionId: report.sessionId,
      context: {
        reportId: report.reportId,
        tradingDate: report.tradingDate,
        netPnl: report.performance.netPnl,
        tradesClosed: report.tradingSummary.tradesClosed,
        overallGrade: report.grades.overall.grade,
      },
    });
    return { report, idempotent: false };
  } catch (error: any) {
    if (error?.code === 11000) {
      const raced = await DailyReportModel.findOne({ sessionId });
      if (raced) return { report: raced, idempotent: true };
    }
    throw error;
  }
}

export async function backfillDailyReportsForDate(tradingDate: string): Promise<GenerationResult[]> {
  assertTradingDate(tradingDate);
  const sessions = await TradingSessionModel.find({ tradingDate }).sort({ updatedAt: -1 }).lean();
  if (!sessions.length) throw Object.assign(new Error('Trading session not found for date'), { status: 404 });
  const results: GenerationResult[] = [];
  for (const session of sessions) {
    results.push(await generateDailyReportForSession(session.sessionId));
  }
  return results;
}

export async function listDailyReports(limit = 50): Promise<DailyReportHydratedDocument[]> {
  return DailyReportModel.find()
    .sort({ tradingDate: -1, updatedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 200));
}

export async function getLatestDailyReport(): Promise<DailyReportHydratedDocument | null> {
  return DailyReportModel.findOne().sort({ tradingDate: -1, updatedAt: -1 });
}

export async function getDailyReportById(id: string): Promise<DailyReportHydratedDocument | null> {
  return DailyReportModel.findOne({ $or: [{ reportId: id }, { sessionId: id }] });
}

export async function getDailyReportsByDate(tradingDate: string): Promise<DailyReportHydratedDocument[]> {
  assertTradingDate(tradingDate);
  return DailyReportModel.find({ tradingDate }).sort({ updatedAt: -1 });
}
