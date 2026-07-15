import mongoose from 'mongoose';
import {
  getExecutionConfig,
  getOptionsFlowConfig,
  getStrategyConfig,
  REASON,
  type AutomationStrategyConfig,
} from '../automation.config';
import { MongoUnavailableError, NotFoundError } from '../automation.errors';
import { AutomationSessionModel, type AutomationSessionDocument } from '../models/automationSession.model';
import { ContractSelectionModel } from '../models/contractSelection.model';
import { OrderIntentModel, type OrderIntentDocument } from '../models/orderIntent.model';
import {
  OptionsFlowSnapshotModel,
  type OptionsFlowSnapshotContract,
  type OptionsFlowSnapshotDocument,
} from '../models/optionsFlowSnapshot.model';
import { RiskDecisionModel } from '../models/riskDecision.model';
import {
  UniverseEvaluationModel,
  type UniverseEvaluationDocument,
  type UniverseEvaluationOutcome,
} from '../models/universeEvaluation.model';
import { TradeCandidateModel } from '../models/tradeCandidate.model';
import type { ChainCompleteness } from '../../marketData/optionsData.types';
import { logAutomationEvent } from './automationAudit.service';
import type { PaperBrokerAdapter } from './brokerAdapter';
import { fetchOptionChain, type NormalizedChain } from './automationMarketData.service';
import { persistTradeCandidate } from './closedBarProcessor.service';
import { computeEntryLimitPrice } from './entryExecution.service';
import { getMarketClockDecision } from './marketClock.service';
import {
  getAutomationUniverse,
  type WatchlistUniverseSymbol,
} from '../../watchlist/automationUniverseProvider.service';
import { recordWatchlistEvaluation } from '../../watchlist/watchlist.service';
import { createOrderIntent } from './orderIntent.service';
import {
  buildFlowWindowFromSnapshots,
  evaluateOptionsFlow,
  type OptionsNativeSignal,
} from './optionsFlowSignal.service';
import { selectContract } from './optionSelector.service';
import { evaluateRisk } from './riskEngine.service';
import { ensureDailyReset, exchangeTradingDate } from './sessionDailyReset.service';
import { isAutomationReady } from './sessionRecovery.service';

// Sprint 2D — the OPTIONS_NATIVE_FLOW production evaluator.
//
// This is the entry-side counterpart to processUniverseTick (EQUITY_MOMENTUM).
// The schedulerController selects between them via getSignalMode(); NOTHING
// else in the lifecycle changes — the same clock gate, the same deterministic
// contract selector, the same risk engine, and the same idempotent
// APPROVED_AWAITING_EXECUTION intent journal are reused verbatim.
//
//   authorized options chain snapshot → persist baseline (first window)
//   → next completed window → diff cumulative volume → evaluateOptionsFlow()
//   → deterministic direction → selectContract() → evaluateRisk()
//   → one approved intent OR NO_TRADE.
//
// Invariants:
//  * NEVER submits — the only broker calls are read-only (clock, account).
//  * The FIRST window (or the first after a restart / new trading day) persists
//    a baseline and returns BASELINE_INITIALIZED → NO_TRADE. It never trades
//    from a single snapshot.
//  * The signal is a pure function of authorized OPTIONS data. No underlying
//    aggregate, no AI, no inferred quotes. Fails closed on stale/incomplete data.

export type OptionsFlowSymbolFixture = {
  /** Current-window chain snapshot (both sides). Baseline comes from Mongo. */
  current: { call: NormalizedChain | null; put: NormalizedChain | null };
  /** Simulate a provider outage for this symbol (skip + record). */
  failFetch?: boolean;
};

export type OptionsFlowTickFixture = {
  universe?: string[];
  symbols: Record<string, OptionsFlowSymbolFixture>;
  account?: { equity: number; buyingPower: number };
  now?: number;
};

export type OptionsFlowTickResult = {
  evaluation: UniverseEvaluationDocument;
  orderIntent: OrderIntentDocument | null;
  /** Descriptive outcome for scheduler logging (superset of the persisted enum). */
  outcomeLabel: string;
};

/** Risk reasons tied to ONE contract — the next-ranked opportunity may still pass. */
const CONTRACT_SPECIFIC_RISK_REASONS = new Set<string>([
  REASON.RISK_STALE_OPTION_QUOTE,
  REASON.RISK_SPREAD_TOO_WIDE,
  REASON.RISK_NO_VALID_CONTRACT,
]);

type FlowOpportunity = {
  symbol: string;
  direction: 'BULLISH' | 'BEARISH';
  contract: NonNullable<ReturnType<typeof selectContract>['selected']>;
  sideChain: NormalizedChain;
  signal: OptionsNativeSignal;
  candidateId: string;
  observationEnd: number;
  windowAgeMs: number;
  /** Watchlist priority (lower = higher priority); a ranking tiebreak. */
  priority: number;
};

/**
 * Effective per-symbol strategy config: the env defaults overlaid with this
 * symbol's watchlist parameters (DTE window + max spread). Sizing/risk math is
 * untouched — the risk engine is preserved. `maxPositionSize` is recorded on the
 * watchlist item but not yet enforced in sizing (see technical debt).
 */
function effectiveConfigFor(symbol: string, item?: WatchlistUniverseSymbol): AutomationStrategyConfig {
  const base = getStrategyConfig(symbol);
  if (!item) return base;
  return {
    ...base,
    contract: {
      ...base.contract,
      dteMin: item.minDTE,
      dteMax: item.maxDTE,
      maxSpreadPct: item.maxSpreadPercent / 100,
    },
  };
}

/** Deterministic opportunity ranking (spec order). Higher-ranked sorts first. */
function compareOpportunities(a: FlowOpportunity, b: FlowOpportunity): number {
  const liq = (o: FlowOpportunity) => (o.contract.openInterest ?? 0) + (o.contract.volume ?? 0);
  const tilt = (o: FlowOpportunity) => Math.abs(o.signal.featureSnapshot.netPremiumTilt);
  const spread = (o: FlowOpportunity) => o.contract.spreadPct ?? Number.POSITIVE_INFINITY;
  return (
    b.signal.score - a.signal.score || // 1. confidence
    tilt(b) - tilt(a) || // 2. premium flow
    liq(b) - liq(a) || // 3. liquidity
    spread(a) - spread(b) || // 4. spread (tighter first)
    a.priority - b.priority || // 5. watchlist priority
    a.symbol.localeCompare(b.symbol) // absolute deterministic tiebreak
  );
}

function assertMongo(): void {
  if (mongoose.connection?.readyState !== 1) throw new MongoUnavailableError();
}

/** Minimal completeness marker — only `.complete` is read downstream. */
function completenessOf(complete: boolean): ChainCompleteness {
  return { complete, truncated: !complete } as unknown as ChainCompleteness;
}

/** Merge both chain sides into one snapshot for volume differencing. */
function mergeChain(
  underlying: string,
  call: NormalizedChain | null,
  put: NormalizedChain | null,
  now: number
): NormalizedChain | null {
  if (!call && !put) return null;
  const contracts = [...(call?.contracts ?? []), ...(put?.contracts ?? [])];
  const callComplete = call?.completeness ? call.completeness.complete : true;
  const putComplete = put?.completeness ? put.completeness.complete : true;
  return {
    underlying,
    underlyingPrice: call?.underlyingPrice ?? put?.underlyingPrice ?? null,
    fetchedAt: call?.fetchedAt ?? put?.fetchedAt ?? now,
    contracts,
    completeness: completenessOf(callComplete && putComplete),
    underlyingContext: call?.underlyingContext ?? put?.underlyingContext ?? null,
  };
}

/** Persist the current merged chain as the latest baseline (upsert, restart-durable). */
async function persistSnapshot(
  sessionId: string,
  underlying: string,
  chain: NormalizedChain,
  tradingDate: string,
  windowKey: string,
  now: number
): Promise<void> {
  const contracts: OptionsFlowSnapshotContract[] = chain.contracts.map(c => ({
    symbol: c.symbol,
    type: c.type,
    mid: c.mid,
    bid: c.bid,
    ask: c.ask,
    iv: c.iv,
    openInterest: c.openInterest,
    volume: c.volume,
    expiration: c.expiration,
    quoteTimestamp: c.quoteTimestamp,
  }));
  await OptionsFlowSnapshotModel.updateOne(
    { automationSessionId: sessionId, underlying },
    {
      $set: {
        capturedAt: new Date(now),
        tradingDate,
        windowKey,
        underlyingPrice: chain.underlyingPrice,
        complete: chain.completeness ? chain.completeness.complete : true,
        contracts,
      },
    },
    { upsert: true }
  );
}

/** Reconstruct a minimal NormalizedChain from a persisted baseline snapshot. */
function snapshotToChain(doc: OptionsFlowSnapshotDocument): NormalizedChain {
  return {
    underlying: doc.underlying,
    underlyingPrice: doc.underlyingPrice,
    fetchedAt: doc.capturedAt.getTime(),
    contracts: doc.contracts.map(c => ({
      symbol: c.symbol,
      type: c.type,
      strike: null,
      expiration: c.expiration,
      bid: c.bid,
      ask: c.ask,
      mid: c.mid,
      delta: null,
      iv: c.iv,
      openInterest: c.openInterest,
      volume: c.volume,
      quoteTimestamp: c.quoteTimestamp,
      tradable: null,
    })),
    completeness: completenessOf(doc.complete),
  };
}

/**
 * Evaluate one symbol's options flow. Returns an opportunity when a
 * deterministic direction + tradable contract exist, else null (the reason is
 * recorded on a trade candidate). NEVER throws upward — one symbol's failure
 * must not fail the run.
 */
type SymbolFlowResult = { opportunity: FlowOpportunity | null; baselineInitialized: boolean };

async function evaluateSymbolFlow(
  session: AutomationSessionDocument,
  symbol: string,
  config: AutomationStrategyConfig,
  currentCall: NormalizedChain | null,
  currentPut: NormalizedChain | null,
  clockPayload: Record<string, unknown>,
  windowKey: string,
  now: number,
  flowConfig: ReturnType<typeof getOptionsFlowConfig>,
  priority: number
): Promise<SymbolFlowResult> {
  const sessionId = String(session._id);
  const tradingDate = exchangeTradingDate(new Date(now));
  const merged = mergeChain(symbol, currentCall, currentPut, now);

  const recordCandidate = async (status: any, reasonCodes: string[], extra: Record<string, unknown> = {}) => {
    const { candidate } = await persistTradeCandidate(session, symbol, config, new Date(now), {
      status,
      reasonCodes,
      marketClockDecision: clockPayload,
      marketDataHealth: { source: 'options-native-flow', tradingDate, ...extra } as any,
    } as any);
    return candidate;
  };

  // Data availability: an empty/absent chain is a hard data gate, not NO_TRADE.
  if (!merged || merged.contracts.length === 0) {
    await recordCandidate('DATA_REJECTED', [REASON.OPTIONS_DATA_UNAVAILABLE]);
    return { opportunity: null, baselineInitialized: false };
  }

  const baseline = await OptionsFlowSnapshotModel.findOne({ automationSessionId: sessionId, underlying: symbol });
  const baselineValid =
    baseline != null && baseline.tradingDate === tradingDate && baseline.capturedAt.getTime() < now;

  // Always refresh the stored baseline to THIS window for the next evaluation.
  await persistSnapshot(sessionId, symbol, merged, tradingDate, windowKey, now);

  if (!baselineValid) {
    // First window (or first after restart / new trading day): baseline only.
    await recordCandidate('NO_TRADE', [REASON.OPTIONS_BASELINE_INITIALIZED], {
      baselineInitialized: true,
      hadStaleBaseline: baseline != null,
    });
    logAutomationEvent({
      service: 'options-flow',
      event: 'BASELINE_INITIALIZED',
      automationSessionId: sessionId,
      symbol,
      payload: { windowKey, tradingDate, contracts: merged.contracts.length },
    });
    return { opportunity: null, baselineInitialized: true };
  }

  const window = buildFlowWindowFromSnapshots({
    underlying: symbol,
    baseline: snapshotToChain(baseline),
    current: merged,
    observationStart: baseline.capturedAt.getTime(),
    observationEnd: now,
    baselineWindow: null,
  });
  const signal = evaluateOptionsFlow(window, flowConfig, now);

  if (signal.dataRejected) {
    await recordCandidate('DATA_REJECTED', signal.reasonCodes, { featureSnapshot: signal.featureSnapshot });
    return { opportunity: null, baselineInitialized: false };
  }
  if (signal.direction === 'NO_TRADE') {
    await recordCandidate('NO_TRADE', signal.reasonCodes, { featureSnapshot: signal.featureSnapshot });
    return { opportunity: null, baselineInitialized: false };
  }

  // Deterministic direction → contract selection from the direction side chain.
  const sideChain = signal.direction === 'BULLISH' ? currentCall : currentPut;
  if (!sideChain) {
    await recordCandidate('DATA_REJECTED', [REASON.SYMBOL_CHAIN_UNAVAILABLE], {
      featureSnapshot: signal.featureSnapshot,
    });
    return { opportunity: null, baselineInitialized: false };
  }

  const candidate = await recordCandidate('SIGNAL_FOUND', [], {
    featureSnapshot: signal.featureSnapshot,
    direction: signal.direction,
    score: signal.score,
  });
  logAutomationEvent({
    service: 'options-flow',
    event: 'SIGNAL_FOUND',
    automationSessionId: sessionId,
    symbol,
    payload: { direction: signal.direction, score: signal.score, observationEnd: signal.observationEnd },
  });

  const selectionResult = selectContract(signal.direction, sideChain, config, now);
  await ContractSelectionModel.create({
    tradeCandidateId: String(candidate._id),
    automationSessionId: sessionId,
    direction: signal.direction,
    optionSide: selectionResult.optionSide,
    underlying: symbol,
    underlyingPrice: sideChain.underlyingPrice,
    chainFetchedAt: new Date(sideChain.fetchedAt),
    filtersSnapshot: config.contract,
    candidates: selectionResult.candidates,
    consideredCount: selectionResult.consideredCount,
    passedCount: selectionResult.passedCount,
    selected: selectionResult.selected,
    noSelectionReason: selectionResult.noSelectionReason,
  });
  logAutomationEvent({
    service: 'options-flow',
    event: selectionResult.selected ? 'CONTRACT_SELECTED' : 'NO_CONTRACT_SELECTED',
    automationSessionId: sessionId,
    symbol: selectionResult.selected?.symbol ?? symbol,
    payload: {
      considered: selectionResult.consideredCount,
      passed: selectionResult.passedCount,
      noSelectionReason: selectionResult.noSelectionReason,
    },
  });

  if (!selectionResult.selected) {
    candidate.status = 'RISK_REJECTED';
    candidate.reasonCodes = [selectionResult.noSelectionReason ?? REASON.NO_CONTRACT_PASSED_FILTERS];
    await candidate.save();
    return { opportunity: null, baselineInitialized: false };
  }

  return {
    opportunity: {
      symbol,
      direction: signal.direction,
      contract: selectionResult.selected,
      sideChain,
      signal,
      candidateId: String(candidate._id),
      observationEnd: now,
      // Freshness age from the authorized options feed (never an underlying bar).
      windowAgeMs: Math.max(0, now - (window.newestEventTs ?? now)),
      priority,
    },
    baselineInitialized: false,
  };
}

/**
 * Evaluate the configured universe for a session under OPTIONS_NATIVE_FLOW.
 * `fixture` is only honored by test/dev callers; production always fetches live
 * authorized chains. Returns the same UniverseEvaluation record shape as the
 * equity-momentum path so dashboards/audit are mode-agnostic.
 */
export async function processOptionsFlowTick(
  sessionId: string,
  adapter: PaperBrokerAdapter,
  fixture?: OptionsFlowTickFixture
): Promise<OptionsFlowTickResult> {
  assertMongo();
  const session = await AutomationSessionModel.findById(sessionId);
  if (!session) throw new NotFoundError(`Automation session ${sessionId}`);
  const now = fixture?.now ?? Date.now();

  // The Watchlist is the ONLY source of the automation universe. A test/dev
  // caller may still pin symbols via fixture.universe; production always asks
  // the cached Automation Universe Provider (no env symbols, ever).
  const usingWatchlist = !fixture?.universe;
  let universeSymbols: string[];
  let universeItems: Record<string, WatchlistUniverseSymbol> = {};
  let universeSource: string;
  if (fixture?.universe) {
    universeSymbols = fixture.universe.map(s => s.toUpperCase());
    universeSource = 'fixture';
  } else {
    const resolved = await getAutomationUniverse(now);
    universeSymbols = resolved.symbols;
    universeItems = resolved.items;
    universeSource = resolved.source;
  }
  const tradingDateNow = exchangeTradingDate(new Date(now));
  const windowKey = `${tradingDateNow}:${Math.floor(now / (getOptionsFlowConfig().flowWindowMinutes * 60_000))}`;

  const persistEvaluation = async (
    outcome: UniverseEvaluationOutcome,
    fields: Partial<UniverseEvaluationDocument> = {}
  ): Promise<UniverseEvaluationDocument> => {
    const evaluation = await UniverseEvaluationModel.create({
      automationSessionId: sessionId,
      strategyVersionId: session.strategyVersionId,
      evaluatedAt: new Date(now),
      universeSource: `options-native-flow:${universeSource}`,
      configuredSymbols: universeSymbols,
      invalidSymbols: [],
      eligibleSymbols: [],
      symbolResults: [],
      ranking: [],
      riskReasonCodes: [],
      reasonCodes: [],
      outcome,
      ...fields,
    });
    return evaluation;
  };

  // ---- empty universe → FAIL CLOSED (no evaluation, no broker requests) -----
  if (!universeSymbols.length) {
    const emptyReason = usingWatchlist ? REASON.WATCHLIST_EMPTY : REASON.UNIVERSE_NOT_CONFIGURED;
    if (usingWatchlist) {
      logAutomationEvent({
        service: 'options-flow',
        event: 'WATCHLIST_EMPTY',
        severity: 'warning',
        automationSessionId: sessionId,
        payload: { note: 'fail closed — no evaluation, no broker requests' },
      });
    }
    return {
      evaluation: await persistEvaluation('UNIVERSE_NOT_CONFIGURED', { reasonCodes: [emptyReason] }),
      orderIntent: null,
      outcomeLabel: usingWatchlist ? 'WATCHLIST_EMPTY' : 'UNIVERSE_NOT_CONFIGURED',
    };
  }

  // ---- session gates ------------------------------------------------------
  const gateReasons: string[] = [];
  if (session.status !== 'READY') gateReasons.push(REASON.SESSION_NOT_READY);
  if (session.reconciliationStatus !== 'CLEAN') gateReasons.push(REASON.RECONCILIATION_NOT_CLEAN);
  if (session.emergencyStop.active) gateReasons.push(REASON.EMERGENCY_STOP_ACTIVE);
  if (!isAutomationReady()) gateReasons.push(REASON.AUTOMATION_NOT_READY);
  if (gateReasons.length) {
    return {
      evaluation: await persistEvaluation('GATES_REJECTED', { reasonCodes: gateReasons }),
      orderIntent: null,
      outcomeLabel: 'GATES_REJECTED',
    };
  }

  // ---- authoritative clock ------------------------------------------------
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
      evaluation: await persistEvaluation('CLOCK_REJECTED', { reasonCodes, marketClockDecision: clockPayload }),
      orderIntent: null,
      outcomeLabel: 'CLOCK_REJECTED',
    };
  }

  // ---- account + exchange-day reset ---------------------------------------
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
  if (clock) await ensureDailyReset(session, clock, account, getStrategyConfig(universeSymbols[0]));

  const openAutomationPositions = await OrderIntentModel.countDocuments({
    automationSessionId: sessionId,
    status: { $in: ['SUBMITTED'] },
  });
  const unresolvedAutomationOrders = await OrderIntentModel.countDocuments({
    automationSessionId: sessionId,
    status: { $in: ['SUBMITTING', 'MANUAL_REVIEW', 'APPROVED_AWAITING_EXECUTION'] },
  });

  // ---- per-symbol flow evaluation (independent, never-throwing) ------------
  const baseFlowConfig = getOptionsFlowConfig();
  const opportunities: FlowOpportunity[] = [];
  let baselineInitializedCount = 0;
  for (const symbol of universeSymbols) {
    const item = universeItems[symbol];
    // Per-symbol effective config from the watchlist (DTE window + max spread);
    // per-symbol minConfidence overrides the flow score gate.
    const config = effectiveConfigFor(symbol, item);
    const flowConfig = { ...baseFlowConfig, minScore: item?.minConfidence ?? baseFlowConfig.minScore };
    const priority = item?.priority ?? 100;
    try {
      const entry = fixture ? fixture.symbols[symbol] : undefined;
      let currentCall: NormalizedChain | null;
      let currentPut: NormalizedChain | null;
      if (fixture) {
        if (!entry || entry.failFetch) {
          currentCall = null;
          currentPut = null;
        } else {
          currentCall = entry.current.call;
          currentPut = entry.current.put;
        }
      } else {
        // Live: two authorized direction-specific chain fetches (calls + puts).
        // No underlying price hint — strike bounding uses the options snapshot's
        // own (labeled-delayed) underlying price, never a stock aggregate.
        [currentCall, currentPut] = await Promise.all([
          fetchOptionChain(config, 'BULLISH', null, now).catch(() => null),
          fetchOptionChain(config, 'BEARISH', null, now).catch(() => null),
        ]);
      }

      const { opportunity, baselineInitialized } = await evaluateSymbolFlow(
        session,
        symbol,
        config,
        currentCall,
        currentPut,
        clockPayload,
        windowKey,
        now,
        flowConfig,
        priority
      );
      if (opportunity) opportunities.push(opportunity);
      else if (baselineInitialized) baselineInitializedCount += 1;

      if (usingWatchlist) {
        logAutomationEvent({
          service: 'options-flow',
          event: 'WATCHLIST_SYMBOL_EVALUATED',
          automationSessionId: sessionId,
          symbol,
          payload: { hasOpportunity: opportunity != null, baselineInitialized },
        });
        await recordWatchlistEvaluation(symbol, {
          at: new Date(now),
          signal: opportunity ? opportunity.direction : baselineInitialized ? 'BASELINE' : 'NO_TRADE',
          status: opportunity ? 'EVALUATING' : baselineInitialized ? 'WAITING_FOR_BASELINE' : 'MONITORING',
        });
      }
    } catch (error: any) {
      logAutomationEvent({
        service: 'options-flow',
        event: 'SYMBOL_EVALUATION_ERROR',
        severity: 'warning',
        automationSessionId: sessionId,
        symbol,
        payload: { error: String(error?.message ?? error) },
      });
    }
  }

  // ---- deterministic ranking (confidence → premium flow → liquidity →
  //      spread → watchlist priority → symbol) -------------------------------
  opportunities.sort(compareOpportunities);
  if (opportunities.length && usingWatchlist) {
    const best = opportunities[0];
    logAutomationEvent({
      service: 'options-flow',
      event: 'WATCHLIST_CANDIDATE_SELECTED',
      automationSessionId: sessionId,
      symbol: best.symbol,
      payload: {
        direction: best.direction,
        score: best.signal.score,
        contract: best.contract.symbol,
        priority: best.priority,
        rankedFrom: opportunities.length,
      },
    });
  }

  if (!opportunities.length) {
    const outcomeLabel = baselineInitializedCount > 0 ? 'BASELINE_INITIALIZED' : 'NO_TRADE';
    return {
      evaluation: await persistEvaluation('NO_TRADE', {
        reasonCodes: baselineInitializedCount > 0 ? [REASON.OPTIONS_BASELINE_INITIALIZED] : [],
        marketClockDecision: clockPayload,
      }),
      orderIntent: null,
      outcomeLabel,
    };
  }

  // ---- risk engine: best-first, cascade past contract-specific rejections --
  let orderIntent: OrderIntentDocument | null = null;
  let selected: FlowOpportunity | null = null;
  let riskApproved: boolean | null = null;
  let riskReasonCodes: string[] = [];

  for (const opportunity of opportunities) {
    const config = effectiveConfigFor(opportunity.symbol, universeItems[opportunity.symbol]);
    const risk = evaluateRisk({
      account,
      session: {
        id: sessionId,
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
      candidate: { id: opportunity.candidateId, barTimestamp: opportunity.observationEnd, isDuplicate: false },
      selectedContract: opportunity.contract,
      openAutomationPositions,
      unresolvedAutomationOrders,
      // The options-flow window IS the authorized market read; its freshness
      // stands in for underlying-bar freshness (there is no underlying bar).
      marketDataOk: true,
      underlyingBarAgeMs: opportunity.windowAgeMs,
      clockDecision,
      mongoConnected: mongoose.connection?.readyState === 1,
      automationReady: isAutomationReady(),
      now,
      // Per-symbol watchlist cap on contract quantity (most-restrictive wins).
      maxContracts: universeItems[opportunity.symbol]?.maxPositionSize,
    });

    await RiskDecisionModel.create({
      tradeCandidateId: opportunity.candidateId,
      automationSessionId: sessionId,
      approved: risk.approved,
      reasonCodes: risk.reasonCodes,
      checks: risk.checks,
      sizing: risk.sizing,
      decidedAt: new Date(now),
    });
    await TradeCandidateModel.updateOne(
      { _id: opportunity.candidateId },
      { $set: { status: risk.approved ? 'RISK_APPROVED' : 'RISK_REJECTED', reasonCodes: risk.reasonCodes } }
    );
    logAutomationEvent({
      service: 'options-flow',
      event: risk.approved ? 'RISK_APPROVED' : 'RISK_REJECTED',
      severity: risk.approved ? 'info' : 'warning',
      automationSessionId: sessionId,
      symbol: opportunity.symbol,
      payload: { candidateId: opportunity.candidateId, reasonCodes: risk.reasonCodes },
    });

    if (risk.approved && risk.sizing) {
      selected = opportunity;
      riskApproved = true;
      riskReasonCodes = [];
      const entryLimitPrice =
        computeEntryLimitPrice(opportunity.contract.bid, opportunity.contract.ask, getExecutionConfig()) ??
        opportunity.contract.ask;
      const { intent, created } = await createOrderIntent({
        automationSessionId: sessionId,
        strategyVersionId: session.strategyVersionId,
        underlying: opportunity.symbol,
        signalDirection: 'BUY',
        closedBarTimestamp: new Date(opportunity.observationEnd),
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
        service: 'options-flow',
        event: 'INTENT_APPROVED_AWAITING_EXECUTION',
        automationSessionId: sessionId,
        intentId: String(intent._id),
        symbol: opportunity.contract.symbol,
        payload: {
          underlying: opportunity.symbol,
          direction: opportunity.direction,
          quantity: risk.sizing.outputs.quantity,
          limitPrice: entryLimitPrice,
          signalScore: opportunity.signal.score,
        },
      });
      if (usingWatchlist) {
        // Risk approved → INTENT_APPROVED. A broker-confirmed position is NOT
        // asserted here; POSITION_OPEN is derived from AutomationPosition at read time.
        await recordWatchlistEvaluation(opportunity.symbol, {
          at: new Date(now),
          signal: opportunity.direction,
          status: 'INTENT_APPROVED',
        });
      }
      break;
    }

    riskApproved = false;
    riskReasonCodes = risk.reasonCodes;
    const contractSpecific = risk.reasonCodes.every(reason => CONTRACT_SPECIFIC_RISK_REASONS.has(reason));
    if (!contractSpecific) break; // session-level rejection applies to all opportunities
  }

  const evaluationOutcome: UniverseEvaluationOutcome = orderIntent
    ? 'INTENT_CREATED'
    : riskApproved === false
      ? 'RISK_REJECTED'
      : 'NO_TRADE';

  return {
    evaluation: await persistEvaluation(evaluationOutcome, {
      eligibleSymbols: opportunities.map(o => o.symbol),
      selectedSymbol: selected?.symbol ?? null,
      selectedContractSymbol: selected?.contract.symbol ?? null,
      selectedCandidateId: selected?.candidateId ?? null,
      riskApproved,
      riskReasonCodes,
      orderIntentId: orderIntent ? String(orderIntent._id) : null,
      marketClockDecision: clockPayload,
    }),
    orderIntent,
    outcomeLabel: evaluationOutcome,
  };
}
