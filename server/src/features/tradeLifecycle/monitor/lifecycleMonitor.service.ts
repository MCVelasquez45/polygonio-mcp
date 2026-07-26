import { evaluateLifecycleExit } from '../exit/exitDecision.service';
import type { LifecycleEvaluationInput, LifecycleMonitoringDecision } from '../types/lifecycleTypes';

export function evaluateLifecycleMonitoring(input: LifecycleEvaluationInput): LifecycleMonitoringDecision {
  return evaluateLifecycleExit(input);
}
