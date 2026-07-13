import mongoose from 'mongoose';
import { getStrategyConfig, REASON, type AutomationStrategyConfig } from '../automation.config';
import { MongoUnavailableError, NotFoundError } from '../automation.errors';
import { AutomationSessionModel, type AutomationSessionDocument } from '../models/automationSession.model';
import { ContractSelectionModel, type ContractSelectionDocument } from '../models/contractSelection.model';
import { OrderIntentModel, type OrderIntentDocument } from '../models/orderIntent.model';
import { RiskDecisionModel, type RiskDecisionDocument } from '../models/riskDecision.model';
import {
  TradeCandidateModel,
  type TradeCandidateDocument,
  type TradeCandidateStatus,
} from '../models/tradeCandidate.model';
import { logAutomationEvent } from './automationAudit.service';
import type { PaperBrokerAdapter } from './brokerAdapter';
import {
  fetchOptionChain,
  fetchUnderlyingBars,
  validateClosedBars,
  type MarketDataHealth,
  type NormalizedChain,
} from './automationMarketData.service';
import { computeIndicatorSnapshot, type AutomationBar } from './indicatorAdapter.service';
import { getMarketClockDecision } from './marketClock.service';
import { createOrderIntent } from './orderIntent.service';
import { selectContract } from './optionSelector.service';
import { evaluateRisk } from './riskEngine.service';
import { ensureDailyReset } from './sessionDailyReset.service';
import { isAutomationReady } from './sessionRecovery.service';
import { evaluateStrategy } from './strategyEvaluator.service';

// The Phase 2B decision pipeline orchestrator.
//
//   closed bar → validate → indicators → strategy → candidate
//   → chain → deterministic ranking → risk engine → risk decision
//   → idempotent APPROVED_AWAITING_EXECUTION intent → STOP.
//
// THIS SERVICE NEVER SUBMITS. It does not import submitIntent, and the only
// broker adapter calls are read-only (clock, account). Execution is Phase 2C.

export type EvaluateBarFixture = {
  bars: AutomationBar[];
  chain: NormalizedChain;
  account?: { equity: number; buyingPower: number };
  now?: number;
};

export type ProcessResult = {
  candidate: TradeCandidateDocument;
  duplicate: boolean;
  selection: ContractSelectionDocument | null;
  riskDecision: RiskDecisionDocument | null;
  orderIntent: OrderIntentDocument | null;
};

function assertMongo(): void {
  if (mongoose.connection?.readyState !== 1) throw new MongoUnavailableError();
}

async function persistCandidate(
  session: AutomationSessionDocument,
  config: AutomationStrategyConfig,
  barTimestamp: Date,
  fields: Partial<TradeCandidateDocument> & { status: TradeCandidateStatus; reasonCodes: string[] }
): Promise<{ candidate: TradeCandidateDocument; duplicate: boolean }> {
  // Fast path: the bar was already evaluated. Deterministic regardless of
  // index-build timing; the unique index below remains the concurrent guard.
  const existing = await TradeCandidateModel.findOne({
    automationSessionId: String(session._id),
    strategyVersionId: session.strategyVersionId,
    underlying: session.underlying,
    barTimestamp,
  });
  if (existing) {
    logAutomationEvent({
      service: 'closed-bar',
      event: 'DUPLICATE_BAR_SUPPRESSED',
      severity: 'warning',
      automationSessionId: String(session._id),
      payload: { barTimestamp: barTimestamp.toISOString(), existingStatus: existing.status },
    });
    return { candidate: existing, duplicate: true };
  }
  try {
    const candidate = await TradeCandidateModel.create({
      automationSessionId: String(session._id),
      strategyVersionId: session.strategyVersionId,
      underlying: session.underlying,
      barTimestamp,
      signalDirection: fields.signalDirection ?? null,
      status: fields.status,
      reasonCodes: fields.reasonCodes,
      indicatorSnapshot: fields.indicatorSnapshot ?? null,
      marketClockDecision: fields.marketClockDecision ?? null,
      marketDataHealth: fields.marketDataHealth ?? null,
      strategyConfigSnapshot: config,
      conditions: fields.conditions ?? null,
    });
    return { candidate, duplicate: false };
  } catch (error: any) {
    if (error?.code === 11000) {
      // Unique bar key already evaluated — return the original, never re-evaluate.
      const existing = await TradeCandidateModel.findOne({
        automationSessionId: String(session._id),
        strategyVersionId: session.strategyVersionId,
        underlying: session.underlying,
        barTimestamp,
      });
      if (existing) {
        logAutomationEvent({
          service: 'closed-bar',
          event: 'DUPLICATE_BAR_SUPPRESSED',
          severity: 'warning',
          automationSessionId: String(session._id),
          payload: { barTimestamp: barTimestamp.toISOString(), existingStatus: existing.status },
        });
        return { candidate: existing, duplicate: true };
      }
    }
    throw error;
  }
}

/**
 * Evaluate ONE confirmed closed bar for a session, end to end.
 * `fixture` is only honored when the caller has verified the test/dev gate
 * (see automation.controller) — production paths always load live data.
 */
export async function processClosedBar(
  sessionId: string,
  adapter: PaperBrokerAdapter,
  fixture?: EvaluateBarFixture
): Promise<ProcessResult> {
  assertMongo();
  const config = getStrategyConfig();
  const session = await AutomationSessionModel.findById(sessionId);
  if (!session) throw new NotFoundError(`Automation session ${sessionId}`);
  const now = fixture?.now ?? Date.now();

  // ---- session gates (recorded, never silently skipped) -------------------
  const gateReasons: string[] = [];
  if (session.status !== 'READY') gateReasons.push(REASON.SESSION_NOT_READY);
  if (session.reconciliationStatus !== 'CLEAN') gateReasons.push(REASON.RECONCILIATION_NOT_CLEAN);
  if (session.emergencyStop.active) gateReasons.push(REASON.EMERGENCY_STOP_ACTIVE);
  if (!isAutomationReady()) gateReasons.push(REASON.AUTOMATION_NOT_READY);

  // ---- market data ---------------------------------------------------------
  const { bars, health } =
    fixture != null
      ? {
          bars: fixture.bars,
          health: {
            source: 'fixture',
            fetchedAt: new Date(now).toISOString(),
            barCount: fixture.bars.length,
          } as MarketDataHealth,
        }
      : await fetchUnderlyingBars(config);

  const validation = validateClosedBars(bars, config, now);
  if (!validation.closedBar) {
    // No bar at all → nothing to key a candidate on; audit and bail.
    logAutomationEvent({
      service: 'closed-bar',
      event: 'DATA_REJECTED_NO_BARS',
      severity: 'warning',
      automationSessionId: String(session._id),
      payload: { reasonCodes: validation.reasonCodes, health },
    });
    throw new NotFoundError(`No closed ${config.barTimeframeMinutes}m bars for ${config.underlying}`);
  }
  const barTimestamp = new Date(validation.closedBar.timestamp);

  // ---- clock ---------------------------------------------------------------
  const clockDecision = await getMarketClockDecision(adapter, { force: fixture != null });
  const clockPayload = {
    state: clockDecision.state,
    canEnter: clockDecision.canEnter,
    reasons: clockDecision.reasons,
    decidedAt: clockDecision.decidedAt.toISOString(),
  };

  // ---- ordered rejection recording ----------------------------------------
  const reject = async (status: TradeCandidateStatus, reasonCodes: string[], extras: Record<string, unknown> = {}) => {
    const { candidate, duplicate } = await persistCandidate(session, config, barTimestamp, {
      status,
      reasonCodes,
      marketClockDecision: clockPayload,
      marketDataHealth: health as unknown as Record<string, unknown>,
      ...extras,
    } as any);
    logAutomationEvent({
      service: 'closed-bar',
      event: `CANDIDATE_${duplicate ? 'DUPLICATE' : status}`,
      severity: 'info',
      automationSessionId: String(session._id),
      payload: { barTimestamp: barTimestamp.toISOString(), reasonCodes },
    });
    return { candidate, duplicate, selection: null, riskDecision: null, orderIntent: null };
  };

  if (gateReasons.length) return reject('DATA_REJECTED', gateReasons);

  // Underlying-data entitlement gate (Options Advanced alignment): the
  // strategy requires authorized real-time intraday bars. When the provider
  // plan blocks them — or the resolver degraded to delayed/cached/fallback
  // data — no evaluation happens. Fail closed, never evaluate on
  // previous-close data masquerading as live input.
  if (fixture == null && health.underlyingAuthorized === false) {
    return reject('DATA_REJECTED', health.underlyingReasonCodes ?? [REASON.UNDERLYING_DATA_UNAUTHORIZED]);
  }

  // Bar must be strictly newer than the last processed closed bar.
  if (session.lastProcessedClosedBarTs && barTimestamp.getTime() <= session.lastProcessedClosedBarTs.getTime()) {
    return reject('DUPLICATE_SUPPRESSED', [REASON.BAR_NOT_NEWER_THAN_LAST_PROCESSED]);
  }
  if (!validation.ok) return reject('DATA_REJECTED', validation.reasonCodes);
  if (!clockDecision.canEnter) {
    return reject(
      'CLOCK_REJECTED',
      clockDecision.state === 'UNKNOWN'
        ? [REASON.MARKET_CLOCK_UNKNOWN]
        : clockDecision.state === 'CLOSED'
          ? [REASON.MARKET_CLOSED]
          : [REASON.CLOCK_CONFLICT]
    );
  }

  // ---- daily reset (exchange trading day via broker clock) ------------------
  let account = null;
  try {
    account = fixture?.account
      ? { accountIdMasked: '****FIXT', buyingPower: fixture.account.buyingPower, equity: fixture.account.equity, cash: null, currency: 'USD', isPaper: true as const }
      : await adapter.getAccount();
  } catch {
    account = null;
  }
  const clock = await adapter.getClock().catch(() => null);
  if (clock) await ensureDailyReset(session, clock, account, config);

  // ---- indicators + strategy ------------------------------------------------
  const indicators = computeIndicatorSnapshot(validation.closedBars, config);
  const openAutomationPositions = await OrderIntentModel.countDocuments({
    automationSessionId: String(session._id),
    status: { $in: ['SUBMITTED'] },
  });
  const unresolvedAutomationOrders = await OrderIntentModel.countDocuments({
    automationSessionId: String(session._id),
    status: { $in: ['SUBMITTING', 'MANUAL_REVIEW', 'APPROVED_AWAITING_EXECUTION'] },
  });

  const evaluation = evaluateStrategy(indicators, config, {
    hasOpenAutomationPosition: openAutomationPositions > 0,
    hasUnresolvedAutomationOrder: unresolvedAutomationOrders > 0,
    dailyTradeCount: session.dailyTradeCount,
    maxTradesPerDay: config.risk.maxTradesPerDay,
  });

  if (!evaluation.direction) {
    const { candidate, duplicate } = await persistCandidate(session, config, barTimestamp, {
      status: 'NO_TRADE',
      reasonCodes: evaluation.reasonCodes,
      signalDirection: null,
      indicatorSnapshot: indicators,
      marketClockDecision: clockPayload,
      marketDataHealth: health as unknown as Record<string, unknown>,
      conditions: evaluation.conditions as unknown as Record<string, unknown>,
    } as any);
    if (!duplicate) {
      session.lastProcessedClosedBarTs = barTimestamp;
      await session.save();
    }
    logAutomationEvent({
      service: 'closed-bar',
      event: 'CANDIDATE_NO_TRADE',
      automationSessionId: String(session._id),
      payload: { barTimestamp: barTimestamp.toISOString(), reasonCodes: evaluation.reasonCodes },
    });
    return { candidate, duplicate, selection: null, riskDecision: null, orderIntent: null };
  }

  // ---- SIGNAL_FOUND candidate (single insert = the dedupe claim) -------------
  const { candidate, duplicate } = await persistCandidate(session, config, barTimestamp, {
    status: 'SIGNAL_FOUND',
    reasonCodes: [],
    signalDirection: evaluation.direction,
    indicatorSnapshot: indicators,
    marketClockDecision: clockPayload,
    marketDataHealth: health as unknown as Record<string, unknown>,
    conditions: evaluation.conditions as unknown as Record<string, unknown>,
  } as any);
  if (duplicate) {
    return { candidate, duplicate, selection: null, riskDecision: null, orderIntent: null };
  }
  logAutomationEvent({
    service: 'closed-bar',
    event: 'SIGNAL_FOUND',
    automationSessionId: String(session._id),
    payload: { direction: evaluation.direction, barTimestamp: barTimestamp.toISOString() },
  });

  // ---- contract selection -----------------------------------------------------
  // Direction-specific 7–21 DTE window through the shared orchestrator; the
  // last closed bar's price bounds the strike range.
  const chain =
    fixture?.chain ??
    (await fetchOptionChain(config, evaluation.direction, validation.closedBar?.close ?? null, now));
  const selectionResult = selectContract(evaluation.direction, chain, config, now);
  const selection = await ContractSelectionModel.create({
    tradeCandidateId: String(candidate._id),
    automationSessionId: String(session._id),
    direction: evaluation.direction,
    optionSide: selectionResult.optionSide,
    underlying: session.underlying,
    underlyingPrice: chain.underlyingPrice,
    chainFetchedAt: new Date(chain.fetchedAt),
    filtersSnapshot: config.contract,
    candidates: selectionResult.candidates,
    consideredCount: selectionResult.consideredCount,
    passedCount: selectionResult.passedCount,
    selected: selectionResult.selected,
    noSelectionReason: selectionResult.noSelectionReason,
  });
  logAutomationEvent({
    service: 'contract-selection',
    event: selectionResult.selected ? 'CONTRACT_SELECTED' : 'NO_CONTRACT_SELECTED',
    automationSessionId: String(session._id),
    symbol: selectionResult.selected?.symbol ?? session.underlying,
    payload: {
      considered: selectionResult.consideredCount,
      passed: selectionResult.passedCount,
      noSelectionReason: selectionResult.noSelectionReason,
    },
  });

  // ---- risk engine (pure; AI is not an input) ----------------------------------
  const barAgeMs = now - (validation.closedBar.timestamp + config.barTimeframeMinutes * 60_000);
  const risk = evaluateRisk({
    account,
    session: {
      id: String(session._id),
      status: session.status,
      reconciliationStatus: session.reconciliationStatus,
      emergencyStopActive: session.emergencyStop.active,
      dailyTradeCount: session.dailyTradeCount,
      dailyRealizedPnl: session.dailyRealizedPnl,
      consecutiveLossCount: session.consecutiveLossCount,
      startingDayEquity: session.startingDayEquity,
      currentDrawdown: session.currentDrawdown,
    },
    config,
    candidate: { id: String(candidate._id), barTimestamp: barTimestamp.getTime(), isDuplicate: duplicate },
    selectedContract: selectionResult.selected,
    openAutomationPositions,
    unresolvedAutomationOrders,
    marketDataOk: validation.ok,
    underlyingBarAgeMs: Math.max(0, barAgeMs),
    clockDecision,
    mongoConnected: mongoose.connection?.readyState === 1,
    automationReady: isAutomationReady(),
    now,
  });

  const riskDecision = await RiskDecisionModel.create({
    tradeCandidateId: String(candidate._id),
    automationSessionId: String(session._id),
    approved: risk.approved,
    reasonCodes: risk.reasonCodes,
    checks: risk.checks,
    sizing: risk.sizing,
    decidedAt: new Date(now),
  });
  logAutomationEvent({
    service: 'risk-engine',
    event: risk.approved ? 'RISK_APPROVED' : 'RISK_REJECTED',
    severity: risk.approved ? 'info' : 'warning',
    automationSessionId: String(session._id),
    payload: {
      candidateId: String(candidate._id),
      reasonCodes: risk.reasonCodes,
      quantity: risk.sizing?.outputs.quantity ?? null,
    },
  });

  candidate.status = risk.approved ? 'RISK_APPROVED' : 'RISK_REJECTED';
  candidate.reasonCodes = risk.reasonCodes;
  await candidate.save();

  // ---- approved → idempotent intent, then STOP (no submission in Phase 2B) ----
  let orderIntent: OrderIntentDocument | null = null;
  if (risk.approved && selectionResult.selected && risk.sizing) {
    const { intent, created } = await createOrderIntent({
      automationSessionId: String(session._id),
      strategyVersionId: session.strategyVersionId,
      underlying: session.underlying,
      signalDirection: 'BUY', // long calls (bullish) / long puts (bearish)
      closedBarTimestamp: barTimestamp,
      intentType: 'ENTRY',
      optionSymbol: selectionResult.selected.symbol,
      quantity: risk.sizing.outputs.quantity,
      orderType: 'limit',
      limitPrice: selectionResult.selected.ask,
      timeInForce: 'day',
    });
    if (created && intent.status === 'CREATED') {
      intent.status = 'APPROVED_AWAITING_EXECUTION';
      await intent.save();
    }
    orderIntent = intent;
    logAutomationEvent({
      service: 'closed-bar',
      event: 'INTENT_APPROVED_AWAITING_EXECUTION',
      automationSessionId: String(session._id),
      intentId: String(intent._id),
      symbol: selectionResult.selected.symbol,
      payload: {
        created,
        quantity: risk.sizing.outputs.quantity,
        limitPrice: selectionResult.selected.ask,
        note: 'execution deferred to Phase 2C — no broker submission',
      },
    });
  }

  session.lastProcessedClosedBarTs = barTimestamp;
  await session.save();

  return { candidate, duplicate, selection, riskDecision, orderIntent };
}
