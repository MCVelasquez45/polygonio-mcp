import type { AutonomousTradingMode } from '../types/pipelineTypes';

export type AutonomousEntryGateInput = {
  autonomousTradingEnabled: boolean;
  autonomousEntryEnabled: boolean;
  mode: AutonomousTradingMode;
  alpacaPaperConfirmed: boolean;
  marketOpen: boolean;
  automationReady: boolean;
  mongoConnected: boolean;
  brokerTruthCurrent: boolean;
  executionLeaseOwned: boolean;
  emergencyStopActive: boolean;
  riskApprovalExists: boolean;
  riskApproved: boolean;
  riskApprovalExpired: boolean;
  recommendationMatchesApproval: boolean;
  lifecycleAlreadyExists: boolean;
  duplicateOrderIntentExists: boolean;
  positionAndOrderLimitsPermitEntry: boolean;
};

export type AutonomousEntryGateResult =
  | { allowed: true; reasonCodes: []; explanation: string }
  | { allowed: false; reasonCodes: string[]; explanation: string };

const REASON_TEXT: Record<string, string> = {
  AUTONOMOUS_TRADING_DISABLED: 'Autonomous trading is disabled.',
  AUTONOMOUS_ENTRY_DISABLED: 'Autonomous paper entries are disabled.',
  MODE_NOT_AUTONOMOUS_PAPER: 'The system is not in Autonomous Paper mode.',
  ALPACA_NOT_CONFIRMED_PAPER: 'Alpaca is not confirmed as paper trading.',
  MARKET_NOT_OPEN: 'The market is not open for entries.',
  AUTOMATION_NOT_READY: 'Automation readiness checks have not passed.',
  MONGO_DISCONNECTED: 'MongoDB is disconnected.',
  BROKER_TRUTH_STALE: 'Broker truth is stale or unavailable.',
  EXECUTION_LEASE_NOT_OWNED: 'This process does not own the execution lease.',
  EMERGENCY_STOP_ACTIVE: 'Emergency Stop is active.',
  RISK_APPROVAL_MISSING: 'No Risk Engine approval package is available.',
  RISK_APPROVAL_REJECTED: 'The Risk Engine rejected this recommendation.',
  RISK_APPROVAL_EXPIRED: 'The Risk Engine approval package is expired.',
  RECOMMENDATION_APPROVAL_MISMATCH: 'The recommendation no longer matches the approval package.',
  LIFECYCLE_ALREADY_EXISTS: 'A lifecycle record already exists for this recommendation.',
  DUPLICATE_ORDER_INTENT: 'A duplicate order intent already exists.',
  POSITION_OR_ORDER_LIMIT_BLOCK: 'Position or order limits block a new entry.',
};

export function evaluateAutonomousEntryGate(input: AutonomousEntryGateInput): AutonomousEntryGateResult {
  const reasonCodes: string[] = [];
  if (!input.autonomousTradingEnabled) reasonCodes.push('AUTONOMOUS_TRADING_DISABLED');
  if (!input.autonomousEntryEnabled) reasonCodes.push('AUTONOMOUS_ENTRY_DISABLED');
  if (input.mode !== 'AUTONOMOUS_PAPER') reasonCodes.push('MODE_NOT_AUTONOMOUS_PAPER');
  if (!input.alpacaPaperConfirmed) reasonCodes.push('ALPACA_NOT_CONFIRMED_PAPER');
  if (!input.marketOpen) reasonCodes.push('MARKET_NOT_OPEN');
  if (!input.automationReady) reasonCodes.push('AUTOMATION_NOT_READY');
  if (!input.mongoConnected) reasonCodes.push('MONGO_DISCONNECTED');
  if (!input.brokerTruthCurrent) reasonCodes.push('BROKER_TRUTH_STALE');
  if (!input.executionLeaseOwned) reasonCodes.push('EXECUTION_LEASE_NOT_OWNED');
  if (input.emergencyStopActive) reasonCodes.push('EMERGENCY_STOP_ACTIVE');
  if (!input.riskApprovalExists) reasonCodes.push('RISK_APPROVAL_MISSING');
  if (input.riskApprovalExists && !input.riskApproved) reasonCodes.push('RISK_APPROVAL_REJECTED');
  if (input.riskApprovalExpired) reasonCodes.push('RISK_APPROVAL_EXPIRED');
  if (!input.recommendationMatchesApproval) reasonCodes.push('RECOMMENDATION_APPROVAL_MISMATCH');
  if (input.lifecycleAlreadyExists) reasonCodes.push('LIFECYCLE_ALREADY_EXISTS');
  if (input.duplicateOrderIntentExists) reasonCodes.push('DUPLICATE_ORDER_INTENT');
  if (!input.positionAndOrderLimitsPermitEntry) reasonCodes.push('POSITION_OR_ORDER_LIMIT_BLOCK');

  if (reasonCodes.length === 0) {
    return { allowed: true, reasonCodes: [], explanation: 'All autonomous paper entry gates passed.' };
  }
  return {
    allowed: false,
    reasonCodes,
    explanation: reasonCodes.map(code => REASON_TEXT[code] ?? code).join(' '),
  };
}

