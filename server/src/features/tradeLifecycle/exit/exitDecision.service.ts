import type {
  LifecycleEvaluationInput,
  LifecycleMonitoringDecision,
  MonitoringAction,
} from '../types/lifecycleTypes';
import { buildCurrentConfidence } from '../monitor/confidence.service';

function hasMeaningfulExitReason(input: LifecycleEvaluationInput, confidenceDelta: number | null): string | null {
  const reasons: string[] = [];
  if (input.updatedThesis && input.originalThesis && input.updatedThesis !== input.originalThesis) {
    reasons.push('updated thesis no longer matches original thesis');
  }
  if (input.strategyChanged) reasons.push('strategy winner changed');
  if (input.riskChanged) reasons.push('risk profile changed');
  if (input.eventRisk) reasons.push(`event intelligence risk: ${input.eventRisk}`);
  if (input.daysToExpiration != null && input.daysToExpiration <= 1) reasons.push('time decay risk is elevated');
  if (input.spreadPct != null && input.spreadPct > 25) reasons.push('spread is too wide for clean management');
  if (confidenceDelta != null && confidenceDelta <= -20) reasons.push('confidence weakened materially');
  if (input.volatility != null && input.volatility > 0.75) reasons.push('volatility regime changed');
  return reasons.length ? reasons.join('; ') : null;
}

export function evaluateLifecycleExit(input: LifecycleEvaluationInput): LifecycleMonitoringDecision {
  const returnPct = input.returnPct;
  const confidence = buildCurrentConfidence({
    entryConfidence: input.entryConfidence,
    returnPct,
    spreadPct: input.spreadPct,
    daysToExpiration: input.daysToExpiration,
    quoteFresh: null,
    riskChanged: input.riskChanged,
    strategyChanged: input.strategyChanged,
  });
  const reasoning: string[] = [];
  const thesisReason = hasMeaningfulExitReason(input, confidence.delta);
  let action: MonitoringAction = 'HOLD';
  let exitRequired = false;
  let exitReason: string | null = null;

  if (input.state === 'PENDING_ENTRY' || input.state === 'ENTRY_SUBMITTED') {
    action = 'WAIT';
    reasoning.push('Entry is not broker-filled yet.');
  } else if (input.state === 'EXIT_PENDING' || input.state === 'PARTIAL_EXIT') {
    action = 'WAIT';
    reasoning.push('Exit lifecycle is already in progress through the existing execution path.');
  } else if (input.state === 'MONITORING') {
    if (thesisReason && returnPct != null && returnPct < -20) {
      action = 'EXIT';
      exitRequired = true;
      exitReason = thesisReason;
    } else if (thesisReason && confidence.trend === 'Weakening') {
      action = 'SCALE_OUT';
      reasoning.push(thesisReason);
    } else if (returnPct != null && returnPct >= 30 && confidence.trend !== 'Weakening') {
      action = 'TAKE_PROFIT';
      reasoning.push('Profit target zone reached while thesis confidence remains intact.');
    } else if (returnPct != null && returnPct <= -15 && confidence.trend === 'Weakening') {
      action = 'MOVE_STOP';
      reasoning.push('Loss is expanding and confidence is weakening; stop should tighten.');
    } else {
      action = 'HOLD';
      reasoning.push('No combined thesis, risk, liquidity, time-decay, or confidence trigger requires action.');
    }
  } else {
    action = 'NO_ACTION';
    reasoning.push('Trade is outside active monitoring state.');
  }

  if (action === 'EXIT' && !exitReason) {
    exitReason = thesisReason ?? 'multi-factor exit condition';
  }
  if (action === 'EXIT') {
    reasoning.push(`Exit requires multi-factor reasoning: ${exitReason}.`);
  }
  if (confidence.trend !== 'Unknown') {
    reasoning.push(`Confidence trend is ${confidence.trend} (${confidence.entry ?? 'n/a'} -> ${confidence.current ?? 'n/a'}).`);
  }

  return { action, confidence, reasoning, exitRequired, exitReason };
}
