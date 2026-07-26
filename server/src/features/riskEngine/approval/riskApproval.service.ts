import { randomUUID } from 'crypto';
import { estimateGreekImpact, normalizeGreeks } from '../greeks/greeks.service';
import { getRiskRuleSet, RISK_REASON_EXPLANATIONS, riskApprovalRequired, riskEngineEnabled } from '../limits/riskRules.service';
import { sectorExposureRatio } from '../portfolio/riskPortfolio.service';
import { estimateCorrelationRisk } from '../correlation/correlation.service';
import { calculatePositionSize } from '../positionSizing/positionSizing.service';
import type {
  ApprovalPackage,
  CorrelationResult,
  RiskCheck,
  RiskPortfolioSnapshot,
  RiskReasonCode,
  RiskRecommendationInput,
  RiskRuleSet,
} from '../types/riskTypes';

function pass(explanation: string, metrics: RiskCheck['supportingMetrics'] = {}): RiskCheck {
  return { code: 'PASSED', passed: true, explanation, supportingMetrics: metrics, suggestedImprovement: null };
}

function fail(
  code: RiskReasonCode,
  metrics: RiskCheck['supportingMetrics'],
  suggestedImprovement: string
): RiskCheck {
  return {
    code,
    passed: false,
    explanation: RISK_REASON_EXPLANATIONS[code],
    supportingMetrics: metrics,
    suggestedImprovement,
  };
}

function isMarketOpen(status: string): boolean {
  return ['open', 'OPEN', 'regular', 'REGULAR'].includes(status);
}

function buildReason(check: RiskCheck): ApprovalPackage['reasons'][number] | null {
  if (check.passed || check.code === 'PASSED') return null;
  return {
    code: check.code,
    explanation: check.explanation,
    supportingMetrics: check.supportingMetrics,
    suggestedImprovement: check.suggestedImprovement,
  };
}

function validateLiquidity(input: RiskRecommendationInput, rules: RiskRuleSet): RiskCheck {
  const liquidity = input.contract?.liquidity;
  if (!liquidity) {
    return fail('MISSING_LIQUIDITY_DATA', {}, 'Attach bid, ask, spread, volume, open interest, and IV to the recommendation package.');
  }
  if (liquidity.bid == null || liquidity.bid <= 0) {
    return fail('LOW_LIQUIDITY', { bid: liquidity.bid }, 'Wait for a live bid before requesting risk approval.');
  }
  if (liquidity.ask == null || liquidity.ask <= 0) {
    return fail('LOW_LIQUIDITY', { ask: liquidity.ask }, 'Wait for a live ask before requesting risk approval.');
  }
  if (liquidity.spreadPct == null || liquidity.spreadPct > rules.maximumSpreadPct) {
    return fail(
      'HIGH_SPREAD',
      { spreadPct: liquidity.spreadPct, maximumSpreadPct: rules.maximumSpreadPct },
      'Use a tighter contract or wait for the spread to narrow.'
    );
  }
  if (liquidity.volume == null || liquidity.volume < rules.minimumVolume) {
    return fail('LOW_LIQUIDITY', { volume: liquidity.volume, minimumVolume: rules.minimumVolume }, 'Use a contract with higher same-day volume.');
  }
  if (liquidity.openInterest == null || liquidity.openInterest < rules.minimumOpenInterest) {
    return fail(
      'LOW_LIQUIDITY',
      { openInterest: liquidity.openInterest, minimumOpenInterest: rules.minimumOpenInterest },
      'Use a contract with stronger open interest.'
    );
  }
  if (liquidity.impliedVolatility != null && liquidity.impliedVolatility > rules.maximumIv) {
    return fail('HIGH_IV', { impliedVolatility: liquidity.impliedVolatility, maximumIv: rules.maximumIv }, 'Wait for IV to normalize or choose a lower-IV structure.');
  }
  return pass('Liquidity metrics satisfy bid, ask, spread, volume, open interest, and IV limits.', {
    spreadPct: liquidity.spreadPct,
    volume: liquidity.volume,
    openInterest: liquidity.openInterest,
  });
}

function validateGreeks(
  input: RiskRecommendationInput,
  portfolio: RiskPortfolioSnapshot,
  rules: RiskRuleSet,
  contracts: number
): RiskCheck {
  const next = estimateGreekImpact(portfolio.greeks, normalizeGreeks(input.contract?.greeks), contracts);
  if (next.delta != null && Math.abs(next.delta) > rules.maximumDelta) {
    return fail('MAX_DELTA', { portfolioDelta: next.delta, maximumDelta: rules.maximumDelta }, 'Reduce size or use a hedge with lower directional exposure.');
  }
  if (next.gamma != null && Math.abs(next.gamma) > rules.maximumGamma) {
    return fail('MAX_GAMMA', { portfolioGamma: next.gamma, maximumGamma: rules.maximumGamma }, 'Reduce size or choose a lower-gamma contract.');
  }
  if (next.theta != null && Math.abs(next.theta) > rules.maximumTheta) {
    return fail('MAX_THETA', { portfolioTheta: next.theta, maximumTheta: rules.maximumTheta }, 'Reduce theta decay or select a farther-dated contract.');
  }
  if (next.vega != null && Math.abs(next.vega) > rules.maximumVega) {
    return fail('MAX_VEGA', { portfolioVega: next.vega, maximumVega: rules.maximumVega }, 'Reduce volatility exposure before approval.');
  }
  return pass('Portfolio Greeks remain inside configured limits after the proposed size.', {
    delta: next.delta,
    gamma: next.gamma,
    theta: next.theta,
    vega: next.vega,
  });
}

function validateBuyingPower(portfolio: RiskPortfolioSnapshot, allocation: number): RiskCheck {
  if (portfolio.buyingPower == null) {
    return pass('Buying power was not available from persisted state; approval remains limited by capital and risk rules.', {
      buyingPowerKnown: false,
      allocation,
    });
  }
  if (allocation > portfolio.buyingPower) {
    return fail(
      'INSUFFICIENT_BUYING_POWER',
      { buyingPower: portfolio.buyingPower, allocation },
      'Reduce position size or free buying power before requesting approval.'
    );
  }
  return pass('Buying power covers the proposed allocation.', { buyingPower: portfolio.buyingPower, allocation });
}

function validateCorrelation(correlation: CorrelationResult, rules: RiskRuleSet): RiskCheck {
  if (correlation.score > rules.maximumCorrelation) {
    return fail(
      'HIGH_CORRELATION',
      { correlationScore: correlation.score, maximumCorrelation: rules.maximumCorrelation, symbols: correlation.correlatedSymbols.join(',') },
      'Reduce size or avoid adding another position in the same correlation cluster.'
    );
  }
  return pass(correlation.explanation, { correlationScore: correlation.score });
}

function validateDailyBudget(portfolio: RiskPortfolioSnapshot, allocation: number, rules: RiskRuleSet): RiskCheck {
  if (portfolio.riskBudget.remainingRiskBudget <= 0 || allocation > portfolio.riskBudget.remainingRiskBudget) {
    return fail(
      'MAX_DAILY_LOSS',
      { remainingRiskBudget: portfolio.riskBudget.remainingRiskBudget, allocation, maximumDailyLoss: rules.maximumDailyLoss },
      'Wait for the next trading session or reduce risk below the remaining daily budget.'
    );
  }
  return pass('Daily risk budget can absorb the proposed allocation.', {
    remainingRiskBudget: portfolio.riskBudget.remainingRiskBudget,
    allocation,
  });
}

function validateRecommendation(input: RiskRecommendationInput, rules: RiskRuleSet): RiskCheck[] {
  const checks: RiskCheck[] = [];
  if (!riskEngineEnabled()) {
    checks.push(fail('NO_ACTIONABLE_RECOMMENDATION', { riskEngineEnabled: false }, 'Enable RISK_ENGINE_ENABLED before approving risk.'));
  }
  if (input.recommendation.action !== 'BUY') {
    checks.push(
      fail(
        'NO_ACTIONABLE_RECOMMENDATION',
        { action: input.recommendation.action },
        'Only actionable BUY recommendations can receive execution approval.'
      )
    );
  }
  if (input.confidence < rules.minimumConfidence) {
    checks.push(fail('LOW_CONFIDENCE', { confidence: input.confidence, minimumConfidence: rules.minimumConfidence }, 'Wait for stronger evidence or more confirming strategies.'));
  }
  if (!isMarketOpen(input.marketStatus)) {
    checks.push(fail('MARKET_CLOSED', { marketStatus: input.marketStatus }, 'Request approval only while the relevant market is open.'));
  }
  const lockout = input.eventContext.latestEvents.find(event => event.importance >= rules.newsLockoutImportance);
  if (lockout) {
    checks.push(
      fail(
        'NEWS_LOCKOUT',
        { event: lockout.title, importance: lockout.importance, lockoutThreshold: rules.newsLockoutImportance },
        'Wait for event risk to settle or lower the news lockout threshold by rule version.'
      )
    );
  }
  return checks;
}

export function evaluateRiskApproval(
  input: RiskRecommendationInput,
  portfolio: RiskPortfolioSnapshot,
  now = new Date()
): ApprovalPackage {
  const rules = getRiskRuleSet(now);
  const sizing = calculatePositionSize(input, portfolio, rules);
  const correlationRisk = estimateCorrelationRisk(input, portfolio);
  const liquidityRisk = validateLiquidity(input, rules);
  const greekRisk = validateGreeks(input, portfolio, rules, sizing.suggestedContracts);
  const buyingPowerRisk = validateBuyingPower(portfolio, sizing.capitalAllocation);
  const checks: RiskCheck[] = [
    ...validateRecommendation(input, rules),
    liquidityRisk,
    greekRisk,
    buyingPowerRisk,
    validateCorrelation(correlationRisk, rules),
    validateDailyBudget(portfolio, sizing.capitalAllocation, rules),
  ];

  if (sizing.suggestedContracts <= 0) {
    checks.push(
      fail(
        'MAX_POSITION_SIZE',
        { suggestedContracts: sizing.suggestedContracts, dollarRisk: sizing.dollarRisk },
        'Increase available risk budget or reduce unit contract risk.'
      )
    );
  }
  if (sizing.suggestedContracts > rules.maximumContracts || sizing.dollarRisk > rules.maximumDollarRisk) {
    checks.push(
      fail(
        'MAX_DOLLAR_RISK',
        { suggestedContracts: sizing.suggestedContracts, dollarRisk: sizing.dollarRisk, maximumDollarRisk: rules.maximumDollarRisk },
        'Reduce requested contracts below configured dollar risk.'
      )
    );
  }
  if (portfolio.exposure.currentOpenTrades >= rules.maximumOpenTrades) {
    checks.push(
      fail(
        'MAX_OPEN_TRADES',
        { currentOpenTrades: portfolio.exposure.currentOpenTrades, maximumOpenTrades: rules.maximumOpenTrades },
        'Close or reduce existing positions before opening another trade.'
      )
    );
  }
  const sectorRatio = sectorExposureRatio(portfolio, input.sector, sizing.capitalAllocation);
  if (sectorRatio > rules.maximumSectorExposurePct) {
    checks.push(
      fail(
        'MAX_SECTOR_EXPOSURE',
        { sector: input.sector, sectorExposurePct: Number(sectorRatio.toFixed(4)), maximumSectorExposurePct: rules.maximumSectorExposurePct },
        'Reduce size or avoid adding more exposure to this sector.'
      )
    );
  }

  const reasons = checks.map(buildReason).filter(Boolean) as ApprovalPackage['reasons'];
  const approved = riskApprovalRequired() ? reasons.length === 0 : reasons.every(reason => reason.code === 'NO_ACTIONABLE_RECOMMENDATION');
  return {
    approved,
    status: approved ? 'APPROVE' : 'REJECT',
    approvalId: randomUUID(),
    recommendationId: input.recommendationId,
    suggestedPositionSize: sizing,
    portfolioRisk: portfolio.riskBudget,
    sectorExposure: portfolio.exposure.sectorExposure,
    correlationRisk,
    liquidityRisk,
    greekRisk,
    buyingPowerRisk,
    remainingRiskBudget: Math.max(0, Number((portfolio.riskBudget.remainingRiskBudget - sizing.capitalAllocation).toFixed(2))),
    reasons,
    warnings: [
      ...(input.contract?.estimatedUnitRisk == null ? ['Contract unit risk was not supplied; configurable default risk was used for sizing.'] : []),
      ...(portfolio.buyingPower == null ? ['Buying power is unavailable in persisted state; live broker buying power was not queried by this read-side engine.'] : []),
    ],
    timestamp: now.toISOString(),
  };
}
