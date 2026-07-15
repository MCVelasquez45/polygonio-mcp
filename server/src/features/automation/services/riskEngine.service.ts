import type { AutomationStrategyConfig } from '../automation.config';
import { REASON } from '../automation.config';
import type { BrokerAccount, MarketClockDecision } from '../automation.types';
import type { RankedContract } from '../models/contractSelection.model';
import type { RiskCheckRecord } from '../models/riskDecision.model';
import { computePositionSize, type SizingResult } from './positionSizing.service';

// THE deterministic risk engine.
//
// A pure function of the typed inputs below and nothing else. AI output is
// structurally excluded: there is no field for it, and unknown extra
// properties cannot influence any check (verified by test). The engine
// evaluates EVERY check (no short-circuit) so the persisted record shows the
// complete picture, and approves only when all checks pass.

export type RiskEngineInputs = {
  account: Pick<BrokerAccount, 'equity' | 'buyingPower' | 'isPaper'> | null;
  session: {
    id: string;
    status: string;
    reconciliationStatus: string;
    emergencyStopActive: boolean;
    dailyTradeCount: number;
    dailyRealizedPnl: number;
    consecutiveLossCount: number;
    startingDayEquity: number | null;
    currentDrawdown: number;
  };
  config: AutomationStrategyConfig;
  candidate: {
    id: string;
    barTimestamp: number;
    isDuplicate: boolean;
  };
  selectedContract: Pick<RankedContract, 'symbol' | 'ask' | 'bid' | 'spreadPct' | 'quoteTimestamp'> | null;
  openAutomationPositions: number;
  unresolvedAutomationOrders: number;
  marketDataOk: boolean;
  underlyingBarAgeMs: number;
  clockDecision: Pick<MarketClockDecision, 'state' | 'canEnter'>;
  mongoConnected: boolean;
  automationReady: boolean;
  now: number;
  /**
   * Sprint 2E: per-symbol watchlist max contract quantity (maxPositionSize).
   * Applied as an additional deterministic sizing cap; omitted → no extra cap.
   */
  maxContracts?: number;
};

export type RiskEngineResult = {
  approved: boolean;
  reasonCodes: string[];
  checks: RiskCheckRecord[];
  sizing: SizingResult | null;
};

export function evaluateRisk(inputs: RiskEngineInputs): RiskEngineResult {
  const checks: RiskCheckRecord[] = [];
  const reasonCodes: string[] = [];
  const { config, session, selectedContract } = inputs;

  const push = (name: string, passed: boolean, detail: string, reason: string, observed?: RiskCheckRecord['observed'], limit?: RiskCheckRecord['limit']) => {
    checks.push({ name, passed, detail, observed: observed ?? null, limit: limit ?? null });
    if (!passed) reasonCodes.push(reason);
  };

  // Infrastructure gates
  push('mongoConnected', inputs.mongoConnected, inputs.mongoConnected ? 'MongoDB connected' : 'MongoDB unavailable', REASON.RISK_MONGO_UNAVAILABLE);
  push('automationReady', inputs.automationReady, inputs.automationReady ? 'automation ready' : 'automation not ready', REASON.RISK_AUTOMATION_NOT_READY);
  push(
    'reconciliationClean',
    session.reconciliationStatus === 'CLEAN',
    `session reconciliation=${session.reconciliationStatus}`,
    REASON.RISK_RECONCILIATION_NOT_CLEAN,
    session.reconciliationStatus,
    'CLEAN'
  );
  push('emergencyStopInactive', !session.emergencyStopActive, session.emergencyStopActive ? 'emergency stop ACTIVE' : 'emergency stop inactive', REASON.RISK_EMERGENCY_STOP);

  // Market gates
  push(
    'marketOpen',
    inputs.clockDecision.state === 'OPEN' && inputs.clockDecision.canEnter,
    `clock state=${inputs.clockDecision.state} canEnter=${inputs.clockDecision.canEnter}`,
    REASON.RISK_MARKET_NOT_OPEN,
    inputs.clockDecision.state,
    'OPEN'
  );
  const barFresh = inputs.marketDataOk && inputs.underlyingBarAgeMs <= config.barFreshnessMaxAgeMs;
  push('underlyingBarFresh', barFresh, `bar age ${Math.round(inputs.underlyingBarAgeMs / 1000)}s`, REASON.RISK_STALE_UNDERLYING_BAR, inputs.underlyingBarAgeMs, config.barFreshnessMaxAgeMs);

  // Contract gates
  push('contractSelected', selectedContract != null, selectedContract ? `selected ${selectedContract.symbol}` : 'no contract passed filters', REASON.RISK_NO_VALID_CONTRACT);
  const quoteAgeMs =
    selectedContract?.quoteTimestamp != null
      ? inputs.now - new Date(selectedContract.quoteTimestamp).getTime()
      : null;
  push(
    'optionQuoteFresh',
    selectedContract != null && quoteAgeMs != null && quoteAgeMs <= config.contract.quoteMaxAgeMs,
    quoteAgeMs != null ? `quote age ${Math.round(quoteAgeMs / 1000)}s` : 'no quote timestamp',
    REASON.RISK_STALE_OPTION_QUOTE,
    quoteAgeMs,
    config.contract.quoteMaxAgeMs
  );
  push(
    'spreadAcceptable',
    selectedContract != null && selectedContract.spreadPct != null && selectedContract.spreadPct <= config.contract.maxSpreadPct,
    `spreadPct=${selectedContract?.spreadPct ?? 'n/a'}`,
    REASON.RISK_SPREAD_TOO_WIDE,
    selectedContract?.spreadPct ?? null,
    config.contract.maxSpreadPct
  );

  // Session limits
  const startingEquity = session.startingDayEquity ?? inputs.account?.equity ?? null;
  const dailyLossLimit = startingEquity != null ? startingEquity * config.risk.maxDailyLossPct : null;
  const dailyLossOk = dailyLossLimit == null || -session.dailyRealizedPnl < dailyLossLimit;
  push('dailyLossWithinLimit', dailyLossOk, `dailyRealizedPnl=${session.dailyRealizedPnl}`, REASON.RISK_MAX_DAILY_LOSS, session.dailyRealizedPnl, dailyLossLimit);
  const drawdownLimit = startingEquity != null ? startingEquity * config.risk.maxDrawdownPct : null;
  const drawdownOk = drawdownLimit == null || session.currentDrawdown < drawdownLimit;
  push('drawdownWithinLimit', drawdownOk, `currentDrawdown=${session.currentDrawdown}`, REASON.RISK_MAX_DRAWDOWN, session.currentDrawdown, drawdownLimit);
  push(
    'tradesWithinDailyLimit',
    session.dailyTradeCount < config.risk.maxTradesPerDay,
    `dailyTradeCount=${session.dailyTradeCount}`,
    REASON.RISK_MAX_TRADES,
    session.dailyTradeCount,
    config.risk.maxTradesPerDay
  );
  push(
    'consecutiveLossCooldownInactive',
    session.consecutiveLossCount < config.risk.consecutiveLossPause,
    `consecutiveLossCount=${session.consecutiveLossCount}`,
    REASON.RISK_CONSECUTIVE_LOSS_COOLDOWN,
    session.consecutiveLossCount,
    config.risk.consecutiveLossPause
  );
  push(
    'noExistingAutomationPosition',
    inputs.openAutomationPositions < config.risk.maxConcurrentPositions,
    `openAutomationPositions=${inputs.openAutomationPositions}`,
    REASON.RISK_EXISTING_POSITION,
    inputs.openAutomationPositions,
    config.risk.maxConcurrentPositions
  );
  push(
    'noUnresolvedAutomationOrder',
    inputs.unresolvedAutomationOrders === 0,
    `unresolvedAutomationOrders=${inputs.unresolvedAutomationOrders}`,
    REASON.RISK_UNRESOLVED_ORDER,
    inputs.unresolvedAutomationOrders,
    0
  );
  push('notDuplicateCandidate', !inputs.candidate.isDuplicate, inputs.candidate.isDuplicate ? 'duplicate candidate/intent' : 'unique candidate', REASON.RISK_DUPLICATE_CANDIDATE);

  // Sizing (only meaningful when a contract with a positive ask exists)
  let sizing: SizingResult | null = null;
  if (selectedContract?.ask != null && selectedContract.ask > 0 && inputs.account?.equity != null) {
    sizing = computePositionSize({
      accountEquity: inputs.account.equity,
      buyingPower: inputs.account.buyingPower ?? 0,
      selectedAsk: selectedContract.ask,
      config: config.risk,
      maxContracts: inputs.maxContracts,
    });
    const bpOk = sizing.outputs.buyingPowerCap >= 1;
    push(
      'sufficientBuyingPower',
      bpOk,
      `buyingPowerCap=${sizing.outputs.buyingPowerCap}`,
      REASON.RISK_INSUFFICIENT_BUYING_POWER,
      inputs.account.buyingPower ?? null,
      sizing.outputs.premiumCostPerContract
    );
    push(
      'quantityAtLeastOne',
      sizing.outputs.quantity >= 1,
      `quantity=${sizing.outputs.quantity}${sizing.outputs.rejectedReason ? ` (${sizing.outputs.rejectedReason})` : ''}`,
      REASON.RISK_QUANTITY_BELOW_ONE,
      sizing.outputs.quantity,
      1
    );
  } else {
    push('sufficientBuyingPower', false, 'no account equity or valid ask to size against', REASON.RISK_INSUFFICIENT_BUYING_POWER);
    push('quantityAtLeastOne', false, 'sizing impossible without valid contract/account', REASON.RISK_QUANTITY_BELOW_ONE);
  }

  const approved = checks.every(check => check.passed);
  return { approved, reasonCodes, checks, sizing };
}
