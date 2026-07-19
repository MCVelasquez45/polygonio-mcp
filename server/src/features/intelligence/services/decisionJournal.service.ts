import { writeStructuredLog } from '../../../shared/logging/safeLogging';
import { AutomationEventModel } from '../../automation/models/automationEvent.model';
import { AutomationPositionModel } from '../../automation/models/automationPosition.model';
import { ContractSelectionModel } from '../../automation/models/contractSelection.model';
import { OrderIntentModel } from '../../automation/models/orderIntent.model';
import { RiskDecisionModel } from '../../automation/models/riskDecision.model';
import { TradeCandidateModel } from '../../automation/models/tradeCandidate.model';
import { UniverseEvaluationModel } from '../../automation/models/universeEvaluation.model';
import { TradingSessionModel } from '../models/tradingSession.model';
import { TradeReportModel } from '../models/tradeReport.model';
import {
  DecisionJournalModel,
  type DecisionAction,
  type DecisionJournalDocument,
  type DecisionJournalHydratedDocument,
  type DecisionJournalWarning,
  type DecisionTimelineEvent,
  type DecisionType,
} from '../models/decisionJournal.model';

const GENERATOR_VERSION = 'decision-journal-v1';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMEZONE = 'America/New_York';

type CaptureResult = {
  entry: DecisionJournalHydratedDocument;
  idempotent: boolean;
};

type DecisionSourceBundle = {
  session: any;
  tradeReports: any[];
  universeEvaluations: any[];
  candidates: any[];
  selections: any[];
  riskDecisions: any[];
  orderIntents: any[];
  positions: any[];
  events: any[];
};

type DecisionDraft = Omit<DecisionJournalDocument, '_id' | 'createdAt' | 'updatedAt'>;

function assertTradingDate(value: string): void {
  if (!DATE_RE.test(value)) {
    throw Object.assign(new Error('tradingDate must be YYYY-MM-DD'), { status: 400 });
  }
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function zonedMidnightUtc(tradingDate: string, timezone = TIMEZONE): Date {
  const [year, month, day] = tradingDate.split('-').map(Number);
  const desired = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = Date.UTC(year, month - 1, day, 5, 0, 0);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let i = 0; i < 5; i += 1) {
    const parts: Record<string, number> = {};
    for (const part of formatter.formatToParts(new Date(guess))) {
      if (part.type !== 'literal') parts[part.type] = Number(part.value);
    }
    const actual = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const delta = actual - desired;
    if (delta === 0) break;
    guess -= delta;
  }
  return new Date(guess);
}

function evidenceWindowForSession(session: any): { start: Date; end: Date } {
  const tradingStart = zonedMidnightUtc(session.tradingDate);
  const nextTradingStart = zonedMidnightUtc(addDays(session.tradingDate, 1));
  const sourceStart = session.generation?.sourceWindowStart ? new Date(session.generation.sourceWindowStart) : null;
  const sourceEnd = session.generation?.sourceWindowEnd ? new Date(session.generation.sourceWindowEnd) : null;
  const start = sourceStart && sourceStart > tradingStart ? sourceStart : tradingStart;
  const end = sourceEnd && sourceEnd > nextTradingStart ? sourceEnd : nextTradingStart;
  return { start, end };
}

function sourceQuery(session: any, dateField: string, window: { start: Date; end: Date }) {
  const dateClause = { [dateField]: { $gte: window.start, $lt: window.end } };
  return session.automationSessionId ? { automationSessionId: session.automationSessionId, ...dateClause } : dateClause;
}

function positionSourceQuery(session: any, window: { start: Date; end: Date }) {
  const inWindow = { $gte: window.start, $lt: window.end };
  const dateClause = {
    $or: [
      { createdAt: inWindow },
      { openedAt: inWindow },
      { exitSubmittedAt: inWindow },
      { closedAt: inWindow },
      { overnightDetectedAt: inWindow },
      { recoveryExitSubmittedAt: inWindow },
      { updatedAt: inWindow },
    ],
  };
  return session.automationSessionId
    ? { $and: [{ automationSessionId: session.automationSessionId }, dateClause] }
    : dateClause;
}

function idOf(doc: { _id?: unknown } | null | undefined): string {
  return String(doc?._id ?? '');
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function dateOrNow(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function reasonText(code: string): string {
  const known: Record<string, string> = {
    LOW_LIQUIDITY: 'Liquidity was below the configured requirement.',
    LOW_CONFIDENCE: 'Signal confidence was below the configured requirement.',
    HIGH_SPREAD: 'The contract spread was too wide.',
    MAX_POSITIONS: 'The maximum open-position limit was reached.',
    MARKET_CLOSED: 'The market was closed.',
    MARKET_CLOCK_NOT_CAPTURED: 'Market clock state was unavailable.',
    EMERGENCY_STOP: 'Emergency stop was active.',
    NO_SIGNAL: 'No actionable signal was detected.',
    OPTIONS_FLOW_BALANCED: 'Options flow did not show a directional edge.',
    OPTIONS_DATA_UNAVAILABLE: 'Required options-flow evidence was unavailable.',
    OPTIONS_WINDOW_STALE: 'Options-flow evidence was stale.',
    OPTIONS_WINDOW_INSUFFICIENT_VOLUME: 'Options-flow volume was insufficient.',
    INSUFFICIENT_VOLUME: 'Volume was insufficient.',
    NO_CONTRACT_PASSED_FILTERS: 'No contract passed the selection filters.',
    OPPORTUNITY_NOT_SELECTED: 'A stronger opportunity was selected.',
    RISK_MAX_DAILY_LOSS: 'Daily loss limit blocked the trade.',
    RISK_MAX_DRAWDOWN: 'Drawdown limit blocked the trade.',
    RISK_MAX_TRADES: 'Maximum trade count blocked the trade.',
    RISK_EXISTING_POSITION: 'An existing automation position blocked the trade.',
    RISK_UNRESOLVED_ORDER: 'An unresolved order blocked the trade.',
    RISK_INSUFFICIENT_BUYING_POWER: 'Buying power was insufficient.',
    RISK_MARKET_NOT_OPEN: 'Risk engine blocked entry because the market was not open.',
    RISK_REJECTED: 'Risk engine rejected the candidate.',
    INTENT_CREATED: 'An order intent was created from approved evidence.',
    END_OF_DAY: 'End-of-day exit policy triggered.',
    OVERNIGHT_RECOVERY: 'Overnight recovery exit was required.',
    HARD_STOP: 'Hard stop exit triggered.',
    PROFIT_TARGET: 'Profit target exit triggered.',
  };
  return known[code] ?? code.toLowerCase().replace(/_/g, ' ');
}

function warning(code: string, message: string, source: string | null = null): DecisionJournalWarning {
  return { code, message, source };
}

function timelineEvent(
  at: Date | string | null | undefined,
  label: string,
  source: string,
  sourceId: string | null,
  severity: 'info' | 'warning' | 'critical' = 'info'
): DecisionTimelineEvent[] {
  if (!at) return [];
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return [];
  return [{ at: date, label, source, sourceId, severity }];
}

function defaultEvaluation(overrides: Partial<DecisionDraft['evaluation']> = {}): DecisionDraft['evaluation'] {
  return {
    signalStrength: null,
    confidence: null,
    flowScore: null,
    momentumScore: null,
    trendScore: null,
    riskScore: null,
    candidateRank: null,
    marketRegime: null,
    ...overrides,
  };
}

function defaultInputs(overrides: Partial<DecisionDraft['inputs']> = {}): DecisionDraft['inputs'] {
  return {
    liquidity: null,
    spread: null,
    volume: null,
    iv: null,
    delta: null,
    theta: null,
    gamma: null,
    vega: null,
    marketClock: null,
    buyingPower: null,
    existingPositions: null,
    watchlistRank: null,
    ...overrides,
  };
}

function defaultRiskSnapshot(overrides: Partial<DecisionDraft['riskSnapshot']> = {}): DecisionDraft['riskSnapshot'] {
  return {
    positionSize: null,
    riskPercent: null,
    maxLoss: null,
    estimatedReward: null,
    estimatedRR: null,
    ...overrides,
  };
}

function evidenceQuality(fields: Record<string, unknown>, warnings: DecisionJournalWarning[] = []) {
  const persistedFields: string[] = [];
  const missingFields: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || (Array.isArray(value) && value.length === 0)) missingFields.push(key);
    else persistedFields.push(key);
  }
  return { persistedFields: persistedFields.sort(), missingFields: missingFields.sort(), warnings };
}

function decisionState(type: DecisionType, reasonCodes: string[]): DecisionDraft['decision'] {
  const approvedTypes = new Set<DecisionType>(['BUY_APPROVED', 'SELL_APPROVED', 'EXIT_TRIGGERED']);
  const skippedTypes = new Set<DecisionType>(['NO_SIGNAL', 'NO_ACTION']);
  const rejectedTypes = new Set<DecisionType>([
    'BUY_REJECTED',
    'SELL_REJECTED',
    'SIGNAL_REJECTED',
    'DATA_REJECTED',
    'RISK_REJECTED',
    'ORDER_CANCELLED',
    'ORDER_TIMEOUT',
    'EMERGENCY_STOP',
  ]);
  let decision: DecisionAction = 'NO_ACTION';
  if (type === 'BUY_APPROVED') decision = 'BUY';
  else if (type === 'SELL_APPROVED') decision = 'SELL';
  else if (type === 'EXIT_TRIGGERED') decision = 'EXIT';
  else if (type === 'ORDER_CANCELLED') decision = 'CANCEL';
  else if (type === 'EMERGENCY_STOP') decision = 'EMERGENCY_STOP';
  else if (skippedTypes.has(type)) decision = 'SKIP';
  else if (rejectedTypes.has(type)) decision = 'REJECT';
  return {
    decision,
    approved: approvedTypes.has(type),
    rejected: rejectedTypes.has(type),
    skipped: skippedTypes.has(type),
    reasonCodes,
    humanReadableReasons: reasonCodes.length ? reasonCodes.map(reasonText) : [reasonText(type)],
  };
}

function baseDraft(args: {
  decisionId: string;
  session: any;
  sourceType: string;
  sourceId: string;
  collection: string;
  timestamp: Date;
  decisionType: DecisionType;
  symbol?: string | null;
  contract?: string | null;
  strategy?: string | null;
  marketRegime?: string | null;
  tradeId?: string | null;
  reportId?: string | null;
  orderIntentId?: string | null;
  brokerOrderId?: string | null;
  positionId?: string | null;
  reasonCodes?: string[];
  evaluation?: Partial<DecisionDraft['evaluation']>;
  inputs?: Partial<DecisionDraft['inputs']>;
  riskSnapshot?: Partial<DecisionDraft['riskSnapshot']>;
  evidenceFields?: Record<string, unknown>;
  warnings?: DecisionJournalWarning[];
  timeline?: DecisionTimelineEvent[];
}): DecisionDraft {
  const reasonCodes = unique(args.reasonCodes?.length ? args.reasonCodes : [args.decisionType]);
  return {
    decisionId: args.decisionId,
    sessionId: args.session?.sessionId ?? null,
    automationSessionId: args.session?.automationSessionId ?? null,
    tradeId: args.tradeId ?? null,
    reportId: args.reportId ?? null,
    timestamp: args.timestamp,
    decisionType: args.decisionType,
    source: {
      type: args.sourceType,
      id: args.sourceId,
      collection: args.collection,
    },
    context: {
      symbol: args.symbol ?? null,
      contract: args.contract ?? null,
      strategy: args.strategy ?? null,
      environment: args.session?.environment ?? 'PAPER',
      marketRegime: args.marketRegime ?? null,
    },
    evaluation: defaultEvaluation(args.evaluation),
    inputs: defaultInputs(args.inputs),
    decision: decisionState(args.decisionType, reasonCodes),
    riskSnapshot: defaultRiskSnapshot(args.riskSnapshot),
    executionReference: {
      orderIntentId: args.orderIntentId ?? null,
      brokerOrderId: args.brokerOrderId ?? null,
      positionId: args.positionId ?? null,
    },
    evidenceQuality: evidenceQuality(args.evidenceFields ?? {}, args.warnings ?? []),
    timeline: args.timeline ?? [],
    generation: {
      schemaVersion: 1,
      generatorVersion: GENERATOR_VERSION,
      generatedBy: 'server:intelligence:decision-journal',
      generatedFromPersistedEvidence: true,
    },
  };
}

function candidateDecisionType(candidate: any): DecisionType {
  switch (candidate.status) {
    case 'RISK_APPROVED':
      return 'BUY_APPROVED';
    case 'RISK_REJECTED':
      return 'RISK_REJECTED';
    case 'NO_TRADE':
      return 'NO_SIGNAL';
    case 'DATA_REJECTED':
    case 'CLOCK_REJECTED':
      return 'DATA_REJECTED';
    case 'RANKED_NOT_SELECTED':
      return 'SIGNAL_REJECTED';
    case 'DUPLICATE_SUPPRESSED':
      return 'NO_ACTION';
    case 'SIGNAL_FOUND':
      return 'NO_ACTION';
    default:
      return 'NO_ACTION';
  }
}

function universeDecisionType(evaluation: any): DecisionType {
  switch (evaluation.outcome) {
    case 'INTENT_CREATED':
      return 'BUY_APPROVED';
    case 'RISK_REJECTED':
      return 'RISK_REJECTED';
    case 'CLOCK_REJECTED':
    case 'GATES_REJECTED':
    case 'UNIVERSE_NOT_CONFIGURED':
      return 'DATA_REJECTED';
    case 'NO_TRADE':
    case 'NO_ELIGIBLE_SYMBOLS':
      return 'NO_ACTION';
    default:
      return 'NO_ACTION';
  }
}

function conditions(candidate: any): Record<string, unknown> {
  return recordOrNull(candidate?.conditions) ?? {};
}

function selectedContract(selection: any | null): any | null {
  return selection?.selected ?? null;
}

function rankingForCandidate(evaluations: any[], candidateId: string): any | null {
  for (const evaluation of evaluations) {
    const match = (evaluation.ranking ?? []).find((item: any) => item?.candidateId === candidateId);
    if (match) return match;
  }
  return null;
}

function findEntryIntent(candidate: any, intents: any[]): any | null {
  const bar = candidate?.barTimestamp ? new Date(candidate.barTimestamp).toISOString() : null;
  return (
    intents.find(
      intent =>
        intent.intentType === 'ENTRY' &&
        intent.underlying === candidate.underlying &&
        intent.strategyVersionId === candidate.strategyVersionId &&
        (!bar || intent.idempotencyInputs?.closedBarTimestamp === bar)
    ) ?? null
  );
}

function findPositionForIntent(intent: any | null, positions: any[]): any | null {
  if (!intent) return null;
  return (
    positions.find(position => position.entryIntentId === idOf(intent)) ??
    positions.find(position => position.exitIntentId === idOf(intent)) ??
    positions.find(position => position.entryClientOrderId === intent.clientOrderId) ??
    null
  );
}

function findTradeReportForPosition(position: any | null, reports: any[]): any | null {
  if (!position) return null;
  const positionId = idOf(position);
  return reports.find(report => report.tradeId === positionId || report.evidence?.positionId === positionId) ?? null;
}

function riskNumbers(risk: any | null): Partial<DecisionDraft['riskSnapshot']> {
  const outputs = recordOrNull(risk?.sizing?.outputs) ?? {};
  const inputs = recordOrNull(risk?.sizing?.inputs) ?? {};
  return {
    positionSize:
      numberOrNull(outputs.quantity) ??
      numberOrNull(outputs.contracts) ??
      numberOrNull(outputs.positionSize) ??
      numberOrNull(outputs.positionValue),
    riskPercent: numberOrNull(outputs.riskPercent) ?? numberOrNull(outputs.riskPct) ?? numberOrNull(inputs.riskPercent),
    maxLoss: numberOrNull(outputs.maxLoss) ?? numberOrNull(inputs.maxLoss),
    estimatedReward: numberOrNull(outputs.estimatedReward) ?? numberOrNull(outputs.reward),
    estimatedRR: numberOrNull(outputs.estimatedRR) ?? numberOrNull(outputs.rewardRiskRatio),
  };
}

function riskInputNumbers(risk: any | null): Partial<DecisionDraft['inputs']> {
  const inputs = recordOrNull(risk?.sizing?.inputs) ?? {};
  return {
    buyingPower: numberOrNull(inputs.buyingPower),
    existingPositions: numberOrNull(inputs.openAutomationPositions),
    marketClock: recordOrNull(inputs.clockDecision),
  };
}

function buildUniverseDrafts(bundle: DecisionSourceBundle): DecisionDraft[] {
  return bundle.universeEvaluations.map(evaluation => {
    const type = universeDecisionType(evaluation);
    const selected = evaluation.ranking?.find((item: any) => item?.symbol === evaluation.selectedSymbol) ?? evaluation.ranking?.[0] ?? null;
    return baseDraft({
      decisionId: `decision:universe:${idOf(evaluation)}`,
      session: bundle.session,
      sourceType: 'UniverseEvaluation',
      sourceId: idOf(evaluation),
      collection: 'automation_universe_evaluations',
      timestamp: dateOrNow(evaluation.evaluatedAt ?? evaluation.createdAt),
      decisionType: type,
      symbol: evaluation.selectedSymbol ?? selected?.symbol ?? null,
      contract: evaluation.selectedContractSymbol ?? selected?.contractSymbol ?? null,
      strategy: evaluation.strategyVersionId ?? null,
      marketRegime: null,
      orderIntentId: evaluation.orderIntentId ?? null,
      reasonCodes: [...(evaluation.reasonCodes ?? []), ...(evaluation.riskReasonCodes ?? [])],
      evaluation: {
        signalStrength: numberOrNull(selected?.opportunityScore),
        riskScore: evaluation.riskApproved === true ? 1 : evaluation.riskApproved === false ? 0 : null,
        candidateRank: numberOrNull(selected?.rank),
      },
      inputs: {
        liquidity: recordOrNull(selected),
        spread: numberOrNull(selected?.spreadPct),
        volume: numberOrNull(selected?.volume),
        marketClock: recordOrNull(evaluation.marketClockDecision),
        watchlistRank: numberOrNull(selected?.rank),
      },
      evidenceFields: {
        outcome: evaluation.outcome,
        reasonCodes: evaluation.reasonCodes,
        ranking: evaluation.ranking,
        symbolResults: evaluation.symbolResults,
        marketClockDecision: evaluation.marketClockDecision,
      },
      timeline: timelineEvent(evaluation.evaluatedAt ?? evaluation.createdAt, `Universe decision ${evaluation.outcome}`, 'UniverseEvaluation', idOf(evaluation), type === 'BUY_APPROVED' ? 'info' : 'warning'),
    });
  });
}

function buildCandidateDrafts(bundle: DecisionSourceBundle): DecisionDraft[] {
  return bundle.candidates.map(candidate => {
    const candidateId = idOf(candidate);
    const selection = bundle.selections.find(item => item.tradeCandidateId === candidateId) ?? null;
    const risk = bundle.riskDecisions.find(item => item.tradeCandidateId === candidateId) ?? null;
    const intent = findEntryIntent(candidate, bundle.orderIntents);
    const position = findPositionForIntent(intent, bundle.positions);
    const report = findTradeReportForPosition(position, bundle.tradeReports);
    const selected = selectedContract(selection);
    const ranking = rankingForCandidate(bundle.universeEvaluations, candidateId);
    const c = conditions(candidate);
    const decisionType = candidateDecisionType(candidate);
    return baseDraft({
      decisionId: `decision:candidate:${candidateId}`,
      session: bundle.session,
      sourceType: 'TradeCandidate',
      sourceId: candidateId,
      collection: 'automation_trade_candidates',
      timestamp: dateOrNow(candidate.barTimestamp ?? candidate.createdAt),
      decisionType,
      symbol: candidate.underlying ?? null,
      contract: selected?.symbol ?? intent?.optionSymbol ?? null,
      strategy: candidate.strategyVersionId ?? null,
      tradeId: position ? idOf(position) : null,
      reportId: report?.reportId ?? null,
      orderIntentId: intent ? idOf(intent) : null,
      brokerOrderId: intent?.brokerOrderId ?? null,
      positionId: position ? idOf(position) : null,
      reasonCodes: candidate.reasonCodes?.length ? candidate.reasonCodes : [candidate.status],
      evaluation: {
        confidence: numberOrNull(c.confidence),
        flowScore: numberOrNull(c.flowScore),
        momentumScore: numberOrNull(c.momentumScore),
        trendScore: numberOrNull(c.trendScore),
        marketRegime: typeof c.regime === 'string' ? c.regime : null,
        candidateRank: numberOrNull(ranking?.rank),
        signalStrength: numberOrNull(ranking?.opportunityScore),
        riskScore: risk?.approved === true ? 1 : risk?.approved === false ? 0 : null,
      },
      inputs: {
        liquidity: recordOrNull(selected),
        spread: numberOrNull(selected?.spreadPct),
        volume: numberOrNull(selected?.volume),
        iv: numberOrNull(selected?.iv),
        delta: numberOrNull(selected?.delta),
        marketClock: recordOrNull(candidate.marketClockDecision),
        watchlistRank: numberOrNull(ranking?.rank),
        ...riskInputNumbers(risk),
      },
      riskSnapshot: riskNumbers(risk),
      evidenceFields: {
        candidateStatus: candidate.status,
        reasonCodes: candidate.reasonCodes,
        indicatorSnapshot: candidate.indicatorSnapshot,
        conditions: candidate.conditions,
        marketClockDecision: candidate.marketClockDecision,
        selection: selection ? idOf(selection) : null,
        riskDecision: risk ? idOf(risk) : null,
        orderIntent: intent ? idOf(intent) : null,
      },
      timeline: timelineEvent(candidate.barTimestamp ?? candidate.createdAt, `Candidate ${candidate.status}`, 'TradeCandidate', candidateId, decisionType === 'BUY_APPROVED' ? 'info' : 'warning'),
    });
  });
}

function buildSelectionDrafts(bundle: DecisionSourceBundle): DecisionDraft[] {
  return bundle.selections.map(selection => {
    const candidate = bundle.candidates.find(item => idOf(item) === selection.tradeCandidateId) ?? null;
    const selected = selectedContract(selection);
    const decisionType: DecisionType = selected ? 'BUY_APPROVED' : 'BUY_REJECTED';
    return baseDraft({
      decisionId: `decision:selection:${idOf(selection)}`,
      session: bundle.session,
      sourceType: 'ContractSelection',
      sourceId: idOf(selection),
      collection: 'automation_contract_selections',
      timestamp: dateOrNow(selection.createdAt ?? selection.chainFetchedAt),
      decisionType,
      symbol: selection.underlying ?? candidate?.underlying ?? null,
      contract: selected?.symbol ?? null,
      strategy: candidate?.strategyVersionId ?? null,
      reasonCodes: selected ? ['CONTRACT_SELECTED'] : [selection.noSelectionReason ?? 'NO_CONTRACT_SELECTED'],
      evaluation: {
        confidence: numberOrNull(conditions(candidate).confidence),
        signalStrength: numberOrNull(selected?.score),
        marketRegime: typeof conditions(candidate).regime === 'string' ? String(conditions(candidate).regime) : null,
      },
      inputs: {
        liquidity: selected ? recordOrNull(selected) : null,
        spread: numberOrNull(selected?.spreadPct),
        volume: numberOrNull(selected?.volume),
        iv: numberOrNull(selected?.iv),
        delta: numberOrNull(selected?.delta),
      },
      evidenceFields: {
        consideredCount: selection.consideredCount,
        passedCount: selection.passedCount,
        selected: selected?.symbol,
        noSelectionReason: selection.noSelectionReason,
        rejectedCandidates: (selection.candidates ?? []).filter((item: any) => item?.passed === false).length,
      },
      timeline: timelineEvent(selection.createdAt ?? selection.chainFetchedAt, selected ? 'Contract selected' : 'No contract selected', 'ContractSelection', idOf(selection), selected ? 'info' : 'warning'),
    });
  });
}

function buildRiskDrafts(bundle: DecisionSourceBundle): DecisionDraft[] {
  return bundle.riskDecisions.map(risk => {
    const candidate = bundle.candidates.find(item => idOf(item) === risk.tradeCandidateId) ?? null;
    const selection = bundle.selections.find(item => item.tradeCandidateId === risk.tradeCandidateId) ?? null;
    const selected = selectedContract(selection);
    const intent = findEntryIntent(candidate, bundle.orderIntents);
    const position = findPositionForIntent(intent, bundle.positions);
    const report = findTradeReportForPosition(position, bundle.tradeReports);
    return baseDraft({
      decisionId: `decision:risk:${idOf(risk)}`,
      session: bundle.session,
      sourceType: 'RiskDecision',
      sourceId: idOf(risk),
      collection: 'automation_risk_decisions',
      timestamp: dateOrNow(risk.decidedAt ?? risk.createdAt),
      decisionType: risk.approved ? 'BUY_APPROVED' : 'RISK_REJECTED',
      symbol: candidate?.underlying ?? selection?.underlying ?? null,
      contract: selected?.symbol ?? intent?.optionSymbol ?? null,
      strategy: candidate?.strategyVersionId ?? null,
      tradeId: position ? idOf(position) : null,
      reportId: report?.reportId ?? null,
      orderIntentId: intent ? idOf(intent) : null,
      brokerOrderId: intent?.brokerOrderId ?? null,
      positionId: position ? idOf(position) : null,
      reasonCodes: risk.reasonCodes?.length ? risk.reasonCodes : [risk.approved ? 'RISK_APPROVED' : 'RISK_REJECTED'],
      evaluation: {
        confidence: numberOrNull(conditions(candidate).confidence),
        riskScore: risk.approved ? 1 : 0,
        marketRegime: typeof conditions(candidate).regime === 'string' ? String(conditions(candidate).regime) : null,
      },
      inputs: {
        liquidity: selected ? recordOrNull(selected) : null,
        spread: numberOrNull(selected?.spreadPct),
        volume: numberOrNull(selected?.volume),
        iv: numberOrNull(selected?.iv),
        delta: numberOrNull(selected?.delta),
        ...riskInputNumbers(risk),
      },
      riskSnapshot: riskNumbers(risk),
      evidenceFields: {
        approved: risk.approved,
        reasonCodes: risk.reasonCodes,
        checks: risk.checks,
        sizing: risk.sizing,
      },
      timeline: timelineEvent(risk.decidedAt ?? risk.createdAt, risk.approved ? 'Risk approved' : 'Risk rejected', 'RiskDecision', idOf(risk), risk.approved ? 'info' : 'warning'),
    });
  });
}

function buildIntentDrafts(bundle: DecisionSourceBundle): DecisionDraft[] {
  return bundle.orderIntents.map(intent => {
    const position = findPositionForIntent(intent, bundle.positions);
    const report = findTradeReportForPosition(position, bundle.tradeReports);
    const isExit = intent.intentType === 'EXIT';
    let decisionType: DecisionType = isExit ? 'SELL_APPROVED' : 'BUY_APPROVED';
    if (intent.status === 'BROKER_REJECTED' || intent.status === 'FAILED' || intent.status === 'MANUAL_REVIEW') {
      decisionType = isExit ? 'SELL_REJECTED' : 'BUY_REJECTED';
    }
    const reasonCodes = unique([
      intent.rejectionReason,
      intent.status,
      isExit ? position?.exitReason : null,
      isExit && position?.exitReason ? 'EXIT_TRIGGERED' : null,
    ]);
    return baseDraft({
      decisionId: `decision:intent:${idOf(intent)}`,
      session: bundle.session,
      sourceType: 'OrderIntent',
      sourceId: idOf(intent),
      collection: 'automation_order_intents',
      timestamp: dateOrNow(intent.createdAt ?? intent.submittedAt),
      decisionType,
      symbol: intent.underlying ?? position?.underlying ?? null,
      contract: intent.optionSymbol ?? position?.optionSymbol ?? null,
      strategy: intent.strategyVersionId ?? position?.strategyVersionId ?? null,
      tradeId: position ? idOf(position) : null,
      reportId: report?.reportId ?? null,
      orderIntentId: idOf(intent),
      brokerOrderId: intent.brokerOrderId ?? null,
      positionId: position ? idOf(position) : null,
      reasonCodes,
      riskSnapshot: { positionSize: numberOrNull(intent.quantity) },
      evidenceFields: {
        intentType: intent.intentType,
        direction: intent.direction,
        quantity: intent.quantity,
        limitPrice: intent.limitPrice,
        status: intent.status,
        idempotencyKey: intent.idempotencyKey ? '[redacted]' : null,
      },
      timeline: timelineEvent(intent.createdAt ?? intent.submittedAt, `${intent.intentType} intent ${intent.status}`, 'OrderIntent', idOf(intent), decisionType.endsWith('REJECTED') ? 'warning' : 'info'),
    });
  });
}

function buildPositionExitDrafts(bundle: DecisionSourceBundle): DecisionDraft[] {
  return bundle.positions
    .filter(position => position.exitReason || position.exitIntentId || position.overnightRecoveryRequired)
    .map(position => {
      const report = findTradeReportForPosition(position, bundle.tradeReports);
      const reasonCodes = unique([position.exitReason, position.overnightReason, position.status]);
      return baseDraft({
        decisionId: `decision:position-exit:${idOf(position)}`,
        session: bundle.session,
        sourceType: 'AutomationPosition',
        sourceId: idOf(position),
        collection: 'automation_positions',
        timestamp: dateOrNow(position.exitSubmittedAt ?? position.closedAt ?? position.updatedAt),
        decisionType: 'EXIT_TRIGGERED',
        symbol: position.underlying ?? null,
        contract: position.optionSymbol ?? null,
        strategy: position.strategyVersionId ?? null,
        tradeId: idOf(position),
        reportId: report?.reportId ?? null,
        orderIntentId: position.exitIntentId ?? null,
        brokerOrderId: position.exitBrokerOrderId ?? null,
        positionId: idOf(position),
        reasonCodes: reasonCodes.length ? reasonCodes : ['EXIT_TRIGGERED'],
        riskSnapshot: { positionSize: numberOrNull(position.filledQty) },
        evidenceFields: {
          exitReason: position.exitReason,
          exitPolicy: position.exitPolicy,
          overnightRecoveryRequired: position.overnightRecoveryRequired,
          exitIntentId: position.exitIntentId,
          closedAt: position.closedAt,
        },
        timeline: timelineEvent(position.exitSubmittedAt ?? position.closedAt ?? position.updatedAt, `Exit decision ${position.exitReason ?? position.status}`, 'AutomationPosition', idOf(position), position.exitReason === 'EMERGENCY_STOP' ? 'critical' : 'warning'),
      });
    });
}

function buildEventDrafts(bundle: DecisionSourceBundle): DecisionDraft[] {
  return bundle.events
    .filter(event => /EMERGENCY_STOP|ORDER_TIMEOUT|ORDER_CANCEL|EXIT_TRIGGER|NO_ACTION/.test(event.event))
    .map(event => {
      let decisionType: DecisionType = 'NO_ACTION';
      if (event.event.includes('EMERGENCY_STOP')) decisionType = 'EMERGENCY_STOP';
      else if (event.event.includes('ORDER_TIMEOUT')) decisionType = 'ORDER_TIMEOUT';
      else if (event.event.includes('ORDER_CANCEL')) decisionType = 'ORDER_CANCELLED';
      else if (event.event.includes('EXIT_TRIGGER')) decisionType = 'EXIT_TRIGGERED';
      const reasonCodes = unique([event.event, String((event.payload ?? {}).reason ?? '')]);
      return baseDraft({
        decisionId: `decision:event:${idOf(event) || `${event.timestamp?.getTime?.() ?? Date.now()}:${event.event}`}`,
        session: bundle.session,
        sourceType: 'AutomationEvent',
        sourceId: idOf(event) || event.event,
        collection: 'automation_events',
        timestamp: dateOrNow(event.timestamp),
        decisionType,
        symbol: event.symbol ?? null,
        contract: typeof event.payload?.contract === 'string' ? event.payload.contract : null,
        strategy: null,
        orderIntentId: event.intentId ?? null,
        brokerOrderId: event.brokerOrderId ?? null,
        reasonCodes,
        evidenceFields: {
          event: event.event,
          service: event.service,
          severity: event.severity,
          payload: event.payload,
        },
        timeline: timelineEvent(event.timestamp, event.event, 'AutomationEvent', idOf(event), event.severity ?? 'warning'),
      });
    });
}

function buildDecisionDrafts(bundle: DecisionSourceBundle): DecisionDraft[] {
  return [
    ...buildUniverseDrafts(bundle),
    ...buildCandidateDrafts(bundle),
    ...buildSelectionDrafts(bundle),
    ...buildRiskDrafts(bundle),
    ...buildIntentDrafts(bundle),
    ...buildPositionExitDrafts(bundle),
    ...buildEventDrafts(bundle),
  ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.decisionId.localeCompare(b.decisionId));
}

async function loadDecisionSource(session: any): Promise<DecisionSourceBundle> {
  const window = evidenceWindowForSession(session);
  const [
    tradeReports,
    universeEvaluations,
    candidates,
    selections,
    riskDecisions,
    orderIntents,
    positions,
    events,
  ] = await Promise.all([
    TradeReportModel.find({ sessionId: session.sessionId }).lean(),
    UniverseEvaluationModel.find(sourceQuery(session, 'evaluatedAt', window)).sort({ evaluatedAt: 1 }).lean(),
    TradeCandidateModel.find(sourceQuery(session, 'barTimestamp', window)).sort({ barTimestamp: 1 }).lean(),
    ContractSelectionModel.find(sourceQuery(session, 'createdAt', window)).sort({ createdAt: 1 }).lean(),
    RiskDecisionModel.find(sourceQuery(session, 'decidedAt', window)).sort({ decidedAt: 1 }).lean(),
    OrderIntentModel.find(sourceQuery(session, 'createdAt', window)).sort({ createdAt: 1 }).lean(),
    AutomationPositionModel.find(positionSourceQuery(session, window)).sort({ createdAt: 1 }).lean(),
    AutomationEventModel.find(sourceQuery(session, 'timestamp', window)).sort({ timestamp: 1 }).lean(),
  ]);
  return { session, tradeReports, universeEvaluations, candidates, selections, riskDecisions, orderIntents, positions, events };
}

export async function captureDecisionJournalEntry(draft: DecisionDraft): Promise<CaptureResult> {
  const existing = await DecisionJournalModel.findOne({ decisionId: draft.decisionId });
  if (existing) return { entry: existing, idempotent: true };
  try {
    const entry = await DecisionJournalModel.create(draft);
    return { entry, idempotent: false };
  } catch (error: any) {
    if (error?.code === 11000) {
      const raced = await DecisionJournalModel.findOne({ decisionId: draft.decisionId });
      if (raced) return { entry: raced, idempotent: true };
    }
    throw error;
  }
}

export async function backfillDecisionJournalForSession(sessionId: string): Promise<CaptureResult[]> {
  const session = await TradingSessionModel.findOne({ sessionId }).lean();
  if (!session) throw Object.assign(new Error('Trading session not found'), { status: 404 });
  const bundle = await loadDecisionSource(session);
  const drafts = buildDecisionDrafts(bundle);
  const results: CaptureResult[] = [];
  for (const draft of drafts) {
    results.push(await captureDecisionJournalEntry(draft));
  }
  writeStructuredLog({
    component: 'intelligence',
    module: 'decision-journal',
    event: 'DECISION_JOURNAL_BACKFILLED',
    severity: 'info',
    sessionId,
    context: {
      tradingDate: session.tradingDate,
      generated: results.filter(result => !result.idempotent).length,
      existing: results.filter(result => result.idempotent).length,
      sourceRecords: drafts.length,
    },
  });
  return results;
}

export async function backfillDecisionJournalForDate(tradingDate: string): Promise<CaptureResult[]> {
  assertTradingDate(tradingDate);
  const sessions = await TradingSessionModel.find({ tradingDate }).sort({ updatedAt: -1 }).lean();
  if (!sessions.length) throw Object.assign(new Error('Trading session not found for date'), { status: 404 });
  const results: CaptureResult[] = [];
  for (const session of sessions) {
    results.push(...(await backfillDecisionJournalForSession(session.sessionId)));
  }
  return results;
}

export async function listDecisionJournalEntries(limit = 100): Promise<DecisionJournalHydratedDocument[]> {
  return DecisionJournalModel.find()
    .sort({ timestamp: -1, updatedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 500));
}

export async function getDecisionJournalEntryById(id: string): Promise<DecisionJournalHydratedDocument | null> {
  return DecisionJournalModel.findOne({ decisionId: id });
}

export async function getDecisionJournalEntriesBySession(sessionId: string): Promise<DecisionJournalHydratedDocument[]> {
  const session = await TradingSessionModel.findOne({ sessionId }).lean();
  if (session) {
    const window = evidenceWindowForSession(session);
    return DecisionJournalModel.find({
      $or: [{ sessionId }, { automationSessionId: session.automationSessionId }],
      timestamp: { $gte: window.start, $lt: window.end },
    }).sort({ timestamp: 1 });
  }
  return DecisionJournalModel.find({ $or: [{ sessionId }, { automationSessionId: sessionId }] }).sort({ timestamp: 1 });
}

export async function getDecisionJournalEntriesByTrade(tradeId: string): Promise<DecisionJournalHydratedDocument[]> {
  return DecisionJournalModel.find({ tradeId }).sort({ timestamp: 1 });
}
