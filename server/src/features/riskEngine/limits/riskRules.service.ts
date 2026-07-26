import type { RiskReasonCode, RiskRuleSet } from '../types/riskTypes';

function numEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function riskEngineEnabled(): boolean {
  return (process.env.RISK_ENGINE_ENABLED ?? 'true').toLowerCase() !== 'false';
}

export function riskApprovalRequired(): boolean {
  return (process.env.RISK_ENGINE_APPROVAL_REQUIRED ?? 'true').toLowerCase() !== 'false';
}

export function getRiskRuleSet(now = new Date()): RiskRuleSet {
  return {
    ruleVersion: process.env.RISK_ENGINE_RULE_VERSION ?? 'risk-v1',
    maximumContracts: numEnv('RISK_MAX_CONTRACTS', 10),
    maximumDollarRisk: numEnv('RISK_MAX_DOLLAR_RISK', 750),
    maximumDailyLoss: numEnv('RISK_MAX_DAILY_LOSS', 1_500),
    maximumPositionSizePct: numEnv('RISK_MAX_POSITION_SIZE_PCT', 0.05),
    maximumSectorExposurePct: numEnv('RISK_MAX_SECTOR_EXPOSURE_PCT', 0.35),
    maximumCorrelation: numEnv('RISK_MAX_CORRELATION', 0.75),
    maximumGamma: numEnv('RISK_MAX_GAMMA', 0.35),
    maximumTheta: numEnv('RISK_MAX_THETA_ABS', 300),
    maximumDelta: numEnv('RISK_MAX_DELTA_ABS', 300),
    maximumVega: numEnv('RISK_MAX_VEGA_ABS', 500),
    maximumOpenTrades: numEnv('RISK_MAX_OPEN_TRADES', 8),
    minimumConfidence: numEnv('RISK_MIN_CONFIDENCE', 0.6),
    maximumSpreadPct: numEnv('RISK_MAX_SPREAD_PCT', 0.18),
    minimumVolume: numEnv('RISK_MIN_VOLUME', 100),
    minimumOpenInterest: numEnv('RISK_MIN_OPEN_INTEREST', 250),
    maximumIv: numEnv('RISK_MAX_IV', 1.2),
    newsLockoutImportance: numEnv('RISK_NEWS_LOCKOUT_IMPORTANCE', 98),
    defaultPortfolioSize: numEnv('RISK_DEFAULT_PORTFOLIO_SIZE', 100_000),
    defaultContractRisk: numEnv('RISK_DEFAULT_CONTRACT_RISK', 250),
    createdAt: now.toISOString(),
    reason: 'Default enterprise risk rules loaded from environment with conservative fallbacks.',
  };
}

export const RISK_REASON_EXPLANATIONS: Record<RiskReasonCode, string> = {
  MAX_SECTOR_EXPOSURE: 'The recommendation would exceed the configured sector exposure limit.',
  MAX_POSITION_SIZE: 'The recommendation would exceed the maximum single-position allocation.',
  LOW_LIQUIDITY: 'The contract liquidity is below enterprise requirements.',
  HIGH_SPREAD: 'The bid/ask spread is too wide for controlled execution risk.',
  HIGH_IV: 'Implied volatility is above the configured risk ceiling.',
  LOW_CONFIDENCE: 'The upstream recommendation confidence is below the risk approval threshold.',
  MAX_DAILY_LOSS: 'Daily realized or unrealized losses have consumed the configured risk budget.',
  INSUFFICIENT_BUYING_POWER: 'Available buying power is insufficient for the recommended allocation.',
  HIGH_CORRELATION: 'The recommendation is highly correlated with existing portfolio exposure.',
  MAX_GAMMA: 'Portfolio gamma would exceed the configured limit.',
  MAX_DELTA: 'Portfolio delta would exceed the configured limit.',
  MAX_THETA: 'Portfolio theta decay would exceed the configured limit.',
  MAX_VEGA: 'Portfolio vega would exceed the configured limit.',
  MARKET_CLOSED: 'The market is closed or unavailable, so a new risk approval cannot be issued.',
  NEWS_LOCKOUT: 'A very high-importance event requires operator review before new risk approval.',
  MAX_OPEN_TRADES: 'The account already has the maximum allowed concurrent open trades.',
  MAX_DOLLAR_RISK: 'The recommended dollar risk exceeds the configured per-trade risk limit.',
  NO_ACTIONABLE_RECOMMENDATION: 'The upstream package is not an actionable buy recommendation.',
  MISSING_LIQUIDITY_DATA: 'Required liquidity data was not supplied, so risk approval cannot verify execution quality.',
};
