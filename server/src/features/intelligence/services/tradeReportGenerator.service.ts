import mongoose from 'mongoose';
import { writeStructuredLog } from '../../../shared/logging/safeLogging';
import { AutomationEventModel } from '../../automation/models/automationEvent.model';
import { AutomationPositionModel } from '../../automation/models/automationPosition.model';
import { BrokerOrderModel } from '../../automation/models/brokerOrder.model';
import { ContractSelectionModel, type RankedContract } from '../../automation/models/contractSelection.model';
import { OrderIntentModel } from '../../automation/models/orderIntent.model';
import { RiskDecisionModel } from '../../automation/models/riskDecision.model';
import { TradeCandidateModel } from '../../automation/models/tradeCandidate.model';
import { UniverseEvaluationModel } from '../../automation/models/universeEvaluation.model';
import { exchangeTradingDate } from '../../automation/services/sessionDailyReset.service';
import { TradingSessionModel } from '../models/tradingSession.model';
import {
  TradeReportModel,
  type GradeBreakdown,
  type TradeReportDocument,
  type TradeReportGrade,
  type TradeReportHydratedDocument,
  type TradeReportWarning,
  type TradeTimelineEvent,
} from '../models/tradeReport.model';

const GENERATOR_VERSION = 'trade-report-generator-v1';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OPTION_MULTIPLIER = 100;

type GenerationResult = {
  report: TradeReportHydratedDocument;
  idempotent: boolean;
};

type EvidenceBundle = {
  position: any;
  session: any;
  candidate: any | null;
  selection: any | null;
  riskDecision: any | null;
  universeEvaluations: any[];
  orderIntents: any[];
  brokerOrders: any[];
  events: any[];
};

function assertTradingDate(value: string): void {
  if (!DATE_RE.test(value)) {
    throw Object.assign(new Error('tradingDate must be YYYY-MM-DD'), { status: 400 });
  }
}

function idOf(doc: { _id?: unknown } | null | undefined): string {
  return String(doc?._id ?? '');
}

function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
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

function minutesBetween(start: Date | null | undefined, end: Date | null | undefined): number | null {
  if (!start || !end) return null;
  const delta = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(delta) && delta >= 0 ? Math.round(delta / 60_000) : null;
}

function reportIdForTrade(tradeId: string): string {
  return `trade:${tradeId}`;
}

function warning(code: string, message: string, source: string | null = null): TradeReportWarning {
  return { code, message, source };
}

function gradeFromScore(score: number | null): TradeReportGrade {
  if (score == null) return 'UNAVAILABLE';
  if (score >= 97) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function clampScore(score: number): number {
  return Math.min(100, Math.max(0, Math.round(score)));
}

function grade(score: number | null, reasons: string[], unavailableInputs: string[] = []): GradeBreakdown {
  return {
    grade: gradeFromScore(score),
    score: score == null ? null : clampScore(score),
    reasons,
    unavailableInputs,
  };
}

function selectedContract(selection: any | null, optionSymbol: string): RankedContract | null {
  if (!selection) return null;
  if (selection.selected?.symbol === optionSymbol) return selection.selected;
  return (selection.candidates ?? []).find((candidate: RankedContract) => candidate.symbol === optionSymbol) ?? selection.selected ?? null;
}

function rankingForCandidate(evaluations: any[], candidateId: string | null, optionSymbol: string) {
  for (const evaluation of evaluations) {
    const match = (evaluation.ranking ?? []).find(
      (item: any) => item?.candidateId === candidateId || item?.contractSymbol === optionSymbol
    );
    if (match) return match;
  }
  return null;
}

function marketStatusFromEvidence(session: any, evaluations: any[]): string | null {
  if (session?.marketStatus && session.marketStatus !== 'UNAVAILABLE') return session.marketStatus;
  for (const evaluation of [...evaluations].sort((a, b) => new Date(b.evaluatedAt).getTime() - new Date(a.evaluatedAt).getTime())) {
    const state = evaluation?.marketClockDecision?.state;
    if (typeof state === 'string' && state) return state;
  }
  return null;
}

function compactOrder(order: any | null): Record<string, unknown> | null {
  if (!order) return null;
  return {
    brokerOrderId: order.brokerOrderId,
    clientOrderId: order.clientOrderId,
    intentId: order.intentId,
    symbol: order.symbol,
    side: order.side,
    qty: order.qty,
    filledQty: order.filledQty,
    avgFillPrice: order.avgFillPrice,
    status: order.status,
    rawStatus: order.rawStatus,
    orderType: order.orderType,
    limitPrice: order.limitPrice,
    timeInForce: order.timeInForce,
    lastSource: order.lastSource,
    submittedAt: order.submittedAt,
    lastBrokerUpdateAt: order.lastBrokerUpdateAt,
  };
}

function compactIntent(intent: any | null): Record<string, unknown> | null {
  if (!intent) return null;
  return {
    intentId: idOf(intent),
    intentType: intent.intentType,
    direction: intent.direction,
    quantity: intent.quantity,
    orderType: intent.orderType,
    limitPrice: intent.limitPrice,
    timeInForce: intent.timeInForce,
    status: intent.status,
    clientOrderId: intent.clientOrderId,
    brokerOrderId: intent.brokerOrderId,
    attemptCount: intent.attemptCount,
    submittedAt: intent.submittedAt,
    completedAt: intent.completedAt,
    rejectionReason: intent.rejectionReason,
  };
}

function findEntryIntent(position: any, intents: any[]): any | null {
  return (
    intents.find(intent => idOf(intent) === position.entryIntentId) ??
    intents.find(intent => intent.intentType === 'ENTRY' && intent.clientOrderId === position.entryClientOrderId) ??
    intents.find(intent => intent.intentType === 'ENTRY' && intent.brokerOrderId === position.entryBrokerOrderId) ??
    intents.find(intent => intent.intentType === 'ENTRY') ??
    null
  );
}

function findExitIntent(position: any, intents: any[]): any | null {
  return (
    intents.find(intent => idOf(intent) === position.exitIntentId) ??
    intents.find(intent => intent.intentType === 'EXIT' && intent.brokerOrderId === position.exitBrokerOrderId) ??
    intents.find(intent => intent.intentType === 'EXIT' && intent.optionSymbol === position.optionSymbol) ??
    null
  );
}

function findEntryOrder(position: any, orders: any[]): any | null {
  return (
    orders.find(order => order.brokerOrderId === position.entryBrokerOrderId) ??
    orders.find(order => order.clientOrderId === position.entryClientOrderId) ??
    orders.find(order => order.side === 'BUY' && order.symbol === position.optionSymbol) ??
    null
  );
}

function findExitOrder(position: any, orders: any[]): any | null {
  return (
    orders.find(order => order.brokerOrderId === position.exitBrokerOrderId) ??
    orders.find(order => order.side === 'SELL' && order.symbol === position.optionSymbol) ??
    null
  );
}

function slippagePerShare(intent: any | null, order: any | null, actualPrice: number | null): number | null {
  const limit = numberOrNull(intent?.limitPrice ?? order?.limitPrice);
  const side = String(intent?.direction ?? order?.side ?? '').toUpperCase();
  if (limit == null || actualPrice == null || (side !== 'BUY' && side !== 'SELL')) return null;
  return side === 'BUY' ? round(actualPrice - limit, 4) : round(limit - actualPrice, 4);
}

function fillQuality(entrySlippage: number | null, exitSlippage: number | null, rejected: number, partials: number): string {
  if (rejected > 0) return 'Broker rejection captured';
  if (partials > 0) return 'Partial fill captured';
  const values = [entrySlippage, exitSlippage].filter((value): value is number => value != null);
  if (!values.length) return 'Unavailable from captured evidence';
  const adverse = values.filter(value => value > 0).reduce((sum, value) => sum + value, 0);
  if (adverse <= 0) return 'At or better than limit evidence';
  if (adverse <= 0.02) return 'Minor adverse slippage';
  return 'Adverse slippage captured';
}

function buildTimeline(evidence: EvidenceBundle): TradeTimelineEvent[] {
  const { position, candidate, selection, riskDecision, universeEvaluations, orderIntents, brokerOrders, events } = evidence;
  const timeline: TradeTimelineEvent[] = [];
  const push = (
    at: Date | string | null | undefined,
    label: string,
    source: string,
    sourceId: string | null,
    severity: 'info' | 'warning' | 'critical' = 'info',
    details: Record<string, unknown> | null = null
  ) => {
    if (!at) return;
    const date = at instanceof Date ? at : new Date(at);
    if (Number.isNaN(date.getTime())) return;
    timeline.push({ at: date, label, source, sourceId, severity, details });
  };

  push(candidate?.barTimestamp ?? candidate?.createdAt, 'Signal evaluated', 'TradeCandidate', idOf(candidate), 'info', {
    status: candidate?.status,
    direction: candidate?.signalDirection,
  });
  push(selection?.createdAt, 'Contract selection completed', 'ContractSelection', idOf(selection), 'info', {
    considered: selection?.consideredCount,
    passed: selection?.passedCount,
    selected: selection?.selected?.symbol,
  });
  push(riskDecision?.decidedAt ?? riskDecision?.createdAt, riskDecision?.approved ? 'Risk approved' : 'Risk rejected', 'RiskDecision', idOf(riskDecision), riskDecision?.approved ? 'info' : 'warning', {
    reasonCodes: riskDecision?.reasonCodes ?? [],
  });
  for (const evaluation of universeEvaluations) {
    push(evaluation.evaluatedAt, 'Universe evaluation recorded', 'UniverseEvaluation', idOf(evaluation), 'info', {
      outcome: evaluation.outcome,
      selectedSymbol: evaluation.selectedSymbol,
      selectedContractSymbol: evaluation.selectedContractSymbol,
    });
  }
  for (const intent of orderIntents) {
    push(intent.createdAt, `${intent.intentType} intent created`, 'OrderIntent', idOf(intent), intent.status === 'FAILED' ? 'warning' : 'info', {
      status: intent.status,
      clientOrderId: intent.clientOrderId,
    });
    push(intent.submittedAt, `${intent.intentType} intent submitted`, 'OrderIntent', idOf(intent), 'info', {
      status: intent.status,
      brokerOrderId: intent.brokerOrderId,
    });
    push(intent.completedAt, `${intent.intentType} intent completed`, 'OrderIntent', idOf(intent), 'info', {
      status: intent.status,
    });
  }
  for (const order of brokerOrders) {
    push(order.submittedAt, `Broker order ${order.status}`, 'BrokerOrder', order.brokerOrderId, order.status === 'REJECTED' ? 'warning' : 'info', {
      side: order.side,
      filledQty: order.filledQty,
      avgFillPrice: order.avgFillPrice,
    });
    for (const status of order.statusHistory ?? []) {
      push(status.at, `Broker status ${status.status}`, 'BrokerOrderStatus', order.brokerOrderId, status.status === 'REJECTED' ? 'warning' : 'info', {
        rawStatus: status.rawStatus,
        source: status.source,
      });
    }
  }
  push(position.openedAt, 'Position opened', 'AutomationPosition', idOf(position), 'info', {
    avgEntryPrice: position.avgEntryPrice,
    filledQty: position.filledQty,
  });
  push(position.closedAt, 'Position closed', 'AutomationPosition', idOf(position), position.realizedPnl < 0 ? 'warning' : 'info', {
    avgExitPrice: position.avgExitPrice,
    realizedPnl: position.realizedPnl,
    exitReason: position.exitReason,
  });
  for (const event of events) {
    push(event.timestamp, event.event, `AutomationEvent:${event.service}`, idOf(event), event.severity ?? 'info', {
      symbol: event.symbol,
      intentId: event.intentId,
      brokerOrderId: event.brokerOrderId,
    });
  }

  const seen = new Set<string>();
  return timeline
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.label.localeCompare(b.label))
    .filter(item => {
      const key = `${item.at.toISOString()}|${item.label}|${item.source}|${item.sourceId ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function gradeEntry(args: {
  candidate: any | null;
  selection: any | null;
  selected: RankedContract | null;
  rank: any | null;
  riskDecision: any | null;
}): GradeBreakdown {
  const reasons: string[] = [];
  const unavailable: string[] = [];
  let score = 70;

  if (args.candidate?.status) {
    reasons.push(`Candidate status ${args.candidate.status}`);
    if (['RISK_APPROVED', 'SIGNAL_FOUND'].includes(args.candidate.status)) score += 5;
  } else {
    unavailable.push('trade candidate');
  }
  if (args.riskDecision?.approved === true) {
    score += 10;
    reasons.push('Risk engine approved the setup');
  } else if (args.riskDecision?.approved === false) {
    score -= 20;
    reasons.push('Risk engine rejected the setup');
  } else {
    unavailable.push('risk decision');
  }
  if (args.selected) {
    if (typeof args.selected.spreadPct === 'number') {
      if (args.selected.spreadPct <= 0.1) {
        score += 8;
        reasons.push('Selected contract had tight spread evidence');
      } else if (args.selected.spreadPct <= 0.25) {
        score += 3;
        reasons.push('Selected contract had acceptable spread evidence');
      } else {
        score -= 12;
        reasons.push('Selected contract had wide spread evidence');
      }
    } else {
      unavailable.push('selected contract spread');
    }
    if (typeof args.selected.openInterest === 'number') {
      score += args.selected.openInterest >= 100 ? 4 : -4;
      reasons.push(`Open interest captured at ${args.selected.openInterest}`);
    } else {
      unavailable.push('open interest');
    }
    if (typeof args.selected.volume === 'number') {
      score += args.selected.volume > 0 ? 3 : -3;
      reasons.push(`Contract volume captured at ${args.selected.volume}`);
    } else {
      unavailable.push('contract volume');
    }
  } else {
    unavailable.push('selected contract snapshot');
    score -= 10;
  }
  if (args.rank?.rank === 1) {
    score += 5;
    reasons.push('Trade was top-ranked in persisted universe ranking');
  } else if (typeof args.rank?.rank === 'number') {
    reasons.push(`Trade ranked ${args.rank.rank} in persisted universe ranking`);
  } else {
    unavailable.push('universe ranking');
  }
  return grade(clampScore(score), reasons, unavailable);
}

function gradeExecution(args: {
  fillCount: number;
  partialFillCount: number;
  rejectionCount: number;
  retryCount: number;
  entrySlippage: number | null;
  exitSlippage: number | null;
  entryOrder: any | null;
  exitOrder: any | null;
}): GradeBreakdown {
  const reasons: string[] = [];
  const unavailable: string[] = [];
  let score = 75;
  if (args.fillCount >= 2) {
    score += 10;
    reasons.push('Entry and exit fill evidence captured');
  } else if (args.fillCount === 1) {
    score -= 5;
    reasons.push('Only one fill event was captured');
  } else {
    score -= 20;
    unavailable.push('broker fill evidence');
  }
  if (args.partialFillCount > 0) {
    score -= 8;
    reasons.push(`${args.partialFillCount} partial fill(s) captured`);
  }
  if (args.rejectionCount > 0) {
    score -= 15;
    reasons.push(`${args.rejectionCount} broker/order rejection(s) captured`);
  }
  if (args.retryCount > 1) {
    score -= Math.min(15, (args.retryCount - 1) * 4);
    reasons.push(`${args.retryCount} exit attempts captured`);
  }
  const slippageValues = [args.entrySlippage, args.exitSlippage].filter((value): value is number => value != null);
  if (slippageValues.length) {
    const adverse = slippageValues.reduce((sum, value) => sum + Math.max(value, 0), 0);
    if (adverse <= 0) {
      score += 5;
      reasons.push('Fills were at or better than limit evidence');
    } else if (adverse <= 0.02) {
      reasons.push('Minor adverse slippage captured');
    } else {
      score -= 8;
      reasons.push('Adverse slippage captured');
    }
  } else {
    unavailable.push('limit-vs-fill slippage');
  }
  if (!args.entryOrder) unavailable.push('entry broker order');
  if (!args.exitOrder) unavailable.push('exit broker order');
  return grade(clampScore(score), reasons, unavailable);
}

function gradeRisk(args: { riskDecision: any | null; position: any; entryDebit: number | null }): GradeBreakdown {
  const reasons: string[] = [];
  const unavailable: string[] = [];
  let score = 75;
  if (args.riskDecision?.approved === true) {
    score += 10;
    reasons.push('Risk decision approved before entry');
    const failedChecks = (args.riskDecision.checks ?? []).filter((check: any) => check.passed === false).length;
    if (failedChecks > 0) {
      score -= failedChecks * 8;
      reasons.push(`${failedChecks} risk check(s) failed in persisted evidence`);
    }
  } else if (args.riskDecision?.approved === false) {
    score -= 25;
    reasons.push('Persisted risk decision was rejected');
  } else {
    unavailable.push('risk decision');
  }
  if (args.position.overnightRecoveryRequired || args.position.exitReason === 'OVERNIGHT_RECOVERY') {
    score -= 15;
    reasons.push('Trade required overnight recovery');
  }
  const mae = numberOrNull(args.position.maxAdverseExcursion);
  if (mae != null && args.entryDebit && args.entryDebit > 0) {
    const drawdown = Math.abs(mae) / args.entryDebit;
    if (drawdown <= 0.15) {
      score += 5;
      reasons.push('Captured adverse excursion was contained');
    } else if (drawdown >= 0.5) {
      score -= 12;
      reasons.push('Captured adverse excursion was large relative to entry debit');
    }
  } else {
    unavailable.push('max adverse excursion');
  }
  return grade(clampScore(score), reasons, unavailable);
}

function gradeExit(position: any): GradeBreakdown {
  const reasons: string[] = [];
  const unavailable: string[] = [];
  let score = 70;
  const reason = position.exitReason;
  if (reason === 'PROFIT_TARGET') {
    score += 15;
    reasons.push('Exit reason was profit target');
  } else if (reason === 'END_OF_DAY') {
    score += 5;
    reasons.push('Exit reason was end-of-day flattening');
  } else if (reason === 'OVERNIGHT_RECOVERY') {
    score -= 20;
    reasons.push('Exit occurred through overnight recovery');
  } else if (reason === 'HARD_STOP' || reason === 'EMERGENCY_STOP') {
    score -= 10;
    reasons.push(`Exit reason was ${reason}`);
  } else if (reason) {
    reasons.push(`Exit reason was ${reason}`);
  } else {
    unavailable.push('exit reason');
  }
  const pnl = numberOrNull(position.realizedPnl);
  if (pnl != null) {
    if (pnl > 0) {
      score += 10;
      reasons.push('Trade closed profitably');
    } else if (pnl < 0) {
      score -= 10;
      reasons.push('Trade closed at a loss');
    } else {
      reasons.push('Trade closed breakeven');
    }
  } else {
    unavailable.push('realized P/L');
  }
  if (position.closedAt) {
    reasons.push('Broker-confirmed close timestamp captured');
  } else {
    unavailable.push('closed timestamp');
  }
  return grade(clampScore(score), reasons, unavailable);
}

function gradeMarket(selected: RankedContract | null, marketStatus: string | null): GradeBreakdown {
  const reasons: string[] = [];
  const unavailable: string[] = [];
  let score = 70;
  if (marketStatus) {
    reasons.push(`Market status evidence: ${marketStatus}`);
    if (marketStatus === 'OPEN') score += 3;
  } else {
    unavailable.push('market status');
  }
  if (selected) {
    if (typeof selected.spreadPct === 'number') {
      if (selected.spreadPct <= 0.1) score += 10;
      else if (selected.spreadPct > 0.3) score -= 12;
      reasons.push(`Spread percent captured at ${selected.spreadPct}`);
    } else {
      unavailable.push('spread percent');
    }
    if (typeof selected.openInterest === 'number' || typeof selected.volume === 'number') {
      reasons.push('Liquidity snapshot captured at selection');
    } else {
      unavailable.push('liquidity snapshot');
    }
  } else {
    unavailable.push('selected contract market snapshot');
  }
  return grade(clampScore(score), reasons, unavailable);
}

function overallGrade(grades: GradeBreakdown[]): GradeBreakdown {
  const scored = grades.map(item => item.score).filter((value): value is number => typeof value === 'number');
  if (!scored.length) {
    return grade(null, [], ['component grades']);
  }
  const average = scored.reduce((sum, value) => sum + value, 0) / scored.length;
  return grade(clampScore(average), [`Average of ${scored.length} deterministic component grade(s)`], []);
}

function buildLessons(args: {
  position: any;
  riskDecision: any | null;
  selected: RankedContract | null;
  executionGrade: GradeBreakdown;
  warnings: TradeReportWarning[];
}) {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const improvementSuggestions: string[] = [];

  if (args.riskDecision?.approved === true) strengths.push('Risk approval was persisted before entry.');
  if ((args.position.realizedPnl ?? 0) > 0) strengths.push('Trade closed with positive realized P/L.');
  if (args.executionGrade.score != null && args.executionGrade.score >= 85) strengths.push('Broker fill evidence indicates clean execution.');
  if ((args.position.realizedPnl ?? 0) < 0) weaknesses.push('Trade closed with negative realized P/L.');
  if (args.position.exitReason === 'OVERNIGHT_RECOVERY') weaknesses.push('Trade required overnight recovery instead of same-day closure.');
  if (args.selected?.spreadPct != null && args.selected.spreadPct > 0.3) weaknesses.push('Selected contract had wide spread evidence at selection.');
  if (args.warnings.length) weaknesses.push('Some report fields could not be reconstructed from persisted V1 evidence.');
  if (!args.selected) {
    improvementSuggestions.push('Persist full greek snapshots at entry if future reports need theta/gamma/vega attribution.');
  }
  if (args.position.exitReason === 'OVERNIGHT_RECOVERY') {
    improvementSuggestions.push('Review overnight recovery cases separately before changing exit rules.');
  }
  if (args.warnings.some(item => item.code.includes('MARKET_CONTEXT'))) {
    improvementSuggestions.push('Capture market-regime context as persisted evidence before adding regime analytics.');
  }
  return { strengths, weaknesses, improvementSuggestions };
}

async function findSessionForPosition(position: any): Promise<any | null> {
  const tradeId = idOf(position);
  const byReference = await TradingSessionModel.findOne({ 'references.closedTradeIds': tradeId }).lean();
  if (byReference) return byReference;
  if (position.automationSessionId) {
    const byAutomationSession = await TradingSessionModel.findOne({ automationSessionId: position.automationSessionId })
      .sort({ tradingDate: -1, updatedAt: -1 })
      .lean();
    if (byAutomationSession) return byAutomationSession;
  }
  const dateSource = position.closedAt ?? position.openedAt ?? position.createdAt;
  if (dateSource) {
    const tradingDate = exchangeTradingDate(new Date(dateSource));
    return TradingSessionModel.findOne({ tradingDate }).sort({ updatedAt: -1 }).lean();
  }
  return null;
}

async function loadEvidenceForTrade(tradeId: string): Promise<EvidenceBundle> {
  const position = isObjectId(tradeId)
    ? await AutomationPositionModel.findById(tradeId).lean()
    : await AutomationPositionModel.findOne({ entryClientOrderId: tradeId }).lean();
  if (!position) throw Object.assign(new Error('Automation position not found'), { status: 404 });
  if (position.status !== 'CLOSED') {
    throw Object.assign(new Error('Trade report generation requires a CLOSED automation position'), { status: 409 });
  }
  const session = await findSessionForPosition(position);
  if (!session) {
    throw Object.assign(new Error('Trading session evidence not found for trade'), { status: 409 });
  }

  const candidateQuery = position.tradeCandidateId && isObjectId(position.tradeCandidateId) ? { _id: position.tradeCandidateId } : null;
  const selectionQuery = position.contractSelectionId && isObjectId(position.contractSelectionId)
    ? { _id: position.contractSelectionId }
    : position.tradeCandidateId
      ? { tradeCandidateId: position.tradeCandidateId }
      : null;
  const riskQuery = position.riskDecisionId && isObjectId(position.riskDecisionId)
    ? { _id: position.riskDecisionId }
    : position.tradeCandidateId
      ? { tradeCandidateId: position.tradeCandidateId }
      : null;

  const intentOr: any[] = [
    { clientOrderId: position.entryClientOrderId },
    { brokerOrderId: position.entryBrokerOrderId },
    { brokerOrderId: position.exitBrokerOrderId },
  ].filter(item => Object.values(item)[0]);
  if (position.entryIntentId && isObjectId(position.entryIntentId)) intentOr.push({ _id: position.entryIntentId });
  if (position.exitIntentId && isObjectId(position.exitIntentId)) intentOr.push({ _id: position.exitIntentId });

  const orderOr: any[] = [
    { brokerOrderId: position.entryBrokerOrderId },
    { brokerOrderId: position.exitBrokerOrderId },
    { clientOrderId: position.entryClientOrderId },
    { symbol: position.optionSymbol, automationSessionId: position.automationSessionId },
  ].filter(item => Object.values(item)[0] != null);

  const [candidate, selection, riskDecision, universeEvaluations, orderIntents, brokerOrders, events] = await Promise.all([
    candidateQuery ? TradeCandidateModel.findOne(candidateQuery).lean() : null,
    selectionQuery ? ContractSelectionModel.findOne(selectionQuery).lean() : null,
    riskQuery ? RiskDecisionModel.findOne(riskQuery).lean() : null,
    UniverseEvaluationModel.find({
      automationSessionId: position.automationSessionId,
      $or: [
        { selectedCandidateId: position.tradeCandidateId },
        { selectedContractSymbol: position.optionSymbol },
        { selectedSymbol: position.underlying },
        { 'ranking.contractSymbol': position.optionSymbol },
      ],
    })
      .sort({ evaluatedAt: 1 })
      .lean(),
    intentOr.length ? OrderIntentModel.find({ $or: intentOr }).sort({ createdAt: 1 }).lean() : [],
    orderOr.length ? BrokerOrderModel.find({ $or: orderOr }).sort({ submittedAt: 1, createdAt: 1 }).lean() : [],
    AutomationEventModel.find({
      automationSessionId: position.automationSessionId,
      $or: [
        { symbol: position.underlying },
        { symbol: position.optionSymbol },
        { intentId: { $in: unique([position.entryIntentId, position.exitIntentId]) } },
        { brokerOrderId: { $in: unique([position.entryBrokerOrderId, position.exitBrokerOrderId]) } },
      ],
    })
      .sort({ timestamp: 1 })
      .limit(200)
      .lean(),
  ]);

  return { position, session, candidate, selection, riskDecision, universeEvaluations, orderIntents, brokerOrders, events };
}

function buildReportDocument(evidence: EvidenceBundle): Omit<TradeReportDocument, '_id' | 'createdAt' | 'updatedAt'> {
  const { position, session, candidate, selection, riskDecision, universeEvaluations, orderIntents, brokerOrders, events } = evidence;
  const tradeId = idOf(position);
  const entryIntent = findEntryIntent(position, orderIntents);
  const exitIntent = findExitIntent(position, orderIntents);
  const entryOrder = findEntryOrder(position, brokerOrders);
  const exitOrder = findExitOrder(position, brokerOrders);
  const selected = selectedContract(selection, position.optionSymbol);
  const rank = rankingForCandidate(universeEvaluations, position.tradeCandidateId, position.optionSymbol);
  const marketStatus = marketStatusFromEvidence(session, universeEvaluations);
  const warnings: TradeReportWarning[] = [];

  if (!candidate) warnings.push(warning('TRADE_CANDIDATE_NOT_CAPTURED', 'Trade candidate evidence was not found for this position.', 'TradeCandidate'));
  if (!selection) warnings.push(warning('CONTRACT_SELECTION_NOT_CAPTURED', 'Contract selection evidence was not found for this position.', 'ContractSelection'));
  if (!riskDecision) warnings.push(warning('RISK_DECISION_NOT_CAPTURED', 'Risk decision evidence was not found for this position.', 'RiskDecision'));
  if (!entryOrder) warnings.push(warning('ENTRY_ORDER_NOT_CAPTURED', 'Entry broker order evidence was not found for this position.', 'BrokerOrder'));
  if (!exitOrder) warnings.push(warning('EXIT_ORDER_NOT_CAPTURED', 'Exit broker order evidence was not found for this position.', 'BrokerOrder'));
  if (!marketStatus) warnings.push(warning('MARKET_CONTEXT_NOT_CAPTURED', 'Market status/regime context was not captured for this trade.', 'UniverseEvaluation'));
  if (!selected?.delta) warnings.push(warning('DELTA_NOT_CAPTURED', 'Delta was not captured for this selected contract.', 'ContractSelection'));
  if (!selected || selected.iv == null) warnings.push(warning('IV_NOT_CAPTURED', 'Implied volatility was not captured for this selected contract.', 'ContractSelection'));
  warnings.push(warning('THETA_GAMMA_VEGA_NOT_CAPTURED', 'Theta, gamma, and vega are not persisted by V1 contract selection evidence.', 'ContractSelection'));
  warnings.push(warning('SPY_SECTOR_VIX_CONTEXT_NOT_CAPTURED', 'SPY, sector, and VIX context are not persisted by V1 evidence.', 'MarketContext'));

  const fillCount = brokerOrders.filter(order => order.status === 'FILLED' || order.filledQty >= order.qty).length;
  const partialFillCount = brokerOrders.filter(order => order.status === 'PARTIALLY_FILLED' || (order.filledQty > 0 && order.filledQty < order.qty)).length;
  const cancellationCount = brokerOrders.filter(order => ['CANCELLED', 'CANCEL_PENDING'].includes(order.status)).length;
  const rejectionCount =
    brokerOrders.filter(order => order.status === 'REJECTED').length +
    orderIntents.filter(intent => ['BROKER_REJECTED', 'FAILED'].includes(intent.status)).length;
  const retryCount = Math.max(numberOrNull(position.exitAttemptCount) ?? 0, ...orderIntents.map(intent => numberOrNull(intent.attemptCount) ?? 0), 0);
  const entryPrice = numberOrNull(position.avgEntryPrice);
  const exitPrice = numberOrNull(position.avgExitPrice);
  const contracts = numberOrNull(position.filledQty) ?? 0;
  const entrySlippage = slippagePerShare(entryIntent, entryOrder, entryPrice);
  const exitSlippage = slippagePerShare(exitIntent, exitOrder, exitPrice);
  const totalEstimatedSlippage =
    entrySlippage == null && exitSlippage == null
      ? null
      : roundCurrency(((entrySlippage ?? 0) + (exitSlippage ?? 0)) * contracts * OPTION_MULTIPLIER);
  const entryDebit = entryPrice == null ? null : entryPrice * contracts * OPTION_MULTIPLIER;

  const entry = gradeEntry({ candidate, selection, selected, rank, riskDecision });
  const execution = gradeExecution({
    fillCount,
    partialFillCount,
    rejectionCount,
    retryCount,
    entrySlippage,
    exitSlippage,
    entryOrder,
    exitOrder,
  });
  const risk = gradeRisk({ riskDecision, position, entryDebit });
  const exit = gradeExit(position);
  const market = gradeMarket(selected, marketStatus);
  const overall = overallGrade([entry, exit, risk, execution, market]);
  const timeline = buildTimeline(evidence);
  const lessons = buildLessons({ position, riskDecision, selected, executionGrade: execution, warnings });

  return {
    reportId: reportIdForTrade(tradeId),
    tradeId,
    sessionId: session.sessionId,
    automationSessionId: position.automationSessionId,
    status: 'GENERATED',
    environment: session.environment ?? 'PAPER',
    tradingDate: session.tradingDate ?? exchangeTradingDate(new Date(position.closedAt ?? position.openedAt ?? position.createdAt)),
    identity: {
      underlying: position.underlying,
      optionSymbol: position.optionSymbol,
      direction: position.direction,
      strategyVersionId: position.strategyVersionId,
      strategy: position.strategyVersionId,
      contractType: selected?.type ?? selection?.optionSide ?? null,
      contractStrike: numberOrNull(selected?.strike),
      contractExpiration: typeof selected?.expiration === 'string' ? selected.expiration : null,
    },
    lifecycle: {
      openedAt: position.openedAt ?? null,
      closedAt: position.closedAt ?? null,
      holdTimeMinutes: minutesBetween(position.openedAt, position.closedAt),
      exitReason: position.exitReason ?? null,
      overnightRecoveryRequired: Boolean(position.overnightRecoveryRequired || position.exitReason === 'OVERNIGHT_RECOVERY'),
      manualReviewReason: position.manualReviewReason ?? null,
    },
    execution: {
      entryOrder: compactOrder(entryOrder),
      exitOrder: compactOrder(exitOrder),
      entryIntent: compactIntent(entryIntent),
      exitIntent: compactIntent(exitIntent),
      fillCount,
      partialFillCount,
      cancellationCount,
      rejectionCount,
      retryCount,
      entrySlippage,
      exitSlippage,
      totalEstimatedSlippage,
      fillQuality: fillQuality(entrySlippage, exitSlippage, rejectionCount, partialFillCount),
    },
    marketContext: {
      marketStatus,
      underlyingPriceAtSelection: numberOrNull(selection?.underlyingPrice),
      spyContext: null,
      sectorContext: null,
      vixContext: null,
      trend: typeof candidate?.conditions?.trend === 'string' ? candidate.conditions.trend : null,
      marketRegime: typeof candidate?.conditions?.regime === 'string' ? candidate.conditions.regime : null,
      liquidity: selected
        ? {
            bid: selected.bid,
            ask: selected.ask,
            mid: selected.mid,
            spreadDollars: selected.spreadDollars,
            spreadPct: selected.spreadPct,
            volume: selected.volume,
            openInterest: selected.openInterest,
            quoteTimestamp: selected.quoteTimestamp,
          }
        : null,
    },
    greeks: {
      delta: numberOrNull(selected?.delta),
      theta: null,
      gamma: null,
      vega: null,
      iv: numberOrNull(selected?.iv),
    },
    signal: {
      confidence: numberOrNull(candidate?.conditions?.confidence),
      flowScore: numberOrNull(candidate?.conditions?.flowScore),
      momentumScore: numberOrNull(candidate?.conditions?.momentumScore),
      trendScore: numberOrNull(candidate?.conditions?.trendScore),
      riskScore: riskDecision?.checks?.length
        ? round(riskDecision.checks.filter((check: any) => check.passed).length / riskDecision.checks.length, 4)
        : null,
      candidateRank: numberOrNull(rank?.rank),
      candidateStatus: candidate?.status ?? null,
      riskApproved: typeof riskDecision?.approved === 'boolean' ? riskDecision.approved : null,
      riskReasonCodes: riskDecision?.reasonCodes ?? [],
      selectedContractScore: numberOrNull(selected?.score ?? rank?.contractScore),
      selectedContractRank: numberOrNull(rank?.rank),
    },
    performance: {
      entryPrice,
      exitPrice,
      contracts,
      realizedPnl: roundCurrency(numberOrNull(position.realizedPnl)),
      returnPct: round(numberOrNull(position.returnPct), 4),
      maxFavorableExcursion: roundCurrency(numberOrNull(position.maxFavorableExcursion)),
      maxAdverseExcursion: roundCurrency(numberOrNull(position.maxAdverseExcursion)),
      drawdown: roundCurrency(numberOrNull(position.maxAdverseExcursion)),
      fees:
        numberOrNull(position.entryFees) == null && numberOrNull(position.exitFees) == null
          ? null
          : roundCurrency((numberOrNull(position.entryFees) ?? 0) + (numberOrNull(position.exitFees) ?? 0)),
    },
    grades: { entry, exit, risk, execution, market, overall },
    lessons,
    timeline,
    evidence: {
      positionId: tradeId,
      tradingSessionId: session.sessionId,
      brokerOrderIds: unique(brokerOrders.map(order => order.brokerOrderId)),
      orderIntentIds: unique(orderIntents.map(idOf)),
      riskDecisionId: riskDecision ? idOf(riskDecision) : null,
      tradeCandidateId: candidate ? idOf(candidate) : position.tradeCandidateId ?? null,
      contractSelectionId: selection ? idOf(selection) : position.contractSelectionId ?? null,
      universeEvaluationIds: unique(universeEvaluations.map(idOf)),
      eventIds: unique(events.map(idOf)),
    },
    warnings,
    generation: {
      schemaVersion: 1,
      generatorVersion: GENERATOR_VERSION,
      generatedBy: 'server:intelligence:trade-report-generator',
      sourceWindowStart: session.generation?.sourceWindowStart ?? position.openedAt ?? null,
      sourceWindowEnd: session.generation?.sourceWindowEnd ?? position.closedAt ?? null,
      generatedAt: new Date(),
      generatedFromPersistedEvidence: true,
    },
  };
}

export async function generateTradeReportForTrade(tradeId: string): Promise<GenerationResult> {
  const existing = await TradeReportModel.findOne({
    $or: [{ tradeId }, { reportId: reportIdForTrade(tradeId) }],
  });
  if (existing) return { report: existing, idempotent: true };

  const evidence = await loadEvidenceForTrade(tradeId);
  const doc = buildReportDocument(evidence);
  try {
    const report = await TradeReportModel.create(doc);
    writeStructuredLog({
      component: 'intelligence',
      module: 'trade-report-generator',
      event: 'TRADE_REPORT_GENERATED',
      severity: 'info',
      sessionId: report.sessionId,
      tradeId: report.tradeId,
      context: {
        reportId: report.reportId,
        tradingDate: report.tradingDate,
        underlying: report.identity.underlying,
        realizedPnl: report.performance.realizedPnl,
        overallGrade: report.grades.overall.grade,
      },
    });
    return { report, idempotent: false };
  } catch (error: any) {
    if (error?.code === 11000) {
      const raced = await TradeReportModel.findOne({ tradeId: doc.tradeId });
      if (raced) return { report: raced, idempotent: true };
    }
    throw error;
  }
}

export async function generateTradeReportsForSession(sessionId: string): Promise<GenerationResult[]> {
  const session = await TradingSessionModel.findOne({ sessionId }).lean();
  if (!session) throw Object.assign(new Error('Trading session not found'), { status: 404 });
  const tradeIds = session.references?.closedTradeIds?.length
    ? session.references.closedTradeIds
    : (
        await AutomationPositionModel.find({
          automationSessionId: session.automationSessionId,
          status: 'CLOSED',
        })
          .select('_id')
          .lean()
      ).map(idOf);
  const results: GenerationResult[] = [];
  for (const tradeId of tradeIds) {
    results.push(await generateTradeReportForTrade(tradeId));
  }
  return results;
}

export async function backfillTradeReportsForDate(tradingDate: string): Promise<GenerationResult[]> {
  assertTradingDate(tradingDate);
  const sessions = await TradingSessionModel.find({ tradingDate }).sort({ updatedAt: -1 }).lean();
  if (!sessions.length) throw Object.assign(new Error('Trading session not found for date'), { status: 404 });
  const results: GenerationResult[] = [];
  for (const session of sessions) {
    results.push(...(await generateTradeReportsForSession(session.sessionId)));
  }
  return results;
}

export async function listTradeReports(limit = 50): Promise<TradeReportHydratedDocument[]> {
  return TradeReportModel.find()
    .sort({ tradingDate: -1, 'lifecycle.closedAt': -1, updatedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 200));
}

export async function getTradeReportById(id: string): Promise<TradeReportHydratedDocument | null> {
  return TradeReportModel.findOne({ $or: [{ reportId: id }, { tradeId: id }] });
}

export async function getTradeReportsBySession(sessionId: string): Promise<TradeReportHydratedDocument[]> {
  return TradeReportModel.find({ sessionId }).sort({ 'lifecycle.closedAt': -1, updatedAt: -1 });
}
