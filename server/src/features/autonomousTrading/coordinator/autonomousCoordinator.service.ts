import mongoose from 'mongoose';
import { getMarketStatusSnapshot } from '../../market/services/marketStatus';
import { listWatchlist } from '../../watchlist/watchlist.service';
import { getLatestEventRecord, listEventRecords } from '../../eventIntelligence/storage/eventJournal.service';
import { getLatestDecisionScan, listDecisionScans } from '../../decisionEngine/journal.service';
import { getLatestStrategyRun, runStrategyOrchestrator } from '../../strategyOrchestrator/controllers/orchestrator.service';
import { buildRiskRecommendationFromStrategyRun, getLatestRiskApproval, runRiskReview } from '../../riskEngine/controllers/riskEngine.service';
import { AutomationPositionModel } from '../../automation/models/automationPosition.model';
import { OrderIntentModel } from '../../automation/models/orderIntent.model';
import { BrokerOrderModel } from '../../automation/models/brokerOrder.model';
import { AutomationSessionModel } from '../../automation/models/automationSession.model';
import { AutomationEventModel } from '../../automation/models/automationEvent.model';
import { getAutomationHealth } from '../../automation/services/automationHealth.service';
import { getSchedulerStatus } from '../../automation/services/schedulerController.service';
import { getMonitorStatus } from '../../automation/services/monitorController.service';
import { getBrokerStreamHealth, isBrokerTruthCurrent } from '../../automation/services/orderReconciliation.service';
import { getAutomationRuntime } from '../../automation/services/sessionRecovery.service';
import {
  listLifecycleActive,
  listLifecyclePending,
  listLifecycleTimeline,
} from '../../tradeLifecycle/positionManager/lifecycleOwner.service';
import { buildPipelineTransition } from '../state/pipelineStateMachine';
import {
  emptyPipelineRecord,
  executionSourceForMode,
  normalizeAutonomousMode,
  stablePipelineId,
} from '../contracts/pipelineContract';
import { evaluateAutonomousEntryGate } from '../contracts/entryGate';
import {
  getAutonomousPipeline,
  listAutonomousPipelines,
  upsertAutonomousPipeline,
} from '../storage/autonomousPipelineJournal.service';
import type {
  AutonomousMetricsSource,
  AutonomousOperatorStatus,
  AutonomousOverallHealth,
  AutonomousPipelineTimelineEvent,
  AutonomousServiceHealth,
  AutonomousTradePipelineRecord,
} from '../types/pipelineTypes';

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function iso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
  }
  if (typeof (value as any)?.toISOString === 'function') return (value as any).toISOString();
  return null;
}

function finite(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function modeBanner(mode: ReturnType<typeof normalizeAutonomousMode>): string {
  if (mode === 'AUTONOMOUS_PAPER') return 'AUTONOMOUS PAPER MODE - Paper orders may be submitted.';
  if (mode === 'MANUAL') return 'MANUAL MODE - Autonomous intelligence may inform but may not initiate orders.';
  return 'SHADOW MODE - No broker orders will be submitted.';
}

function displayMode(mode: ReturnType<typeof normalizeAutonomousMode>): AutonomousOperatorStatus['mode'] {
  if (mode === 'AUTONOMOUS_PAPER') return 'Autonomous Paper';
  if (mode === 'MANUAL') return 'Manual';
  return 'Shadow';
}

function statusFromSession(session: any | null, automationReady: boolean): AutonomousOperatorStatus['status'] {
  if (!session) return automationReady ? 'Running' : 'Stopped';
  if (session.status === 'READY') return automationReady ? 'Running' : 'Degraded';
  if (session.status === 'PAUSED') return 'Paused';
  if (session.status === 'STOPPED' || session.status === 'EMERGENCY_STOPPED') return 'Stopped';
  return automationReady ? 'Degraded' : 'Stopped';
}

function marketLabel(raw: unknown): string {
  const value = String(raw ?? 'UNKNOWN').toUpperCase();
  if (value === 'OPEN' || value === 'REGULAR') return 'Open';
  if (value === 'PRE_MARKET') return 'Pre-market';
  if (value === 'AFTER_HOURS') return 'After-hours';
  if (value === 'CLOSED') return 'Closed';
  return value === 'UNKNOWN' ? 'Unknown' : value;
}

function eventSummary(event: any | null): string | null {
  return event?.event?.title ?? event?.event?.summary ?? event?.category ?? null;
}

function decisionExplanation(scan: any | null): string | null {
  return scan?.winner?.thesis ?? scan?.winner?.aiResearch?.explanation ?? scan?.noTradeReason ?? null;
}

function rankOfWinner(scan: any | null): number | null {
  if (!scan?.winner?.id || !Array.isArray(scan?.ranking?.top10)) return scan?.winner ? 1 : null;
  const index = scan.ranking.top10.findIndex((candidate: any) => candidate?.id === scan.winner.id);
  return index >= 0 ? index + 1 : 1;
}

function strategyConflicts(run: any | null): string[] {
  if (!run?.conflicts) return [];
  const conflicts: string[] = [];
  if (run.conflicts.hasConflict) conflicts.push(run.conflicts.explanation ?? 'Strategy conflict detected.');
  if (Array.isArray(run.conflicts.bullishStrategies) && run.conflicts.bullishStrategies.length > 0) {
    conflicts.push(`Bullish: ${run.conflicts.bullishStrategies.join(', ')}`);
  }
  if (Array.isArray(run.conflicts.bearishStrategies) && run.conflicts.bearishStrategies.length > 0) {
    conflicts.push(`Bearish: ${run.conflicts.bearishStrategies.join(', ')}`);
  }
  return conflicts;
}

function latestPipelineState(record: AutonomousTradePipelineRecord): AutonomousTradePipelineRecord['state'] {
  if (record.evaluationContext.evaluationId) return 'COMPLETED';
  if (record.lifecycleContext.state === 'MONITORING') return 'MONITORING';
  if (record.executionContext.brokerOrderId) return 'ENTRY_SUBMITTED';
  if (record.executionContext.requested) return 'ENTRY_REQUESTED';
  if (record.lifecycleContext.lifecycleId) return 'LIFECYCLE_CREATED';
  if (record.riskContext.approved === false) return 'RISK_REJECTED';
  if (record.riskContext.approved === true) return 'RISK_APPROVED';
  if (record.strategyContext.runId) return 'STRATEGY_SELECTED';
  if (record.decisionContext.scanId) return 'OPPORTUNITY_IDENTIFIED';
  if (record.eventContext.eventIds.length > 0) return 'EVENT_DETECTED';
  return 'OBSERVING';
}

function buildPlainLanguageStatus(record: AutonomousTradePipelineRecord): string {
  if (record.blockingReasons.length > 0) {
    return `The system is blocked: ${record.blockingReasons.join(', ')}.`;
  }
  if (record.riskContext.approved === false) {
    return `Risk review rejected ${record.symbol ?? 'the current opportunity'}${
      record.riskContext.reasonCodes.length ? ` because ${record.riskContext.reasonCodes.join(', ')}` : ''
    }.`;
  }
  if (record.lifecycleContext.currentAction) {
    return `The lifecycle manager recommends ${record.lifecycleContext.currentAction} for ${record.optionContract ?? record.symbol ?? 'the current position'}.`;
  }
  if (record.strategyContext.winningStrategy) {
    return `${record.strategyContext.winningStrategy} is leading with ${Math.round((record.strategyContext.confidence ?? 0) * 100)}% confidence.`;
  }
  if (record.decisionContext.recommendation) {
    return `Decision Intelligence recommends ${record.decisionContext.recommendation} for ${record.symbol ?? 'the current opportunity'}.`;
  }
  return 'The autonomous trader is observing and waiting for current subsystem data.';
}

function buildTimeline(record: AutonomousTradePipelineRecord): AutonomousPipelineTimelineEvent[] {
  const events: AutonomousPipelineTimelineEvent[] = [];
  let state: AutonomousTradePipelineRecord['state'] = 'OBSERVING';
  const push = (
    to: AutonomousTradePipelineRecord['state'],
    actor: string,
    event: string,
    reason: string,
    relatedRecords: AutonomousPipelineTimelineEvent['relatedRecords'],
    reasonCode?: string | null
  ) => {
    if (state === to) return;
    events.push(buildPipelineTransition({ from: state, to, actor, event, reason, relatedRecords, reasonCode }));
    state = to;
  };

  if (record.eventContext.eventIds.length > 0) {
    push(
      'EVENT_DETECTED',
      'event-intelligence',
      'Event detected',
      record.eventContext.summary ?? 'Event Intelligence found a market event.',
      record.eventContext.eventIds.map(recordId => ({ subsystem: 'event-intelligence', recordId, collection: 'event_intelligence_events' }))
    );
  }
  if (record.decisionContext.scanId) {
    push(
      'OPPORTUNITY_IDENTIFIED',
      'decision-intelligence',
      'Decision scan completed',
      record.decisionContext.explanation ?? 'Decision Intelligence ranked an opportunity.',
      [{ subsystem: 'decision-intelligence', recordId: record.decisionContext.scanId, collection: 'decision_engine_scans' }]
    );
  }
  if (record.strategyContext.runId) {
    push(
      'STRATEGY_SELECTED',
      'strategy-orchestrator',
      'Strategy selected',
      record.strategyContext.winningStrategy
        ? `${record.strategyContext.winningStrategy} is leading.`
        : 'Strategy Orchestrator completed without a leading strategy.',
      [{ subsystem: 'strategy-orchestrator', recordId: record.strategyContext.runId, collection: 'strategy_orchestrator_runs' }]
    );
  }
  if (record.riskContext.approvalId) {
    push(
      'RISK_REVIEW',
      'risk-engine',
      'Risk review completed',
      record.riskContext.approved ? 'Risk Engine approved the recommendation.' : 'Risk Engine rejected the recommendation.',
      [{ subsystem: 'risk-engine', recordId: record.riskContext.approvalId, collection: 'risk_engine_approvals' }]
    );
    push(
      record.riskContext.approved ? 'RISK_APPROVED' : 'RISK_REJECTED',
      'risk-engine',
      record.riskContext.approved ? 'Risk approved' : 'Risk rejected',
      record.riskContext.reasonCodes.join(', ') || (record.riskContext.approved ? 'Approved by Risk Engine.' : 'Rejected by Risk Engine.'),
      [{ subsystem: 'risk-engine', recordId: record.riskContext.approvalId, collection: 'risk_engine_approvals' }],
      record.riskContext.reasonCodes[0] ?? null
    );
  }
  if (record.lifecycleContext.lifecycleId) {
    push(
      'LIFECYCLE_CREATED',
      'trade-lifecycle',
      'Lifecycle created',
      `Lifecycle state is ${record.lifecycleContext.state ?? 'unknown'}.`,
      [{ subsystem: 'trade-lifecycle', recordId: record.lifecycleContext.lifecycleId, collection: 'trade_lifecycle_records' }]
    );
  }
  if (record.executionContext.requested && record.executionContext.executionIntentId) {
    push(
      record.executionContext.brokerOrderId ? 'ENTRY_SUBMITTED' : 'ENTRY_REQUESTED',
      'execution-gateway',
      record.executionContext.brokerOrderId ? 'Entry submitted' : 'Entry requested',
      record.executionContext.brokerOrderId
        ? 'Existing Execution Gateway submitted a paper order.'
        : 'Execution intent exists; broker order has not been submitted.',
      [{ subsystem: 'execution-gateway', recordId: record.executionContext.executionIntentId, collection: 'automation_order_intents' }]
    );
  }
  if (record.lifecycleContext.state === 'MONITORING') {
    push('MONITORING', 'trade-lifecycle', 'Position monitoring', buildPlainLanguageStatus(record), []);
  }
  if (record.evaluationContext.evaluationId) {
    push(
      'EVALUATING',
      'trade-evaluation',
      'Evaluation started',
      'Existing Trade Evaluation measured the completed outcome.',
      [{ subsystem: 'trade-evaluation', recordId: record.evaluationContext.evaluationId }]
    );
    push('COMPLETED', 'autonomous-coordinator', 'Pipeline completed', 'The opportunity lifecycle is complete.', []);
  } else if (record.state === 'RISK_REJECTED') {
    push('COMPLETED', 'autonomous-coordinator', 'Pipeline completed', 'No trade was submitted.', []);
  }
  return events;
}

export async function buildCurrentAutonomousPipeline(options: {
  persist?: boolean;
  runStrategy?: boolean;
  runRisk?: boolean;
} = {}): Promise<AutonomousTradePipelineRecord> {
  const mode = normalizeAutonomousMode();
  const now = new Date().toISOString();
  if (mongoose.connection?.readyState !== 1) {
    const pipelineId = stablePipelineId({
      mode,
      symbol: null,
      eventIds: [],
      scanId: null,
      strategyRunId: null,
      recommendationId: null,
    });
    const record = emptyPipelineRecord({ pipelineId, mode, symbol: null, optionContract: null, idempotencyKey: pipelineId, now });
    record.state = 'FAILED';
    record.blockingReasons = ['MONGO_DISCONNECTED'];
    record.plainLanguageStatus = 'MongoDB is disconnected, so persisted autonomous pipeline data is unavailable.';
    return record;
  }
  const [event, decision, existingStrategy] = await Promise.all([
    getLatestEventRecord().catch(() => null),
    getLatestDecisionScan().catch(() => null),
    getLatestStrategyRun().catch(() => null),
  ]);
  const strategy = options.runStrategy ? await runStrategyOrchestrator({ persist: options.persist !== false }).catch(() => existingStrategy) : existingStrategy;
  const riskRecommendation = strategy ? buildRiskRecommendationFromStrategyRun(strategy as any) : null;
  const riskReview =
    options.runRisk && riskRecommendation
      ? await runRiskReview({ recommendation: riskRecommendation, persist: options.persist !== false }).catch(() => null)
      : null;
  const latestRisk = riskReview?.record ?? (await getLatestRiskApproval().catch(() => null));
  const eventAny = event as any;
  const decisionAny = decision as any;
  const strategyAny = strategy as any;
  const latestRiskAny = latestRisk as any;
  const symbol = decisionAny?.winner?.symbol ?? strategyAny?.decisionEngineContext?.bestOpportunity?.symbol ?? latestRiskAny?.recommendation?.symbol ?? null;
  const optionContract = decisionAny?.winner?.contract?.symbol ?? latestRiskAny?.recommendation?.contract?.symbol ?? null;
  const eventIds = eventAny ? [eventAny.eventId ?? eventAny.event?.id].filter(Boolean) : [];
  const recommendationId = strategyAny?.recommendation?.riskHandoff?.packageId ?? latestRiskAny?.recommendation?.recommendationId ?? null;
  const pipelineId = stablePipelineId({
    mode,
    symbol,
    eventIds,
    scanId: decisionAny?.scanId ?? null,
    strategyRunId: strategyAny?.runId ?? null,
    recommendationId,
  });
  const existing = await getAutonomousPipeline(pipelineId).catch(() => null);
  const record = existing ?? emptyPipelineRecord({ pipelineId, mode, symbol, optionContract, idempotencyKey: pipelineId, now });
  record.updatedAt = now;
  record.mode = mode;
  record.executionSource = executionSourceForMode(mode);
  record.symbol = symbol;
  record.optionContract = optionContract;
  record.eventContext = {
    eventIds,
    importance: finite(eventAny?.importance ?? eventAny?.event?.importance),
    sentiment: eventAny?.event?.sentiment?.score ?? eventAny?.event?.sentiment?.label ?? null,
    summary: eventSummary(event),
  };
  record.decisionContext = {
    scanId: decisionAny?.scanId ?? null,
    opportunityScore: finite(decisionAny?.winner?.overallScore),
    rank: rankOfWinner(decision),
    recommendation: decisionAny?.winner?.recommendation ?? null,
    explanation: decisionExplanation(decision),
  };
  record.strategyContext = {
    runId: strategyAny?.runId ?? null,
    winningStrategy: strategyAny?.winner?.name ?? null,
    confidence: finite(strategyAny?.recommendation?.confidence ?? strategyAny?.winner?.confidence),
    evidenceScore: finite(strategyAny?.evidence?.score ?? strategyAny?.winner?.evidenceScore),
    conflicts: strategyConflicts(strategy),
  };
  record.riskContext = {
    approvalId: latestRiskAny?.approvalId ?? null,
    approved: latestRiskAny?.approval?.approved ?? null,
    suggestedContracts: finite(latestRiskAny?.approval?.suggestedPositionSize?.suggestedContracts),
    dollarRisk: finite(latestRiskAny?.approval?.suggestedPositionSize?.dollarRisk),
    reasonCodes: latestRiskAny?.reasonCodes ?? latestRiskAny?.approval?.reasons?.map((reason: any) => reason.code) ?? [],
    warnings: latestRiskAny?.approval?.warnings ?? [],
    expiresAt: latestRiskAny?.timestamp ? new Date(Date.parse(latestRiskAny.timestamp) + 5 * 60_000).toISOString() : null,
  };

  const [lifecycle, intent] = await Promise.all([
    optionContract
      ? listLifecycleActive().then(items => items.find((item: any) => item.optionSymbol === optionContract) ?? null).catch(() => null)
      : Promise.resolve(null),
    recommendationId
      ? OrderIntentModel.findOne({ idempotencyKey: recommendationId }).sort({ createdAt: -1 }).lean().catch(() => null)
      : Promise.resolve(null),
  ]);
  const brokerOrder =
    intent?.brokerOrderId
      ? await BrokerOrderModel.findOne({ brokerOrderId: intent.brokerOrderId }).lean().catch(() => null)
      : null;

  record.lifecycleContext = {
    lifecycleId: lifecycle?.tradeId ?? lifecycle?._id?.toString?.() ?? null,
    state: lifecycle?.state ?? null,
    currentAction: lifecycle?.currentAction ?? null,
    currentConfidence: finite(lifecycle?.confidence?.current),
    nextEvaluationAt: iso(lifecycle?.nextEvaluationAt),
  };
  record.executionContext = {
    requested: Boolean(intent),
    executionIntentId: intent?._id ? String(intent._id) : null,
    brokerOrderId: intent?.brokerOrderId ?? brokerOrder?.brokerOrderId ?? null,
    status: intent?.status ?? brokerOrder?.status ?? null,
    paper: mode !== 'SHADOW',
    source: executionSourceForMode(mode),
  };
  record.evaluationContext = {
    evaluationId: lifecycle?.evaluationReportId ?? null,
    status: lifecycle?.evaluationSummary ? 'COMPLETED' : null,
    outcome: (lifecycle?.evaluationSummary as any)?.winLoss ?? null,
    returnPct: finite((lifecycle?.evaluationSummary as any)?.return),
  };

  const health = await getAutomationHealth().catch(() => null);
  const gate = evaluateAutonomousEntryGate({
    autonomousTradingEnabled: envBool('AUTONOMOUS_TRADING_ENABLED', false),
    autonomousEntryEnabled: envBool('AUTONOMOUS_ENTRY_ENABLED', false),
    mode,
    alpacaPaperConfirmed: health?.gates?.brokerMode?.status === 'pass',
    marketOpen: health?.gates?.marketClock?.state === 'OPEN',
    automationReady: Boolean(health?.automationReady),
    mongoConnected: mongoose.connection?.readyState === 1,
    brokerTruthCurrent: isBrokerTruthCurrent(),
    executionLeaseOwned: getSchedulerStatus().lastTick?.ownsLease === true,
    emergencyStopActive: Boolean((await latestSession().catch(() => null))?.emergencyStop?.active),
    riskApprovalExists: Boolean(record.riskContext.approvalId),
    riskApproved: record.riskContext.approved === true,
    riskApprovalExpired: record.riskContext.expiresAt ? Date.parse(record.riskContext.expiresAt) < Date.now() : false,
    recommendationMatchesApproval: !recommendationId || latestRiskAny?.recommendation?.recommendationId === recommendationId,
    lifecycleAlreadyExists: Boolean(record.lifecycleContext.lifecycleId),
    duplicateOrderIntentExists: Boolean(record.executionContext.executionIntentId),
    positionAndOrderLimitsPermitEntry: !(await hasOpenAutomationPosition().catch(() => true)),
  });
  record.blockingReasons = gate.allowed || mode !== 'AUTONOMOUS_PAPER' ? [] : gate.reasonCodes;
  record.state = record.blockingReasons.length > 0 && record.riskContext.approved ? 'ENTRY_BLOCKED' : latestPipelineState(record);
  record.plainLanguageStatus = buildPlainLanguageStatus(record);
  record.timeline = buildTimeline(record);

  if (options.persist !== false && mongoose.connection?.readyState === 1) {
    return upsertAutonomousPipeline(record);
  }
  return record;
}

async function latestSession() {
  return AutomationSessionModel.findOne({}).sort({ updatedAt: -1 }).lean();
}

async function hasOpenAutomationPosition(): Promise<boolean> {
  const count = await AutomationPositionModel.countDocuments({ status: { $in: ['PENDING_ENTRY', 'OPEN', 'EXITING'] } });
  return count > 0;
}

export async function getAutonomousStatus(): Promise<AutonomousOperatorStatus> {
  if (mongoose.connection?.readyState !== 1) {
    const mode = normalizeAutonomousMode();
    return {
      generatedAt: new Date().toISOString(),
      status: 'Stopped',
      mode: displayMode(mode),
      modeBanner: modeBanner(mode),
      market: 'Unknown',
      broker: 'Alpaca Paper',
      automationOwner: 'Unknown',
      marketData: 'Unavailable',
      nextEvaluationAt: null,
      emergencyStop: 'Unknown',
      watching: [],
      currentActivity: 'MongoDB is disconnected, so autonomous trading status is unavailable.',
      latestPipelineId: null,
      featureFlags: getAutonomousFeatureFlags(),
    };
  }
  const [pipeline, health, scheduler, session, watchlist, market] = await Promise.all([
    buildCurrentAutonomousPipeline({ persist: false }).catch(() => null),
    getAutomationHealth().catch(() => null),
    Promise.resolve(getSchedulerStatus()),
    latestSession().catch(() => null),
    listWatchlist().catch(() => []),
    getMarketStatusSnapshot().catch(() => null),
  ]);
  const mode = normalizeAutonomousMode();
  const watching = watchlist.filter((item: any) => item.enabled !== false).map((item: any) => item.symbol).filter(Boolean);
  const marketClock = health?.gates?.marketClock?.state ?? market?.market ?? 'UNKNOWN';
  const massiveGate = health?.gates?.massiveMarketData;
  return {
    generatedAt: new Date().toISOString(),
    status: statusFromSession(session, Boolean(health?.automationReady)),
    mode: displayMode(mode),
    modeBanner: modeBanner(mode),
    market: marketLabel(marketClock),
    broker: 'Alpaca Paper',
    automationOwner: scheduler.state === 'ACTIVE' ? 'Owned' : scheduler.state === 'STOPPED' ? 'Not Owned' : 'Unknown',
    marketData: massiveGate?.status === 'pass' ? 'Live' : massiveGate?.status === 'degraded' ? 'Stale' : 'Unavailable',
    nextEvaluationAt: scheduler.nextWindow ?? pipeline?.lifecycleContext.nextEvaluationAt ?? null,
    emergencyStop: session?.emergencyStop?.active === true ? 'Active' : session?.emergencyStop?.active === false ? 'Inactive' : 'Unknown',
    watching,
    currentActivity: buildCurrentActivityNarrative(pipeline, watching, scheduler.nextWindow),
    latestPipelineId: pipeline?.pipelineId ?? null,
    featureFlags: getAutonomousFeatureFlags(),
  };
}

function buildCurrentActivityNarrative(
  pipeline: AutonomousTradePipelineRecord | null,
  watching: string[],
  nextEvaluationAt: string | null
): string {
  const sentences: string[] = [];
  if (watching.length > 0) sentences.push(`The system is monitoring ${watching.join(', ')}.`);
  else sentences.push('No watchlist symbols are currently configured for autonomous monitoring.');
  if (!pipeline) {
    sentences.push('No current autonomous pipeline record is available.');
  } else {
    if (pipeline.eventContext.summary) sentences.push(`${pipeline.eventContext.summary} was detected by Event Intelligence.`);
    else sentences.push('No current Event Intelligence context is available.');
    if (pipeline.strategyContext.winningStrategy) {
      sentences.push(`${pipeline.strategyContext.winningStrategy} is leading with ${Math.round((pipeline.strategyContext.confidence ?? 0) * 100)}% confidence.`);
    } else {
      sentences.push('No current strategy recommendation is available.');
    }
    if (pipeline.riskContext.approved === true) sentences.push('Risk Engine approved the current recommendation.');
    else if (pipeline.riskContext.approved === false) sentences.push(`Risk Engine rejected the current recommendation because ${pipeline.riskContext.reasonCodes.join(', ') || 'risk checks did not pass'}.`);
    else sentences.push('The system is waiting for Risk Engine review.');
    sentences.push(pipeline.plainLanguageStatus);
  }
  if (nextEvaluationAt) sentences.push(`The next evaluation is scheduled for ${nextEvaluationAt}.`);
  return sentences.join(' ');
}

export function getAutonomousFeatureFlags(): Record<string, boolean | string> {
  return {
    AUTONOMOUS_TRADING_ENABLED: envBool('AUTONOMOUS_TRADING_ENABLED', false),
    AUTONOMOUS_TRADING_MODE: String(process.env.AUTONOMOUS_TRADING_MODE ?? 'shadow'),
    AUTONOMOUS_COORDINATOR_AUTO_START: envBool('AUTONOMOUS_COORDINATOR_AUTO_START', false),
    AUTONOMOUS_ENTRY_ENABLED: envBool('AUTONOMOUS_ENTRY_ENABLED', false),
    AUTONOMOUS_EXIT_ENABLED: envBool('AUTONOMOUS_EXIT_ENABLED', false),
    AUTONOMOUS_SHADOW_EXECUTION_ENABLED: envBool('AUTONOMOUS_SHADOW_EXECUTION_ENABLED', true),
    AUTONOMOUS_UI_ENABLED: envBool('AUTONOMOUS_UI_ENABLED', true),
    AUTONOMOUS_METRICS_ENABLED: envBool('AUTONOMOUS_METRICS_ENABLED', true),
  };
}

export async function getAutonomousCurrent() {
  const pipeline = await buildCurrentAutonomousPipeline({ persist: mongoose.connection?.readyState === 1 });
  return { pipeline };
}

export async function getAutonomousActive() {
  const [lifecycleTrades, positions] = await Promise.all([
    listLifecycleActive().catch(() => []),
    AutomationPositionModel.find({ status: { $in: ['PENDING_ENTRY', 'OPEN', 'EXITING'] } }).sort({ updatedAt: -1 }).lean().catch(() => []),
  ]);
  return {
    trades: lifecycleTrades.map((trade: any) => ({
      symbol: trade.underlying,
      contract: trade.optionSymbol,
      entry: null,
      currentMark: null,
      pnl: null,
      lifecycleState: trade.state,
      lifecycleAction: trade.currentAction,
      currentConfidence: trade.confidence?.current ?? null,
      timeHeld: null,
      nextEvaluationAt: iso(trade.nextEvaluationAt),
      ownership: 'AUTONOMOUS',
      trade,
    })),
    positions,
  };
}

export async function getAutonomousPending() {
  const [pipeline, lifecyclePending, intents] = await Promise.all([
    buildCurrentAutonomousPipeline({ persist: false }).catch(() => null),
    listLifecyclePending().catch(() => []),
    OrderIntentModel.find({ status: { $in: ['CREATED', 'APPROVED_AWAITING_EXECUTION', 'SUBMITTING', 'SUBMITTED', 'MANUAL_REVIEW'] } })
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean()
      .catch(() => []),
  ]);
  return {
    trades: lifecyclePending,
    intents,
    current: pipeline
      ? {
          symbol: pipeline.symbol,
          contract: pipeline.optionContract,
          recommendation: pipeline.decisionContext.recommendation,
          winningStrategy: pipeline.strategyContext.winningStrategy,
          evidenceScore: pipeline.strategyContext.evidenceScore,
          riskStatus: pipeline.riskContext.approved == null ? 'PENDING' : pipeline.riskContext.approved ? 'APPROVED' : 'REJECTED',
          entryStatus: pipeline.executionContext.status ?? (pipeline.blockingReasons.length ? 'BLOCKED' : 'WAITING'),
          blockingReason: pipeline.blockingReasons.join(', ') || null,
          ageSeconds: Math.max(0, Math.round((Date.now() - Date.parse(pipeline.updatedAt)) / 1000)),
        }
      : null,
  };
}

export async function getAutonomousRecentDecisions(limit = 20) {
  const [pipelines, decisions, risks, lifecycleEvents] = await Promise.all([
    listAutonomousPipelines(limit).catch(() => []),
    listDecisionScans(limit).catch(() => []),
    getRiskHistory(limit),
    listLifecycleTimeline(undefined, limit).catch(() => []),
  ]);
  const items = [
    ...pipelines.map(pipeline => ({
      time: pipeline.updatedAt,
      symbol: pipeline.symbol,
      action: pipeline.state,
      subsystem: 'Autonomous Coordinator',
      reason: pipeline.plainLanguageStatus,
      pipelineId: pipeline.pipelineId,
    })),
    ...decisions.map((scan: any) => ({
      time: iso(scan.timestamp) ?? iso(scan.createdAt) ?? new Date().toISOString(),
      symbol: scan.winner?.symbol ?? null,
      action: scan.winner?.recommendation ?? 'WATCH',
      subsystem: 'Decision Intelligence',
      reason: decisionExplanation(scan) ?? 'Decision scan completed.',
      pipelineId: null,
    })),
    ...risks.map((risk: any) => ({
      time: iso(risk.timestamp) ?? iso(risk.createdAt) ?? new Date().toISOString(),
      symbol: risk.recommendation?.symbol ?? null,
      action: risk.approval?.approved ? 'APPROVED' : 'REJECTED',
      subsystem: 'Risk Engine',
      reason: risk.reasonCodes?.join(', ') || (risk.approval?.approved ? 'Risk approved.' : 'Risk rejected.'),
      pipelineId: null,
    })),
    ...lifecycleEvents.map((event: any) => ({
      time: iso(event.at ?? event.timestamp) ?? new Date().toISOString(),
      symbol: event.symbol ?? null,
      action: event.eventType ?? event.event ?? 'LIFECYCLE',
      subsystem: event.source ?? event.service ?? 'Trade Lifecycle',
      reason: event.reason ?? 'Lifecycle event recorded.',
      pipelineId: null,
    })),
  ];
  return { decisions: items.sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, limit) };
}

async function getRiskHistory(limit: number) {
  const { listRiskApprovals } = await import('../../riskEngine/controllers/riskEngine.service');
  return listRiskApprovals(limit).catch(() => []);
}

export async function getAutonomousTimeline(limit = 100) {
  const [pipelines, lifecycleEvents, automationEvents] = await Promise.all([
    listAutonomousPipelines(limit).catch(() => []),
    listLifecycleTimeline(undefined, limit).catch(() => []),
    AutomationEventModel.find({}).sort({ timestamp: -1 }).limit(limit).lean().catch(() => []),
  ]);
  const timeline = [
    ...pipelines.flatMap(pipeline =>
      pipeline.timeline.map(event => ({
        ...event,
        pipelineId: pipeline.pipelineId,
        symbol: pipeline.symbol,
      }))
    ),
    ...lifecycleEvents.map((event: any) => ({
      at: iso(event.at ?? event.timestamp) ?? new Date().toISOString(),
      pipelineId: null,
      symbol: event.symbol ?? null,
      event: event.eventType ?? event.event ?? 'Lifecycle event',
      actor: event.source ?? event.service ?? 'trade-lifecycle',
      reason: event.reason ?? 'Lifecycle journal event.',
      state: event.state ?? null,
      relatedRecords: event.tradeId ? [{ subsystem: 'trade-lifecycle', recordId: event.tradeId }] : [],
    })),
    ...automationEvents.map((event: any) => ({
      at: iso(event.timestamp) ?? new Date().toISOString(),
      pipelineId: null,
      symbol: event.symbol ?? null,
      event: event.event ?? 'Automation event',
      actor: event.service ?? 'automation',
      reason: event.payload?.reason ?? event.event ?? 'Automation journal event.',
      state: null,
      relatedRecords: event.intentId ? [{ subsystem: 'execution-gateway', recordId: event.intentId }] : [],
    })),
  ];
  return { events: timeline.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit) };
}

export async function getAutonomousHealth() {
  if (mongoose.connection?.readyState !== 1) {
    const services: AutonomousServiceHealth[] = [
      healthItem('MongoDB', false, null, 'MongoDB disconnected.', true),
      healthItem('Automation scheduler', getSchedulerStatus().state === 'ACTIVE', getSchedulerStatus().lastTickAt, getSchedulerStatus().lastError, true),
      healthItem('Monitor scheduler', getMonitorStatus().state === 'ACTIVE', getMonitorStatus().lastTickAt, getMonitorStatus().lastError, true),
    ];
    return {
      overall: 'BLOCKED' as const,
      generatedAt: new Date().toISOString(),
      explanation: 'MongoDB is disconnected; journal-backed autonomous status is unavailable.',
      services,
    };
  }
  const [automationHealth, scheduler, monitor, latestEvent, latestDecision, latestStrategy, latestRisk] = await Promise.all([
    getAutomationHealth().catch(() => null),
    Promise.resolve(getSchedulerStatus()),
    Promise.resolve(getMonitorStatus()),
    getLatestEventRecord().catch(() => null),
    getLatestDecisionScan().catch(() => null),
    getLatestStrategyRun().catch(() => null),
    getLatestRiskApproval().catch(() => null),
  ]);
  const brokerStream = getBrokerStreamHealth();
  const services: AutonomousServiceHealth[] = [
    healthItem('Massive REST', automationHealth?.gates?.massiveMarketData?.status === 'pass', null, automationHealth?.gates?.massiveMarketData?.detail ?? null, true),
    healthItem('Massive Options WebSocket', brokerStream.state !== 'DISCONNECTED', iso(brokerStream.lastEventAt), brokerStream.state, true),
    healthItem('Massive Stocks WebSocket', true, null, 'No stock websocket freshness reported by current subsystem.', true),
    healthItem('Event Intelligence', Boolean(latestEvent), iso((latestEvent as any)?.timestamp ?? (latestEvent as any)?.createdAt), null, true),
    healthItem('Decision Intelligence', Boolean(latestDecision), iso((latestDecision as any)?.timestamp ?? (latestDecision as any)?.createdAt), null, true),
    healthItem('Strategy Orchestrator', Boolean(latestStrategy), iso((latestStrategy as any)?.timestamp ?? (latestStrategy as any)?.createdAt), null, true),
    healthItem('Risk Engine', Boolean(latestRisk), iso((latestRisk as any)?.timestamp ?? (latestRisk as any)?.createdAt), null, true),
    healthItem('Trade Lifecycle Manager', true, null, null, true),
    healthItem('Execution Gateway', automationHealth?.gates?.brokerMode?.status === 'pass', null, automationHealth?.gates?.brokerMode?.detail ?? null, true),
    healthItem('Alpaca Paper', automationHealth?.gates?.brokerApi?.status === 'pass', null, automationHealth?.gates?.brokerApi?.detail ?? null, true),
    healthItem('Trade Evaluation', true, null, null, true),
    healthItem('MongoDB', mongoose.connection?.readyState === 1, null, mongoose.connection?.readyState === 1 ? null : 'MongoDB disconnected.', true),
    healthItem('Automation scheduler', scheduler.state === 'ACTIVE', scheduler.lastTickAt, scheduler.lastError, true, scheduler.ownerId ? 'Owned' : 'Not Owned'),
    healthItem('Monitor scheduler', monitor.state === 'ACTIVE', monitor.lastTickAt, monitor.lastError, true, monitor.ownerId ? 'Owned' : 'Not Owned'),
  ];
  const overall: AutonomousOverallHealth = services.some(service => service.status === 'BLOCKED')
    ? 'BLOCKED'
    : services.some(service => service.status === 'DEGRADED')
      ? 'DEGRADED'
      : services.every(service => service.status === 'STOPPED')
        ? 'STOPPED'
        : 'HEALTHY';
  return {
    overall,
    generatedAt: new Date().toISOString(),
    explanation: explainHealth(overall, services),
    services,
  };
}

function healthItem(
  name: string,
  ok: boolean,
  dataTimestamp: string | null,
  detail: string | null,
  featureEnabled: boolean,
  ownerStatus: string | null = null
): AutonomousServiceHealth {
  const stale = dataTimestamp ? Date.now() - Date.parse(dataTimestamp) > 10 * 60_000 : !ok;
  return {
    name,
    status: !featureEnabled ? 'STOPPED' : ok ? (stale ? 'DEGRADED' : 'HEALTHY') : 'BLOCKED',
    lastSuccessfulRunAt: ok ? dataTimestamp : null,
    lastAttemptAt: dataTimestamp,
    latencyMs: null,
    dataTimestamp,
    stale,
    staleReason: stale ? detail ?? 'No fresh timestamp is available.' : null,
    lastError: ok ? null : detail,
    featureEnabled,
    ownerStatus,
  };
}

function explainHealth(overall: AutonomousOverallHealth, services: AutonomousServiceHealth[]): string {
  if (overall === 'HEALTHY') return 'Every autonomous trading service is healthy and current.';
  const blocked = services.filter(service => service.status === 'BLOCKED').map(service => service.name);
  if (blocked.length > 0) return `Blocked services: ${blocked.join(', ')}.`;
  const degraded = services.filter(service => service.status === 'DEGRADED').map(service => service.name);
  if (degraded.length > 0) return `Degraded services: ${degraded.join(', ')}.`;
  return 'Autonomous services are stopped.';
}

export async function getAutonomousMetrics() {
  const [pipelines, positions, intents, orders] = await Promise.all([
    listAutonomousPipelines(500).catch(() => []),
    AutomationPositionModel.find({}).limit(1000).lean().catch(() => []),
    OrderIntentModel.find({}).limit(1000).lean().catch(() => []),
    BrokerOrderModel.find({}).limit(1000).lean().catch(() => []),
  ]);
  const sourceNames: AutonomousMetricsSource['source'][] = ['SHADOW_SIMULATION', 'AUTONOMOUS_PAPER', 'MANUAL_PAPER'];
  const sources: AutonomousMetricsSource[] = sourceNames.map(source => {
    const sourcePipelines = pipelines.filter(pipeline => pipeline.executionSource === source);
    const sourcePositions = source === 'AUTONOMOUS_PAPER' ? positions : [];
    const completed = sourcePositions.filter((position: any) => position.status === 'CLOSED');
    const returns = completed.map((position: any) => finite(position.returnPct)).filter((value): value is number => value != null);
    const topReason = topValue(sourcePipelines.flatMap(pipeline => pipeline.riskContext.reasonCodes));
    return {
      source,
      eventsProcessed: sourcePipelines.filter(pipeline => pipeline.eventContext.eventIds.length > 0).length,
      opportunitiesEvaluated: sourcePipelines.filter(pipeline => pipeline.decisionContext.scanId).length,
      strategiesEvaluated: sourcePipelines.filter(pipeline => pipeline.strategyContext.runId).length,
      recommendationsGenerated: sourcePipelines.filter(pipeline => pipeline.decisionContext.recommendation).length,
      riskApprovals: sourcePipelines.filter(pipeline => pipeline.riskContext.approved === true).length,
      riskRejections: sourcePipelines.filter(pipeline => pipeline.riskContext.approved === false).length,
      shadowEntries: source === 'SHADOW_SIMULATION' ? sourcePipelines.filter(pipeline => pipeline.executionContext.requested).length : 0,
      paperEntriesRequested: source === 'AUTONOMOUS_PAPER' ? intents.filter((intent: any) => intent.intentType === 'ENTRY').length : 0,
      ordersSubmitted: source === 'AUTONOMOUS_PAPER' ? orders.length : 0,
      ordersFilled: source === 'AUTONOMOUS_PAPER' ? orders.filter((order: any) => String(order.status).toUpperCase().includes('FILL')).length : 0,
      entryFailures: sourcePipelines.filter(pipeline => pipeline.state === 'ENTRY_BLOCKED' || pipeline.state === 'FAILED').length,
      lifecycleEvaluations: sourcePipelines.filter(pipeline => pipeline.lifecycleContext.lifecycleId).length,
      exitRecommendations: sourcePositions.filter((position: any) => position.exitReason).length,
      exitOrders: source === 'AUTONOMOUS_PAPER' ? intents.filter((intent: any) => intent.intentType === 'EXIT').length : 0,
      completedTrades: completed.length,
      winRate: completed.length ? completed.filter((position: any) => finite(position.realizedPnl) != null && finite(position.realizedPnl)! > 0).length / completed.length : null,
      averageReturn: returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null,
      averageHoldTimeMinutes: null,
      maximumDrawdown: minNumber(sourcePositions.map((position: any) => finite(position.maxAdverseExcursion))),
      topRejectionReason: topReason,
      staleDataBlocks: sourcePipelines.filter(pipeline => pipeline.blockingReasons.some(reason => reason.includes('STALE'))).length,
      duplicateOrderBlocks: sourcePipelines.filter(pipeline => pipeline.blockingReasons.includes('DUPLICATE_ORDER_INTENT')).length,
    };
  });
  return { generatedAt: new Date().toISOString(), sources };
}

function topValue(values: string[]): string | null {
  const counts = new Map<string, number>();
  values.forEach(value => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function minNumber(values: Array<number | null>): number | null {
  const finiteValues = values.filter((value): value is number => value != null);
  return finiteValues.length ? Math.min(...finiteValues) : null;
}

export async function getAutonomousPipelineById(pipelineId: string) {
  const pipeline = await getAutonomousPipeline(pipelineId);
  if (!pipeline) throw Object.assign(new Error('AUTONOMOUS_PIPELINE_NOT_FOUND'), { status: 404 });
  return { pipeline };
}

export function getRuntimeExecutionMode() {
  const runtime = getAutomationRuntime();
  return runtime.adapter?.describe?.() ?? null;
}
