import mongoose from 'mongoose';
import { getExecutionConfig, getStrategyConfig, REASON, type AutomationStrategyConfig } from '../automation.config';
import { computeEntryLimitPrice } from './entryExecution.service';
import { MongoUnavailableError, NotFoundError } from '../automation.errors';
import { AutomationSessionModel, type AutomationSessionDocument } from '../models/automationSession.model';
import { ContractSelectionModel } from '../models/contractSelection.model';
import { OrderIntentModel, type OrderIntentDocument } from '../models/orderIntent.model';
import { RiskDecisionModel } from '../models/riskDecision.model';
import type { TradeCandidateDocument } from '../models/tradeCandidate.model';
import {
  UniverseEvaluationModel,
  type RankedOpportunity,
  type SymbolEvaluationRecord,
  type UniverseEvaluationDocument,
  type UniverseEvaluationOutcome,
} from '../models/universeEvaluation.model';
import { logAutomationEvent } from './automationAudit.service';
import type { PaperBrokerAdapter } from './brokerAdapter';
import { validateClosedBars, type NormalizedChain } from './automationMarketData.service';
import { persistTradeCandidate } from './closedBarProcessor.service';
import { computeIndicatorSnapshot, type AutomationBar } from './indicatorAdapter.service';
import { getMarketClockDecision } from './marketClock.service';
import {
  assessSymbol,
  fetchSymbolData,
  rankEligibleSymbols,
  resolveUniverse,
  type SymbolDataBundle,
  type SymbolEligibility,
} from './marketUniverse.service';
import { createOrderIntent } from './orderIntent.service';
import { selectContract } from './optionSelector.service';
import { evaluateRisk } from './riskEngine.service';
import { ensureDailyReset } from './sessionDailyReset.service';
import { isAutomationReady } from './sessionRecovery.service';
import { evaluateStrategy } from './strategyEvaluator.service';

// Phase 2.6 — the symbol-agnostic universe decision pipeline.
//
//   configured universe → per-symbol validation (skip + record failures)
//   → per-symbol strategy evaluation (identical deterministic rules)
//   → deterministic opportunity ranking → risk engine on the best
//   opportunity → ONE approved intent or NO_TRADE.
//
// Invariants carried over from Phase 2B:
//  * THIS SERVICE NEVER SUBMITS — broker adapter calls are read-only.
//  * One unavailable symbol never fails the run: every per-symbol step is
//    guarded, failures become recorded reason codes.
//  * No ticker symbol appears in this file or anything it imports.

export type UniverseSymbolFixture = {
  bars: AutomationBar[];
  chains: { call: NormalizedChain | null; put: NormalizedChain | null };
  /** Simulate a provider outage for this symbol (skip + record). */
  failFetch?: boolean;
};

export type UniverseTickFixture = {
  /** Override the configured universe (test gate only). */
  universe?: string[];
  symbols: Record<string, UniverseSymbolFixture>;
  account?: { equity: number; buyingPower: number };
  now?: number;
};

export type UniverseTickResult = {
  evaluation: UniverseEvaluationDocument;
  orderIntent: OrderIntentDocument | null;
};

/** Risk reasons tied to ONE contract — the next-ranked opportunity may still pass. */
const CONTRACT_SPECIFIC_RISK_REASONS = new Set<string>([
  REASON.RISK_STALE_OPTION_QUOTE,
  REASON.RISK_SPREAD_TOO_WIDE,
  REASON.RISK_NO_VALID_CONTRACT,
]);

type SymbolOutcome = {
  record: SymbolEvaluationRecord;
  eligibility: SymbolEligibility;
  candidate: TradeCandidateDocument | null;
  opportunity: {
    symbol: string;
    direction: 'BULLISH' | 'BEARISH';
    contract: NonNullable<ReturnType<typeof selectContract>['selected']>;
    contractScore: number;
    symbolScore: number;
    opportunityScore: number;
    closedBarTimestamp: number;
    barAgeMs: number;
    marketDataOk: boolean;
  } | null;
};

function assertMongo(): void {
  if (mongoose.connection?.readyState !== 1) throw new MongoUnavailableError();
}

function bundleFromFixture(symbol: string, fixture: UniverseTickFixture): SymbolDataBundle {
  const entry = fixture.symbols[symbol];
  if (!entry || entry.failFetch) {
    return {
      symbol,
      bars: [],
      health: null,
      chains: { call: null, put: null },
      fetchFailureCodes: [REASON.SYMBOL_DATA_UNAVAILABLE],
    };
  }
  return {
    symbol,
    bars: entry.bars,
    health: {
      source: 'fixture',
      fetchedAt: new Date(fixture.now ?? Date.now()).toISOString(),
      barCount: entry.bars.length,
      underlyingAuthorized: true,
      underlyingReasonCodes: [],
    },
    chains: entry.chains,
    fetchFailureCodes: [],
  };
}

/**
 * Deterministic opportunity score. Contract quality dominates (the selector's
 * deterministic score, weight 10); symbol-level liquidity/freshness quality
 * breaks contract ties. Absolute tiebreak downstream: symbol ascending.
 */
export function computeOpportunityScore(contractScore: number, symbolScore: number): number {
  return Number((contractScore * 10 + symbolScore).toFixed(4));
}

async function evaluateOneSymbol(
  session: AutomationSessionDocument,
  symbol: string,
  bundle: SymbolDataBundle,
  config: AutomationStrategyConfig,
  clockPayload: Record<string, unknown>,
  context: {
    now: number;
    openAutomationPositions: number;
    unresolvedAutomationOrders: number;
  }
): Promise<SymbolOutcome> {
  const { now } = context;
  const eligibility = assessSymbol(bundle, config, now);
  const validation = validateClosedBars(bundle.bars, config, now);
  const healthPayload = (bundle.health ?? { source: 'none' }) as unknown as Record<string, unknown>;

  const record: SymbolEvaluationRecord = {
    symbol,
    eligible: eligibility.eligible,
    reasonCodes: eligibility.reasonCodes,
    symbolScore: eligibility.score,
    barCount: eligibility.barSummary.barCount,
    closedBarTimestamp:
      eligibility.barSummary.closedBarTimestamp != null
        ? new Date(eligibility.barSummary.closedBarTimestamp)
        : null,
    liquidity: eligibility.liquidity as unknown as Record<string, unknown> | null,
    candidateId: null,
    candidateStatus: null,
    direction: null,
  };

  // Ineligible: record the skip; persist an audit candidate when a closed bar
  // exists to key it on (the unique index also dedupes repeated skips).
  if (!eligibility.eligible) {
    if (validation.closedBar) {
      const { candidate } = await persistTradeCandidate(
        session,
        symbol,
        config,
        new Date(validation.closedBar.timestamp),
        {
          status: 'DATA_REJECTED',
          reasonCodes: eligibility.reasonCodes,
          marketClockDecision: clockPayload,
          marketDataHealth: healthPayload,
        } as any
      );
      record.candidateId = String(candidate._id);
      record.candidateStatus = candidate.status;
    }
    return { record, eligibility, candidate: null, opportunity: null };
  }

  const closedBar = validation.closedBar!;
  const barTimestamp = new Date(closedBar.timestamp);

  // Per-symbol monotonic guard: never re-evaluate an already-processed bar.
  const lastProcessed = session.lastProcessedBars.find(entry => entry.symbol === symbol);
  if (lastProcessed && barTimestamp.getTime() <= lastProcessed.barTimestamp.getTime()) {
    const { candidate } = await persistTradeCandidate(session, symbol, config, barTimestamp, {
      status: 'DUPLICATE_SUPPRESSED',
      reasonCodes: [REASON.BAR_NOT_NEWER_THAN_LAST_PROCESSED],
      marketClockDecision: clockPayload,
      marketDataHealth: healthPayload,
    } as any);
    record.candidateId = String(candidate._id);
    record.candidateStatus = candidate.status;
    record.reasonCodes = [REASON.BAR_NOT_NEWER_THAN_LAST_PROCESSED];
    record.eligible = false;
    return { record, eligibility, candidate: null, opportunity: null };
  }

  // Identical deterministic strategy for every symbol in the universe.
  const indicators = computeIndicatorSnapshot(validation.closedBars, config);
  const evaluation = evaluateStrategy(indicators, config, {
    hasOpenAutomationPosition: context.openAutomationPositions > 0,
    hasUnresolvedAutomationOrder: context.unresolvedAutomationOrders > 0,
    dailyTradeCount: session.dailyTradeCount,
    maxTradesPerDay: config.risk.maxTradesPerDay,
  });

  if (!evaluation.direction) {
    const { candidate } = await persistTradeCandidate(session, symbol, config, barTimestamp, {
      status: 'NO_TRADE',
      reasonCodes: evaluation.reasonCodes,
      signalDirection: null,
      indicatorSnapshot: indicators,
      marketClockDecision: clockPayload,
      marketDataHealth: healthPayload,
      conditions: evaluation.conditions as unknown as Record<string, unknown>,
    } as any);
    record.candidateId = String(candidate._id);
    record.candidateStatus = candidate.status;
    return { record, eligibility, candidate, opportunity: null };
  }

  const { candidate, duplicate } = await persistTradeCandidate(session, symbol, config, barTimestamp, {
    status: 'SIGNAL_FOUND',
    reasonCodes: [],
    signalDirection: evaluation.direction,
    indicatorSnapshot: indicators,
    marketClockDecision: clockPayload,
    marketDataHealth: healthPayload,
    conditions: evaluation.conditions as unknown as Record<string, unknown>,
  } as any);
  record.candidateId = String(candidate._id);
  record.candidateStatus = candidate.status;
  record.direction = evaluation.direction;
  if (duplicate) {
    return { record, eligibility, candidate, opportunity: null };
  }
  logAutomationEvent({
    service: 'universe',
    event: 'SIGNAL_FOUND',
    automationSessionId: String(session._id),
    symbol,
    payload: { direction: evaluation.direction, barTimestamp: barTimestamp.toISOString() },
  });

  // Contract selection on the already-fetched, already-validated chain side.
  const chain = evaluation.direction === 'BULLISH' ? bundle.chains.call : bundle.chains.put;
  if (!chain) {
    candidate.status = 'DATA_REJECTED';
    candidate.reasonCodes = [REASON.SYMBOL_CHAIN_UNAVAILABLE];
    await candidate.save();
    record.candidateStatus = candidate.status;
    record.reasonCodes = [...record.reasonCodes, REASON.SYMBOL_CHAIN_UNAVAILABLE];
    return { record, eligibility, candidate, opportunity: null };
  }
  const selectionResult = selectContract(evaluation.direction, chain, config, now);
  await ContractSelectionModel.create({
    tradeCandidateId: String(candidate._id),
    automationSessionId: String(session._id),
    direction: evaluation.direction,
    optionSide: selectionResult.optionSide,
    underlying: symbol,
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
    service: 'universe',
    event: selectionResult.selected ? 'CONTRACT_SELECTED' : 'NO_CONTRACT_SELECTED',
    automationSessionId: String(session._id),
    symbol: selectionResult.selected?.symbol ?? symbol,
    payload: {
      considered: selectionResult.consideredCount,
      passed: selectionResult.passedCount,
      noSelectionReason: selectionResult.noSelectionReason,
    },
  });

  if (!selectionResult.selected) {
    record.reasonCodes = [...record.reasonCodes, selectionResult.noSelectionReason ?? REASON.NO_CONTRACT_PASSED_FILTERS];
    return { record, eligibility, candidate, opportunity: null };
  }

  const barAgeMs = Math.max(0, now - (closedBar.timestamp + config.barTimeframeMinutes * 60_000));
  return {
    record,
    eligibility,
    candidate,
    opportunity: {
      symbol,
      direction: evaluation.direction,
      contract: selectionResult.selected,
      contractScore: selectionResult.selected.score ?? 0,
      symbolScore: eligibility.score,
      opportunityScore: computeOpportunityScore(selectionResult.selected.score ?? 0, eligibility.score),
      closedBarTimestamp: closedBar.timestamp,
      barAgeMs,
      marketDataOk: validation.ok,
    },
  };
}

/**
 * Evaluate the whole configured universe for a session, end to end.
 * `fixture` is only honored when the caller has verified the test/dev gate
 * (see automation.controller) — production paths always load live data.
 */
export async function processUniverseTick(
  sessionId: string,
  adapter: PaperBrokerAdapter,
  fixture?: UniverseTickFixture
): Promise<UniverseTickResult> {
  assertMongo();
  const session = await AutomationSessionModel.findById(sessionId);
  if (!session) throw new NotFoundError(`Automation session ${sessionId}`);
  const now = fixture?.now ?? Date.now();

  const universe = fixture?.universe
    ? { symbols: fixture.universe.map(s => s.toUpperCase()), invalidSymbols: [], source: 'fixture' }
    : resolveUniverse(session.universe);

  const persistEvaluation = async (
    outcome: UniverseEvaluationOutcome,
    fields: Partial<UniverseEvaluationDocument> = {}
  ): Promise<UniverseEvaluationDocument> => {
    const evaluation = await UniverseEvaluationModel.create({
      automationSessionId: String(session._id),
      strategyVersionId: session.strategyVersionId,
      evaluatedAt: new Date(now),
      universeSource: universe.source,
      configuredSymbols: universe.symbols,
      invalidSymbols: universe.invalidSymbols,
      eligibleSymbols: [],
      symbolResults: [],
      ranking: [],
      riskReasonCodes: [],
      reasonCodes: [],
      outcome,
      ...fields,
    });
    logAutomationEvent({
      service: 'universe',
      event: `UNIVERSE_${outcome}`,
      severity: outcome === 'INTENT_CREATED' || outcome === 'NO_TRADE' ? 'info' : 'warning',
      automationSessionId: String(session._id),
      payload: {
        outcome,
        configured: universe.symbols,
        eligible: fields.eligibleSymbols ?? [],
        selectedSymbol: fields.selectedSymbol ?? null,
        reasonCodes: fields.reasonCodes ?? [],
      },
    });
    return evaluation;
  };

  // ---- universe configured at all? ----------------------------------------
  if (!universe.symbols.length) {
    const reasonCodes: string[] = [REASON.UNIVERSE_NOT_CONFIGURED];
    if (universe.invalidSymbols.length) reasonCodes.push(REASON.UNIVERSE_SYMBOL_INVALID);
    return {
      evaluation: await persistEvaluation('UNIVERSE_NOT_CONFIGURED', { reasonCodes }),
      orderIntent: null,
    };
  }

  // ---- session gates (recorded, never silently skipped) --------------------
  const gateReasons: string[] = [];
  if (session.status !== 'READY') gateReasons.push(REASON.SESSION_NOT_READY);
  if (session.reconciliationStatus !== 'CLEAN') gateReasons.push(REASON.RECONCILIATION_NOT_CLEAN);
  if (session.emergencyStop.active) gateReasons.push(REASON.EMERGENCY_STOP_ACTIVE);
  if (!isAutomationReady()) gateReasons.push(REASON.AUTOMATION_NOT_READY);
  if (gateReasons.length) {
    return {
      evaluation: await persistEvaluation('GATES_REJECTED', { reasonCodes: gateReasons }),
      orderIntent: null,
    };
  }

  // ---- market clock, once for the whole universe (US equities/options) -----
  const clockDecision = await getMarketClockDecision(adapter, { force: fixture != null });
  const clockPayload = {
    state: clockDecision.state,
    canEnter: clockDecision.canEnter,
    reasons: clockDecision.reasons,
    decidedAt: clockDecision.decidedAt.toISOString(),
  };
  if (!clockDecision.canEnter) {
    const reasonCodes =
      clockDecision.state === 'UNKNOWN'
        ? [REASON.MARKET_CLOCK_UNKNOWN]
        : clockDecision.state === 'CLOSED'
          ? [REASON.MARKET_CLOSED]
          : [REASON.CLOCK_CONFLICT];
    return {
      evaluation: await persistEvaluation('CLOCK_REJECTED', {
        reasonCodes,
        marketClockDecision: clockPayload,
      }),
      orderIntent: null,
    };
  }

  // ---- account + exchange-day reset ----------------------------------------
  let account = null;
  try {
    account = fixture?.account
      ? {
          accountIdMasked: '****FIXT',
          buyingPower: fixture.account.buyingPower,
          equity: fixture.account.equity,
          cash: null,
          currency: 'USD',
          isPaper: true as const,
        }
      : await adapter.getAccount();
  } catch {
    account = null;
  }
  const clock = await adapter.getClock().catch(() => null);
  // Daily reset thresholds are shared across the universe; any symbol's
  // config resolves the same risk block.
  if (clock) await ensureDailyReset(session, clock, account, getStrategyConfig(universe.symbols[0]));

  // ---- shared strategy context (session-wide, computed once) ---------------
  const openAutomationPositions = await OrderIntentModel.countDocuments({
    automationSessionId: String(session._id),
    status: { $in: ['SUBMITTED'] },
  });
  const unresolvedAutomationOrders = await OrderIntentModel.countDocuments({
    automationSessionId: String(session._id),
    status: { $in: ['SUBMITTING', 'MANUAL_REVIEW', 'APPROVED_AWAITING_EXECUTION'] },
  });

  // ---- per-symbol evaluation: independent, ordered, never-throwing ----------
  const outcomes: SymbolOutcome[] = [];
  for (const symbol of universe.symbols) {
    const config = getStrategyConfig(symbol);
    try {
      const bundle = fixture ? bundleFromFixture(symbol, fixture) : await fetchSymbolData(symbol, now);
      outcomes.push(
        await evaluateOneSymbol(session, symbol, bundle, config, clockPayload, {
          now,
          openAutomationPositions,
          unresolvedAutomationOrders,
        })
      );
    } catch (error: any) {
      // One symbol's failure NEVER fails the universe run.
      logAutomationEvent({
        service: 'universe',
        event: 'SYMBOL_EVALUATION_ERROR',
        severity: 'warning',
        automationSessionId: String(session._id),
        symbol,
        payload: { error: String(error?.message ?? error) },
      });
      outcomes.push({
        record: {
          symbol,
          eligible: false,
          reasonCodes: [REASON.SYMBOL_EVALUATION_ERROR],
          symbolScore: 0,
          barCount: 0,
          closedBarTimestamp: null,
          liquidity: null,
          candidateId: null,
          candidateStatus: null,
          direction: null,
        },
        eligibility: {
          symbol,
          eligible: false,
          reasonCodes: [REASON.SYMBOL_EVALUATION_ERROR],
          barSummary: {
            ok: false,
            barCount: 0,
            closedBarTimestamp: null,
            reasonCodes: [],
            underlyingAuthorized: null,
          },
          liquidity: null,
          score: 0,
        },
        candidate: null,
        opportunity: null,
      });
    }
  }

  const symbolResults = outcomes.map(outcome => outcome.record);
  const eligibleSymbols = rankEligibleSymbols(outcomes.map(outcome => outcome.eligibility)).map(
    entry => entry.symbol
  );
  const dataHealth = {
    evaluatedSymbols: universe.symbols.length,
    eligibleCount: eligibleSymbols.length,
    rejectedCount: universe.symbols.length - eligibleSymbols.length,
  };

  // ---- deterministic opportunity ranking ------------------------------------
  const opportunities = outcomes
    .map(outcome => outcome.opportunity)
    .filter((opportunity): opportunity is NonNullable<SymbolOutcome['opportunity']> => opportunity != null)
    .sort((a, b) => b.opportunityScore - a.opportunityScore || a.symbol.localeCompare(b.symbol));

  const ranking: RankedOpportunity[] = opportunities.map((opportunity, index) => ({
    rank: index + 1,
    symbol: opportunity.symbol,
    direction: opportunity.direction,
    contractSymbol: opportunity.contract.symbol,
    opportunityScore: opportunity.opportunityScore,
    contractScore: opportunity.contractScore,
    symbolScore: opportunity.symbolScore,
    spreadPct: opportunity.contract.spreadPct,
    openInterest: opportunity.contract.openInterest,
    volume: opportunity.contract.volume,
    candidateId:
      outcomes.find(outcome => outcome.opportunity === opportunity)?.record.candidateId ?? null,
  }));

  // ---- advance per-symbol bar cursors (fresh evaluations only) --------------
  for (const outcome of outcomes) {
    const processedTs = outcome.record.closedBarTimestamp;
    if (!processedTs || !outcome.record.candidateId) continue;
    if (outcome.record.candidateStatus === 'DUPLICATE_SUPPRESSED') continue;
    const existing = session.lastProcessedBars.find(entry => entry.symbol === outcome.record.symbol);
    if (existing) {
      if (processedTs.getTime() > existing.barTimestamp.getTime()) existing.barTimestamp = processedTs;
    } else {
      session.lastProcessedBars.push({ symbol: outcome.record.symbol, barTimestamp: processedTs });
    }
  }
  session.markModified('lastProcessedBars');

  if (!opportunities.length) {
    await session.save();
    const outcome: UniverseEvaluationOutcome = eligibleSymbols.length ? 'NO_TRADE' : 'NO_ELIGIBLE_SYMBOLS';
    return {
      evaluation: await persistEvaluation(outcome, {
        eligibleSymbols,
        symbolResults,
        ranking: [],
        reasonCodes: eligibleSymbols.length ? [] : [REASON.NO_ELIGIBLE_SYMBOLS],
        marketClockDecision: clockPayload,
        dataHealth,
      }),
      orderIntent: null,
    };
  }

  // ---- risk engine: highest-ranked first; cascade only past contract-specific
  // rejections (session-level rejections apply to every opportunity) ----------
  let orderIntent: OrderIntentDocument | null = null;
  let selected: (typeof opportunities)[number] | null = null;
  let riskApproved: boolean | null = null;
  let riskReasonCodes: string[] = [];

  for (const opportunity of opportunities) {
    const outcome = outcomes.find(entry => entry.opportunity === opportunity)!;
    const candidate = outcome.candidate!;
    const config = getStrategyConfig(opportunity.symbol);

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
      candidate: {
        id: String(candidate._id),
        barTimestamp: opportunity.closedBarTimestamp,
        isDuplicate: false,
      },
      selectedContract: opportunity.contract,
      openAutomationPositions,
      unresolvedAutomationOrders,
      marketDataOk: opportunity.marketDataOk,
      underlyingBarAgeMs: opportunity.barAgeMs,
      clockDecision,
      mongoConnected: mongoose.connection?.readyState === 1,
      automationReady: isAutomationReady(),
      now,
    });

    await RiskDecisionModel.create({
      tradeCandidateId: String(candidate._id),
      automationSessionId: String(session._id),
      approved: risk.approved,
      reasonCodes: risk.reasonCodes,
      checks: risk.checks,
      sizing: risk.sizing,
      decidedAt: new Date(now),
    });
    logAutomationEvent({
      service: 'universe',
      event: risk.approved ? 'RISK_APPROVED' : 'RISK_REJECTED',
      severity: risk.approved ? 'info' : 'warning',
      automationSessionId: String(session._id),
      symbol: opportunity.symbol,
      payload: { candidateId: String(candidate._id), reasonCodes: risk.reasonCodes },
    });

    candidate.status = risk.approved ? 'RISK_APPROVED' : 'RISK_REJECTED';
    candidate.reasonCodes = risk.reasonCodes;
    await candidate.save();
    outcome.record.candidateStatus = candidate.status;

    if (risk.approved && risk.sizing) {
      selected = opportunity;
      riskApproved = true;
      riskReasonCodes = [];
      // Deterministic entry limit price per the configured policy (MID default),
      // falling back to the ask when bid/ask are unusable.
      const entryLimitPrice =
        computeEntryLimitPrice(opportunity.contract.bid, opportunity.contract.ask, getExecutionConfig()) ??
        opportunity.contract.ask;
      const { intent, created } = await createOrderIntent({
        automationSessionId: String(session._id),
        strategyVersionId: session.strategyVersionId,
        underlying: opportunity.symbol,
        signalDirection: 'BUY', // long calls (bullish) / long puts (bearish)
        closedBarTimestamp: new Date(opportunity.closedBarTimestamp),
        intentType: 'ENTRY',
        optionSymbol: opportunity.contract.symbol,
        quantity: risk.sizing.outputs.quantity,
        orderType: 'limit',
        limitPrice: entryLimitPrice,
        timeInForce: 'day',
      });
      if (created && intent.status === 'CREATED') {
        intent.status = 'APPROVED_AWAITING_EXECUTION';
        await intent.save();
      }
      orderIntent = intent;
      logAutomationEvent({
        service: 'universe',
        event: 'INTENT_APPROVED_AWAITING_EXECUTION',
        automationSessionId: String(session._id),
        intentId: String(intent._id),
        symbol: opportunity.contract.symbol,
        payload: {
          created,
          underlying: opportunity.symbol,
          quantity: risk.sizing.outputs.quantity,
          limitPrice: entryLimitPrice,
          note: 'approved intent — execution wired via Phase 2C scheduler',
        },
      });
      break;
    }

    riskApproved = false;
    riskReasonCodes = risk.reasonCodes;
    const contractSpecific = risk.reasonCodes.every(reason => CONTRACT_SPECIFIC_RISK_REASONS.has(reason));
    if (!contractSpecific) {
      // Session-level rejection (loss limits, positions, clock, …): the same
      // verdict applies to every remaining opportunity — stop the cascade.
      break;
    }
  }

  // Signals that ranked below the decision point are recorded, never traded.
  for (const outcome of outcomes) {
    if (!outcome.opportunity || !outcome.candidate) continue;
    if (outcome.candidate.status !== 'SIGNAL_FOUND') continue;
    outcome.candidate.status = 'RANKED_NOT_SELECTED';
    outcome.candidate.reasonCodes = [REASON.OPPORTUNITY_NOT_SELECTED];
    await outcome.candidate.save();
    outcome.record.candidateStatus = outcome.candidate.status;
  }

  await session.save();

  const evaluationOutcome: UniverseEvaluationOutcome = orderIntent
    ? 'INTENT_CREATED'
    : riskApproved === false
      ? 'RISK_REJECTED'
      : 'NO_TRADE';

  return {
    evaluation: await persistEvaluation(evaluationOutcome, {
      eligibleSymbols,
      symbolResults,
      ranking,
      selectedSymbol: selected?.symbol ?? null,
      selectedContractSymbol: selected?.contract.symbol ?? null,
      selectedCandidateId: selected
        ? (outcomes.find(entry => entry.opportunity === selected)?.record.candidateId ?? null)
        : null,
      riskApproved,
      riskReasonCodes,
      orderIntentId: orderIntent ? String(orderIntent._id) : null,
      marketClockDecision: clockPayload,
      dataHealth,
    }),
    orderIntent,
  };
}
