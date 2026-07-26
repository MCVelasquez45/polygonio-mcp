import type { MarketRegimeType } from '../../strategyOrchestrator/types/orchestratorTypes';
import type { PositionSizeResult, RiskPortfolioSnapshot, RiskRecommendationInput, RiskRuleSet } from '../types/riskTypes';

function regimeMultiplier(regime: MarketRegimeType): number {
  if (regime === 'HIGH_VOLATILITY' || regime === 'RISK_OFF' || regime === 'MACRO_DRIVEN') return 0.55;
  if (regime === 'NEWS_DRIVEN' || regime === 'SECTOR_ROTATION') return 0.7;
  if (regime === 'LOW_VOLATILITY' || regime === 'RISK_ON' || regime === 'TRENDING') return 1;
  return 0.8;
}

export function calculatePositionSize(
  input: RiskRecommendationInput,
  portfolio: RiskPortfolioSnapshot,
  rules: RiskRuleSet
): PositionSizeResult {
  const unitRisk = input.contract?.estimatedUnitRisk && input.contract.estimatedUnitRisk > 0
    ? input.contract.estimatedUnitRisk
    : rules.defaultContractRisk;
  const confidence = Math.max(0, Math.min(1, input.confidence));
  const expectedReturn = Math.max(0, input.expectedReturn);
  const heat = portfolio.riskBudget.maximumOpenRisk > 0
    ? Math.min(1, portfolio.riskBudget.openRisk / portfolio.riskBudget.maximumOpenRisk)
    : 0;
  const maxRiskByPortfolio = portfolio.portfolioSize * rules.maximumPositionSizePct;
  const confidenceBudget = rules.maximumDollarRisk * (0.35 + confidence * 0.65);
  const returnBudget = confidenceBudget * (1 + Math.min(0.5, expectedReturn));
  const adjustedBudget = returnBudget * (1 - heat * 0.5) * regimeMultiplier(input.marketRegime.current);
  const dollarRisk = Number(Math.max(0, Math.min(rules.maximumDollarRisk, maxRiskByPortfolio, adjustedBudget)).toFixed(2));
  const suggestedContracts = Math.max(0, Math.min(rules.maximumContracts, Math.floor(dollarRisk / unitRisk)));
  const capitalAllocation = Number((suggestedContracts * unitRisk).toFixed(2));
  return {
    suggestedContracts,
    dollarRisk: capitalAllocation,
    capitalAllocation,
    expectedPortfolioImpact: portfolio.portfolioSize > 0 ? Number((capitalAllocation / portfolio.portfolioSize).toFixed(4)) : 0,
    explanation:
      `Sizing used confidence ${confidence.toFixed(2)}, expected return ${expectedReturn.toFixed(2)}, ` +
      `portfolio heat ${heat.toFixed(2)}, ${input.marketRegime.current} regime, and unit risk $${unitRisk.toFixed(2)}.`,
  };
}
